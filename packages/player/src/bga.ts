import { access, readFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import { normalizeChannel, normalizeObjectKey, sortEvents, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { createTimingResolver } from '@be-music/audio-renderer';
import { decode as decodeBmpFast } from 'fast-bmp';
import { decode as decodePngFast } from 'fast-png';
import jpeg from 'jpeg-js';
import { decodeVideoFramesStream } from './bga-video.ts';

const BASE_BGA_CHANNEL = '04';
const LAYER_BGA_CHANNEL = '07';
const DEFAULT_BGA_ASCII_WIDTH = 34;
const DEFAULT_BGA_ASCII_HEIGHT = 20;
const TRANSPARENT_ALPHA_THRESHOLD = 16;
const ANSI_RESET = '\u001b[0m';
const SPEC_BGA_CANVAS_SIZE = 256;
const TERMINAL_PIXEL_ASPECT_X = 2;
const TERMINAL_PIXEL_ASPECT_Y = 1;

type ImageFormat = 'bmp' | 'png' | 'jpeg' | 'video';
type FrameMode = 'base' | 'layer';

interface BgaCue {
  seconds: number;
  key?: string;
}

interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
  format: ImageFormat;
}

interface AnsiFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
  opaqueMask: Uint8Array;
}

interface TimedAnsiFrame {
  seconds: number;
  frame: AnsiFrame;
}

interface StaticFrameSource {
  kind: 'static';
  frame: AnsiFrame;
}

interface VideoFrameSource {
  kind: 'video';
  frames: TimedAnsiFrame[];
}

type FrameSource = StaticFrameSource | VideoFrameSource;

interface FrameSelection {
  frame?: AnsiFrame;
  index: number;
}

interface CompositeFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
  opaqueMask: Uint8Array;
}

export interface BgaAnsiOptions {
  baseDir: string;
  width?: number;
  height?: number;
}

export class BgaAnsiRenderer {
  private readonly baseTimeline: BgaCue[];

  private readonly layerTimeline: BgaCue[];

  private readonly baseSourceFramesByKey: Map<string, FrameSource>;

  private readonly layerSourceFramesByKey: Map<string, FrameSource>;

  private readonly stageFileSourceFrame?: FrameSource;

  private readonly missingBaseSourceFrame: AnsiFrame;

  private readonly missingLayerSourceFrame: AnsiFrame;

  private baseFramesByKey = new Map<string, FrameSource>();

  private layerFramesByKey = new Map<string, FrameSource>();

  private stageFileFrame?: FrameSource;

  private missingBaseFrame: AnsiFrame;

  private missingLayerFrame: AnsiFrame;

  private displayWidth: number;

  private displayHeight: number;

  private cachedBaseKey = '__INIT__';

  private cachedLayerKey = '__INIT__';

  private cachedBaseFrameIndex = -1;

  private cachedLayerFrameIndex = -1;

  private cachedComposite?: CompositeFrame;

  private cachedLines?: string[];

  constructor(params: {
    baseTimeline: BgaCue[];
    layerTimeline: BgaCue[];
    baseSourceFramesByKey: Map<string, FrameSource>;
    layerSourceFramesByKey: Map<string, FrameSource>;
    stageFileSourceFrame?: FrameSource;
    missingBaseSourceFrame: AnsiFrame;
    missingLayerSourceFrame: AnsiFrame;
    width: number;
    height: number;
  }) {
    this.baseTimeline = params.baseTimeline;
    this.layerTimeline = params.layerTimeline;
    this.baseSourceFramesByKey = params.baseSourceFramesByKey;
    this.layerSourceFramesByKey = params.layerSourceFramesByKey;
    this.stageFileSourceFrame = params.stageFileSourceFrame;
    this.missingBaseSourceFrame = params.missingBaseSourceFrame;
    this.missingLayerSourceFrame = params.missingLayerSourceFrame;
    this.displayWidth = params.width;
    this.displayHeight = params.height;
    this.missingBaseFrame = resizeAnsiFrame(this.missingBaseSourceFrame, this.displayWidth, this.displayHeight);
    this.missingLayerFrame = resizeAnsiFrame(this.missingLayerSourceFrame, this.displayWidth, this.displayHeight);
    this.rebuildFrames();
  }

