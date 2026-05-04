import { Texture, VideoSource } from 'pixi.js';
import { resolveLr2AssetBytes, type Lr2Skin } from './lr2-skin.ts';

/**
 * Result of `loadVideoTextureFromBytes`. The texture is a Pixi
 * `Texture` whose source is a `VideoSource` wrapping the same
 * `<video>` element returned alongside it. Callers seek / play the
 * video element directly to drive frame updates; the Pixi source
 * polls `requestVideoFrameCallback` (or a rAF fallback) to push
 * fresh frames into the GL texture.
 *
 * The associated `objectUrl` is created from the bytes' `Blob` and
 * MUST be revoked (via `URL.revokeObjectURL`) once the texture is
 * disposed to free the underlying memory.
 */
export interface VideoTextureHandle {
  texture: Texture;
  video: HTMLVideoElement;
  objectUrl: string;
}

/**
 * Tunables for the ffmpeg.wasm fallback path. Plumbed through from
 * the host so end-users can trade encode time for visual
 * resolution at runtime (the demo wires this to a lil-gui pair).
 */
export interface VideoTranscodeOptions {
  /**
   * When set to a positive integer, the transcode pass downscales
   * the source so neither side exceeds this many pixels (aspect
   * ratio preserved). Single-threaded libx264's per-frame cost
   * scales linearly with width × height, so this is the single
   * biggest lever we have once `-preset ultrafast` is in effect.
   * BMS BGA renders into a 256-px spec canvas and even at 3× DPR
   * tops out near 768 px on screen, so caps in the 480–720 range
   * are visually transparent under nearest-filter scaling.
   *
   * `undefined` / `0` / negative values disable the cap and the
   * source resolution is preserved verbatim (the original behaviour).
   */
  maxLongEdgePx?: number;
  /**
   * When true, the encode step uses the WebCodecs `VideoEncoder`
   * API instead of libx264 in the wasm core. The decode step
   * still goes through ffmpeg.wasm because WebCodecs'
   * `VideoDecoder` doesn't support the legacy codecs (MPEG-1,
   * VC-1, etc.) BMS BGA usually ships in.
   *
   * WebCodecs is hardware-accelerated where the browser's
   * platform decoder/encoder is available — typically a 5–20×
   * encode-side speedup over the single-threaded wasm libx264.
   * Falls back to the ffmpeg-only path silently when the
   * browser doesn't expose `VideoEncoder` (currently Safari <
   * 17 / older Firefox builds), when `isConfigSupported`
   * rejects the requested codec parameters, or when any step
   * of the WebCodecs pipeline throws.
   */
  useWebCodecs?: boolean;
}

/**
 * Loads a video file (`mp4` / `webm` / etc.) into a Pixi `Texture`
 * backed by an HTML `<video>` element. The video starts paused and
 * muted — the caller is expected to seek + `.play()` it on cue.
 *
 * Falls back to {@link transcodeVideoToBrowserCodec} (via libav /
 * ffmpeg.wasm) when the browser refuses to decode the original
 * bytes — typical for legacy BMS BGA shipping `.mpg` / MPEG-1
 * containers that no modern browser plays natively. The
 * transcode pass writes a temporary H.264 / yuv420p MP4 in
 * memory and feeds that back through the same `<video>` path,
 * so the rest of the BGA pipeline (Pixi `VideoSource`, frame
 * polling) is identical regardless of whether a transcode
 * happened.
 *
 * Returns `undefined` only when both the native decode AND the
 * libav fallback fail — at that point we accept the asset is
 * unplayable and the BGA preloader simply skips it.
 */
export async function loadVideoTextureFromBytes(
  path: string,
  bytes: Uint8Array,
  options?: VideoTranscodeOptions,
): Promise<VideoTextureHandle | undefined> {
  const direct = await tryLoadVideoTextureFromBytes(path, bytes);
  if (direct) return direct;
  // eslint-disable-next-line no-console
  console.info(`[bga-video] native decode failed; falling back to ffmpeg.wasm transcode: ${path}`);
  let transcoded: Uint8Array | undefined;
  if (options?.useWebCodecs && isWebCodecsEncodeSupported()) {
    transcoded = await transcodeViaWebCodecs(bytes, path, options).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] WebCodecs transcode failed; falling back to ffmpeg encode: ${path}`, error);
      return undefined;
    });
  }
  if (!transcoded) {
    transcoded = await transcodeVideoToBrowserCodec(bytes, path, options).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] transcode failed: ${path}`, error);
      return undefined;
    });
  }
  if (!transcoded) return undefined;
  // The transcoded payload is always MP4 / H.264 (whether it
  // came out of libx264 or the WebCodecs encoder); pass an
  // explicit name so `guessVideoMimeType` picks `video/mp4`
  // and the browser's H.264 decoder takes the fast path.
  return tryLoadVideoTextureFromBytes(`${stripVideoExtension(path)}.transcoded.mp4`, transcoded);
}

/**
 * Browser-side check for the `VideoEncoder` half of WebCodecs.
 * Used to gate the Web Codecs encode path before we even hand
 * bytes to ffmpeg for decoding — there's no point paying the
 * decode cost if we can't encode the result with WebCodecs.
 *
 * `'VideoEncoder' in globalThis` is the canonical feature
 * detection; it avoids tripping a `ReferenceError` on older
 * browsers (Safari < 17, older Firefox) that don't define the
 * symbol at all.
 */
