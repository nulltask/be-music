import { access, readFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import { normalizeChannel, normalizeObjectKey, sortEvents, type BmsJson } from '@be-music/json';
import { createTimingResolver } from '@be-music/audio-renderer';
import bmp from 'bmp-js';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const BASE_BGA_CHANNEL = '04';
const LAYER_BGA_CHANNEL = '07';
const DEFAULT_BGA_ASCII_WIDTH = 34;
const DEFAULT_BGA_ASCII_HEIGHT = 20;
const TRANSPARENT_ALPHA_THRESHOLD = 16;
const ANSI_RESET = '\u001b[0m';
const DEFAULT_SIXEL_SCALE_X = 8;
const DEFAULT_SIXEL_SCALE_Y = 16;
const SPEC_BGA_CANVAS_SIZE = 256;
const TERMINAL_PIXEL_ASPECT_X = 2;
const TERMINAL_PIXEL_ASPECT_Y = 1;

type ImageFormat = 'bmp' | 'png' | 'jpeg';
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

  private readonly baseFramesByKey: Map<string, AnsiFrame>;

  private readonly layerFramesByKey: Map<string, AnsiFrame>;

  private readonly stageFileFrame?: AnsiFrame;

  private readonly missingBaseFrame: AnsiFrame;

  private readonly missingLayerFrame: AnsiFrame;

  private cachedBaseKey = '__INIT__';

  private cachedLayerKey = '__INIT__';

  private cachedComposite?: CompositeFrame;

  private cachedLines?: string[];

  private cachedSixel?: string;

  private cachedSixelScaleX = -1;

  private cachedSixelScaleY = -1;

  constructor(params: {
    baseTimeline: BgaCue[];
    layerTimeline: BgaCue[];
    baseFramesByKey: Map<string, AnsiFrame>;
    layerFramesByKey: Map<string, AnsiFrame>;
    stageFileFrame?: AnsiFrame;
    missingBaseFrame: AnsiFrame;
    missingLayerFrame: AnsiFrame;
  }) {
    this.baseTimeline = params.baseTimeline;
    this.layerTimeline = params.layerTimeline;
    this.baseFramesByKey = params.baseFramesByKey;
    this.layerFramesByKey = params.layerFramesByKey;
    this.stageFileFrame = params.stageFileFrame;
    this.missingBaseFrame = params.missingBaseFrame;
    this.missingLayerFrame = params.missingLayerFrame;
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

  getSixel(currentSeconds: number, scaleX?: number, scaleY?: number): string | undefined {
    this.refreshComposite(currentSeconds);
    if (!this.cachedComposite) {
      return undefined;
    }
    const normalizedScaleX = Math.max(1, Math.floor(scaleX ?? DEFAULT_SIXEL_SCALE_X));
    const normalizedScaleY = Math.max(1, Math.floor(scaleY ?? DEFAULT_SIXEL_SCALE_Y));
    if (
      !this.cachedSixel ||
      this.cachedSixelScaleX !== normalizedScaleX ||
      this.cachedSixelScaleY !== normalizedScaleY
    ) {
      this.cachedSixel = composeSixel(this.cachedComposite, normalizedScaleX, normalizedScaleY);
      this.cachedSixelScaleX = normalizedScaleX;
      this.cachedSixelScaleY = normalizedScaleY;
    }
    return this.cachedSixel;
  }

  private refreshComposite(currentSeconds: number): void {
    const baseKey = findActiveCueKey(this.baseTimeline, currentSeconds) ?? '';
    const layerKey = findActiveCueKey(this.layerTimeline, currentSeconds) ?? '';
    if (this.cachedBaseKey === baseKey && this.cachedLayerKey === layerKey) {
      return;
    }

    const baseFrame = this.resolveBaseFrame(baseKey);
    const layerFrame = this.resolveLayerFrame(layerKey);

    this.cachedBaseKey = baseKey;
    this.cachedLayerKey = layerKey;
    this.cachedComposite = mergeCompositeFrames(baseFrame, layerFrame);
    this.cachedLines = undefined;
    this.cachedSixel = undefined;
    this.cachedSixelScaleX = -1;
    this.cachedSixelScaleY = -1;
  }

  private resolveBaseFrame(baseKey: string): AnsiFrame | undefined {
    if (!baseKey) {
      return this.stageFileFrame;
    }
    return this.baseFramesByKey.get(baseKey) ?? this.missingBaseFrame;
  }

  private resolveLayerFrame(layerKey: string): AnsiFrame | undefined {
    if (!layerKey) {
      return undefined;
    }
    return this.layerFramesByKey.get(layerKey) ?? this.missingLayerFrame;
  }
}

export async function createBgaAnsiRenderer(
  json: BmsJson,
  options: BgaAnsiOptions,
): Promise<BgaAnsiRenderer | undefined> {
  const width = Math.max(8, Math.floor(options.width ?? DEFAULT_BGA_ASCII_WIDTH));
  const height = Math.max(6, Math.floor(options.height ?? DEFAULT_BGA_ASCII_HEIGHT));
  const resolver = createTimingResolver(json);

  const baseTimeline = buildBgaTimeline(json, resolver, BASE_BGA_CHANNEL);
  const layerTimeline = buildBgaTimeline(json, resolver, LAYER_BGA_CHANNEL);

  const baseKeys = new Set(baseTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const layerKeys = new Set(layerTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));

  const baseFramesByKey = await loadFramesByKeys({
    keys: baseKeys,
    resources: json.resources.bmp,
    baseDir: options.baseDir,
    width,
    height,
    mode: 'base',
  });
  const layerFramesByKey = await loadFramesByKeys({
    keys: layerKeys,
    resources: json.resources.bmp,
    baseDir: options.baseDir,
    width,
    height,
    mode: 'layer',
  });

  let stageFileFrame: AnsiFrame | undefined;
  if (json.metadata.stageFile) {
    const resolved = await resolveImagePath(options.baseDir, json.metadata.stageFile);
    if (resolved) {
      stageFileFrame = await loadImageAsAnsiFrame(resolved, width, height, 'base');
    }
  }

  if (baseFramesByKey.size === 0 && layerFramesByKey.size === 0 && !stageFileFrame) {
    return undefined;
  }

  const missingBaseFrame = createMissingFrame(width, height, 'base');
  const missingLayerFrame = createMissingFrame(width, height, 'layer');

  return new BgaAnsiRenderer({
    baseTimeline,
    layerTimeline,
    baseFramesByKey,
    layerFramesByKey,
    stageFileFrame,
    missingBaseFrame,
    missingLayerFrame,
  });
}

async function loadFramesByKeys(params: {
  keys: ReadonlySet<string>;
  resources: Record<string, string>;
  baseDir: string;
  width: number;
  height: number;
  mode: FrameMode;
}): Promise<Map<string, AnsiFrame>> {
  const { keys, resources, baseDir, width, height, mode } = params;
  const map = new Map<string, AnsiFrame>();

  for (const key of keys) {
    const resourcePath = resources[key];
    if (!resourcePath) {
      continue;
    }
    const resolved = await resolveImagePath(baseDir, resourcePath);
    if (!resolved) {
      continue;
    }
    const frame = await loadImageAsAnsiFrame(resolved, width, height, mode);
    if (frame) {
      map.set(key, frame);
    }
  }

  return map;
}

function buildBgaTimeline(json: BmsJson, resolver: ReturnType<typeof createTimingResolver>, channel: string): BgaCue[] {
  const normalized = normalizeChannel(channel);
  const timeline = sortEvents(json.events)
    .filter((event) => normalizeChannel(event.channel) === normalized)
    .map((event) => {
      const key = normalizeObjectKey(event.value);
      return {
        seconds: resolver.eventToSeconds(event),
        key: key === '00' ? undefined : key,
      } satisfies BgaCue;
    })
    .sort((left, right) => left.seconds - right.seconds);

  if (timeline.length < 2) {
    return timeline;
  }

  const compact: BgaCue[] = [];
  let previousKey = '__UNSET__';
  for (const cue of timeline) {
    const currentKey = cue.key ?? '';
    if (currentKey === previousKey) {
      continue;
    }
    compact.push(cue);
    previousKey = currentKey;
  }
  return compact;
}

function findActiveCueKey(timeline: BgaCue[], currentSeconds: number): string | undefined {
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

  return timeline[answer].key;
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

function composeSixel(frame: CompositeFrame, scaleX: number, scaleY: number): string {
  const { width: sourceWidth, height: sourceHeight, rgb, opaqueMask } = frame;
  const width = sourceWidth * scaleX;
  const height = sourceHeight * scaleY;
  const paletteKeys = new Map<number, number>();
  const paletteByRegister: Array<{ register: number; r: number; g: number; b: number }> = [];
  const sourceRegisters = new Uint16Array(sourceWidth * sourceHeight);

  for (let pixelOffset = 0; pixelOffset < sourceRegisters.length; pixelOffset += 1) {
    if (opaqueMask[pixelOffset] === 0) {
      continue;
    }

    const rgbOffset = pixelOffset * 3;
    const { key, r, g, b } = quantizeRgb(rgb[rgbOffset] ?? 0, rgb[rgbOffset + 1] ?? 0, rgb[rgbOffset + 2] ?? 0);

    let register = paletteKeys.get(key);
    if (!register) {
      register = paletteByRegister.length + 1;
      paletteKeys.set(key, register);
      paletteByRegister.push({ register, r, g, b });
    }
    sourceRegisters[pixelOffset] = register;
  }

  const parts: string[] = [];
  parts.push('\u001bPq');
  parts.push(`"1;1;${width};${height}`);

  for (const color of paletteByRegister) {
    parts.push(`#${color.register};2;${toSixelPercent(color.r)};${toSixelPercent(color.g)};${toSixelPercent(color.b)}`);
  }

  const bandCount = Math.ceil(height / 6);
  for (let band = 0; band < bandCount; band += 1) {
    let hasAnyColor = false;
    for (const color of paletteByRegister) {
      let hasAnyPixel = false;
      let sixelData = '';

      for (let x = 0; x < width; x += 1) {
        let bits = 0;
        for (let bit = 0; bit < 6; bit += 1) {
          const y = band * 6 + bit;
          if (y >= height) {
            continue;
          }
          const sourceX = Math.min(sourceWidth - 1, Math.floor(x / scaleX));
          const sourceY = Math.min(sourceHeight - 1, Math.floor(y / scaleY));
          const sourceOffset = sourceY * sourceWidth + sourceX;
          if (sourceRegisters[sourceOffset] === color.register) {
            bits |= 1 << bit;
          }
        }
        if (bits !== 0) {
          hasAnyPixel = true;
        }
        sixelData += String.fromCharCode(63 + bits);
      }

      if (!hasAnyPixel) {
        continue;
      }

      if (hasAnyColor) {
        parts.push('$');
      }
      parts.push(`#${color.register}`);
      parts.push(encodeSixelRunLength(sixelData));
      hasAnyColor = true;
    }

    if (band < bandCount - 1) {
      parts.push('-');
    }
  }

  parts.push('\u001b\\');
  return parts.join('');
}

function quantizeRgb(
  sourceR: number,
  sourceG: number,
  sourceB: number,
): { key: number; r: number; g: number; b: number } {
  const rBucket = Math.max(0, Math.min(5, Math.round(sourceR / 51)));
  const gBucket = Math.max(0, Math.min(5, Math.round(sourceG / 51)));
  const bBucket = Math.max(0, Math.min(5, Math.round(sourceB / 51)));
  const r = rBucket * 51;
  const g = gBucket * 51;
  const b = bBucket * 51;
  const key = rBucket * 36 + gBucket * 6 + bBucket;
  return { key, r, g, b };
}

function toSixelPercent(channelValue: number): number {
  return Math.max(0, Math.min(100, Math.round((channelValue / 255) * 100)));
}

function encodeSixelRunLength(input: string): string {
  if (input.length === 0) {
    return input;
  }

  let encoded = '';
  let current = input[0];
  let runLength = 1;

    const flush = (): void => {
    if (runLength >= 4) {
      encoded += `!${runLength}${current}`;
      return;
    }
    encoded += current.repeat(runLength);
  };

  for (let index = 1; index < input.length; index += 1) {
    const next = input[index];
    if (next === current) {
      runLength += 1;
      continue;
    }
    flush();
    current = next;
    runLength = 1;
  }
  flush();

  return encoded;
}

async function loadImageAsAnsiFrame(
  imagePath: string,
  maxWidth: number,
  maxHeight: number,
  mode: FrameMode,
): Promise<AnsiFrame | undefined> {
  try {
    const buffer = await readFile(imagePath);
    const decoded = decodeImageBuffer(buffer, imagePath);
    return convertImageToAnsiFrame(decoded, maxWidth, maxHeight, mode);
  } catch {
    return undefined;
  }
}

async function resolveImagePath(baseDir: string, imagePath: string): Promise<string | undefined> {
  const candidates = createImagePathCandidates(imagePath);
  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate) ? candidate : resolve(baseDir, candidate);
    if (await exists(absolute)) {
      return absolute;
    }
  }
  return undefined;
}

