import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@retronoodle/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildServer } from '../server.js';
import type { AuthClaims } from '../auth/index.js';
import { chain } from '../testUtils/supabaseChain.js';
import { testAuthOptions } from '../testUtils/testAuth.js';
import { FakeTranscriptionProvider } from '../transcription/FakeTranscriptionProvider.js';
import type { TranscriptionProvider } from '../transcription/TranscriptionProvider.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const facilitatorClaims: AuthClaims = { sub: '00000000-0000-4000-8000-000000000001', email: 'f@example.com' };
const participantClaims: AuthClaims = { sub: '00000000-0000-4000-8000-000000000002', email: 'p@example.com' };

function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token === 'facilitator-token') return Promise.resolve(facilitatorClaims);
  if (token === 'participant-token') return Promise.resolve(participantClaims);
  return Promise.reject(new Error('invalid token'));
}

const retroId = '00000000-0000-4000-8000-0000000000aa';
const teamId = '00000000-0000-4000-8000-0000000000bb';
const masterKey = Buffer.alloc(32, 7).toString('base64');

function retroRow(phase: string) {
  return { team_id: teamId, facilitator_id: facilitatorClaims.sub, phase };
}

function recordingSessionRow() {
  return {
    id: '00000000-0000-4000-8000-0000000000cc',
    started_by: facilitatorClaims.sub,
    facilitator_confirmed_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    status: 'recording',
    started_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    stopped_at: null,
  };
}