export function isWebCodecsEncodeSupported(): boolean {
  return typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis;
}

async function tryLoadVideoTextureFromBytes(path: string, bytes: Uint8Array): Promise<VideoTextureHandle | undefined> {
  const blob = new Blob([new Uint8Array(bytes)], { type: guessVideoMimeType(path) });
  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = objectUrl;
  // BMS BGA video has no soundtrack of its own — audio comes from
  // `#WAV` samples on the chart timeline. Muting also lets some
  // browsers skip the autoplay-policy gating since silent media is
  // exempt.
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  // `loop` is left at false — BGA cues drive when the video starts;
  // looping would replay forever after the cue ends, which doesn't
  // match BMS semantics.
  video.loop = false;

  try {
    await waitForVideoMetadata(video, 5000);
  } catch {
    releaseVideoElement(video);
    URL.revokeObjectURL(objectUrl);
    return undefined;
  }

  const source = new VideoSource({ resource: video, autoPlay: false, autoLoad: true });
  // BGA video should look as the artist authored it; nearest-pixel
  // sampling matches our per-skin default for low-res BGA frames
  // and avoids the smeary look the GPU's bilinear gives on 256x256
  // BMS-spec frames scaled up to 800px+ playfields.
  source.scaleMode = 'nearest';
  source.label = path;
  const texture = new Texture({ source });
  texture.label = path;
  return { texture, video, objectUrl };
}

/**
 * Lazy-imports libav.js (ffmpeg.wasm) and remuxes / re-encodes
 * `bytes` to MP4 / H.264 / yuv420p — the lowest-common-denominator
 * codec every modern browser plays natively. The libav module is
 * a multi-megabyte WASM bundle, so the import is intentionally
 * deferred to here: a typical drop with only modern BGA video
 * never pays the download cost.
 *
 * `noworker: true` keeps everything on the main thread so the
 * dev-server doesn't need to ship the COOP / COEP headers a
 * worker-based libav build would otherwise require. Transcoding
 * is CPU-bound but happens during the BGA prepare phase (which
 * already overlaps the Decide splash), so the user never sees a
 * frozen frame waiting for it.
 */
async function transcodeVideoToBrowserCodec(
  bytes: Uint8Array,
  path: string,
  options?: VideoTranscodeOptions,
): Promise<Uint8Array | undefined> {
  const startedAt = performance.now();
  const maxLongEdge = resolveMaxLongEdge(options);
  // eslint-disable-next-line no-console
  console.info(
    `[bga-video] transcode start: ${path} (${bytes.byteLength} bytes${maxLongEdge ? `, resize ≤ ${maxLongEdge}px` : ''})`,
  );
  const ffmpeg = await loadFfmpeg().catch((error) => {
    // eslint-disable-next-line no-console
    console.warn('[bga-video] failed to load ffmpeg.wasm — BGA video will be skipped', error);
    return undefined;
  });
  if (!ffmpeg) return undefined;
  const inputName = `bga-input${pickInputExtension(path)}`;
  const outputName = 'bga-output.mp4';
  try {
    // Clone before handing to ffmpeg.wasm: the worker channel
    // posts the buffer with `transfer` ownership (detaching
    // the source ArrayBuffer), which would brick any caller
    // that wants to retry the same bytes through a different
    // transcode path (e.g. the WebCodecs → ffmpeg fallback
    // chain in `loadVideoTextureFromBytes`).
    await ffmpeg.writeFile(inputName, new Uint8Array(bytes));
    // libx264 fast path. Encoder-side flags chosen for the
    // fastest possible single-threaded encode while keeping
    // the output universally browser-decodable:
    //
    //   - `-c:v libx264 -pix_fmt yuv420p` — universally decoded
    //   - `-preset ultrafast` skips most analysis passes.
    //   - `-tune fastdecode,zerolatency` drops bidirectional
    //     prediction. `fastdecode` also swaps CABAC for CAVLC,
    //     which is ~10–15% faster to encode in addition to
    //     being faster to decode.
    //   - `-crf 30` trades a notch of quality for speed; BGA
    //     art tolerates it cleanly under nearest-filter scaling.
    //   - `-an` strips audio (BMS BGA's audio is irrelevant —
    //     `#WAV` drives chart audio).
    //   - `-movflags +faststart` puts the moov atom at the head
    //     of the file. Adds a second muxer pass but gives the
    //     `<video>` element predictable structure either way.
    //
    // `-vf scale=...` is only inserted when the host opted into
    // resizing via `options.maxLongEdgePx`. See
    // {@link buildScaleFilterArg} for the exact filter graph.
    //
    // No `-threads` override: the wasm core is single-threaded
    // (see `loadFfmpeg` for why we don't use core-mt), so
    // libx264 picks 1 by itself.
    const ffmpegArgs: string[] = ['-y', '-i', inputName];
    if (maxLongEdge) {
      ffmpegArgs.push('-vf', buildScaleFilterArg(maxLongEdge));
    }
    ffmpegArgs.push(
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'fastdecode,zerolatency',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-movflags',
      '+faststart',
      outputName,
    );
    const exitCode = await ffmpeg.exec(ffmpegArgs);
    if (exitCode !== 0) {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] ffmpeg exited with code ${exitCode} for ${path}`);
      return undefined;
    }
    const out = await ffmpeg.readFile(outputName);
    let outBytes: Uint8Array | undefined;
    if (out instanceof Uint8Array) {
      outBytes = out;
    } else if (typeof out === 'string') {
      // ffmpeg.readFile can return string when no encoding is
      // overridden — coerce via TextEncoder so we always return
      // raw bytes downstream.
      outBytes = new TextEncoder().encode(out);
    }
    if (!outBytes || outBytes.byteLength === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] ffmpeg produced empty output for ${path}`);
      return undefined;
    }
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
    // eslint-disable-next-line no-console
    console.info(`[bga-video] transcode ok: ${path} → ${outBytes.byteLength} bytes (${elapsed}s)`);
    return outBytes;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[bga-video] transcode threw for ${path}`, error);
    return undefined;
  } finally {
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore — the in-memory FS lives only as long as the
      // FFmpeg instance, which we leak between calls (see
      // `loadFfmpeg` for why) so cleanup just keeps the VFS
      // tidy across calls.
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      // ignore
    }
  }
}

/**
 * Resolves the user's `maxLongEdgePx` knob into a strictly
 * positive integer (or `undefined`). Anything else — `NaN`, `0`,
 * negative numbers — is treated as "no resize", which matches
 * the GUI's `Off` row in the demo dropdown.
 */
function resolveMaxLongEdge(options: VideoTranscodeOptions | undefined): number | undefined {
  const raw = options?.maxLongEdgePx;
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.floor(raw);
}

/**
 * Builds the `-vf scale=...` filter string for a target
 * long-edge cap. We use `min(iw,N)` / `min(ih,N)` so small
 * inputs (legacy 256-px BGA) pass through unchanged, then
 * `force_original_aspect_ratio=decrease` collapses one edge to
 * preserve aspect when the input originally exceeded the cap.
 * `force_divisible_by=2` keeps yuv420p chroma aligned, and
 * `flags=fast_bilinear` picks the cheapest scaler. Commas
 * inside `min()` are escaped (`\\,`) so the filter-graph
 * parser doesn't read them as filter-chain separators.
 */
function buildScaleFilterArg(maxLongEdge: number): string {
  return `scale='min(iw\\,${maxLongEdge})':'min(ih\\,${maxLongEdge})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear`;
}

