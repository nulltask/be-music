import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const SUPPORTED_VIDEO_CODECS = new Set(['mpeg1video', 'h264']);
// Keep chunks small so ff_decode_multi never allocates too many full-size frames at once.
const PACKET_READ_CHUNK_BYTES = 65_536;
const MAX_PACKET_READ_ITERATIONS = 16_384;
const FALLBACK_FPS = 30;

interface LibAvPlaneLayout {
  offset: number;
  stride: number;
}

interface LibAvVideoFrame {
  data: unknown;
  format?: number;
  layout?: LibAvPlaneLayout[];
  pts?: number;
  width?: number;
  height?: number;
}

interface LibAvStream {
  index: number;
  codecpar: number;
  codec_type: number;
  codec_id: number;
  time_base_num: number;
  time_base_den: number;
  duration: number;
}

type LibAvPacket = unknown;

interface LibAvInstance {
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
  ff_init_demuxer_file(path: string): Promise<[number, LibAvStream[]]>;
  avcodec_get_name(codecId: number): Promise<string>;
  ff_init_decoder(name: string | number, codecpar?: number): Promise<[number, number, number, number]>;
  ff_read_frame_multi(
    fmtCtx: number,
    pkt: number,
    config?: { limit?: number },
  ): Promise<[number, Record<number, LibAvPacket[]>]>;
  ff_decode_multi(
    ctx: number,
    pkt: number,
    frame: number,
    packets: LibAvPacket[],
    config?: boolean | { fin?: boolean; ignoreErrors?: boolean; copyoutFrame?: 'video' | 'video_packed' },
  ): Promise<LibAvVideoFrame[]>;
  ff_free_decoder(ctx: number, pkt: number, frame: number): Promise<void>;
  terminate(): void;
}

interface LibAvFactory {
  LibAV(options?: { noworker?: boolean; variant?: string }): Promise<LibAvInstance>;
}

interface LibAvModule {
  default: LibAvFactory;
}

export interface DecodedVideoFrame {
  seconds: number;
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface DecodedVideoFrames {
  codecName: 'mpeg1video' | 'h264';
  frames: DecodedVideoFrame[];
}

export async function decodeVideoFrames(videoPath: string): Promise<DecodedVideoFrames | undefined> {
  const frames: DecodedVideoFrame[] = [];
  const decoded = await decodeVideoFramesStream(videoPath, (frame) => {
    frames.push(frame);
  });
  if (!decoded || frames.length === 0) {
    return undefined;
  }
  return {
    codecName: decoded.codecName,
    frames,
  };
}

export async function decodeVideoFramesStream(
  videoPath: string,
  onFrame: (frame: DecodedVideoFrame) => void,
): Promise<{ codecName: 'mpeg1video' | 'h264'; frameCount: number } | undefined> {
  let libav: LibAvInstance | undefined;
  try {
    const libavInstance = await createLibAvInstance();
    libav = libavInstance;
    const file = await readFile(videoPath);
    const fileName = basename(videoPath);
    await libavInstance.writeFile(fileName, new Uint8Array(file));

    const [formatContext, streams] = await libavInstance.ff_init_demuxer_file(fileName);
    const videoStream = streams.find((stream) => stream.codec_type === libavInstance.AVMEDIA_TYPE_VIDEO);
    if (!videoStream) {
      return undefined;
    }

    const codecName = await libavInstance.avcodec_get_name(videoStream.codec_id);
    if (!isSupportedVideoCodec(codecName)) {
      return undefined;
    }

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
      );
      if (frameCount === undefined || frameCount <= 0) {
        return undefined;
      }

      return {
        codecName,
        frameCount,
      };
    } finally {
      await libavInstance.ff_free_decoder(decoderContext, packetRef, frameRef);
    }
  } catch {
    return undefined;
  } finally {
    libav?.terminate();
  }
}

function isSupportedVideoCodec(codecName: string): codecName is 'mpeg1video' | 'h264' {
  return SUPPORTED_VIDEO_CODECS.has(codecName);
}