function supabaseWith(opts: {
  retro?: { team_id: string; facilitator_id: string; phase: string } | null;
  session?: ReturnType<typeof recordingSessionRow> | null;
}) {
  const { retro = retroRow('discuss'), session = recordingSessionRow() } = opts;
  let teamKeyCallCount = 0;
  const from = vi.fn((table: string) => {
    if (table === 'retros') return chain({ data: retro, error: null });
    if (table === 'recording_sessions') return chain({ data: session, error: null });
    if (table === 'recording_consents') return chain({ data: [], error: null });
    if (table === 'topics') return chain({ data: [], error: null });
    if (table === 'team_transcript_keys') {
      teamKeyCallCount += 1;
      // First call: getOrCreateTeamDataKey's own lookup (none yet). Second: the insert of a
      // freshly generated one. Both resolve fine either way (chain()'s terminal only matters for
      // the first `.maybeSingle()`/`.then()` the code actually reads).
      return chain({ data: teamKeyCallCount === 1 ? null : undefined, error: null });
    }
    if (table === 'transcript_segments') {
      return chain({
        data: {
          id: '00000000-0000-4000-8000-0000000000e1',
          topic_id: null,
          speaker_tag: 0,
          speaker_user_id: null,
          start_ms: 0,
          end_ms: 1000,
          is_gap_marker: false,
          created_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        },
        error: null,
      });
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from } as unknown as SupabaseClient<Database>;
}

describe('GET /retros/:id/audio-gateway', () => {
  it('closes unauthorized when no token is given', async () => {
    app = await buildServer({
      webOrigin: 'http://localhost',
      auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: supabaseWith({}) }),
    });
    await app.ready();
    const ws = await app.injectWS(`/retros/${retroId}/audio-gateway`);
    const [code] = await new Promise<[number]>((resolve) => ws.once('close', (c: number) => resolve([c])));
    expect(code).toBe(4401);
  });

  it('closes forbidden for a non-facilitator', async () => {
    app = await buildServer({
      webOrigin: 'http://localhost',
      auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: supabaseWith({}) }),
    });
    await app.ready();
    const ws = await app.injectWS(`/retros/${retroId}/audio-gateway?token=participant-token`);
    const [code] = await new Promise<[number]>((resolve) => ws.once('close', (c: number) => resolve([c])));
    expect(code).toBe(4403);
  });

  it('closes phase_not_allowed outside Discuss/Wrap up', async () => {
    app = await buildServer({
      webOrigin: 'http://localhost',
      auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: supabaseWith({ retro: retroRow('vote') }) }),
    });
    await app.ready();
    const ws = await app.injectWS(`/retros/${retroId}/audio-gateway?token=facilitator-token`);
    const [code] = await new Promise<[number]>((resolve) => ws.once('close', (c: number) => resolve([c])));
    expect(code).toBe(4409);
  });

  it('closes not_recording when there is no active recording session', async () => {
    app = await buildServer({
      webOrigin: 'http://localhost',
      auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: supabaseWith({ session: null }) }),
    });
    await app.ready();
    const ws = await app.injectWS(`/retros/${retroId}/audio-gateway?token=facilitator-token`);
    const [code] = await new Promise<[number]>((resolve) => ws.once('close', (c: number) => resolve([c])));
    expect(code).toBe(4409);
  });

  it('closes transcription_unavailable when no master key is configured', async () => {
    app = await buildServer({
      webOrigin: 'http://localhost',
      auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: supabaseWith({}) }),
    });
    await app.ready();
    const ws = await app.injectWS(`/retros/${retroId}/audio-gateway?token=facilitator-token`);
    const [code] = await new Promise<[number]>((resolve) => ws.once('close', (c: number) => resolve([c])));
    expect(code).toBe(4503);
  });

  it('closes transcription_unavailable when no provider is configured', async () => {
    app = await buildServer({
      webOrigin: 'http://localhost',
      auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: supabaseWith({}), transcriptMasterKey: masterKey }),
    });
    await app.ready();
    const ws = await app.injectWS(`/retros/${retroId}/audio-gateway?token=facilitator-token`);
    const [code] = await new Promise<[number]>((resolve) => ws.once('close', (c: number) => resolve([c])));
    expect(code).toBe(4503);
  });

  it('persists and broadcasts a final line from the provider', async () => {
    const provider = new FakeTranscriptionProvider();
    const broadcastRetro = vi.fn().mockResolvedValue(undefined);
    app = await buildServer({
      webOrigin: 'http://localhost',
      auth: testAuthOptions({
        verifyAccessToken,
        supabaseAdmin: supabaseWith({}),
        transcriptMasterKey: masterKey,
        createTranscriptionProvider: () => provider,
        realtimeBus: { broadcastRetro, broadcastUser: vi.fn() } as never,
      }),
    });
    await app.ready();
    const ws = await app.injectWS(`/retros/${retroId}/audio-gateway?token=facilitator-token`);
    ws.send(Buffer.from([1, 2, 3]));

    // Give the handler's async auth/gating chain a tick to finish and register the provider
    // session before the test emits a line through it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    provider.emitLine({ text: 'we should automate releases', startMs: 0, endMs: 1200, isFinal: true, speakerTag: 0 });
    await vi.waitFor(() => expect(broadcastRetro).toHaveBeenCalled());

    expect(broadcastRetro).toHaveBeenCalledWith(
      retroId,
      expect.objectContaining({
        type: 'transcript.line',
        payload: expect.objectContaining({ segment: expect.objectContaining({ text: 'we should automate releases', isGapMarker: false }) }),
      }),
    );
    expect(provider.audioBytesReceived).toBe(3);
    ws.close();
  });

  it('closes gracefully instead of crashing when sendAudio throws', async () => {
    // Regression test: DeepgramProvider used to return before its socket actually reached OPEN,
    // so the very first real audio chunk threw synchronously inside a `ws` message handler — left
    // uncaught, that crashes the whole Node process, not just this one connection (found live,
    // against a real Deepgram socket). This fake reproduces that throw without needing Deepgram.
    const provider: TranscriptionProvider = {
      async startSession() {
        return {
          sendAudio: () => {
            throw new Error('Socket is not open.');
          },
          close: () => {},
        };
      },
    };
    app = await buildServer({
      webOrigin: 'http://localhost',
      auth: testAuthOptions({
        verifyAccessToken,
        supabaseAdmin: supabaseWith({}),
        transcriptMasterKey: masterKey,
        createTranscriptionProvider: () => provider,
      }),
    });
    await app.ready();
    const ws = await app.injectWS(`/retros/${retroId}/audio-gateway?token=facilitator-token`);
    const closed = new Promise<[number]>((resolve) => ws.once('close', (c: number) => resolve([c])));
    ws.send(Buffer.from([1, 2, 3]));

    const [code] = await closed;
    expect(code).toBe(4503);
  });
});
