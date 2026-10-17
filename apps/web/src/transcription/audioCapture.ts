export interface AudioCaptureHandle {
  stop(): void;
}

export interface CaptureStreams {
  micStream: MediaStream;
  displayStream: MediaStream;
}

export interface AcquireCaptureStreamsDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getDisplayMedia?: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
}

export interface OpenCaptureGatewayDeps {
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
 * RN-033: `getDisplayMedia`/`getUserMedia` themselves are the one piece of this that's
 * gesture-sensitive — must be called synchronously from inside a real click handler, with
 * nothing awaited first (same requirement `getDisplayMedia` always had). Split out from actually
 * opening the gateway (`openCaptureGateway` below) so a caller can acquire the streams at click
 * time, then open the WebSocket later once it's known the server-side phase transition that
 * triggered this has actually landed — see BoardPage.tsx's own comment on the race this avoids.
 * `getDisplayMedia` requires `video: true` even for an audio-only capture (sharing a tab without
 * also sharing its video isn't an option the picker offers); the video track is stopped
 * immediately and never touched again.
 */
export async function acquireCaptureStreams(deps: AcquireCaptureStreamsDeps = {}): Promise<CaptureStreams> {
  const getUserMedia = deps.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  const getDisplayMedia = deps.getDisplayMedia ?? ((constraints) => navigator.mediaDevices.getDisplayMedia(constraints));

  const micStream = await getUserMedia({ audio: true });
  const displayStream = await getDisplayMedia({ video: true, audio: true });
  for (const track of displayStream.getVideoTracks()) track.stop();
  return { micStream, displayStream };
}

/**
 * RN-033: mixes the already-acquired mic/call-audio streams and streams Opus-encoded chunks to
 * the audio gateway. Nothing here needs a user gesture — the sensitive part already happened in
 * `acquireCaptureStreams` — so this is safe to call after an `await` (e.g. once a phase-change
 * mutation's response has actually arrived).
 *
 * Nothing in this module is unit-testable in this environment — `getUserMedia`,
 * `getDisplayMedia`, `AudioContext` and `MediaRecorder` all require a real browser with real
 * hardware/permission prompts (same "build the code, verify it by hand" situation as RN-030's
 * audio-capture spike). The constructor functions are still injectable (`deps`) so a future test
 * environment with real browser automation (e.g. Playwright) can swap in fakes.
 */
export function openCaptureGateway(streams: CaptureStreams, wsUrl: string, deps: OpenCaptureGatewayDeps = {}): AudioCaptureHandle {
  const { micStream, displayStream } = streams;
  const createWebSocket = deps.createWebSocket ?? ((url) => new WebSocket(url));

  const audioContext = new AudioContext();
  // `new AudioContext()` can start `'suspended'` under the browser's autoplay policy unless it's
  // confident this is a direct result of a user gesture — true right at click time, no longer
  // true once this is deferred until after a mutation round trip (see startCaptureIfLandingOnDiscuss's
  // own comment on why it has to be). A suspended context never actually processes the
  // mic/display source nodes connected to it: the resulting WebM stream is still structurally
  // valid (MediaRecorder doesn't know or care that nothing is flowing through the graph), so
  // nothing here would ever look broken — the gateway and Deepgram both still "accept" it, every
  // chunk gets billed as usage, and the recording is just silence. `resume()` on an
  // already-running context is a harmless no-op.
  void audioContext.resume();
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
  // `Blob.arrayBuffer()` is async — two chunks' conversions racing in whatever order they happen
  // to resolve could send them out of sequence, which corrupts a WebM container (each chunk after
  // the first is only a valid "Cluster" in the context of the ones before it). Chaining every send
  // onto the previous one's own promise guarantees they go out in the same order they were
  // recorded, regardless of how long any one conversion takes.
  let sendQueue = Promise.resolve();
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size === 0) return;
    sendQueue = sendQueue
      .then(() => event.data.arrayBuffer())
      .then((buffer) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(buffer);
      });
  };
  // Found live: starting the recorder immediately (before the gateway socket had actually
  // finished its handshake) meant its first chunk — the only one carrying the WebM container's
  // own header (EBML/Segment/Tracks) — landed while `socket.readyState` was still CONNECTING and
  // got silently dropped by the guard above. Every chunk sent after that was a structurally real,
  // non-trivial amount of audio with no header context behind it, which Deepgram can't parse into
  // anything at all. Waiting for 'open' here guarantees the first chunk MediaRecorder ever emits
  // is the first one this socket ever sees — the server side has its own matching fix
  // (audioGateway.ts) for the same class of race on its own side of this connection.
  if (socket.readyState === WebSocket.OPEN) recorder.start(CHUNK_DURATION_MS);
  else socket.addEventListener('open', () => recorder.start(CHUNK_DURATION_MS), { once: true });

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

/** Releases streams acquired by `acquireCaptureStreams` without ever opening a gateway —
 * e.g. the phase-change mutation that triggered acquisition ended up rejected or landed
 * somewhere other than Discuss, so the mic/tab-share prompt the user just answered needs to be
 * let go of rather than left dangling. */
export function releaseCaptureStreams(streams: CaptureStreams): void {
  for (const track of streams.micStream.getTracks()) track.stop();
  for (const track of streams.displayStream.getTracks()) track.stop();
}
