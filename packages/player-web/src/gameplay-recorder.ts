/**
 * Records the gameplay scene to a downloadable video Blob using `MediaRecorder` + `HTMLCanvasElement.captureStream` for
 * video and `MediaStreamAudioDestinationNode` for audio. Output is a single WebM container with a VP9 / VP8 video track
 * and an Opus audio track — VP9 preferred, falls back through the codec / mime-type chain if the browser doesn't expose
 * it.
 *
 * Why this approach over offline rendering:
 *
 * - **Real-time.** Captures the canvas as it actually plays, so the recording reflects exactly what the user saw (frame
 *   skips, jank and all). Acceptable trade-off for a debugging / sharing tool.
 * - **No new deps.** All four APIs (`MediaRecorder`, `captureStream`, `MediaStreamAudioDestinationNode`, `Blob`
 *   download) are part of the modern browser baseline. A WASM encoder + offline render pipeline would be more accurate
 *   but order-of-magnitude more complex.
 *
 * Usage:
 *
 * ```ts
 * const recorder = new GameplayRecorder({ canvas, audioContext, audioOutput });
 * recorder.start();
 * // ... gameplay runs ...
 * const blob = await recorder.stop();
 * downloadBlob(blob, 'song.webm');
 * ```
 *
 * Disposed instances throw on further calls; the host should construct a fresh recorder per recording session.
 */

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
   * Frames per second to capture. Defaults to 60 to match the gameplay tick. Setting a lower value (e.g. 30) produces a
   * smaller output at the cost of jerkier scrolling notes.
   */
  fps?: number;
  /**
   * Bits-per-second target for the video track. Defaults to ~5 Mbps which gives reasonable quality for a 1280×720 LR2
   * design space without bloating the file. Honoured only when the picked codec / browser respects the hint.
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

export class GameplayRecorder {
  private readonly canvas: HTMLCanvasElement;
  private readonly audioContext: AudioContext;
  private readonly audioOutput: AudioNode;
  private readonly fps: number;
  private readonly videoBitsPerSecond: number;
  private readonly audioBitsPerSecond: number;
  private readonly explicitMimeType: string | undefined;
  private mediaRecorder: MediaRecorder | undefined;
  private audioDestination: MediaStreamAudioDestinationNode | undefined;
  private chunks: Blob[] = [];
  private startedAtMs = 0;
  private disposed = false;

  public constructor(options: GameplayRecorderOptions) {
    this.canvas = options.canvas;
    this.audioContext = options.audioContext;
    this.audioOutput = options.audioOutput;
    this.fps = options.fps ?? 60;
    this.videoBitsPerSecond = options.videoBitsPerSecond ?? 5_000_000;
    this.audioBitsPerSecond = options.audioBitsPerSecond ?? 192_000;
    this.explicitMimeType = options.mimeType;
  }

  public isActive(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  /**
   * Begins capture. Throws when:
   *
   * - The browser doesn't expose `MediaRecorder` / `canvas.captureStream` / a supported MIME type. UI hosts should
   *   handle this gracefully (hide the record button, show a toast).
   * - The recorder was previously stopped without a fresh instance (`disposed` flag) — recording is a one-shot per
   *   instance to keep the chunk-buffer lifecycle simple.
   */
  public start(): void {
    if (this.disposed) {
      throw new Error('GameplayRecorder.start: instance has already been disposed');
    }
    if (this.mediaRecorder) {
      throw new Error('GameplayRecorder.start: recording is already in progress');
    }
    const mimeType = this.explicitMimeType ?? pickRecorderMimeType();
    if (!mimeType) {
      throw new Error('GameplayRecorder.start: browser exposes no supported MediaRecorder MIME type');
    }
    if (typeof this.canvas.captureStream !== 'function') {
      throw new Error('GameplayRecorder.start: HTMLCanvasElement.captureStream is unavailable');
    }
        // Audio tap. The `MediaStreamAudioDestinationNode` is a dedicated sink — connecting `audioOutput` to it is
    // additive, so live playback through `audioContext.destination` keeps working unchanged.
    const audioDestination = this.audioContext.createMediaStreamDestination();
    this.audioOutput.connect(audioDestination);
    this.audioDestination = audioDestination;
    // Combine canvas video + bus audio into a single stream so the recorder treats them as one timeline.
    const videoStream = this.canvas.captureStream(this.fps);
    const combined = new MediaStream([...videoStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
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
    this.startedAtMs = performance.now();
  }

  /**
   * Ends capture and resolves with the assembled video Blob plus the MIME type the browser used. Idempotent — calling
   * on a non-active recorder resolves with `undefined`.
   *
   * Cleans up the audio tap regardless of state, so a `stop()` call also functions as a panic abort.
   */
  public async stop(): Promise<GameplayRecorderResult | undefined> {
    const recorder = this.mediaRecorder;
    if (!recorder) {
      this.detachAudioTap();
      return undefined;
    }
    if (recorder.state === 'inactive') {
      this.detachAudioTap();
      return undefined;
    }
    const stopPromise = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    recorder.stop();
    await stopPromise;
    const mimeType = recorder.mimeType || 'video/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    this.chunks = [];
    this.detachAudioTap();
    this.mediaRecorder = undefined;
    return {
      blob,
      mimeType,
      durationMs: performance.now() - this.startedAtMs,
    };
  }

  /**
   * Hard-stops without waiting for the final chunk. Discards any partially-collected data. Used by the gameplay view's
   * `dispose` when the user ESCs out mid-recording — we don't want to dangle the audio tap and the user obviously isn't
   * going to use the partial blob.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Throws if state is already 'inactive' or never started. Both cases are fine — nothing more to do.
      }
    }
    this.mediaRecorder = undefined;
    this.chunks = [];
    this.detachAudioTap();
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
// import deferred the resolution to a second optimisation pass where the named-export re-export `tools.readVint` would
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
 * warning) when the input isn't a recognisable WebM container or the patch fails — better to hand the user the
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
