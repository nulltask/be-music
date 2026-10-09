/**
 * WebCodecs + Mediabunny backend of {@link GameplayRecorder}.
 *
 * `MediaRecorder` stamps every video frame and audio buffer with the wall-clock time the capture pipeline happened to
 * receive it, and the audio path (Web Audio → `MediaStreamAudioDestinationNode` → track) is a few tens of milliseconds
 * slower than the canvas path — so its recordings show the picture ~40-50 ms ahead of the sound, by an amount that
 * varies per machine and output device. This backend stamps both tracks itself, on the clock the gameplay runs on:
 *
 * - Video frames carry the `AudioContext.currentTime` the scene was drawn at — the same value the gameplay reads to
 *   place its notes.
 * - Audio is pulled out of the graph by an `AudioWorklet` that reports the context frame index of every block, so each
 *   sample sits exactly at the context time it was rendered for.
 *
 * Both tracks share one origin (the context time at `start`), so the encoded file is in sync by construction, and a
 * dropped frame (overloaded encoder, busy main thread) only lowers the frame rate — it can never shift the picture
 * against the sound. Encoded packets are muxed into WebM by Mediabunny, which also writes the seek index.
 */
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Output,
  Quality,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';

/** Video codecs WebM can carry, in order of preference. */
const WEBM_VIDEO_CODECS = ['vp9', 'vp8', 'av1'] as const;

/** Frames the worklet buffers before posting a chunk to the main thread (~85 ms at 48 kHz). */
const AUDIO_CHUNK_FRAMES = 4096;

/**
 * The capture worklet. It copies every render block of its (stereo) input into a chunk buffer and posts the chunk with
 * the context frame index of its first sample; a `flush` message posts the partial chunk and acknowledges.
 */
const CAPTURE_WORKLET_SOURCE = `
class BeMusicRecorderTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = ${AUDIO_CHUNK_FRAMES};
    this.reset();
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.post();
        this.port.postMessage({ flushed: true });
      }
    };
  }
  reset() {
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.filled = 0;
    this.startFrame = -1;
  }
  post() {
    if (this.filled === 0) return;
    const left = this.left.slice(0, this.filled);
    const right = this.right.slice(0, this.filled);
    this.port.postMessage({ startFrame: this.startFrame, left, right }, [left.buffer, right.buffer]);
    this.reset();
  }
  process(inputs) {
    const input = inputs[0];
    const block = input && input[0] ? input[0].length : 128;
    let offset = 0;
    while (offset < block) {
      if (this.filled === 0) this.startFrame = currentFrame + offset;
      const count = Math.min(block - offset, this.size - this.filled);
      if (input && input[0]) {
        this.left.set(input[0].subarray(offset, offset + count), this.filled);
        this.right.set((input[1] || input[0]).subarray(offset, offset + count), this.filled);
      }
      this.filled += count;
      offset += count;
      if (this.filled === this.size) this.post();
    }
    return true;
  }
}
registerProcessor('be-music-recorder-tap', BeMusicRecorderTap);
`;

/**
 * Where an audio chunk lands on the recording timeline. `startFrame` is the context frame of the chunk's first sample
 * and `originFrame` the context frame recording started at; the part before the origin is cut off. Returns the number
 * of leading frames to skip and the timestamp (seconds) of the first kept frame, or `undefined` when the whole chunk
 * predates the recording.
 */
export function alignAudioChunk(
  startFrame: number,
  frameCount: number,
  originFrame: number,
  sampleRate: number,
): { skip: number; timestamp: number } | undefined {
  const skip = Math.max(0, originFrame - startFrame);
  if (skip >= frameCount) return undefined;
  return { skip, timestamp: (startFrame + skip - originFrame) / sampleRate };
}

/**
 * The timestamp (seconds) for a video frame drawn at context time `clockSeconds`, relative to the recording origin, or
 * `undefined` when it must be skipped: before the origin, or not after the previous frame (the context is suspended
 * while the game is paused, so its clock stands still and repeated frames would collide).
 */
