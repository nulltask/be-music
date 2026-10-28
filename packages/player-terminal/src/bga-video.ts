import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createAbortError, isAbortError, throwIfAborted } from '@be-music/shared-utils/core';
import { loadOptionalNodeModule } from '@be-music/shared-utils/optional-node-module';
import { createSEAWorker, isSEARuntime } from './node/sea-worker.ts';

// Keep chunks small so ff_decode_multi never allocates too many full-size frames at once.
const PACKET_READ_CHUNK_BYTES = 65_536;
const MAX_PACKET_READ_ITERATIONS = 16_384;
const FALLBACK_FPS = 30;
// Mirror the `FrameMode` shape declared in `./bga.ts` — kept in sync so a bmson-source layer can be threaded through
// the video decode worker without losing the spec-aware `'bmson-layer'` distinction (which suppresses the BMS-style
// black chroma-key per the bmson 1.0.0 spec).
type FrameMode = 'base' | 'layer' | 'bmson-layer';

interface LibAVPlaneLayout {
  offset: number;
  stride: number;
}

interface LibAVVideoFrame {
  data: unknown;
  format?: number;
  layout?: LibAVPlaneLayout[];
  pts?: number;
  width?: number;
  height?: number;
}

interface LibAVStream {
  index: number;
  codecpar: number;
  codec_type: number;
  codec_id: number;
  time_base_num: number;
  time_base_den: number;
  duration: number;
}

type LibAVPacket = unknown;

interface LibAVInstance {
  AVMEDIA_TYPE_VIDEO: number;
  EAGAIN: number;
  AVERROR_EOF: number;
  AV_PIX_FMT_YUV420P?: number;
  AV_PIX_FMT_YUVJ420P?: number;
  AV_PIX_FMT_YUV422P?: number;
  AV_PIX_FMT_YUVJ422P?: number;
  AV_PIX_FMT_YUV444P?: number;
  AV_PIX_FMT_YUVJ444P?: number;
  AV_PIX_FMT_RGBA?: number;
  AV_PIX_FMT_BGRA?: number;
  AV_PIX_FMT_RGB24?: number;
  AV_PIX_FMT_BGR24?: number;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  ff_init_demuxer_file(path: string): Promise<[number, LibAVStream[]]>;
  avcodec_get_name(codecId: number): Promise<string>;
  ff_init_decoder(name: string | number, codecpar?: number): Promise<[number, number, number, number]>;
  ff_read_frame_multi(
    fmtCtx: number,
    pkt: number,
    config?: { limit?: number },
  ): Promise<[number, Record<number, LibAVPacket[]>]>;
  ff_decode_multi(
    ctx: number,
    pkt: number,
    frame: number,
    packets: LibAVPacket[],
    config?: boolean | { fin?: boolean; ignoreErrors?: boolean; copyoutFrame?: 'video' | 'video_packed' },
  ): Promise<LibAVVideoFrame[]>;
  ff_free_decoder(ctx: number, pkt: number, frame: number): Promise<void>;
  terminate(): void;
}

interface LibAVFactory {
  LibAV(options?: { noworker?: boolean; variant?: string }): Promise<LibAVInstance>;
}

interface LibAVModule {
  default: LibAVFactory;
}