/**
 * WebCodecs encode path. Pipeline:
 *
 *   1. ffmpeg.wasm decodes the source to raw `yuv420p` planes.
 *      We keep ffmpeg as the decoder because WebCodecs'
 *      `VideoDecoder` doesn't speak the legacy MPEG-1 / VC-1
 *      / WMV codecs typical BMS BGA ships in.
 *   2. JS wraps each decoded frame in a `VideoFrame` and feeds
 *      it to `VideoEncoder` (H.264 / avc1 baseline). On most
 *      platforms this hits the GPU / ASIC video encoder, taking
 *      encode time from ~1× realtime down to 5–20× realtime.
 *   3. Encoded chunks land in `mp4-muxer`'s in-memory MP4
 *      writer; once the encoder flushes, we hand the muxer's
 *      `ArrayBufferTarget` bytes back to the caller — same
 *      shape as the ffmpeg-encode path returns, so the
 *      downstream `<video>` blob plumbing is unchanged.
 *
 * Memory: decode and encode are interleaved in chunks rather
 * than buffering the whole video as raw YUV. We can't get true
 * stream-style concurrency (the wasm worker's `exec()` call
 * blocks the worker from servicing `readFile` until decode
 * completes, and there are no pipes in @ffmpeg/ffmpeg), but
 * looping `ffmpeg.exec(['-ss', t, '-t', N, '-i', input, ...])`
 * + `readFile` + `deleteFile` per chunk keeps MEMFS usage
 * bounded by `MAX_CHUNK_BYTES` regardless of total duration.
 *
 * Trade-off: each chunk requires ffmpeg to seek+demux from the
 * input again. Chunk size is sized to amortise this seek over
 * many frames — too small and demux overhead dominates, too
 * large and per-chunk MEMFS pressure blows the wasm heap.
 * 256 MiB lands ~21 s of 512×512@30 (a typical BMS BGA) and
 * ~3 s of 1920×1080@30 (HD outlier) per chunk; both have
 * negligible seek overhead relative to the encode work.
 */