  setDisplaySize(width: number, height: number): void {
    const next = normalizeDisplaySize(width, height);
    if (next.width === this.displayWidth && next.height === this.displayHeight) {
      return;
    }
    this.displayWidth = next.width;
    this.displayHeight = next.height;
    this.rebuildFrames();
  }

  getAnsiLines(currentSeconds: number): string[] | undefined {
    this.refreshComposite(currentSeconds);
    if (!this.cachedComposite) {
      return undefined;
    }
    if (!this.cachedLines) {
      this.cachedLines = composeAnsiLines(
        this.cachedComposite.rgb,
        this.cachedComposite.opaqueMask,
        this.cachedComposite.width,
        this.cachedComposite.height,
      );
    }
    return this.cachedLines;
  }

  private rebuildFrames(): void {
    this.baseFramesByKey = resizeFrameSourceMap(this.baseSourceFramesByKey, this.displayWidth, this.displayHeight);
    this.layerFramesByKey = resizeFrameSourceMap(this.layerSourceFramesByKey, this.displayWidth, this.displayHeight);
    this.stageFileFrame = this.stageFileSourceFrame
      ? resizeFrameSource(this.stageFileSourceFrame, this.displayWidth, this.displayHeight)
      : undefined;
    this.missingBaseFrame = resizeAnsiFrame(this.missingBaseSourceFrame, this.displayWidth, this.displayHeight);
    this.missingLayerFrame = resizeAnsiFrame(this.missingLayerSourceFrame, this.displayWidth, this.displayHeight);
    this.resetCache();
  }

  private resetCache(): void {
    this.cachedBaseKey = '__INIT__';
    this.cachedLayerKey = '__INIT__';
    this.cachedBaseFrameIndex = -1;
    this.cachedLayerFrameIndex = -1;
    this.cachedComposite = undefined;
    this.cachedLines = undefined;
  }

  private refreshComposite(currentSeconds: number): void {
    const baseCue = findActiveCue(this.baseTimeline, currentSeconds);
    const layerCue = findActiveCue(this.layerTimeline, currentSeconds);

    const baseKey = baseCue?.key ?? '';
    const layerKey = layerCue?.key ?? '';
    const baseSeconds = baseCue ? Math.max(0, currentSeconds - baseCue.seconds) : Math.max(0, currentSeconds);
    const layerSeconds = layerCue ? Math.max(0, currentSeconds - layerCue.seconds) : 0;

    const baseSelection = this.resolveBaseFrame(baseKey, baseSeconds);
    const layerSelection = this.resolveLayerFrame(layerKey, layerSeconds);

    if (
      this.cachedBaseKey === baseKey &&
      this.cachedLayerKey === layerKey &&
      this.cachedBaseFrameIndex === baseSelection.index &&
      this.cachedLayerFrameIndex === layerSelection.index
    ) {
      return;
    }

    this.cachedBaseKey = baseKey;
    this.cachedLayerKey = layerKey;
    this.cachedBaseFrameIndex = baseSelection.index;
    this.cachedLayerFrameIndex = layerSelection.index;
    this.cachedComposite = mergeCompositeFrames(baseSelection.frame, layerSelection.frame);
    this.cachedLines = undefined;
  }

  private resolveBaseFrame(baseKey: string, seconds: number): FrameSelection {
    if (!baseKey) {
      return selectFrameFromSource(this.stageFileFrame, seconds);
    }
    const source = this.baseFramesByKey.get(baseKey) ?? createStaticFrameSource(this.missingBaseFrame);
    return selectFrameFromSource(source, seconds);
  }

  private resolveLayerFrame(layerKey: string, seconds: number): FrameSelection {
    if (!layerKey) {
      return {
        frame: undefined,
        index: -1,
      };
    }
    const source = this.layerFramesByKey.get(layerKey) ?? createStaticFrameSource(this.missingLayerFrame);
    return selectFrameFromSource(source, seconds);
  }
}