export interface DecodedVideoFrame {
  seconds: number;
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface DecodedVideoStreamInfo {
  codecName: string;
  durationSeconds?: number;
}

export interface DecodedSourceVideoFrame {
  seconds: number;
  width: number;
  height: number;
  rgb: Uint8Array;
  opaqueMask: Uint8Array;
}

interface VideoDecodeWorkerInitData {
  videoPath: string;
  mode: FrameMode;
  stopAfterFirstFrame: boolean;
  preserveVideoBorders: boolean;
}

interface VideoDecodeWorkerReadyMessage {
  kind: 'ready';
  info: DecodedVideoStreamInfo;
}

interface VideoDecodeWorkerFrameMessage {
  kind: 'frame';
  frame: DecodedSourceVideoFrame;
}

interface VideoDecodeWorkerDoneMessage {
  kind: 'done';
  result?: { codecName: string; frameCount: number; durationSeconds?: number };
}

interface VideoDecodeWorkerErrorMessage {
  kind: 'error';
  name?: string;
  message: string;
}

type VideoDecodeWorkerOutboundMessage =
  | VideoDecodeWorkerReadyMessage
  | VideoDecodeWorkerFrameMessage
  | VideoDecodeWorkerDoneMessage
  | VideoDecodeWorkerErrorMessage;

export async function decodeVideoFramesStream(
  videoPath: string,
  onFrame: (frame: DecodedVideoFrame) => void,
  signal?: AbortSignal,
  options: {
    onReady?: (info: DecodedVideoStreamInfo) => void;
    stopAfterFirstFrame?: boolean;
  } = {},
): Promise<{ codecName: string; frameCount: number; durationSeconds?: number } | undefined> {
  return await decodeVideoFramesStreamDirect(videoPath, onFrame, signal, options);
}

export async function decodeVideoFramesStreamDirect(
  videoPath: string,
  onFrame: (frame: DecodedVideoFrame) => void,
  signal?: AbortSignal,
  options: {
    onReady?: (info: DecodedVideoStreamInfo) => void;
    stopAfterFirstFrame?: boolean;
  } = {},
): Promise<{ codecName: string; frameCount: number; durationSeconds?: number } | undefined> {
  let libav: LibAVInstance | undefined;
  try {
    throwIfAborted(signal);
    const libavInstance = await createLibAVInstance();
    libav = libavInstance;
    throwIfAborted(signal);
    const file = await readFile(videoPath, { signal });
    const fileName = basename(videoPath);
    await libavInstance.writeFile(fileName, new Uint8Array(file));

    throwIfAborted(signal);
    const [formatContext, streams] = await libavInstance.ff_init_demuxer_file(fileName);
    const videoStream = streams.find((stream) => stream.codec_type === libavInstance.AVMEDIA_TYPE_VIDEO);
    if (!videoStream) {
      return undefined;
    }

    const codecName = await libavInstance.avcodec_get_name(videoStream.codec_id);
    const durationSeconds = resolveStreamDurationSeconds(videoStream);
    options.onReady?.({
      codecName,
      durationSeconds,
    });

    const [, decoderContext, packetRef, frameRef] = await libavInstance.ff_init_decoder(
      videoStream.codec_id,
      videoStream.codecpar,
    );
    try {
      const frameCount = await decodeVideoFramesWithCallback(
        libavInstance,
        formatContext,
        videoStream,
        decoderContext,
        packetRef,
        frameRef,
        onFrame,
        signal,
        Boolean(options.stopAfterFirstFrame),
      );
      if (frameCount === undefined || frameCount <= 0) {
        return undefined;
      }

      return {
        codecName,
        frameCount,
        durationSeconds,
      };
    } finally {
      await libavInstance.ff_free_decoder(decoderContext, packetRef, frameRef);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return undefined;
  } finally {
    libav?.terminate();
  }
}

export async function decodeVideoFramesToSourceFramesInWorker(
  videoPath: string,
  mode: FrameMode,
  onFrame: (frame: DecodedSourceVideoFrame) => void,
  signal?: AbortSignal,
  options: {
    onReady?: (info: DecodedVideoStreamInfo) => void;
    stopAfterFirstFrame?: boolean;
    preserveVideoBorders?: boolean;
  } = {},
): Promise<{ codecName: string; frameCount: number; durationSeconds?: number } | undefined> {
  throwIfAborted(signal);
  const workerInitData = {
    videoPath,
    mode,
    stopAfterFirstFrame: Boolean(options.stopAfterFirstFrame),
    preserveVideoBorders: Boolean(options.preserveVideoBorders),
  } satisfies VideoDecodeWorkerInitData;
  const worker = isSEARuntime()
    ? createSEAWorker('bga-video-worker', workerInitData)
    : new Worker(resolveBGAVideoWorkerURL(), {
        workerData: workerInitData,
        execArgv: resolveBGAVideoWorkerExecArgv(),
      });

  return await new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      signal?.removeEventListener('abort', onAbort);
    };

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const onMessage = (message: VideoDecodeWorkerOutboundMessage): void => {
      if (message.kind === 'ready') {
        options.onReady?.(message.info);
        return;
      }
      if (message.kind === 'frame') {
        onFrame(message.frame);
        return;
      }
      if (message.kind === 'done') {
        settle(() => resolve(message.result));
        return;
      }
      settle(() => reject(message.name === 'AbortError' ? createAbortError() : new Error(message.message)));
    };

    const onError = (error: Error): void => {
      settle(() => reject(error));
    };

    const onExit = (code: number): void => {
      if (settled) {
        return;
      }
      settle(() => reject(new Error(`Video decode worker exited unexpectedly (code ${code})`)));
    };

    const onAbort = (): void => {
      void worker.terminate();
      settle(() => reject(createAbortError()));
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function decodeVideoFramesWithCallback(
  libav: LibAVInstance,
  formatContext: number,
  stream: LibAVStream,
  decoderContext: number,
  packetRef: number,
  frameRef: number,
  onFrame: (frame: DecodedVideoFrame) => void,
  signal?: AbortSignal,
  stopAfterFirstFrame = false,
): Promise<number | undefined> {
  const timeScale = resolveTimeScale(stream);
  const fallbackStep = resolveFallbackStep();
  let firstPts: number | undefined;
  let nextFallbackSeconds = 0;
  let lastSeconds = 0;
  let frameCount = 0;

  const consume = (decodedFrames: LibAVVideoFrame[]): void => {
    for (const frame of decodedFrames) {
      throwIfAborted(signal);
      const converted = convertFrameToRGBA(frame, libav);
      if (!converted) {
        continue;
      }

      const pts = resolveFramePts(frame);
      if (typeof pts === 'number' && typeof firstPts !== 'number') {
        firstPts = pts;
      }

      let seconds = nextFallbackSeconds;
      if (typeof pts === 'number' && typeof firstPts === 'number') {
        seconds = (pts - firstPts) * timeScale;
      }
      if (!Number.isFinite(seconds)) {
        seconds = nextFallbackSeconds;
      }
      seconds = Math.max(0, seconds);
      if (seconds + 1e-6 < lastSeconds) {
        seconds = lastSeconds;
      }
      lastSeconds = seconds;
      nextFallbackSeconds = seconds + fallbackStep;

      onFrame({
        seconds,
        width: converted.width,
        height: converted.height,
        rgba: converted.rgba,
      });
      frameCount += 1;
      if (stopAfterFirstFrame) return;
    }
  };

  for (let iteration = 0; iteration < MAX_PACKET_READ_ITERATIONS; iteration += 1) {
    throwIfAborted(signal);
    const [readResult, packetsByStream] = await libav.ff_read_frame_multi(formatContext, packetRef, {
      limit: PACKET_READ_CHUNK_BYTES,
    });
    const packets = packetsByStream[stream.index] ?? [];
    if (packets.length > 0) {
      const decoded = await libav.ff_decode_multi(decoderContext, packetRef, frameRef, packets, {
        copyoutFrame: 'video',
        ignoreErrors: true,
      });
      consume(decoded);
      if (stopAfterFirstFrame && frameCount > 0) {
        return frameCount;
      }
    }

    if (readResult === libav.AVERROR_EOF) {
      const flushed = await libav.ff_decode_multi(decoderContext, packetRef, frameRef, [], {
        fin: true,
        copyoutFrame: 'video',
        ignoreErrors: true,
      });
      consume(flushed);
      return frameCount;
    }

    if (readResult === 0 || readResult === -libav.EAGAIN) {
      continue;
    }

    return undefined;
  }

  return undefined;
}

function resolveTimeScale(stream: LibAVStream): number {
  const numerator = Number.isFinite(stream.time_base_num) ? stream.time_base_num : 1;
  const denominator = Number.isFinite(stream.time_base_den) && stream.time_base_den > 0 ? stream.time_base_den : 1;
  return numerator / denominator;
}

function resolveStreamDurationSeconds(stream: LibAVStream): number | undefined {
  if (typeof stream.duration !== 'number' || !Number.isFinite(stream.duration) || stream.duration <= 0) {
    return undefined;
  }
  const seconds = stream.duration * resolveTimeScale(stream);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return seconds;
}

function resolveFallbackStep(): number {
  return 1 / FALLBACK_FPS;
}

function resolveFramePts(frame: LibAVVideoFrame | undefined): number | undefined {
  if (!frame || typeof frame.pts !== 'number' || !Number.isFinite(frame.pts)) {
    return undefined;
  }
  return frame.pts;
}

function convertFrameToRGBA(
  frame: LibAVVideoFrame,
  libav: LibAVInstance,
): { width: number; height: number; rgba: Uint8Array } | undefined {
  if (!(frame.data instanceof Uint8Array)) {
    return undefined;
  }

  const width = Math.floor(frame.width ?? 0);
  const height = Math.floor(frame.height ?? 0);
  if (width <= 0 || height <= 0) {
    return undefined;
  }

  const format = frame.format;
  if (typeof format !== 'number') {
    return undefined;
  }

  const rgba = new Uint8Array(width * height * 4);

  if (format === libav.AV_PIX_FMT_RGBA) {
    copyPackedRGBA(frame.data, frame.layout, width, height, rgba, 'rgba');
    return { width, height, rgba };
  }
  if (format === libav.AV_PIX_FMT_BGRA) {
    copyPackedRGBA(frame.data, frame.layout, width, height, rgba, 'bgra');
    return { width, height, rgba };
  }
  if (format === libav.AV_PIX_FMT_RGB24) {
    copyPackedRGB24(frame.data, frame.layout, width, height, rgba, 'rgb24');
    return { width, height, rgba };
  }
  if (format === libav.AV_PIX_FMT_BGR24) {
    copyPackedRGB24(frame.data, frame.layout, width, height, rgba, 'bgr24');
    return { width, height, rgba };
  }

  if (format === libav.AV_PIX_FMT_YUV420P || format === libav.AV_PIX_FMT_YUVJ420P) {
    convertPlanarYuvToRGBA(frame.data, frame.layout, width, height, rgba, 2, 2, format === libav.AV_PIX_FMT_YUVJ420P);
    return { width, height, rgba };
  }

  if (format === libav.AV_PIX_FMT_YUV422P || format === libav.AV_PIX_FMT_YUVJ422P) {
    convertPlanarYuvToRGBA(frame.data, frame.layout, width, height, rgba, 2, 1, format === libav.AV_PIX_FMT_YUVJ422P);
    return { width, height, rgba };
  }

  if (format === libav.AV_PIX_FMT_YUV444P || format === libav.AV_PIX_FMT_YUVJ444P) {
    convertPlanarYuvToRGBA(frame.data, frame.layout, width, height, rgba, 1, 1, format === libav.AV_PIX_FMT_YUVJ444P);
    return { width, height, rgba };
  }

  return undefined;
}

function copyPackedRGBA(
  data: Uint8Array,
  layout: LibAVPlaneLayout[] | undefined,
  width: number,
  height: number,
  out: Uint8Array,
  order: 'rgba' | 'bgra',
): void {
  const source = resolvePlane(layout, 0, width, height, 0, width * 4);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = source.offset + y * source.stride;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = rowOffset + x * 4;
      const outOffset = (y * width + x) * 4;
      const c0 = data[sourceOffset] ?? 0;
      const c1 = data[sourceOffset + 1] ?? 0;
      const c2 = data[sourceOffset + 2] ?? 0;
      const c3 = data[sourceOffset + 3] ?? 255;
      if (order === 'rgba') {
        out[outOffset] = c0;
        out[outOffset + 1] = c1;
        out[outOffset + 2] = c2;
        out[outOffset + 3] = c3;
      } else {
        out[outOffset] = c2;
        out[outOffset + 1] = c1;
        out[outOffset + 2] = c0;
        out[outOffset + 3] = c3;
      }
    }
  }
}

function copyPackedRGB24(
  data: Uint8Array,
  layout: LibAVPlaneLayout[] | undefined,
  width: number,
  height: number,
  out: Uint8Array,
  order: 'rgb24' | 'bgr24',
): void {
  const source = resolvePlane(layout, 0, width, height, 0, width * 3);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = source.offset + y * source.stride;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = rowOffset + x * 3;
      const outOffset = (y * width + x) * 4;
      const c0 = data[sourceOffset] ?? 0;
      const c1 = data[sourceOffset + 1] ?? 0;
      const c2 = data[sourceOffset + 2] ?? 0;
      if (order === 'rgb24') {
        out[outOffset] = c0;
        out[outOffset + 1] = c1;
        out[outOffset + 2] = c2;
      } else {
        out[outOffset] = c2;
        out[outOffset + 1] = c1;
        out[outOffset + 2] = c0;
      }
      out[outOffset + 3] = 255;
    }
  }
}

