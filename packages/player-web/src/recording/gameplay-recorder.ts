/**
 * Records the gameplay scene to a downloadable WebM Blob (VP9 / VP8 video, Opus audio).
 *
 * Two backends, picked at {@link GameplayRecorder.start}:
 *
 * - **WebCodecs + Mediabunny** (preferred; see `webcodecs-recorder.ts`). Frames and audio samples are stamped with the
 *   `AudioContext` clock the gameplay runs on, so picture and sound are in sync by construction, and the output is
 *   seekable as written.
 * - **`MediaRecorder`** fallback for browsers without `VideoEncoder` / `AudioEncoder` / `AudioWorklet`, or without a
 *   WebM-compatible encoder. It records `canvas.captureStream` + a `MediaStreamAudioDestinationNode`; the browser
 *   stamps both on arrival, which leaves the picture a few tens of milliseconds ahead of the sound, and its output
 *   needs {@link makeWebmSeekable} before external players can seek in it.
 *
 * Both capture in real time, so the recording reflects what the player saw (frame skips and all) rather than an offline
 * re-render.
 *
 * Usage:
 *
 * ```ts
 * const recorder = new GameplayRecorder({ canvas, audioContext, audioOutput });
 * recorder.start();
 * // ... gameplay runs ...
 * const result = await recorder.stop();
 * downloadBlob(result.seekable ? result.blob : await makeWebmSeekable(result.blob), 'song.webm');
 * ```
 *
 * Disposed instances throw on further calls; the host should construct a fresh recorder per recording session.
 */
import { WebCodecsCapture, supportsWebCodecsRecording } from './webcodecs-recorder.ts';

export interface GameplayRecorderOptions {
  /**
   * The canvas to capture as the video track. Typically `host.app.canvas` from the `PixiSceneHost`. The recorder
   * doesn't take ownership — disposing the recorder leaves the canvas alone.
   */
  canvas: HTMLCanvasElement;
  /**
   * The play session's `AudioContext`. Used to allocate the `MediaStreamAudioDestinationNode` that taps the audio
   * output for the audio track. The recorder doesn't close the context.
   */
  audioContext: AudioContext;
  /**
   * Master output node to tap. The recorder calls `audioOutput.connect(mediaStreamDestination)` at start and
   * disconnects on stop / dispose. Tapping this node — rather than `audioContext.destination` directly — is the only
   * way Web Audio exposes the live output for capture.
   */
  audioOutput: AudioNode;
  /**
   * Maximum frames per second to capture. Defaults to 60 to match the gameplay tick. Frames are taken as the scene
   * paints them (one per animation frame, thinned to this rate), so a display faster than `fps` is sampled down and a
   * lower value (e.g. 30) produces a smaller output at the cost of jerkier scrolling notes.
   */
  fps?: number;
  /**
   * Bits-per-second target for the video track. Defaults to ~5 Mbps which gives reasonable quality for a 1280×720 LR2
   * design space without bloating the file. Honored only when the picked codec / browser respects the hint.
   */
  videoBitsPerSecond?: number;
  /**
   * Bits-per-second target for the audio track. Defaults to 192 kbps Opus — enough for stereo BMS keysound stacks
   * without obvious artefacts.
   */
  audioBitsPerSecond?: number;
  /**
   * Optional explicit mime-type override. Use this only for testing / forcing a specific codec; production callers
   * should rely on the built-in negotiation that picks the best supported variant.
   */
  mimeType?: string;
  /**
   * Largest video frame to encode, in pixels. Defaults to 1920×1080. A canvas larger than this (a high-DPR display in a
   * big window easily reaches 3000×2000) is scaled down to fit before encoding — software VP9 cannot keep up with such
   * frames in real time, so the encoder starts dropping frames and the video stutters out of step with the audio.
   */
  maxVideoSize?: { width: number; height: number };
  /**
   * Registers a callback to run right after every scene render and returns its unregister function — typically
   * `(cb) => { app.ticker.add(cb, undefined, UPDATE_PRIORITY.UTILITY); return () => app.ticker.remove(cb); }`, which
   * runs after Pixi's own render. Frames are then read while the freshly drawn image is still in the canvas, stamped
   * with the clock that drew it. Without it the recorder polls on its own `requestAnimationFrame`, which may run before
   * the render and pick up the previous frame.
   */
  subscribeFrame?: (onFrame: () => void) => () => void;
  /**
   * Which backend to use. `'auto'` (default) prefers WebCodecs and falls back to `MediaRecorder`; an explicit
   * {@link mimeType} implies `'media-recorder'`.
   */
  backend?: 'auto' | 'webcodecs' | 'media-recorder';
}