export async function createBgaAnsiRenderer(
  json: BeMusicJson,
  options: BgaAnsiOptions,
): Promise<BgaAnsiRenderer | undefined> {
  const displaySize = normalizeDisplaySize(options.width, options.height);
  const resolver = createTimingResolver(json);
  const sortedEvents = sortEvents(json.events);

  const baseTimeline = buildBgaTimeline(sortedEvents, resolver, BASE_BGA_CHANNEL);
  const layerTimeline = buildBgaTimeline(sortedEvents, resolver, LAYER_BGA_CHANNEL);

  const baseKeys = new Set(baseTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const layerKeys = new Set(layerTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));

  const baseSourceFramesByKey = await loadFramesByKeys({
    keys: baseKeys,
    resources: json.resources.bmp,
    baseDir: options.baseDir,
    mode: 'base',
    width: displaySize.width,
    height: displaySize.height,
  });
  const layerSourceFramesByKey = await loadFramesByKeys({
    keys: layerKeys,
    resources: json.resources.bmp,
    baseDir: options.baseDir,
    mode: 'layer',
    width: displaySize.width,
    height: displaySize.height,
  });

  let stageFileSourceFrame: FrameSource | undefined;
  if (json.metadata.stageFile) {
    const resolved = await resolveMediaPath(options.baseDir, json.metadata.stageFile);
    if (resolved) {
      stageFileSourceFrame = await loadFrameSource(resolved, 'base', displaySize.width, displaySize.height);
    }
  }

  if (baseSourceFramesByKey.size === 0 && layerSourceFramesByKey.size === 0 && !stageFileSourceFrame) {
    return undefined;
  }

  const missingBaseSourceFrame = createMissingSourceFrame('base');
  const missingLayerSourceFrame = createMissingSourceFrame('layer');

  return new BgaAnsiRenderer({
    baseTimeline,
    layerTimeline,
    baseSourceFramesByKey,
    layerSourceFramesByKey,
    stageFileSourceFrame,
    missingBaseSourceFrame,
    missingLayerSourceFrame,
    width: displaySize.width,
    height: displaySize.height,
  });
}

async function loadFramesByKeys(params: {
  keys: ReadonlySet<string>;
  resources: Record<string, string>;
  baseDir: string;
  mode: FrameMode;
  width: number;
  height: number;
}): Promise<Map<string, FrameSource>> {
  const { keys, resources, baseDir, mode, width, height } = params;
  const map = new Map<string, FrameSource>();
  const cache = new Map<string, FrameSource | null>();

  for (const key of keys) {
    const resourcePath = resources[key];
    if (!resourcePath) {
      continue;
    }
    const resolved = await resolveMediaPath(baseDir, resourcePath);
    if (!resolved) {
      continue;
    }

    const cacheKey = `${mode}:${width}x${height}:${resolved}`;
    if (!cache.has(cacheKey)) {
      const source = await loadFrameSource(resolved, mode, width, height);
      cache.set(cacheKey, source ?? null);
    }

    const source = cache.get(cacheKey);
    if (source) {
      map.set(key, source);
    }
  }

  return map;
}

function normalizeDisplaySize(width?: number, height?: number): { width: number; height: number } {
  return {
    width: Math.max(8, Math.floor(width ?? DEFAULT_BGA_ASCII_WIDTH)),
    height: Math.max(6, Math.floor(height ?? DEFAULT_BGA_ASCII_HEIGHT)),
  };
}

function resizeFrameSourceMap(sourceMap: Map<string, FrameSource>, width: number, height: number): Map<string, FrameSource> {
  const map = new Map<string, FrameSource>();
  const cache = new WeakMap<FrameSource, FrameSource>();
  for (const [key, source] of sourceMap) {
    let resized = cache.get(source);
    if (!resized) {
      resized = resizeFrameSource(source, width, height);
      cache.set(source, resized);
    }
    map.set(key, resized);
  }
  return map;
}

function createStaticFrameSource(frame: AnsiFrame): FrameSource {
  return {
    kind: 'static',
    frame,
  };
}

function resizeFrameSource(source: FrameSource, width: number, height: number): FrameSource {
  if (source.kind === 'static') {
    return {
      kind: 'static',
      frame: resizeAnsiFrame(source.frame, width, height),
    };
  }

  return {
    kind: 'video',
    frames: source.frames.map((entry) => ({
      seconds: entry.seconds,
      frame: resizeAnsiFrame(entry.frame, width, height),
    })),
  };
}

function selectFrameFromSource(source: FrameSource | undefined, seconds: number): FrameSelection {
  if (!source) {
    return {
      frame: undefined,
      index: -1,
    };
  }

  if (source.kind === 'static') {
    return {
      frame: source.frame,
      index: 0,
    };
  }

  if (source.frames.length === 0) {
    return {
      frame: undefined,
      index: -1,
    };
  }

  let low = 0;
  let high = source.frames.length - 1;
  let answer = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (source.frames[mid].seconds <= seconds) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const bounded = Math.max(0, Math.min(source.frames.length - 1, answer));
  return {
    frame: source.frames[bounded].frame,
    index: bounded,
  };
}