const MAX_CHUNK_BYTES = 256 * 1024 * 1024; // 256 MiB
const MIN_CHUNK_SECONDS = 5;
async function transcodeViaWebCodecs(
  bytes: Uint8Array,
  path: string,
  options: VideoTranscodeOptions,
): Promise<Uint8Array | undefined> {
  if (!isWebCodecsEncodeSupported()) return undefined;
  const startedAt = performance.now();
  const maxLongEdge = resolveMaxLongEdge(options);
  // eslint-disable-next-line no-console
  console.info(
    `[bga-video] WebCodecs transcode start: ${path} (${bytes.byteLength} bytes${maxLongEdge ? `, resize ≤ ${maxLongEdge}px` : ''})`,
  );
  const ffmpeg = await loadFfmpeg().catch((error) => {
    // eslint-disable-next-line no-console
    console.warn('[bga-video] failed to load ffmpeg.wasm — WebCodecs transcode aborted', error);
    return undefined;
  });
  if (!ffmpeg) return undefined;
  const inputName = `bga-input${pickInputExtension(path)}`;
  const chunkName = 'bga-chunk.yuv';
  let probeListener: ((event: { type: string; message: string }) => void) | undefined;
  const probeLines: string[] = [];
  let encoder: VideoEncoder | undefined;
  try {
    // Clone before writeFile — see the libx264 path for why.
    // We need the caller's `bytes` to survive intact in case
    // the WebCodecs path bails out and the ffmpeg-encode
    // fallback is run with the same buffer.
    await ffmpeg.writeFile(inputName, new Uint8Array(bytes));
    // ffmpeg's stderr log carries the input geometry, frame
    // rate, and total duration we need to drive the WebCodecs
    // encoder + chunk loop. Hook a parallel listener that
    // doesn't displace `loadFfmpeg`'s diagnostic listener.
    probeListener = ({ type, message }) => {
      if (type === 'stderr') {
        probeLines.push(message);
      }
    };
    ffmpeg.on('log', probeListener);

    // ── Probe pass ──────────────────────────────────────────
    // `-t 0.05` decodes ~1-2 frames purely so ffmpeg emits the
    // `Input #0` / `Stream #0:0` / `Duration:` lines we parse
    // below. `-f null -` discards the output entirely so this
    // costs only ffmpeg's cold-start time (~50–100 ms once
    // the wasm core is cached). Cheaper than running ffprobe
    // separately, and the stderr format is identical.
    const probeArgs: string[] = ['-y', '-i', inputName, '-t', '0.05'];
    if (maxLongEdge) probeArgs.push('-vf', buildScaleFilterArg(maxLongEdge));
    probeArgs.push('-f', 'null', '-');
    const probeExit = await ffmpeg.exec(probeArgs);
    if (probeExit !== 0) {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] ffmpeg probe (WebCodecs path) exited with code ${probeExit} for ${path}`);
      return undefined;
    }
    const probe = parseFfmpegProbe(probeLines);
    if (!probe) {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] WebCodecs path could not parse ffmpeg probe; falling back: ${path}`);
      return undefined;
    }
    const { width, height, frameRate, durationSec } = probe;
    if (!durationSec || durationSec <= 0) {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] WebCodecs path could not determine duration; falling back: ${path}`);
      return undefined;
    }
    // 12 bits per pixel (yuv420p): 1.5 bytes per pixel.
    const bytesPerFrame = (width * height * 3) >> 1;
    if (bytesPerFrame <= 0) return undefined;

    // ── Encoder + muxer setup ───────────────────────────────
    // H.264 baseline @ Level 5.0 covers up to 1920×1080@30. The
    // browser's `isConfigSupported` will reject anything beyond
    // the platform encoder's reach; we treat that as a
    // fall-through to the ffmpeg-encode path rather than a
    // hard failure.
    //
    // `hardwareAcceleration: 'prefer-hardware'` asks for the
    // platform encoder (VideoToolbox on macOS,
    // MediaFoundation on Windows, MediaCodec on Android, …)
    // but accepts the software fallback when none is
    // available. We log the negotiated mode for visibility.
    const encoderConfig: VideoEncoderConfig = {
      codec: 'avc1.42E01E',
      width,
      height,
      bitrate: estimateBitrate(width, height, frameRate),
      framerate: frameRate,
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'avc' },
    };
    const support = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!support.supported) {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] WebCodecs encoder rejected config for ${path}; falling back`, support);
      return undefined;
    }
    const negotiated = support.config ?? encoderConfig;
    const accelerationLabel = negotiated.hardwareAcceleration ?? 'no-preference';
    // eslint-disable-next-line no-console
    console.info(`[bga-video] WebCodecs encoder negotiated: ${negotiated.codec} (${accelerationLabel})`);
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width,
        height,
        frameRate,
      },
      // 'in-memory' fastStart keeps everything buffered until
      // `finalize()` writes a moov-at-front MP4 — same as
      // libx264's `+faststart`.
      fastStart: 'in-memory',
    });
    encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        muxer.addVideoChunk(chunk, metadata);
      },
      error: (error) => {
        // eslint-disable-next-line no-console
        console.warn(`[bga-video] WebCodecs encoder error for ${path}`, error);
      },
    });
    encoder.configure(negotiated);

    // ── Chunk loop ──────────────────────────────────────────
    // Compute how many seconds fit in the per-chunk byte
    // budget. We always round down to the nearest second so
    // ffmpeg's `-t` argument cleanly matches a frame boundary,
    // and clamp to `MIN_CHUNK_SECONDS` so seek + demux setup
    // doesn't dominate the wall-clock cost on enormous inputs.
    const bytesPerSecond = bytesPerFrame * frameRate;
    const chunkSeconds = Math.max(MIN_CHUNK_SECONDS, Math.floor(MAX_CHUNK_BYTES / bytesPerSecond));
    const keyframeInterval = Math.max(1, Math.round(frameRate * 2));
    const microsPerFrame = Math.max(1, Math.round(1_000_000 / frameRate));

    let frameIndex = 0;
    let chunkCount = 0;
    for (let chunkStartSec = 0; chunkStartSec < durationSec; chunkStartSec += chunkSeconds) {
      const remainingSec = durationSec - chunkStartSec;
      const thisChunkSec = Math.min(chunkSeconds, remainingSec);

      // `-ss BEFORE -i` does input-level seek and is accurate
      // by default in modern ffmpeg (decode-and-discard between
      // the prior keyframe and the seek target). For the first
      // chunk we omit `-ss` entirely — some demuxers re-parse
      // headers when a `-ss 0` is present which adds latency
      // for no benefit.
      const chunkArgs: string[] = ['-y'];
      if (chunkStartSec > 0) chunkArgs.push('-ss', chunkStartSec.toFixed(3));
      chunkArgs.push('-t', thisChunkSec.toFixed(3), '-i', inputName);
      if (maxLongEdge) chunkArgs.push('-vf', buildScaleFilterArg(maxLongEdge));
      chunkArgs.push('-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', '-an', '-sn', '-dn', chunkName);
      const chunkExit = await ffmpeg.exec(chunkArgs);
      if (chunkExit !== 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[bga-video] ffmpeg chunk decode (WebCodecs path) exited with code ${chunkExit} at ${chunkStartSec.toFixed(2)}s for ${path}`,
        );
        return undefined;
      }
      const chunkRead = await ffmpeg.readFile(chunkName);
      const chunkBytes = chunkRead instanceof Uint8Array ? chunkRead : new TextEncoder().encode(chunkRead);
      // Always delete BEFORE iterating frames so MEMFS pressure
      // peaks at one chunk's worth of YUV. The Uint8Array view
      // we just took stays valid because @ffmpeg/ffmpeg copied
      // bytes out of MEMFS into the JS heap during readFile.
      try {
        await ffmpeg.deleteFile(chunkName);
      } catch {
        // ignore
      }
      if (chunkBytes.byteLength === 0) {
        // ffmpeg's `-t` with imprecise duration sometimes
        // overshoots the input end and produces an empty
        // chunk. Treat as EOF and stop.
        break;
      }
      if (chunkBytes.byteLength % bytesPerFrame !== 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[bga-video] WebCodecs path: chunk byte length ${chunkBytes.byteLength} not divisible by ${bytesPerFrame} (frame size); falling back: ${path}`,
        );
        return undefined;
      }
      const framesInChunk = chunkBytes.byteLength / bytesPerFrame;
      for (let i = 0; i < framesInChunk; i++) {
        // Slice (not copy) the raw frame view — WebCodecs
        // takes the buffer reference and the encoder consumes
        // it before we move to the next frame.
        const frameBytes = chunkBytes.subarray(i * bytesPerFrame, (i + 1) * bytesPerFrame);
        const frame = new VideoFrame(frameBytes, {
          format: 'I420',
          codedWidth: width,
          codedHeight: height,
          timestamp: frameIndex * microsPerFrame,
          duration: microsPerFrame,
        });
        encoder.encode(frame, { keyFrame: frameIndex % keyframeInterval === 0 });
        frame.close();
        // Backpressure: yield when the encoder queue grows
        // past a few dozen frames so the GPU encoder can
        // drain. Without this, on a fast wasm-decode + slow
        // encoder pairing we'd pile up hundreds of frames in
        // memory before any get muxed.
        if (encoder.encodeQueueSize > 32) {
          await waitForEncoderDrain(encoder, 4);
        }
        frameIndex++;
      }
      chunkCount++;
    }
    await encoder.flush();
    encoder.close();
    encoder = undefined;
    muxer.finalize();
    const outBytes = new Uint8Array(target.buffer);
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
    // eslint-disable-next-line no-console
    console.info(
      `[bga-video] WebCodecs transcode ok: ${path} → ${outBytes.byteLength} bytes (${elapsed}s, ${frameIndex} frames @ ${width}×${height}, ${chunkCount} chunks of ≤${chunkSeconds}s)`,
    );
    return outBytes;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[bga-video] WebCodecs transcode threw for ${path}`, error);
    return undefined;
  } finally {
    if (probeListener) {
      try {
        ffmpeg.off('log', probeListener);
      } catch {
        // ignore
      }
    }
    if (encoder) {
      try {
        encoder.close();
      } catch {
        // ignore — encoder.close() throws if already closed
      }
    }
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }
    try {
      await ffmpeg.deleteFile(chunkName);
    } catch {
      // ignore
    }
  }
}

/**
 * Pulls input geometry / frame rate / duration out of ffmpeg's
 * stderr. The lines we want look like:
 *
 *   `Duration: 00:02:02.00, start: 0.398189, bitrate: 5076 kb/s`
 *   `Stream #0:0(jpn): Video: vc1 ..., yuv420p, 1080x1080 [...], 30 tbr, 1k tbn`
 *
 * `tbr` (frame rate) and `WxH` come from the `Stream` line;
 * `Duration:` carries the total length we use to size the
 * chunk loop. The rest of each line (codec, profile, SAR /
 * DAR) is informative but doesn't affect the WebCodecs
 * encoder configuration.
 *
 * Returns `undefined` if any of geometry / frame rate /
 * duration could not be parsed. The WebCodecs path bails out
 * in that case rather than guessing.
 */