/**
 * Output of a finished recording session. `mimeType` is the codec the browser actually used (matches the picked variant
 * from the negotiation chain), useful for naming the downloaded file with the right extension. `blob` is the assembled
 * video data.
 */
export interface GameplayRecorderResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Whether the file already carries its seek index (WebCodecs backend); otherwise run {@link makeWebmSeekable}. */
  seekable: boolean;
}

/**
 * Codec / container preference list, tried in order. The last entry is the bare `video/webm` MIME with no codec hint —
 * every `MediaRecorder` implementation that supports webm at all also supports this form, so it's the safety net.
 */
const PREFERRED_RECORDER_MIME_TYPES: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/**
 * Picks the highest-priority MIME type from {@link PREFERRED_RECORDER_MIME_TYPES} that the runtime `MediaRecorder`
 * claims to support. Returns `undefined` when no candidate is available (e.g. older Safari that lacks
 * `MediaRecorder.isTypeSupported`); callers should treat that as "recording unavailable" rather than guessing.
 *
 * Exported for testing — production callers go through {@link GameplayRecorder.start} which calls this internally.
 */
export function pickRecorderMimeType(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(type),
): string | undefined {
  for (const candidate of PREFERRED_RECORDER_MIME_TYPES) {
    if (isSupported(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Whether a frame-driven capture should take the frame painted at `nowMs`, given the last captured frame at `lastMs`
 * (`undefined` before the first) and the target `fps`. At or above the display rate every painted frame is taken; below
 * it frames are taken once their interval has (almost) elapsed — the small tolerance keeps a 30 fps target on 60 Hz
 * from slipping to every third frame through rAF jitter.
 */
export function shouldCaptureFrame(nowMs: number, lastMs: number | undefined, fps: number): boolean {
  if (lastMs === undefined || !Number.isFinite(fps) || fps <= 0) return true;
  const interval = 1000 / fps;
  return nowMs - lastMs >= interval - Math.min(4, interval * 0.25);
}

/**
 * The encoded frame size for a `width`×`height` canvas: the canvas size itself when it fits inside `max`, otherwise the
 * largest size of the same aspect ratio that does, rounded down to even dimensions (VP8 / VP9 encoders reject odd
 * sizes).
 */
export function resolveCaptureSize(
  width: number,
  height: number,
  max: { width: number; height: number },
): { width: number; height: number } {
  const scale = Math.min(1, max.width / width, max.height / height);
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

export class GameplayRecorder {
  private readonly canvas: HTMLCanvasElement;
  private readonly audioContext: AudioContext;
  private readonly audioOutput: AudioNode;
  private readonly fps: number;
  private readonly videoBitsPerSecond: number;
  private readonly audioBitsPerSecond: number;
  private readonly explicitMimeType: string | undefined;
  private readonly maxVideoSize: { width: number; height: number };
  private readonly subscribeFrame: ((onFrame: () => void) => () => void) | undefined;
  private readonly backend: 'auto' | 'webcodecs' | 'media-recorder';
  /** The canvas frames are encoded from, and the copy that refreshes it (when the scene canvas is scaled down). */
  private source: { canvas: HTMLCanvasElement; copy?: () => void } | undefined;
  /** Active WebCodecs session, when that backend is in use. */
  private capture: WebCodecsCapture | undefined;
  private mediaRecorder: MediaRecorder | undefined;
  private audioDestination: MediaStreamAudioDestinationNode | undefined;
  /**
   * The `MediaStream` returned by `canvas.captureStream`. Held so {@link stop} / {@link dispose} can release the
   * stream's video tracks via `track.stop()`. `MediaRecorder.stop()` only ends the recording, not the underlying
   * capture; the canvas' frame producer stays attached and burns CPU on every paint until each video track is
   * explicitly stopped.
   */
  private videoStream: MediaStream | undefined;
  /** Unregisters the per-frame callback (see {@link startFrameLoop}). */
  private stopFrames: (() => void) | undefined;
  private chunks: Blob[] = [];
  private startedAtMs = 0;
  private recording = false;
  private disposed = false;

  public constructor(options: GameplayRecorderOptions) {
    this.canvas = options.canvas;
    this.audioContext = options.audioContext;
    this.audioOutput = options.audioOutput;
    this.fps = options.fps ?? 60;
    this.videoBitsPerSecond = options.videoBitsPerSecond ?? 5_000_000;
    this.audioBitsPerSecond = options.audioBitsPerSecond ?? 192_000;
    this.explicitMimeType = options.mimeType;
    this.maxVideoSize = options.maxVideoSize ?? { width: 1920, height: 1080 };
    this.subscribeFrame = options.subscribeFrame;
    this.backend = options.mimeType !== undefined ? 'media-recorder' : (options.backend ?? 'auto');
  }

  public isActive(): boolean {
    return this.recording;
  }

  /**
   * Begins capture. Throws when:
   *
   * - Neither backend is available (no WebCodecs and no `MediaRecorder` / `canvas.captureStream` / supported MIME
   *   type). UI hosts should handle this gracefully (hide the record button, show a toast).
   * - The recorder was previously stopped without a fresh instance (`disposed` flag) — recording is a one-shot per
   *   instance to keep the buffer lifecycle simple.
   *
   * The WebCodecs backend finishes its setup (codec probe, worklet load) asynchronously; capture begins once it is
   * ready, a few tens of milliseconds in. If the setup fails the recorder switches to `MediaRecorder` on the spot.
   */
  public start(): void {
    if (this.disposed) {
      throw new Error('GameplayRecorder.start: instance has already been disposed');
    }
    if (this.recording) {
      throw new Error('GameplayRecorder.start: recording is already in progress');
    }
    const useWebCodecs =
      this.backend === 'webcodecs' || (this.backend === 'auto' && supportsWebCodecsRecording(this.audioContext));
    this.source = this.createCaptureSource();
    if (useWebCodecs) {
      this.startWebCodecs(this.source);
    } else {
      this.startMediaRecorder(this.source);
    }
    this.recording = true;
    this.startedAtMs = performance.now();
  }

  /**
   * Ends capture and resolves with the assembled video Blob plus the MIME type the browser used. Idempotent — calling
   * on a non-active recorder resolves with `undefined`.
   *
   * Cleans up the audio tap regardless of state, so a `stop()` call also functions as a panic abort.
   */
  public async stop(): Promise<GameplayRecorderResult | undefined> {
    if (!this.recording) {
      this.release();
      return undefined;
    }
    this.recording = false;
    this.stopFrameLoop();
    const durationMs = performance.now() - this.startedAtMs;
    const capture = this.capture;
    if (capture) {
      this.capture = undefined;
      try {
        const blob = await capture.finish();
        return blob ? { blob, mimeType: 'video/webm', durationMs, seekable: true } : undefined;
      } finally {
        this.release();
      }
    }
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') {
      this.release();
      return undefined;
    }
    const stopPromise = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    recorder.stop();
    await stopPromise;
    const mimeType = recorder.mimeType || 'video/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    this.release();
    return { blob, mimeType, durationMs, seekable: false };
  }

  /**
   * Hard-stops without waiting for the final chunk. Discards any partially-collected data. Used by the gameplay view's
   * `dispose` when the user ESCs out mid-recording — we don't want to dangle the audio tap and the user obviously isn't
   * going to use the partial blob.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.recording = false;
    this.capture?.dispose();
    this.capture = undefined;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Throws if state is already 'inactive' or never started. Both cases are fine — nothing more to do.
      }
    }
    this.release();
  }

  private startWebCodecs(source: { canvas: HTMLCanvasElement; copy?: () => void }): void {
    const capture = new WebCodecsCapture({
      canvas: source.canvas,
      audioContext: this.audioContext,
      audioOutput: this.audioOutput,
      fps: this.fps,
      videoBitsPerSecond: this.videoBitsPerSecond,
      audioBitsPerSecond: this.audioBitsPerSecond,
    });
    this.capture = capture;
    this.startFrameLoop(() => {
      source.copy?.();
      capture.captureFrame();
    });
    capture.prepare().catch((error: unknown) => {
      if (this.capture !== capture) return;
      // eslint-disable-next-line no-console
      console.warn('[recorder] WebCodecs capture unavailable; falling back to MediaRecorder', error);
      this.stopFrameLoop();
      capture.dispose();
      this.capture = undefined;
      if (!this.recording) return;
      try {
        this.startMediaRecorder(source);
      } catch (fallbackError) {
        // eslint-disable-next-line no-console
        console.warn('[recorder] MediaRecorder fallback failed too', fallbackError);
        this.recording = false;
        this.release();
      }
    });
  }

  private startMediaRecorder(source: { canvas: HTMLCanvasElement; copy?: () => void }): void {
    const mimeType = this.explicitMimeType ?? pickRecorderMimeType();
    if (!mimeType) {
      throw new Error('GameplayRecorder.start: browser exposes no supported MediaRecorder MIME type');
    }
    if (typeof source.canvas.captureStream !== 'function') {
      throw new Error('GameplayRecorder.start: HTMLCanvasElement.captureStream is unavailable');
    }
    // Audio tap. The `MediaStreamAudioDestinationNode` is a dedicated sink — connecting `audioOutput` to it is
    // additive, so live playback through `audioContext.destination` keeps working unchanged.
    const audioDestination = this.audioContext.createMediaStreamDestination();
    this.audioOutput.connect(audioDestination);
    this.audioDestination = audioDestination;
    // Frame-driven capture: `captureStream(fps)` samples the canvas on its own timer, which drifts against the render
    // loop and drops frames (a 60 fps capture of a 60 fps render measured ~54 fps). Capturing with frame rate 0 and
    // requesting a frame after every render takes exactly the frames the scene painted. Browsers without
    // `requestFrame` fall back to the timer-driven capture.
    const videoStream = source.canvas.captureStream(0);
    const track = videoStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (track && typeof track.requestFrame === 'function') {
      this.videoStream = videoStream;
      this.startFrameLoop(() => {
        source.copy?.();
        track.requestFrame();
      });
    } else {
      for (const unused of videoStream.getTracks()) unused.stop();
      this.videoStream = this.canvas.captureStream(this.fps);
    }
    // Combine canvas video + bus audio into a single stream so the recorder treats them as one timeline.
    const combined = new MediaStream([
      ...this.videoStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: this.videoBitsPerSecond,
      audioBitsPerSecond: this.audioBitsPerSecond,
    });
    this.chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    // 1-second chunk timeslice keeps memory bounded — without it the entire recording lives in a single Blob until
    // stop(), which is fine for short sessions but punishes 5-minute LN grindfests.
    recorder.start(1000);
    this.mediaRecorder = recorder;
  }

  /**
   * The canvas to capture: the scene canvas itself when it fits {@link maxVideoSize}, otherwise a smaller 2D canvas plus
   * a `copy` that scales the current scene frame into it.
   */
  private createCaptureSource(): { canvas: HTMLCanvasElement; copy?: () => void } {
    const { width, height } = this.canvas;
    const size = resolveCaptureSize(width, height, this.maxVideoSize);
    if (size.width === width && size.height === height) return { canvas: this.canvas };
    const target = document.createElement('canvas');
    target.width = size.width;
    target.height = size.height;
    const context = target.getContext('2d', { alpha: false });
    if (!context) return { canvas: this.canvas };
    context.imageSmoothingQuality = 'high';
    const copy = () => {
      // The scene canvas can be resized mid-recording (window resize); stretch whatever it holds into the fixed frame.
      context.drawImage(this.canvas, 0, 0, target.width, target.height);
    };
    copy();
    return { canvas: target, copy };
  }

  /**
   * Runs `onFrame` after every scene render (via {@link subscribeFrame}, else on each animation frame), thinned to
   * {@link fps}, until {@link stopFrameLoop}.
   */
  private startFrameLoop(onFrame: () => void): void {
    this.stopFrameLoop();
    let lastCapturedMs: number | undefined;
    const tick = () => {
      const nowMs = performance.now();
      if (!shouldCaptureFrame(nowMs, lastCapturedMs, this.fps)) return;
      lastCapturedMs = nowMs;
      onFrame();
    };
    if (this.subscribeFrame) {
      this.stopFrames = this.subscribeFrame(tick);
      return;
    }
    let handle = 0;
    const pump = () => {
      tick();
      handle = requestAnimationFrame(pump);
    };
    handle = requestAnimationFrame(pump);
    this.stopFrames = () => cancelAnimationFrame(handle);
  }

  private stopFrameLoop(): void {
    this.stopFrames?.();
    this.stopFrames = undefined;
  }

  /** Releases every capture resource: frame loop, video tracks, audio tap and buffered chunks. Idempotent. */
  private release(): void {
    this.stopFrameLoop();
    this.mediaRecorder = undefined;
    this.chunks = [];
    this.source = undefined;
    this.releaseVideoStream();
    this.detachAudioTap();
  }

  /**
   * Stops every track on the captured `videoStream` and drops the reference. The browser keeps the capture pipeline
   * alive (and burns CPU on every canvas paint) until `track.stop()` lands on each track, even after
   * `MediaRecorder.stop()` returns. Idempotent — safe to call when the stream wasn't started or has already been
   * released.
   */
  private releaseVideoStream(): void {
    const stream = this.videoStream;
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Defensive — `track.stop()` throws on tracks that have already ended in some browser builds.
      }
    }
    this.videoStream = undefined;
  }

  private detachAudioTap(): void {
    if (!this.audioDestination) return;
    try {
      this.audioOutput.disconnect(this.audioDestination);
    } catch {
      // `disconnect(target)` throws when the edge isn't present. Defensive — `start` always connects before populating
      // `audioDestination`, but the recorder can be torn down mid-construction if `start` itself threw after wiring.
    }
    this.audioDestination = undefined;
  }
}

// Static import of `ts-ebml` so Vite handles its CJS interop during the initial pre-bundle pass. The previous dynamic
// import deferred the resolution to a second optimization pass where the named-export re-export `tools.readVint` would
// land as `undefined` and crash the recording-stop flow.
import { Decoder, Reader, tools } from 'ts-ebml';

/**
 * Rewrites a `MediaRecorder`-produced WebM blob so external video players can seek inside it.
 *
 * The problem: `MediaRecorder` writes a streaming WebM container with no `Duration` field on the EBML header and no
 * `Cues` (seek index) at all — the spec doesn't require them for live captures. Most players (Chrome's <video>, Safari,
 * VLC, QuickTime, Finder previews, Discord embeds) refuse to seek inside such a file: the scrub bar drags but the
 * playhead snaps back to wherever the next cluster boundary happens to be. The user-visible symptom is exactly what was
 * reported — the saved `.webm` plays, but you can't jump around inside it.
 *
 * The fix is to walk the EBML tree once, collect the cluster timestamps + their byte offsets, then splice a fresh
 * `SeekHead` + `Cues` + `Duration` block in front of the original body. `ts-ebml` is the canonical browser-side library
 * for this dance — it ships a `Decoder` that emits typed EBML elements, an `EBMLReader` that accumulates the metadata
 * we need, and a `tools.makeMetadataSeekable` that builds the patched header buffer.
 *
 * Returns a fresh `Blob` of the same MIME type with seekable metadata. Falls back to the original blob (and logs a
 * warning) when the input isn't a recognizable WebM container or the patch fails — better to hand the user the
 * play-only file than to lose the recording outright.
 */
export async function makeWebmSeekable(blob: Blob): Promise<Blob> {
  if (blob.size === 0) return blob;
  const buffer = await blob.arrayBuffer();
  try {
    const decoder = new Decoder();
    const reader = new Reader();
    reader.logging = false;
    reader.drop_default_duration = false;
    const elements = decoder.decode(buffer);
    for (const element of elements) {
      reader.read(element);
    }
    reader.stop();
    const refinedMetadata = tools.makeMetadataSeekable(reader.metadatas, reader.duration, reader.cues);
    const body = buffer.slice(reader.metadataSize);
    return new Blob([refinedMetadata, body], { type: blob.type });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[recorder] failed to inject seekable metadata; downloading raw blob', error);
    return blob;
  }
}

/**
 * Triggers a browser download of `blob` under `filename`. Pure convenience — the caller wires up the click handler.
 *
 * Revokes the temporary blob URL after the click has had a chance to register (next microtask) so the download still
 * completes but the URL doesn't sit pinning the blob in memory.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  // Defer revoke to the next macrotask — Chrome / Firefox finalize the download synchronously after `click()` but
  // Safari spreads the work across event-loop turns; revoking too eagerly there can cancel the in-flight download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 0);
}
