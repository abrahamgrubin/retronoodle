import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tagLineToTopic, TRANSCRIPTION_CAPTURE_PHASES, type Database } from '@retronoodle/shared';
import { parseMasterKey, encryptForTeam } from '@retronoodle/worker';
import { can } from '../auth/can.js';
import { claimsToUser, type VerifyAccessToken } from '../auth/index.js';
import { fetchActiveRecordingSession } from '../recordingSession.js';
import type { RealtimeBus } from '../realtime/RealtimeBus.js';
import { recordTranscriptionUsage } from '../transcription/costTracking.js';
import type { TranscriptionProvider } from '../transcription/TranscriptionProvider.js';

export interface AudioGatewayDeps {
  supabaseAdmin: SupabaseClient<Database>;
  verifyAccessToken: VerifyAccessToken;
  realtimeBus: RealtimeBus;
  transcriptMasterKey: string | undefined;
  /** Returns null when no provider is configured (no DEEPGRAM_API_KEY) — the one seam a test
   * swaps a FakeTranscriptionProvider through, and the one place production decides Deepgram. */
  createProvider: () => TranscriptionProvider | null;
  /** How often (ms) to flush elapsed streaming time into transcription_usage — a constant, not
   * config, since it only trades off write volume against reporting granularity. */
  usageFlushIntervalMs?: number;
}

const USAGE_FLUSH_INTERVAL_MS_DEFAULT = 10_000;

/** The minimal structural slice of `ws`'s WebSocket this route actually uses — avoids depending
 * on `ws`'s own type declarations directly (only a transitive dependency via @fastify/websocket);
 * the real socket Fastify hands the handler satisfies this structurally. */
interface GatewaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: Buffer | ArrayBuffer, isBinary: boolean) => void): void;
  on(event: 'close', cb: () => void): void;
}

function closeWith(socket: GatewaySocket, code: number, reason: string): void {
  try {
    socket.send(JSON.stringify({ type: 'error', reason }));
  } catch {
    // Socket may already be past OPEN — closing below is what actually matters.
  }
  socket.close(code, reason);
}

/**
 * GET /retros/:id/audio-gateway (RN-033): the facilitator's browser streams Opus-encoded audio
 * over this WebSocket; the gateway forwards it to a `TranscriptionProvider`, persists each final
 * line (encrypted, RN-031's envelope scheme) tagged to its topic (RN-034), and broadcasts it live
 * to the retro channel. A browser can't set an Authorization header on a WebSocket upgrade, so the
 * access token travels as a query param instead — this route does its own auth, phase and
 * consent-session gating rather than reusing the header-based `requireAuth` preHandler.
 *
 * Closes immediately (never accepts a frame) unless: the caller is the retro's facilitator, the
 * retro is in Discuss or Wrap up (the story's own "stream only during Discuss and Wrap up" AC),
 * there's an active `recording` session (RN-032's consent gate), and a provider is configured —
 * the last of these is what the "Deepgram outage shows 'Transcription unavailable'" AC maps to.
 */
