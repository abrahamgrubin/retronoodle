import { DeepgramClient } from '@deepgram/sdk';
import { DEEPGRAM_MODEL, type TranscriptLine } from '@retronoodle/shared';
import type { TranscriptionProvider, TranscriptionSession, TranscriptionSessionHandlers } from './TranscriptionProvider.js';

/**
 * RN-033: Deepgram Nova-3 live streaming, diarization on, opted out of Deepgram's model
 * improvement program (the story's own requirement — "Opt out of Deepgram model improvement").
 * The only concrete `TranscriptionProvider` — nothing outside this file knows Deepgram's SDK
 * shape (its AC: "Swapping the provider requires changes only behind TranscriptionProvider").
 *
 * Diarization in Deepgram's wire format is per-word, not per-line (`words[].speaker`) — this
 * tags each emitted line with its first word's speaker, which is only ever wrong for a line that
 * (rarely) starts mid-handoff between two speakers.
 */
export class DeepgramProvider implements TranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async startSession(handlers: TranscriptionSessionHandlers): Promise<TranscriptionSession> {
    const client = new DeepgramClient({ apiKey: this.apiKey });
    const socket = await client.listen.v1.connect({
      model: DEEPGRAM_MODEL,
      diarize: 'true',
      smart_format: 'true',
      punctuate: 'true',
      interim_results: 'true',
      encoding: 'opus',
      sample_rate: 48_000,
      mip_opt_out: true,
      Authorization: `Token ${this.apiKey}`,
    });

    socket.on('message', (message) => {
      if (message.type !== 'Results') return;
      const alternative = message.channel.alternatives[0];
      if (!alternative || !alternative.transcript) return;
      const line: TranscriptLine = {
        text: alternative.transcript,
        startMs: Math.round(message.start * 1000),
        endMs: Math.round((message.start + message.duration) * 1000),
        isFinal: message.is_final ?? false,
        speakerTag: alternative.words[0]?.speaker ?? null,
      };
      handlers.onLine(line);
    });
    socket.on('error', (err) => handlers.onError(err));
    let closedByUs = false;
    socket.on('close', () => {
      if (!closedByUs) handlers.onClose();
    });

    return {
      sendAudio(chunk) {
        socket.sendMedia(chunk);
      },
      close() {
        closedByUs = true;
        socket.close();
      },
    };
  }
}