function parseFfmpegProbe(
  lines: ReadonlyArray<string>,
): { width: number; height: number; frameRate: number; durationSec: number } | undefined {
  let width: number | undefined;
  let height: number | undefined;
  let frameRate: number | undefined;
  let durationSec: number | undefined;
  for (const line of lines) {
    if (durationSec === undefined) {
      const duration = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/u);
      if (duration) {
        const hours = Number.parseInt(duration[1]!, 10);
        const minutes = Number.parseInt(duration[2]!, 10);
        const seconds = Number.parseFloat(duration[3]!);
        if (Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds)) {
          durationSec = hours * 3600 + minutes * 60 + seconds;
        }
      }
    }
    if (!line.includes('Video:')) continue;
    const dim = line.match(/(\d{2,5})x(\d{2,5})/u);
    if (dim) {
      width = Number.parseInt(dim[1]!, 10);
      height = Number.parseInt(dim[2]!, 10);
    }
    const fps = line.match(/(\d+(?:\.\d+)?)\s*(tbr|fps)/u);
    if (fps) {
      const value = Number.parseFloat(fps[1]!);
      if (Number.isFinite(value) && value > 0) {
        frameRate = value;
      }
    }
  }
  if (!width || !height || !frameRate || !durationSec) return undefined;
  return { width, height, frameRate, durationSec };
}

