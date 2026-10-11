import type { TranscriptLine } from '@retronoodle/shared';

export interface TranscriptionSessionHandlers {
  onLine(line: TranscriptLine): void;
  onError(err: Error): void;
  /** Fires when the provider's own connection ends, for any reason other than our own `close()`
   * call — e.g. the provider dropped the connection. The gateway treats this the same as a
   * client-side socket drop: insert a gap marker, let the next connection resume. */
  onClose(): void;
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