function buildBgaTimeline(
  sortedEvents: BeMusicEvent[],
  resolver: ReturnType<typeof createTimingResolver>,
  channel: string,
): BgaCue[] {
  const normalized = normalizeChannel(channel);
  const timeline: BgaCue[] = [];
  for (const event of sortedEvents) {
    if (normalizeChannel(event.channel) !== normalized) {
      continue;
    }
    const key = normalizeObjectKey(event.value);
    timeline.push({
      seconds: resolver.eventToSeconds(event),
      key: key === '00' ? undefined : key,
    });
  }
  return timeline;
}

function findActiveCue(timeline: BgaCue[], currentSeconds: number): BgaCue | undefined {
  let low = 0;
  let high = timeline.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (timeline[mid].seconds <= currentSeconds) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (answer < 0) {
    return undefined;
  }

  return timeline[answer];
}

function mergeCompositeFrames(baseFrame?: AnsiFrame, layerFrame?: AnsiFrame): CompositeFrame | undefined {
  if (!baseFrame && !layerFrame) {
    return undefined;
  }

  const canvasWidth = Math.max(baseFrame?.width ?? 0, layerFrame?.width ?? 0);
  const canvasHeight = Math.max(baseFrame?.height ?? 0, layerFrame?.height ?? 0);
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return undefined;
  }

  const rgb = new Uint8Array(canvasWidth * canvasHeight * 3);
  const opaqueMask = new Uint8Array(canvasWidth * canvasHeight);

  if (baseFrame) {
    paintFrame(rgb, opaqueMask, canvasWidth, canvasHeight, baseFrame);
  }
  if (layerFrame) {
    paintFrame(rgb, opaqueMask, canvasWidth, canvasHeight, layerFrame);
  }

  return {
    width: canvasWidth,
    height: canvasHeight,
    rgb,
    opaqueMask,
  };
}

function paintFrame(
  canvasRgb: Uint8Array,
  canvasMask: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  frame: AnsiFrame,
): void {
  const offsetX = Math.floor((canvasWidth - frame.width) / 2);
  const offsetY = Math.floor((canvasHeight - frame.height) / 2);

  for (let y = 0; y < frame.height; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= canvasHeight) {
      continue;
    }

    for (let x = 0; x < frame.width; x += 1) {
      const sourcePixelOffset = y * frame.width + x;
      if (frame.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= canvasWidth) {
        continue;
      }
      const sourceRgbOffset = sourcePixelOffset * 3;
      const targetPixelOffset = targetY * canvasWidth + targetX;
      const targetRgbOffset = targetPixelOffset * 3;
      canvasRgb[targetRgbOffset] = frame.rgb[sourceRgbOffset] ?? 0;
      canvasRgb[targetRgbOffset + 1] = frame.rgb[sourceRgbOffset + 1] ?? 0;
      canvasRgb[targetRgbOffset + 2] = frame.rgb[sourceRgbOffset + 2] ?? 0;
      canvasMask[targetPixelOffset] = 1;
    }
  }
}

function composeAnsiLines(rgb: Uint8Array, opaqueMask: Uint8Array, width: number, height: number): string[] {
  const lines: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let line = '';
    let active = false;
    let currentR = -1;
    let currentG = -1;
    let currentB = -1;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = y * width + x;
      if (opaqueMask[pixelOffset] === 0) {
        if (active) {
          line += ANSI_RESET;
          active = false;
        }
        line += ' ';
        continue;
      }

      const rgbOffset = pixelOffset * 3;
      const r = rgb[rgbOffset] ?? 0;
      const g = rgb[rgbOffset + 1] ?? 0;
      const b = rgb[rgbOffset + 2] ?? 0;
      if (!active || r !== currentR || g !== currentG || b !== currentB) {
        line += `\u001b[48;2;${r};${g};${b}m`;
        currentR = r;
        currentG = g;
        currentB = b;
        active = true;
      }
      line += ' ';
    }

    if (active) {
      line += ANSI_RESET;
    }
    lines.push(line);
  }

  return lines;
}