export function registerAudioGatewayRoutes(app: FastifyInstance, deps: AudioGatewayDeps): void {
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/retros/:id/audio-gateway',
    { websocket: true },
    async (socket: GatewaySocket, request: FastifyRequest<{ Params: { id: string }; Querystring: { token?: string } }>) => {
      // Found live: the browser considers its own socket "open" (and starts streaming — see
      // audioCapture.ts) the instant the WebSocket upgrade itself completes, well before this
      // handler function has done ANY of its own async setup below — auth, two DB round trips for
      // the retro/recording session, and `provider.startSession()` itself, which is a full round
      // trip to Deepgram's own connect handshake. `socket.on('message', ...)` registered only
      // after all of that finished was missing every frame the browser sent in that window —
      // including its very first one, the only chunk carrying the WebM container's own header, so
      // every later chunk arrived with no header context behind it and nothing Deepgram could
      // parse into anything at all (zero "Results" messages, ever, despite real bytes arriving,
      // reproduced over and over regardless of client-side fixes — the loss was always here).
      // Registering the listener as the very first thing this handler does, before any `await`,
      // and buffering until the real processing function is ready, is what finally closes that gap.
      const earlyFrames: Buffer[] = [];
      let handleMessage = (chunk: Buffer) => {
        earlyFrames.push(chunk);
      };
      socket.on('message', (data, isBinary) => {
        if (!isBinary) return; // No control-frame protocol yet — every binary frame is audio.
        handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      });

      const retroId = request.params.id;
      const token = request.query.token;
      if (!token) return closeWith(socket, 4401, 'unauthorized');

      let user;
      try {
        user = claimsToUser(await deps.verifyAccessToken(token));
      } catch {
        return closeWith(socket, 4401, 'unauthorized');
      }

      const { data: retro, error: retroError } = await deps.supabaseAdmin
        .from('retros')
        .select('team_id, facilitator_id, phase')
        .eq('id', retroId)
        .maybeSingle();
      if (retroError || !retro) return closeWith(socket, 4404, 'not_found');

      if (!can(user, 'retro.manageRecording', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
        return closeWith(socket, 4403, 'forbidden');
      }
      if (!(TRANSCRIPTION_CAPTURE_PHASES as readonly string[]).includes(retro.phase)) {
        return closeWith(socket, 4409, 'phase_not_allowed');
      }

      const { data: session, error: sessionError } = await fetchActiveRecordingSession(deps.supabaseAdmin, retroId);
      if (sessionError || !session || session.status !== 'recording') {
        return closeWith(socket, 4409, 'not_recording');
      }

      if (!deps.transcriptMasterKey) return closeWith(socket, 4503, 'transcription_unavailable');
      const masterKey = parseMasterKey(deps.transcriptMasterKey);

      const provider = deps.createProvider();
      if (!provider) return closeWith(socket, 4503, 'transcription_unavailable');

      const streamStartedAt = Date.now();

      async function tagToTopic(relativeStartMs: number): Promise<string | null> {
        const { data: topics } = await deps.supabaseAdmin.from('topics').select('id, started_at, ended_at').eq('retro_id', retroId);
        const candidates = (topics ?? []).map((t) => ({
          id: t.id,
          startedAt: t.started_at ? new Date(t.started_at).getTime() : null,
          endedAt: t.ended_at ? new Date(t.ended_at).getTime() : null,
        }));
        return tagLineToTopic({ startMs: streamStartedAt + relativeStartMs }, candidates);
      }

      async function persistAndBroadcast(text: string, startMs: number, endMs: number, speakerTag: number | null, isGapMarker: boolean) {
        const topicId = await tagToTopic(startMs);
        const encrypted = await encryptForTeam(deps.supabaseAdmin, masterKey, retro!.team_id, text);
        const { data: inserted, error: insertError } = await deps.supabaseAdmin
          .from('transcript_segments')
          .insert({
            retro_id: retroId,
            team_id: retro!.team_id,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            auth_tag: encrypted.authTag,
            topic_id: topicId,
            speaker_tag: speakerTag,
            start_ms: startMs,
            end_ms: endMs,
            is_gap_marker: isGapMarker,
          })
          .select()
          .single();
        if (insertError || !inserted) {
          request.log.error({ err: insertError }, 'failed to persist transcript segment');
          return;
        }
        await deps.realtimeBus.broadcastRetro(retroId, {
          type: 'transcript.line',
          payload: {
            segment: {
              id: inserted.id,
              retroId,
              topicId: inserted.topic_id,
              speakerTag: inserted.speaker_tag,
              speakerUserId: inserted.speaker_user_id,
              text,
              startMs: inserted.start_ms,
              endMs: inserted.end_ms,
              isGapMarker: inserted.is_gap_marker,
              createdAt: new Date(inserted.created_at).toISOString(),
            },
          },
        });
      }

      let session_;
      try {
        session_ = await provider.startSession({
          onLine: (line) => {
            if (!line.isFinal) return;
            void persistAndBroadcast(line.text, line.startMs, line.endMs, line.speakerTag, false);
          },
          onError: (err) => {
            request.log.error(err, 'transcription provider error');
            closeWith(socket, 4503, 'transcription_unavailable');
          },
          onClose: (reason) => {
            // Found live: Deepgram closing the connection well inside its own documented 30s
            // idle timeout, with nothing anywhere saying why — this previously discarded the
            // close event's own code/reason entirely, which is the one piece of information that
            // would actually explain an early, silent disconnect like that.
            request.log.warn({ reason }, 'transcription provider connection closed');
            // RN-033: "facilitator tab drop records a gap and the next facilitator can resume" —
            // a marker with no text, at the moment the provider's own connection ended.
            void persistAndBroadcast('', Date.now() - streamStartedAt, Date.now() - streamStartedAt, null, true);
          },
          // Found live: a session that runs its full course and is torn down normally (recording
          // stopped, left Discuss) never fires onClose at all — this is the only way to tell "ran
          // fine, nobody said anything transcribable" apart from "never actually worked," since
          // both look identical from the outside otherwise (zero segments, no error anywhere).
          onSessionEnd: (stats) => request.log.info({ stats }, 'transcription session ended'),
        });
      } catch (err) {
        request.log.error(err, 'failed to start transcription session');
        return closeWith(socket, 4503, 'transcription_unavailable');
      }

      let lastUsageFlushAt = Date.now();
      const flushIntervalMs = deps.usageFlushIntervalMs ?? USAGE_FLUSH_INTERVAL_MS_DEFAULT;

      // Swaps the early-buffering stand-in above for the real per-chunk handling, then replays
      // anything that arrived (and was buffered) during this handler's own auth/DB/Deepgram-connect
      // setup — in the same order it arrived, so a header chunk buffered here is still first.
      handleMessage = (chunk: Buffer) => {
        try {
          session_.sendAudio(chunk);
        } catch (err) {
          // Defense in depth, not the fix itself (DeepgramProvider.ts now waits for the socket to
          // actually be open before ever returning) — a throw here is inside a `ws` message-event
          // handler, so left uncaught it crashes this whole process, not just this one gateway
          // connection (found live). Whatever the cause, the right response is closing this one
          // client's socket, never taking the server down with it.
          request.log.error(err, 'failed to forward audio to transcription provider');
          closeWith(socket, 4503, 'transcription_unavailable');
          return;
        }

        const now = Date.now();
        if (now - lastUsageFlushAt >= flushIntervalMs) {
          const elapsedSeconds = (now - lastUsageFlushAt) / 1000;
          lastUsageFlushAt = now;
          void recordTranscriptionUsage(deps.supabaseAdmin, retroId, elapsedSeconds);
        }
      };
      for (const chunk of earlyFrames) handleMessage(chunk);
      earlyFrames.length = 0;

      socket.on('close', () => {
        session_.close();
      });
    },
  );
}