export function resolveFrameTimestamp(
  clockSeconds: number,
  originSeconds: number,
  lastTimestamp: number | undefined,
): number | undefined {
  const timestamp = clockSeconds - originSeconds;
  if (!Number.isFinite(timestamp) || timestamp < 0) return undefined;
  if (lastTimestamp !== undefined && timestamp <= lastTimestamp) return undefined;
  return timestamp;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'WebCodecs capture failed');
}

/** Whether this browser exposes everything the WebCodecs backend needs. Codec support is probed separately. */
export function supportsWebCodecsRecording(audioContext: BaseAudioContext): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    audioContext.audioWorklet !== undefined
  );
}

export interface WebCodecsCaptureOptions {
  /** Canvas the frames are read from (the scene canvas, or the scaled copy). */
  canvas: HTMLCanvasElement;
  audioContext: AudioContext;
  audioOutput: AudioNode;
  fps: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
}

/**
 * One WebCodecs recording session. {@link prepare} probes the codecs and loads the worklet (it rejects when no
 * WebM-compatible codec pair is encodable, so the caller can fall back to `MediaRecorder`); {@link captureFrame} is
 * called right after each scene render; {@link finish} flushes everything and returns the WebM bytes.
 */
export class WebCodecsCapture {
  private readonly options: WebCodecsCaptureOptions;
  private readonly originSeconds: number;
  private readonly originFrame: number;
  private output: Output<WebMOutputFormat, BufferTarget> | undefined;
  private videoSource: CanvasSource | undefined;
  private audioSource: AudioSampleSource | undefined;
  private tap: AudioWorkletNode | undefined;
  private sink: GainNode | undefined;
  /** Encode of the previous frame, still in flight; frames arriving meanwhile are dropped instead of queued. */
  private pendingFrame: Promise<void> | undefined;
  /** Audio samples are added strictly in order, each after the previous one was accepted. */
  private audioChain: Promise<void> = Promise.resolve();
  private lastFrameTimestamp: number | undefined;
  private failure: Error | undefined;
  private closed = false;

  public constructor(options: WebCodecsCaptureOptions) {
    this.options = options;
    // Recording starts "now" on the gameplay clock. Both tracks are measured from here.
    this.originSeconds = options.audioContext.currentTime;
    this.originFrame = Math.round(this.originSeconds * options.audioContext.sampleRate);
  }