/**
 * Crude bitrate budget for the WebCodecs encoder, picked to
 * land at roughly the same visual fidelity libx264's
 * `-crf 30 -preset ultrafast` produces. The H.264 baseline
 * profile we configure tops out around level 5.0 — enough
 * headroom for any BMS BGA dimensions we'd accept here.
 */
function estimateBitrate(width: number, height: number, frameRate: number): number {
  const pixelsPerSecond = width * height * frameRate;
  // 0.08 bits per pixel-second lands around 4 Mb/s for 1080p30
  // and 1 Mb/s for 480p30 — comparable to libx264 ultrafast crf
  // 30 outputs in the same range.
  return Math.max(500_000, Math.round(pixelsPerSecond * 0.08));
}

/**
 * Yields control to the event loop until the encoder's queue
 * shrinks under `target`. Without this throttle, a fast wasm
 * decode loop can pile thousands of `VideoFrame`s into the
 * encoder's queue and exhaust GPU video memory.
 */
async function waitForEncoderDrain(encoder: VideoEncoder, target: number): Promise<void> {
  while (encoder.encodeQueueSize > target) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 4);
    });
  }
}

/**
 * Lazy-loaded singleton — the `FFmpeg` class boots a Worker that
 * downloads + instantiates the ~30 MB `@ffmpeg/core` wasm. We
 * keep the loaded instance around between calls so subsequent
 * BGA videos transcode immediately instead of paying the cold-
 * start hit on every chart change.
 */
let cachedFfmpeg: FfmpegInstance | undefined;
let cachedFfmpegPromise: Promise<FfmpegInstance> | undefined;

async function loadFfmpeg(): Promise<FfmpegInstance> {
  if (cachedFfmpeg) return cachedFfmpeg;
  if (cachedFfmpegPromise) return cachedFfmpegPromise;
  cachedFfmpegPromise = (async () => {
    // Lazy ESM imports keep the multi-megabyte wasm + worker
    // bundle out of the initial page load — the user only pays
    // the download cost when they actually pick a chart with an
    // unsupported BGA video.
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
    // We target the ESM entry from the host's `/ffmpeg-core/`
    // static path. @ffmpeg/ffmpeg creates its outer worker as
    // `type: "module"`, where `importScripts` is unavailable:
    // the worker's load handler catches that and falls back to
    // `await import(coreURL)`. Dynamic-importing the UMD bundle
    // yields `{ default: undefined }` (its IIFE assigns to a
    // module-local `var createFFmpegCore` rather than to
    // `module.exports` in a way the dynamic import can see),
    // which trips `ERROR_IMPORT_FAILURE`. The ESM bundle exports
    // `createFFmpegCore` as `default` properly.
    //
    // We deliberately use `@ffmpeg/core` (single-threaded) over
    // `@ffmpeg/core-mt`. The multi-threaded core 0.12.x has a
    // long-standing wasm bug where libx264's indirect calls
    // crash every pthread worker with `RuntimeError: function
    // signature mismatch`, after which `ffmpeg.exec()` aborts
    // with a non-Error throw that detonates inside the core's
    // own catch with `Cannot read properties of undefined
    // (reading 'startsWith')`. Single-threaded encoding takes
    // ~tens of seconds for a typical BMS BGA but actually
    // completes.
    //
    // The demo's Vite config installs a custom plugin
    // (`be-music:ffmpeg-core`) that serves the ESM core
    // (`ffmpeg-core.js` / `.wasm`) at this stable URL prefix in
    // dev and emits them as build assets in production.
    const baseUrl = '/ffmpeg-core';
    const coreUrl = `${baseUrl}/ffmpeg-core.js`;
    const wasmUrl = `${baseUrl}/ffmpeg-core.wasm`;
    const ffmpeg = new FFmpeg();
    // `toBlobURL` re-fetches the core JS / WASM URLs into blob
    // URLs so the spawned module worker's `await import(coreURL)`
    // succeeds even when the page sits behind a different origin
    // (the worker's same-origin policy otherwise blocks the
    // cross-origin file URLs Vite hands out under HMR).
    const [coreBlobUrl, wasmBlobUrl] = await Promise.all([
      toBlobURL(coreUrl, 'text/javascript'),
      toBlobURL(wasmUrl, 'application/wasm'),
    ]);
    // Surface ffmpeg's own log so we can see *what* the wasm
    // side reports — the core's `exec()` wrapper hides errors
    // without a JS-style `.message` (it only re-throws when the
    // message starts with `"Aborted"` and self-detonates with a
    // TypeError on `"unwind"` strings / OOMs), so the stderr log
    // is often our only signal when something goes wrong.
    ffmpeg.on('log', ({ type, message }: { type: string; message: string }) => {
      // eslint-disable-next-line no-console
      console.debug(`[bga-video] ffmpeg ${type}: ${message}`);
    });
    await ffmpeg.load({ coreURL: coreBlobUrl, wasmURL: wasmBlobUrl });
    cachedFfmpeg = ffmpeg as FfmpegInstance;
    return cachedFfmpeg;
  })().catch((error) => {
    // Reset the promise cache on failure so a transient
    // network blip doesn't permanently disable the fallback.
    cachedFfmpegPromise = undefined;
    throw error;
  });
  return cachedFfmpegPromise;
}