function convertPlanarYuvToRGBA(
  data: Uint8Array,
  layout: LibAVPlaneLayout[] | undefined,
  width: number,
  height: number,
  out: Uint8Array,
  chromaDivX: number,
  chromaDivY: number,
  fullRange: boolean,
): void {
  const chromaWidth = Math.ceil(width / chromaDivX);
  const chromaHeight = Math.ceil(height / chromaDivY);

  const yPlane = resolvePlane(layout, 0, width, height, 0, width);
  const uDefaultOffset = yPlane.offset + yPlane.stride * yPlane.height;
  const uPlane = resolvePlane(layout, 1, chromaWidth, chromaHeight, uDefaultOffset, chromaWidth);
  const vDefaultOffset = uPlane.offset + uPlane.stride * uPlane.height;
  const vPlane = resolvePlane(layout, 2, chromaWidth, chromaHeight, vDefaultOffset, chromaWidth);

  for (let y = 0; y < height; y += 1) {
    const yRow = yPlane.offset + y * yPlane.stride;
    const cRow = Math.floor(y / chromaDivY);
    const uRow = uPlane.offset + cRow * uPlane.stride;
    const vRow = vPlane.offset + cRow * vPlane.stride;

    for (let x = 0; x < width; x += 1) {
      const yValue = data[yRow + x] ?? 0;
      const cX = Math.floor(x / chromaDivX);
      const uValue = data[uRow + cX] ?? 128;
      const vValue = data[vRow + cX] ?? 128;

      const outOffset = (y * width + x) * 4;
      if (fullRange) {
        const yy = yValue;
        const u = uValue - 128;
        const v = vValue - 128;
        out[outOffset] = clampToByte(Math.round(yy + 1.402 * v));
        out[outOffset + 1] = clampToByte(Math.round(yy - 0.344_136 * u - 0.714_136 * v));
        out[outOffset + 2] = clampToByte(Math.round(yy + 1.772 * u));
      } else {
        const c = yValue - 16;
        const d = uValue - 128;
        const e = vValue - 128;
        out[outOffset] = clampToByte((298 * c + 409 * e + 128) >> 8);
        out[outOffset + 1] = clampToByte((298 * c - 100 * d - 208 * e + 128) >> 8);
        out[outOffset + 2] = clampToByte((298 * c + 516 * d + 128) >> 8);
      }
      out[outOffset + 3] = 255;
    }
  }
}