function createImagePathCandidates(imagePath: string): string[] {
  const extCandidates = ['.bmp', '.BMP', '.png', '.PNG', '.jpg', '.JPG', '.jpeg', '.JPEG'];
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

  const basePaths = [imagePath];
  const slashNormalized = imagePath.replaceAll('\\', '/');
  if (slashNormalized !== imagePath) {
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
  const decoded = PNG.sync.read(buffer);
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data,
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
  const decoded = bmp.decode(buffer);
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data,
    format: 'bmp',
  };
}

function createMissingFrame(maxWidth: number, maxHeight: number, mode: FrameMode): AnsiFrame {
  const specMaskFill = mode === 'base' ? 1 : 0;
  const specFrame = createSolidAnsiFrame(SPEC_BGA_CANVAS_SIZE, SPEC_BGA_CANVAS_SIZE, 0, 0, 0, specMaskFill);
  return resizeAnsiFrame(specFrame, maxWidth, maxHeight);
}

function createSolidAnsiFrame(width: number, height: number, r: number, g: number, b: number, maskFill: 0 | 1): AnsiFrame {
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

function convertImageToAnsiFrame(image: DecodedImage, maxWidth: number, maxHeight: number, mode: FrameMode): AnsiFrame {
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

  return resizeAnsiFrame(specFrame, maxWidth, maxHeight);
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
  if (format === 'bmp') {
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