interface FfmpegInstance {
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array | string>;
  exec(args: string[]): Promise<number>;
  deleteFile(path: string): Promise<boolean>;
  /**
   * `@ffmpeg/ffmpeg` exposes an EventEmitter-style `on` /
   * `off` for the underlying worker's `log` events. The
   * WebCodecs encode path uses this to capture stderr lines
   * mid-decode (input geometry, frame rate) without displacing
   * the diagnostic listener `loadFfmpeg` already attaches.
   */
  on(event: 'log', listener: (event: { type: string; message: string }) => void): void;
  off(event: 'log', listener: (event: { type: string; message: string }) => void): void;
}

function pickInputExtension(path: string): string {
  const lower = path.toLowerCase();
  // Preserve the original extension so libav picks the right
  // demuxer (`.mpg` → mpegps, `.avi` → avi, `.wmv` → asf, …).
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex < 0) return '.mpg';
  const ext = lower.slice(dotIndex);
  // Allow only a small allowlist of known video extensions to
  // avoid passing arbitrary user-controlled strings into the
  // VFS path.
  if (['.mpg', '.mpeg', '.avi', '.wmv', '.mov', '.mp4', '.webm', '.mkv', '.ogv', '.ogg'].includes(ext)) {
    return ext;
  }
  return '.mpg';
}

function stripVideoExtension(path: string): string {
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex < 0) return path;
  return path.slice(0, dotIndex);
}

function releaseVideoElement(video: HTMLVideoElement): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    // Defensive: detached / unsupported media elements can throw on load().
  }
}

function waitForVideoMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      window.clearTimeout(timeoutHandle);
    };
    const onLoaded = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('video error'));
    };
    const timeoutHandle = window.setTimeout(() => {
      cleanup();
      reject(new Error('video metadata timeout'));
    }, timeoutMs);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });
}

function guessVideoMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.ogv') || lower.endsWith('.ogg')) return 'video/ogg';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  // Older BMS archives sometimes ship `.mpg` / `.mpeg` / `.avi` /
  // `.wmv` — modern browsers won't decode those so the video element
  // will fire `error` and `loadVideoTextureFromBytes` returns
  // `undefined`. We still tag a sensible MIME type so the rare
  // browser-supported codec works.
  if (lower.endsWith('.mpg') || lower.endsWith('.mpeg')) return 'video/mpeg';
  return 'video/mp4';
}

export interface LoadTextureOptions {
  /** Skin-declared `#TRANSCOLOR` chroma key (rare on BGA assets, common on UI sprites). */
  transparentColor?: { r: number; g: number; b: number };
  /**
   * Treat pure-black pixels as transparent. Mirrors the BMS BGA "layer"
   * convention (`packages/player/src/bga.ts`'s `isOpaquePixel` for `mode
   * === 'layer'`): the foreground BGA layer is composited over the base
   * with `(0, 0, 0)` acting as a chroma-key. Only enabled for layer-track
   * decodes — base / POOR retain their black pixels because they're the
   * bottommost BGA layer (nothing visible behind them).
   */
  keyOutBlack?: boolean;
}

/**
 * Loads any LR2 / BGA asset (TGA, PNG, BMP, JPG, …) into a PixiJS
 * `Texture`. Branches by file extension because TGA isn't decoded by
 * `createImageBitmap` in any browser.
 *
 * The legacy positional `transparentColor` argument is supported for
 * backward compatibility — pass an `LoadTextureOptions` object for the
 * full feature set (`keyOutBlack`, future flags).
 */
export async function loadTextureFromBytes(
  path: string,
  bytes: Uint8Array,
  transparentColorOrOptions?: { r: number; g: number; b: number } | LoadTextureOptions,
): Promise<Texture | undefined> {
  const options = normalizeLoadTextureOptions(transparentColorOrOptions);
  if (path.toLowerCase().endsWith('.tga')) {
    return decodeTgaTexture(bytes, options, path);
  }
  const blob = new Blob([new Uint8Array(bytes)]);
  return loadTextureFromBlob(blob, path, options);
}

/**
 * Resolves an LR2 skin asset (image, font sheet, etc.) to a Pixi
 * texture using the skin's bundled file map. Honours the skin's
 * `#TRANSCOLOR` chroma key.
 */
export async function loadSkinAssetTexture(skin: Lr2Skin, path: string): Promise<Texture | undefined> {
  const bytes = resolveLr2AssetBytes(skin, path);
  if (!bytes) {
    return undefined;
  }
  return loadTextureFromBytes(path, bytes, skin.transparentColor);
}

function normalizeLoadTextureOptions(
  input: { r: number; g: number; b: number } | LoadTextureOptions | undefined,
): LoadTextureOptions {
  if (!input) {
    return {};
  }
  // The legacy positional `transparentColor` shape has flat `r/g/b`
  // numbers; the new options shape has a nested `transparentColor` /
  // `keyOutBlack`. Discriminate on `r` so call sites that still pass
  // the bare color triple keep working without a typed cast.
  if (typeof (input as { r?: unknown }).r === 'number') {
    return { transparentColor: input as { r: number; g: number; b: number } };
  }
  return input as LoadTextureOptions;
}

