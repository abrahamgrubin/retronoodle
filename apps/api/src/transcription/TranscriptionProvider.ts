import type { TranscriptLine } from '@retronoodle/shared';

export interface TranscriptionSessionHandlers {
  onLine(line: TranscriptLine): void;
  onError(err: Error): void;
  /** Fires when the provider's own connection ends, for any reason other than our own `close()`
   * call — e.g. the provider dropped the connection. The gateway treats this the same as a
   * client-side socket drop: insert a gap marker, let the next connection resume. `reason` is
   * whatever the provider's own close event names (Deepgram: its WebSocket close code/reason,
   * e.g. "1011 NET-0001") — found live: Deepgram closing well inside its own 30s idle timeout,
   * with nothing anywhere saying why, since this previously discarded the close event entirely. */
  onClose(reason?: string): void;
  /** Fires exactly once, right before the session ends either way (our own `close()` or the
   * provider's) — unlike `onClose`, not just the abnormal case. A session that runs its full
   * course and is torn down normally (recording stopped, left Discuss) never calls `onClose` at
   * all, so without this there was no way to tell "silently produced nothing because nobody ever
   * spoke into a working pipeline" apart from "silently produced nothing because the pipeline
   * never worked" (found live: a full session with no abnormal close and zero transcript either). */
  onSessionEnd?(stats: string): void;
}

export interface TranscriptionSession {
  /** Raw encoded audio (Opus, per the story's own technical notes) straight from the browser —
   * the provider is responsible for whatever framing/encoding config it needs. */
  sendAudio(chunk: Buffer): void;
  close(): void;
}

/**
 * RN-033 AC: "Swapping the provider requires changes only behind TranscriptionProvider" — the
 * audio gateway (routes/audioGateway.ts) only ever talks to this interface, never to Deepgram's
 * SDK directly. `startSession` rejects if the provider itself is unavailable (no credentials, or
 * the initial connect fails) — the gateway's own job is turning that into "Transcription
 * unavailable" for the client, not this interface's.
 */
export interface TranscriptionProvider {
  startSession(handlers: TranscriptionSessionHandlers): Promise<TranscriptionSession>;
}
