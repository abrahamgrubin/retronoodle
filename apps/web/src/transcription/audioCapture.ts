export interface AudioCaptureHandle {
  stop(): void;
}

export interface StartAudioCaptureDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getDisplayMedia?: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
  createWebSocket?: (url: string) => WebSocket;
  createRecorder?: (stream: MediaStream) => MediaRecorder;
  /** Fires once if the gateway closes the connection for any reason other than our own
   * `stop()` — Deepgram outage, the session stopping server-side, a phase change, etc. (RN-033
   * AC: "Deepgram outage shows 'Transcription unavailable'"). The gateway sends one JSON text
   * frame naming why just before closing; this only tells the caller it happened, not why,
   * since every reason maps to the same user-facing message. */
  onUnavailable?: () => void;
}

/** 250ms (the story's own technical notes: "Opus 250 ms chunks over a WebSocket"). */
const CHUNK_DURATION_MS = 250;

/**
 * RN-033: the facilitator's browser mixes their mic with the call's shared-tab audio and streams
 * Opus-encoded chunks to the audio gateway. `getDisplayMedia` is what actually captures "the
 * call's audio" — Chrome requires `video: true` on that request even for an audio-only capture
 * (sharing a tab without also sharing its video isn't an option the picker offers), so the video
 * track is stopped immediately after the stream is obtained and never touched again.
 *
 * Nothing in this module is unit-testable in this environment — `getUserMedia`,
 * `getDisplayMedia`, `AudioContext` and `MediaRecorder` all require a real browser with real
 * hardware/permission prompts (same "build the code, verify it by hand" situation as RN-030's
 * audio-capture spike). The constructor functions are still injectable (`deps`) so a future test
 * environment with real browser automation (e.g. Playwright) can swap in fakes.
 */
export async function startAudioCapture(wsUrl: string, deps: StartAudioCaptureDeps = {}): Promise<AudioCaptureHandle> {
  const getUserMedia = deps.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  const getDisplayMedia = deps.getDisplayMedia ?? ((constraints) => navigator.mediaDevices.getDisplayMedia(constraints));
  const createWebSocket = deps.createWebSocket ?? ((url) => new WebSocket(url));

  const micStream = await getUserMedia({ audio: true });
  const displayStream = await getDisplayMedia({ video: true, audio: true });
  for (const track of displayStream.getVideoTracks()) track.stop();

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  audioContext.createMediaStreamSource(micStream).connect(destination);
  if (displayStream.getAudioTracks().length > 0) {
    audioContext.createMediaStreamSource(displayStream).connect(destination);
  }

  const socket = createWebSocket(wsUrl);
  socket.binaryType = 'arraybuffer';

  let stoppedByUs = false;
  socket.addEventListener('close', () => {
    if (!stoppedByUs) deps.onUnavailable?.();
  });

  const createRecorder = deps.createRecorder ?? ((stream) => new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }));
  const recorder = createRecorder(destination.stream);
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size === 0 || socket.readyState !== WebSocket.OPEN) return;
    void event.data.arrayBuffer().then((buffer) => socket.send(buffer));
  };
  recorder.start(CHUNK_DURATION_MS);

  return {
    stop() {
      stoppedByUs = true;
      if (recorder.state !== 'inactive') recorder.stop();
      socket.close();
      for (const track of micStream.getTracks()) track.stop();
      for (const track of displayStream.getTracks()) track.stop();
      void audioContext.close();
    },
  };
}
