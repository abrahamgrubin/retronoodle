import { DEEPGRAM_MODEL, type TranscriptLine } from '@retronoodle/shared';
import type { TranscriptionProvider, TranscriptionSession, TranscriptionSessionHandlers } from './TranscriptionProvider.js';

interface DeepgramResultsMessage {
  type: 'Results';
  start: number;
  duration: number;
  is_final?: boolean;
  channel: {
    alternatives: { transcript: string; words: { speaker?: number }[] }[];
  };
}

/**
 * RN-033: Deepgram Nova-3 live streaming, diarization on, opted out of Deepgram's model
 * improvement program (the story's own requirement — "Opt out of Deepgram model improvement").
 * The only concrete `TranscriptionProvider` — nothing outside this file knows Deepgram's wire
 * format (its AC: "Swapping the provider requires changes only behind TranscriptionProvider").
 *
 * A raw WebSocket to Deepgram's own endpoint, not `@deepgram/sdk`'s `client.listen.v1.connect()`
 * — that wrapper's `V1Socket` accepted every audio chunk with zero errors anywhere (no thrown
 * exception, no `error`/`close` event, `waitForOpen()` resolving normally) but never once
 * delivered a single message back, live or in any test, across this feature's entire history.
 * Proven by direct comparison (found live): the exact same browser-captured WebM/Opus bytes,
 * replayed over a raw WebSocket straight to `wss://api.deepgram.com/v1/listen` with no SDK
 * involved, produced perfect real-time transcripts immediately. Whatever the SDK's wrapper does
 * differently, it silently breaks live streaming specifically — Deepgram's own batch REST
 * endpoint had no trouble with the same account/key/audio either. Node's own global `WebSocket`
 * is used here (no new dependency) — it can't set an `Authorization` header the way the `ws`
 * package can, but Deepgram also accepts the token as a WebSocket subprotocol for exactly this
 * reason (browsers can't set arbitrary handshake headers either).
 *
 * Diarization in Deepgram's wire format is per-word, not per-line (`words[].speaker`) — this
 * tags each emitted line with its first word's speaker, which is only ever wrong for a line that
 * (rarely) starts mid-handoff between two speakers.
 */
export class DeepgramProvider implements TranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async startSession(handlers: TranscriptionSessionHandlers): Promise<TranscriptionSession> {
    const params = new URLSearchParams({
      model: DEEPGRAM_MODEL,
      diarize: 'true',
      smart_format: 'true',
      punctuate: 'true',
      interim_results: 'true',
      mip_opt_out: 'true',
      // No `encoding`/`sample_rate` here — those tell Deepgram to expect a *raw*, headerless
      // bitstream (only correct for formats like linear16/mulaw that have no container of their
      // own). audioCapture.ts's MediaRecorder produces actual WebM-containerized Opus chunks
      // (`audio/webm;codecs=opus`), not bare Opus packets — Deepgram auto-detects a known
      // container's codec/sample-rate from its own headers, but only when these two params are
      // left unset.
    });
    const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', this.apiKey]);

    // Found live: Deepgram cleanly closing (code 1000) ~9s into a real session with nothing
    // transcribed, and no way to tell from the close event alone whether that's because no audio
    // ever reached it, or audio arrived but Deepgram's own VAD never detected speech in it. These
    // counts get folded into the close reason below — never the transcript text itself (CLAUDE.md:
    // no retro content in logs), just enough shape to tell those two cases apart next time.
    let chunkCount = 0;
    let totalBytes = 0;
    let resultsMessageCount = 0;
    let nonEmptyTranscriptCount = 0;

    // Sending audio before the socket is actually open throws synchronously from inside a `ws`
    // message-event handler elsewhere in this pipeline (audioGateway.ts), which Node treats as an
    // uncaught exception and crashes the whole process (found live: the very first audio chunk a
    // real browser sent killed the dev server outright) — waiting for `open` here is what
    // prevents that.
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener(
        'error',
        () => reject(new Error('Deepgram WebSocket failed to open')),
        { once: true },
      );
    });

    socket.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object' || (parsed as { type?: unknown }).type !== 'Results') return;
      resultsMessageCount += 1;
      const message = parsed as DeepgramResultsMessage;
      const alternative = message.channel.alternatives[0];
      if (!alternative || !alternative.transcript) return;
      nonEmptyTranscriptCount += 1;
      const line: TranscriptLine = {
        text: alternative.transcript,
        startMs: Math.round(message.start * 1000),
        endMs: Math.round((message.start + message.duration) * 1000),
        isFinal: message.is_final ?? false,
        speakerTag: alternative.words[0]?.speaker ?? null,
      };
      handlers.onLine(line);
    });
    socket.addEventListener('error', () => handlers.onError(new Error('Deepgram WebSocket error')));
    const stats = () => `chunks=${chunkCount} bytes=${totalBytes} results=${resultsMessageCount} nonEmpty=${nonEmptyTranscriptCount}`;
    let closedByUs = false;
    let sessionEndReported = false;
    const reportSessionEnd = () => {
      if (sessionEndReported) return;
      sessionEndReported = true;
      handlers.onSessionEnd?.(stats());
    };
    socket.addEventListener('close', (event) => {
      const closeEvent = event as unknown as { code?: number; reason?: string };
      reportSessionEnd();
      if (!closedByUs) handlers.onClose(`${closeEvent.code ?? 'unknown'} ${closeEvent.reason ?? ''} (${stats()})`.trim());
    });

    return {
      sendAudio(chunk) {
        chunkCount += 1;
        totalBytes += chunk.length;
        // DOM lib's WebSocket.send() types `BufferSource` against a real `ArrayBuffer`
        // specifically, not Node's `Buffer<ArrayBufferLike>` (which also covers
        // `SharedArrayBuffer`) — copying into a fresh Uint8Array satisfies that at zero real
        // cost (chunks are a few hundred bytes).
        socket.send(Uint8Array.from(chunk));
      },
      close() {
        closedByUs = true;
        reportSessionEnd();
        socket.close();
      },
    };
  }
}
