import type { TranscriptLine } from '@retronoodle/shared';
import type { TranscriptionProvider, TranscriptionSession, TranscriptionSessionHandlers } from './TranscriptionProvider.js';

/**
 * A deterministic `TranscriptionProvider` for tests — no network, no SDK. `sendAudio` just
 * counts bytes (so cost-tracking logic has something to measure against); lines are emitted only
 * when the test calls `emitLine` directly, never derived from the "audio" at all.
 */
export class FakeTranscriptionProvider implements TranscriptionProvider {
  public audioBytesReceived = 0;
  public closed = false;
  private handlers: TranscriptionSessionHandlers | undefined;

  async startSession(handlers: TranscriptionSessionHandlers): Promise<TranscriptionSession> {
    this.handlers = handlers;
    return {
      sendAudio: (chunk) => {
        this.audioBytesReceived += chunk.byteLength;
      },
      close: () => {
        this.closed = true;
      },
    };
  }

  emitLine(line: TranscriptLine): void {
    this.handlers?.onLine(line);
  }

  emitError(err: Error): void {
    this.handlers?.onError(err);
  }

  emitClose(): void {
    this.handlers?.onClose();
  }
}