  public async prepare(): Promise<void> {
    const { canvas, audioContext, fps } = this.options;
    const videoQuality = new Quality({ bitrate: Math.round(this.options.videoBitsPerSecond) });
    const audioQuality = new Quality({ bitrate: Math.round(this.options.audioBitsPerSecond) });
    const [videoCodec, audioCodec] = await Promise.all([
      getFirstEncodableVideoCodec([...WEBM_VIDEO_CODECS], {
        width: canvas.width,
        height: canvas.height,
        quality: videoQuality,
      }),
      getFirstEncodableAudioCodec(['opus'], {
        numberOfChannels: 2,
        sampleRate: audioContext.sampleRate,
        quality: audioQuality,
      }),
    ]);
    if (!videoCodec || !audioCodec) {
      throw new Error('WebCodecsCapture: no WebM-compatible codec pair is encodable');
    }
    const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: 'text/javascript' }));
    try {
      await audioContext.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    if (this.closed) return;

    const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
    const videoSource = new CanvasSource(canvas, {
      codec: videoCodec,
      quality: videoQuality,
      // Realtime mode lets the encoder shed load instead of falling ever further behind on a slow machine.
      latencyMode: 'realtime',
      sizeChangeBehavior: 'contain',
    });
    const audioSource = new AudioSampleSource({ codec: audioCodec, quality: audioQuality });
    output.addVideoTrack(videoSource, { frameRate: fps });
    output.addAudioTrack(audioSource);
    await output.start();
    if (this.closed) {
      await output.cancel();
      return;
    }
    this.output = output;
    this.videoSource = videoSource;
    this.audioSource = audioSource;
    this.attachTap();
  }

  /** Encodes the canvas as it is now, stamped with the gameplay clock. Call right after the scene rendered. */
  public captureFrame(): void {
    const source = this.videoSource;
    if (!source || this.closed || this.pendingFrame || this.failure !== undefined) return;
    const timestamp = resolveFrameTimestamp(
      this.options.audioContext.currentTime,
      this.originSeconds,
      this.lastFrameTimestamp,
    );
    if (timestamp === undefined) return;
    this.lastFrameTimestamp = timestamp;
    const pending = source
      .add(timestamp, 1 / this.options.fps)
      .catch((error: unknown) => {
        this.failure ??= toError(error);
      })
      .finally(() => {
        if (this.pendingFrame === pending) this.pendingFrame = undefined;
      });
    this.pendingFrame = pending;
  }

  /** Drains the worklet and the encoders and returns the finished WebM, or `undefined` if nothing was set up. */
  public async finish(): Promise<Blob | undefined> {
    if (this.closed) return undefined;
    this.closed = true;
    const output = this.output;
    if (!output) return undefined;
    await this.flushTap();
    this.detachTap();
    await this.pendingFrame;
    await this.audioChain;
    if (this.failure !== undefined) {
      await output.cancel();
      throw this.failure;
    }
    await output.finalize();
    const buffer = output.target.buffer;
    return buffer ? new Blob([buffer], { type: 'video/webm' }) : undefined;
  }

  /** Abandons the session without producing a file. */
  public dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.detachTap();
    void this.output?.cancel().catch(() => {});
  }

  private attachTap(): void {
    const { audioContext, audioOutput } = this.options;
    const tap = new AudioWorkletNode(audioContext, 'be-music-recorder-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    tap.port.onmessage = (event: MessageEvent<{ startFrame: number; left: Float32Array; right: Float32Array }>) => {
      if ('startFrame' in event.data) this.pushAudio(event.data.startFrame, event.data.left, event.data.right);
    };
    // A muted path to the destination keeps the worklet pulled by the render graph in every browser.
    const sink = audioContext.createGain();
    sink.gain.value = 0;
    audioOutput.connect(tap);
    tap.connect(sink);
    sink.connect(audioContext.destination);
    this.tap = tap;
    this.sink = sink;
  }

  private pushAudio(startFrame: number, left: Float32Array, right: Float32Array): void {
    const source = this.audioSource;
    if (!source || this.failure !== undefined) return;
    const { sampleRate } = this.options.audioContext;
    const placement = alignAudioChunk(startFrame, left.length, this.originFrame, sampleRate);
    if (!placement) return;
    const frames = left.length - placement.skip;
    const planar = new Float32Array(frames * 2);
    planar.set(left.subarray(placement.skip), 0);
    planar.set(right.subarray(placement.skip), frames);
    const sample = new AudioSample({
      data: planar,
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate,
      timestamp: placement.timestamp,
    });
    this.audioChain = this.audioChain
      .then(() => source.add(sample))
      .catch((error: unknown) => {
        this.failure ??= toError(error);
      })
      .finally(() => sample.close());
  }

  private flushTap(): Promise<void> {
    const tap = this.tap;
    if (!tap) return Promise.resolve();
    return new Promise<void>((resolve) => {
      // The worklet only answers while the context is running; don't hang on a suspended one.
      const timer = setTimeout(resolve, 500);
      tap.port.addEventListener('message', (event: MessageEvent<{ flushed?: boolean }>) => {
        if (event.data.flushed) {
          clearTimeout(timer);
          resolve();
        }
      });
      tap.port.postMessage('flush');
    });
  }

  private detachTap(): void {
    const { tap, sink } = this;
    if (!tap) return;
    try {
      this.options.audioOutput.disconnect(tap);
    } catch {
      // Already disconnected.
    }
    tap.port.onmessage = null;
    tap.disconnect();
    sink?.disconnect();
    this.tap = undefined;
    this.sink = undefined;
  }
}