async function loadTextureFromBlob(
  blob: Blob,
  label?: string,
  options: LoadTextureOptions = {},
): Promise<Texture | undefined> {
  try {
    const imageBitmap = await createImageBitmap(blob);
    let finalBitmap = imageBitmap;
    if (options.transparentColor || options.keyOutBlack) {
      const keyedBitmap = await applyChromaKeyToBitmap(imageBitmap, options);
      if (keyedBitmap) {
        imageBitmap.close();
        finalBitmap = keyedBitmap;
      }
    }
    let texture: Texture;
    try {
      texture = Texture.from(finalBitmap);
    } catch (error) {
      finalBitmap.close();
      throw error;
    }
    // Force nearest-neighbour sampling on every loaded texture. LR2
    // skin / BGA assets are pixel-art; bilinear filtering blurs them
    // when the design space is scaled up to the canvas. Mirrors the
    // user-requested "disable all interpolation / AA" policy.
    texture.source.scaleMode = 'nearest';
    if (label) {
      texture.label = label;
      texture.source.label = label;
    }
    return texture;
  } catch {
    return undefined;
  }
}

async function applyChromaKeyToBitmap(
  imageBitmap: ImageBitmap,
  options: LoadTextureOptions,
): Promise<ImageBitmap | undefined> {
  const canvas = document.createElement('canvas');
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }
  context.drawImage(imageBitmap, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const transparent = options.transparentColor;
  const keyOutBlack = options.keyOutBlack === true;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    if (transparent && r === transparent.r && g === transparent.g && b === transparent.b) {
      data[index + 3] = 0;
      continue;
    }
    if (keyOutBlack && r === 0 && g === 0 && b === 0) {
      data[index + 3] = 0;
    }
  }
  context.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}

async function decodeTgaTexture(
  bytes: Uint8Array,
  options: LoadTextureOptions = {},
  label?: string,
): Promise<Texture | undefined> {
  const transparentColor = options.transparentColor;
  const keyOutBlack = options.keyOutBlack === true;
  if (bytes.length < 18) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0] ?? 0;
  const colorMapType = bytes[1] ?? 0;
  const imageType = bytes[2] ?? 0;
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bitsPerPixel = bytes[16] ?? 0;
  const descriptor = bytes[17] ?? 0;
  const bytesPerPixel = bitsPerPixel / 8;
  const isRle = imageType === 10 || imageType === 11;
  const isTrueColor = imageType === 2 || imageType === 10;
  const isGrayscale = imageType === 3 || imageType === 11;

  if (
    colorMapType !== 0 ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(bytesPerPixel) ||
    !((isTrueColor && (bitsPerPixel === 24 || bitsPerPixel === 32)) || (isGrayscale && bitsPerPixel === 8))
  ) {
    return undefined;
  }

  const pixelCount = width * height;
  const imageData = new ImageData(width, height);
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  let sourceOffset = 18 + idLength;
  let written = 0;

  const writePixel = (source: number): boolean => {
    if (source + bytesPerPixel > bytes.length || written >= pixelCount) {
      return false;
    }
    const sourceX = written % width;
    const sourceY = Math.floor(written / width);
    const x = rightOrigin ? width - 1 - sourceX : sourceX;
    const y = topOrigin ? sourceY : height - 1 - sourceY;
    const target = (y * width + x) * 4;
    if (isGrayscale) {
      const value = bytes[source] ?? 0;
      imageData.data[target] = value;
      imageData.data[target + 1] = value;
      imageData.data[target + 2] = value;
      imageData.data[target + 3] = 255;
    } else {
      const r = bytes[source + 2] ?? 0;
      const g = bytes[source + 1] ?? 0;
      const b = bytes[source] ?? 0;
      let a = bitsPerPixel === 32 ? (bytes[source + 3] ?? 255) : 255;
      if (transparentColor && r === transparentColor.r && g === transparentColor.g && b === transparentColor.b) {
        a = 0;
      } else if (keyOutBlack && r === 0 && g === 0 && b === 0) {
        a = 0;
      }
      imageData.data[target] = r;
      imageData.data[target + 1] = g;
      imageData.data[target + 2] = b;
      imageData.data[target + 3] = a;
    }
    written += 1;
    return true;
  };

  if (isRle) {
    while (written < pixelCount && sourceOffset < bytes.length) {
      const packet = bytes[sourceOffset++] ?? 0;
      const count = (packet & 0x7f) + 1;
      if ((packet & 0x80) !== 0) {
        const pixelOffset = sourceOffset;
        sourceOffset += bytesPerPixel;
        for (let index = 0; index < count; index += 1) {
          if (!writePixel(pixelOffset)) {
            return undefined;
          }
        }
      } else {
        for (let index = 0; index < count; index += 1) {
          if (!writePixel(sourceOffset)) {
            return undefined;
          }
          sourceOffset += bytesPerPixel;
        }
      }
    }
  } else {
    while (written < pixelCount) {
      if (!writePixel(sourceOffset)) {
        return undefined;
      }
      sourceOffset += bytesPerPixel;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }
  context.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    return undefined;
  }
  return loadTextureFromBlob(blob, label);
}