async function loadImageAsSpecFrame(imagePath: string, mode: FrameMode): Promise<AnsiFrame | undefined> {
  const extension = extname(imagePath).toLowerCase();
  if (extension !== '.bmp' && extension !== '.png' && extension !== '.jpg' && extension !== '.jpeg') {
    return undefined;
  }
  try {
    const buffer = await readFile(imagePath);
    const decoded = decodeImageBuffer(buffer, imagePath);
    return convertImageToSpecFrame(decoded, mode);
  } catch {
    return undefined;
  }
}

async function loadFrameSource(
  resourcePath: string,
  mode: FrameMode,
  width: number,
  height: number,
): Promise<FrameSource | undefined> {
  const imageFrame = await loadImageAsSpecFrame(resourcePath, mode);
  if (imageFrame) {
    return createStaticFrameSource(imageFrame);
  }

  return loadVideoAsFrameSource(resourcePath, mode, width, height);
}

async function loadVideoAsFrameSource(
  videoPath: string,
  mode: FrameMode,
  width: number,
  height: number,
): Promise<FrameSource | undefined> {
  const frames: TimedAnsiFrame[] = [];
  const decoded = await decodeVideoFramesStream(videoPath, (frame) => {
    const specFrame = convertImageToSpecFrame(
      {
        width: frame.width,
        height: frame.height,
        data: frame.rgba,
        format: 'video',
      },
      mode,
    );
    frames.push({
      seconds: frame.seconds,
      frame: resizeAnsiFrame(specFrame, width, height),
    });
  });

  if (!decoded || frames.length === 0) {
    return undefined;
  }

  return {
    kind: 'video',
    frames,
  };
}

async function resolveMediaPath(baseDir: string, mediaPath: string): Promise<string | undefined> {
  const candidates = createMediaPathCandidates(mediaPath);
  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate) ? candidate : resolve(baseDir, candidate);
    if (await exists(absolute)) {
      return absolute;
    }
  }
  return undefined;
}

function createMediaPathCandidates(mediaPath: string): string[] {
  const extCandidates = [
    '.bmp',
    '.BMP',
    '.png',
    '.PNG',
    '.jpg',
    '.JPG',
    '.jpeg',
    '.JPEG',
    '.mpg',
    '.MPG',
    '.mpeg',
    '.MPEG',
    '.mp4',
    '.MP4',
    '.m4v',
    '.M4V',
    '.avi',
    '.AVI',
    '.wmv',
    '.WMV',
    '.mov',
    '.MOV',
    '.webm',
    '.WEBM',
  ];
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const basePaths = [mediaPath];
  const slashNormalized = mediaPath.replaceAll('\\', '/');
  if (slashNormalized !== mediaPath) {
    basePaths.push(slashNormalized);
  }

  for (const basePath of basePaths) {
    push(basePath);
    const extension = extname(basePath);
    const withoutExtension = extension.length > 0 ? basePath.slice(0, -extension.length) : basePath;
    for (const candidateExtension of extCandidates) {
      push(`${withoutExtension}${candidateExtension}`);
    }
  }

  return candidates;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function decodeImageBuffer(buffer: Buffer, pathHint: string): DecodedImage {
  if (isPngBuffer(buffer)) {
    return decodePng(buffer);
  }
  if (isJpegBuffer(buffer)) {
    return decodeJpeg(buffer);
  }
  if (isBmpBuffer(buffer)) {
    return decodeBmp(buffer);
  }

  const extension = extname(pathHint).toLowerCase();
  if (extension === '.png') {
    return decodePng(buffer);
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return decodeJpeg(buffer);
  }
  if (extension === '.bmp') {
    return decodeBmp(buffer);
  }

  try {
    return decodePng(buffer);
  } catch {
    try {
      return decodeJpeg(buffer);
    } catch {
      return decodeBmp(buffer);
    }
  }
}

function decodePng(buffer: Buffer): DecodedImage {
  const decoded = decodePngFast(buffer);
  return {
    width: decoded.width,
    height: decoded.height,
    data: convertToRgba8(decoded.data, decoded.width, decoded.height, decoded.channels, decoded.depth),
    format: 'png',
  };
}

function decodeJpeg(buffer: Buffer): DecodedImage {
  const decoded = jpeg.decode(buffer, {
    useTArray: true,
    formatAsRGBA: true,
  });
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data,
    format: 'jpeg',
  };
}

