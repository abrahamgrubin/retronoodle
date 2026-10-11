import { MicVAD } from '@ricky0123/vad-web';
import type { SpeechActivityInterval } from '@retronoodle/shared';
import { uploadSpeechActivity } from '../board';

export interface SpeechDetectionHandle {
  /** RN-035 AC: "Turning detection off stops interval uploads immediately" — pauses the VAD and
   * discards any not-yet-uploaded batch rather than waiting for the next upload tick. */
  stop(): Promise<void>;
}

/**
 * Clock-corrects a locally-timed speaking interval into absolute epoch milliseconds — the same
 * `clockOffsetMs` convention as clock.ts's `computeClockOffsetMs`/`remainingMs` (`localStartMs`/
 * `localEndMs` are expected to already be local wall-clock-ish timestamps, i.e.
 * `performance.timeOrigin + performance.now()`, not a bare `performance.now()`). Pure, so it's
 * testable without a real VAD/microphone — unlike the rest of this module.
 */
export function toAbsoluteInterval(localStartMs: number, localEndMs: number, clockOffsetMs: number): SpeechActivityInterval {
  return { startMs: Math.round(localStartMs + clockOffsetMs), endMs: Math.round(localEndMs + clockOffsetMs) };
}

export interface StartSpeechDetectionDeps {
  createMicVAD?: typeof MicVAD.new;
  uploadIntervalMs?: number;
  /** Returns a local wall-clock-ish timestamp — overridable in tests; defaults to
   * `performance.timeOrigin + performance.now()` (not `Date.now()`, which can jump on NTP
   * correction mid-session; `performance.now()` can't, and timeOrigin anchors it to epoch time). */
  now?: () => number;
}

/**
 * RN-035: Silero VAD (vad-web's own Web Worker, ~2MB model) detects only *when* this participant
 * is speaking — never sends audio, only the resulting intervals, uploaded every 5s
 * (uploadSpeechActivity). Mic permission is requested by `MicVAD.new` itself, the moment this is
 * called — BoardPage.tsx only calls it once RN-032's recording consent is already agreed, so
 * "mic permission requested only after consent" holds without this module needing to know why.
 */
export async function startSpeechDetection(
  accessToken: string,
  retroId: string,
  clockOffsetMs: number,
  deps: StartSpeechDetectionDeps = {},
): Promise<SpeechDetectionHandle> {
  const now = deps.now ?? (() => performance.timeOrigin + performance.now());
  const uploadIntervalMs = deps.uploadIntervalMs ?? 5000;
  let pending: SpeechActivityInterval[] = [];
  let speechStartedAtMs: number | null = null;

  const timer = setInterval(() => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    void uploadSpeechActivity(accessToken, retroId, batch);
  }, uploadIntervalMs);

  const createMicVAD = deps.createMicVAD ?? MicVAD.new;
  const vad = await createMicVAD({
    // vite.config.ts's copyVadAssets plugin copies these from node_modules into public/ —
    // nothing Vite would otherwise know to bundle (plain model/WASM binaries, not JS modules).
    model: 'v5',
    baseAssetPath: '/vad/',
    onnxWASMBasePath: '/ort/',
    // Forces onnxruntime-web onto its plain single-threaded WASM build rather than the
    // multi-threaded one — which would need both a second, larger WASM file (its asyncify/jsep
    // variants are 26-28MB, over Cloudflare Workers' 25MiB static-asset limit, so only the plain
    // build is shipped — see vite.config.ts) and Cross-Origin-Opener/Embedder-Policy response
    // headers this app doesn't set. A VAD model this small has no real need for threading anyway.
    ortConfig: (ort) => {
      ort.env.wasm.numThreads = 1;
    },
    onSpeechStart: () => {
      speechStartedAtMs = now();
    },
    onSpeechEnd: () => {
      if (speechStartedAtMs === null) return;
      pending.push(toAbsoluteInterval(speechStartedAtMs, now(), clockOffsetMs));
      speechStartedAtMs = null;
    },
  });

  return {
    async stop() {
      clearInterval(timer);
      pending = [];
      await vad.pause();
    },
  };
}