function resolvePlane(
  layout: LibAVPlaneLayout[] | undefined,
  index: number,
  width: number,
  height: number,
  fallbackOffset: number,
  fallbackStride: number,
): { offset: number; stride: number; width: number; height: number } {
  const entry = layout?.[index];
  return {
    offset: entry?.offset ?? fallbackOffset,
    stride: entry?.stride ?? fallbackStride,
    width,
    height,
  };
}

function clampToByte(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return value;
}

async function createLibAVInstance(): Promise<LibAVInstance> {
  if (typeof globalThis.self === 'undefined') {
    (globalThis as { self?: unknown }).self = globalThis;
  }

  // In a SEA binary the bare-specifier import always fails; the helper retries from a `node_modules`
  // directory next to the executable (or the working directory) before giving up.
  const loadedModule = (await loadOptionalNodeModule('@uwx/libav.js-fat', () => import('@uwx/libav.js-fat'))) as
    | LibAVModule
    | LibAVFactory
    | undefined;
  if (!loadedModule) {
    throw new Error('@uwx/libav.js-fat is unavailable; cannot decode video BGA.');
  }
  // `import()` wraps the CJS exports in a namespace whose `default` holds them; the createRequire fallback
  // used inside a SEA returns the exports object directly. Accept both shapes.
  const libavFactory = 'default' in loadedModule ? loadedModule.default : loadedModule;
  if (typeof libavFactory.LibAV !== 'function') {
    throw new Error('@uwx/libav.js-fat does not expose a LibAV factory; cannot decode video BGA.');
  }
  return libavFactory.LibAV({
    noworker: true,
    variant: 'fat',
  });
}

function resolveBGAVideoWorkerURL(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './bga-video-worker.ts' : './bga-video-worker.js', import.meta.url);
}

function resolveBGAVideoWorkerExecArgv(): string[] {
  if (!import.meta.url.endsWith('.ts')) {
    return process.execArgv;
  }
  if (process.execArgv.includes('--conditions=source')) {
    return process.execArgv;
  }
  return [...process.execArgv, '--conditions=source'];
}