function decodeBmp(buffer: Buffer): DecodedImage {
  const decoded = decodeBmpFast(buffer);
  const channels = decoded.channels > 0 ? decoded.channels : 4;
  const depth = Math.max(1, Math.floor(decoded.bitsPerPixel / channels));
  const rgba = convertToRgba8(toSampleArray(decoded.data), decoded.width, decoded.height, channels, depth);
  return {
    width: decoded.width,
    height: decoded.height,
    data: rgba,
    format: 'bmp',
  };
}

function toSampleArray(data: unknown): ArrayLike<number> {
  if (ArrayBuffer.isView(data)) {
    if ('length' in data) {
      return data as unknown as ArrayLike<number>;
    }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'object' && data && 'byteLength' in data) {
    return new Uint8Array(data as ArrayBufferLike);
  }
  if (typeof data === 'object' && data && 'length' in data) {
    return data as ArrayLike<number>;
  }
  return new Uint8Array(0);
}

function convertToRgba8(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
  depth: number,
): Uint8Array {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  const safeChannels = Math.max(1, Math.floor(channels));
  const safeDepth = Math.max(1, Math.floor(depth));
  const sampleMax = Math.max(1, safeDepth >= 16 ? 65535 : 2 ** safeDepth - 1);
  const pixelCount = safeWidth * safeHeight;
  const rgba = new Uint8Array(pixelCount * 4);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const sourceOffset = pixelIndex * safeChannels;
    const targetOffset = pixelIndex * 4;

    if (safeChannels === 1) {
      const gray = toByte(data[sourceOffset] ?? 0, sampleMax);
      rgba[targetOffset] = gray;
      rgba[targetOffset + 1] = gray;
      rgba[targetOffset + 2] = gray;
      rgba[targetOffset + 3] = 255;
      continue;
    }

    if (safeChannels === 2) {
      const gray = toByte(data[sourceOffset] ?? 0, sampleMax);
      rgba[targetOffset] = gray;
      rgba[targetOffset + 1] = gray;
      rgba[targetOffset + 2] = gray;
      rgba[targetOffset + 3] = toByte(data[sourceOffset + 1] ?? sampleMax, sampleMax);
      continue;
    }

    rgba[targetOffset] = toByte(data[sourceOffset] ?? 0, sampleMax);
    rgba[targetOffset + 1] = toByte(data[sourceOffset + 1] ?? 0, sampleMax);
    rgba[targetOffset + 2] = toByte(data[sourceOffset + 2] ?? 0, sampleMax);
    rgba[targetOffset + 3] =
      safeChannels >= 4 ? toByte(data[sourceOffset + 3] ?? sampleMax, sampleMax) : 255;
  }
  return rgba;
}

function toByte(sample: number, sampleMax: number): number {
  const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(sampleMax, sample)) : 0;
  if (sampleMax === 255) {
    return normalized;
  }
  return Math.round((normalized * 255) / sampleMax);
}

function createMissingSourceFrame(mode: FrameMode): AnsiFrame {
  const specMaskFill = mode === 'base' ? 1 : 0;
  return createSolidAnsiFrame(SPEC_BGA_CANVAS_SIZE, SPEC_BGA_CANVAS_SIZE, 0, 0, 0, specMaskFill);
}

function createSolidAnsiFrame(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  maskFill: 0 | 1,
): AnsiFrame {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const rgb = new Uint8Array(safeWidth * safeHeight * 3);
  const opaqueMask = new Uint8Array(safeWidth * safeHeight);
  if (maskFill === 0) {
    return {
      width: safeWidth,
      height: safeHeight,
      rgb,
      opaqueMask,
    };
  }

  for (let pixelOffset = 0; pixelOffset < safeWidth * safeHeight; pixelOffset += 1) {
    const rgbOffset = pixelOffset * 3;
    rgb[rgbOffset] = r;
    rgb[rgbOffset + 1] = g;
    rgb[rgbOffset + 2] = b;
    opaqueMask[pixelOffset] = 1;
  }

  return {
    width: safeWidth,
    height: safeHeight,
    rgb,
    opaqueMask,
  };
}