async function decodeVideoFramesWithCallback(
  libav: LibAvInstance,
  formatContext: number,
  stream: LibAvStream,
  decoderContext: number,
  packetRef: number,
  frameRef: number,
  onFrame: (frame: DecodedVideoFrame) => void,
): Promise<number | undefined> {
  const timeScale = resolveTimeScale(stream);
  const fallbackStep = resolveFallbackStep();
  let firstPts: number | undefined;
  let nextFallbackSeconds = 0;
  let lastSeconds = 0;
  let frameCount = 0;

  const consume = (decodedFrames: LibAvVideoFrame[]): void => {
    for (const frame of decodedFrames) {
      const converted = convertFrameToRgba(frame, libav);
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
    }
  };

  for (let iteration = 0; iteration < MAX_PACKET_READ_ITERATIONS; iteration += 1) {
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

function resolveTimeScale(stream: LibAvStream): number {
  const numerator = Number.isFinite(stream.time_base_num) ? stream.time_base_num : 1;
  const denominator = Number.isFinite(stream.time_base_den) && stream.time_base_den > 0 ? stream.time_base_den : 1;
  return numerator / denominator;
}

function resolveFallbackStep(): number {
  return 1 / FALLBACK_FPS;
}

function resolveFramePts(frame: LibAvVideoFrame | undefined): number | undefined {
  if (!frame || typeof frame.pts !== 'number' || !Number.isFinite(frame.pts)) {
    return undefined;
  }
  return frame.pts;
}

function convertFrameToRgba(
  frame: LibAvVideoFrame,
  libav: LibAvInstance,
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
    copyPackedRgba(frame.data, frame.layout, width, height, rgba, 'rgba');
    return { width, height, rgba };
  }
  if (format === libav.AV_PIX_FMT_BGRA) {
    copyPackedRgba(frame.data, frame.layout, width, height, rgba, 'bgra');
    return { width, height, rgba };
  }
  if (format === libav.AV_PIX_FMT_RGB24) {
    copyPackedRgb24(frame.data, frame.layout, width, height, rgba, 'rgb24');
    return { width, height, rgba };
  }
  if (format === libav.AV_PIX_FMT_BGR24) {
    copyPackedRgb24(frame.data, frame.layout, width, height, rgba, 'bgr24');
    return { width, height, rgba };
  }

  if (format === libav.AV_PIX_FMT_YUV420P || format === libav.AV_PIX_FMT_YUVJ420P) {
    convertPlanarYuvToRgba(frame.data, frame.layout, width, height, rgba, 2, 2, format === libav.AV_PIX_FMT_YUVJ420P);
    return { width, height, rgba };
  }

  if (format === libav.AV_PIX_FMT_YUV422P || format === libav.AV_PIX_FMT_YUVJ422P) {
    convertPlanarYuvToRgba(frame.data, frame.layout, width, height, rgba, 2, 1, format === libav.AV_PIX_FMT_YUVJ422P);
    return { width, height, rgba };
  }

  if (format === libav.AV_PIX_FMT_YUV444P || format === libav.AV_PIX_FMT_YUVJ444P) {
    convertPlanarYuvToRgba(frame.data, frame.layout, width, height, rgba, 1, 1, format === libav.AV_PIX_FMT_YUVJ444P);
    return { width, height, rgba };
  }

  return undefined;
}

function copyPackedRgba(
  data: Uint8Array,
  layout: LibAvPlaneLayout[] | undefined,
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

function copyPackedRgb24(
  data: Uint8Array,
  layout: LibAvPlaneLayout[] | undefined,
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

function convertPlanarYuvToRgba(
  data: Uint8Array,
  layout: LibAvPlaneLayout[] | undefined,
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
  layout: LibAvPlaneLayout[] | undefined,
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

async function createLibAvInstance(): Promise<LibAvInstance> {
  if (typeof globalThis.self === 'undefined') {
    (globalThis as { self?: unknown }).self = globalThis;
  }

  const libAvModule = (await import('@uwx/libav.js-fat')) as unknown as LibAvModule;
  return libAvModule.default.LibAV({
    noworker: true,
    variant: 'fat',
  });
}