function convertImageToSpecFrame(image: DecodedImage, mode: FrameMode): AnsiFrame {
  const specFrame = createSolidAnsiFrame(SPEC_BGA_CANVAS_SIZE, SPEC_BGA_CANVAS_SIZE, 0, 0, 0, 0);
  const offsetX = Math.floor((SPEC_BGA_CANVAS_SIZE - image.width) / 2);
  const offsetY = 0;

  for (let sourceY = 0; sourceY < image.height; sourceY += 1) {
    const targetY = sourceY + offsetY;
    if (targetY < 0 || targetY >= SPEC_BGA_CANVAS_SIZE) {
      continue;
    }

    for (let sourceX = 0; sourceX < image.width; sourceX += 1) {
      const targetX = sourceX + offsetX;
      if (targetX < 0 || targetX >= SPEC_BGA_CANVAS_SIZE) {
        continue;
      }

      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const r = image.data[sourceOffset] ?? 0;
      const g = image.data[sourceOffset + 1] ?? 0;
      const b = image.data[sourceOffset + 2] ?? 0;
      const a = image.data[sourceOffset + 3] ?? 255;
      if (!isOpaquePixel(r, g, b, a, image.format, mode)) {
        continue;
      }

      const targetPixelOffset = targetY * SPEC_BGA_CANVAS_SIZE + targetX;
      const targetRgbOffset = targetPixelOffset * 3;
      specFrame.rgb[targetRgbOffset] = r;
      specFrame.rgb[targetRgbOffset + 1] = g;
      specFrame.rgb[targetRgbOffset + 2] = b;
      specFrame.opaqueMask[targetPixelOffset] = 1;
    }
  }

  return specFrame;
}

function resizeAnsiFrame(source: AnsiFrame, maxWidth: number, maxHeight: number): AnsiFrame {
  const canvasWidth = Math.max(1, maxWidth);
  const canvasHeight = Math.max(1, maxHeight);
  const fitted = fitSizeKeepingAspect(
    source.width * TERMINAL_PIXEL_ASPECT_X,
    source.height * TERMINAL_PIXEL_ASPECT_Y,
    canvasWidth,
    canvasHeight,
  );
  const offsetX = Math.floor((canvasWidth - fitted.width) / 2);
  const offsetY = Math.floor((canvasHeight - fitted.height) / 2);
  const rgb = new Uint8Array(canvasWidth * canvasHeight * 3);
  const opaqueMask = new Uint8Array(canvasWidth * canvasHeight);

  for (let y = 0; y < fitted.height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.max(0, Math.floor(((y + 0.5) * source.height) / fitted.height)));
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= canvasHeight) {
      continue;
    }

    for (let x = 0; x < fitted.width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.max(0, Math.floor(((x + 0.5) * source.width) / fitted.width)));
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= canvasWidth) {
        continue;
      }

      const sourcePixelOffset = sourceY * source.width + sourceX;
      if (source.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }

      const sourceRgbOffset = sourcePixelOffset * 3;
      const targetPixelOffset = targetY * canvasWidth + targetX;
      const targetRgbOffset = targetPixelOffset * 3;
      rgb[targetRgbOffset] = source.rgb[sourceRgbOffset] ?? 0;
      rgb[targetRgbOffset + 1] = source.rgb[sourceRgbOffset + 1] ?? 0;
      rgb[targetRgbOffset + 2] = source.rgb[sourceRgbOffset + 2] ?? 0;
      opaqueMask[targetPixelOffset] = 1;
    }
  }

  return {
    width: canvasWidth,
    height: canvasHeight,
    rgb,
    opaqueMask,
  };
}

function isOpaquePixel(r: number, g: number, b: number, a: number, format: ImageFormat, mode: FrameMode): boolean {
  if (mode !== 'layer') {
    return true;
  }
  if (format === 'bmp' || format === 'video') {
    return !(r === 0 && g === 0 && b === 0);
  }
  if (format === 'png') {
    return a > TRANSPARENT_ALPHA_THRESHOLD;
  }
  return true;
}

function fitSizeKeepingAspect(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const safeMaxWidth = Math.max(1, maxWidth);
  const safeMaxHeight = Math.max(1, maxHeight);
  const aspect = safeSourceWidth / safeSourceHeight;

  let width = safeMaxWidth;
  let height = Math.max(1, Math.floor(width / aspect));

  if (height > safeMaxHeight) {
    height = safeMaxHeight;
    width = Math.max(1, Math.floor(height * aspect));
  }

  return { width, height };
}

function isPngBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isJpegBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function isBmpBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d;
}
