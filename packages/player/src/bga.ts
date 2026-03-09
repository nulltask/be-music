import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  invokeWorkerizedFunction,
  isAbortError,
  resolveFirstExistingPath,
  throwIfAborted,
  workerize,
} from '@be-music/utils';
import { normalizeChannel, normalizeObjectKey, sortEvents, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { createTimingResolver } from '@be-music/audio-renderer';
import { decode as decodeBmpFast } from 'fast-bmp';
import { decode as decodePngFast } from 'fast-png';
import jpeg from 'jpeg-js';
import { decodeVideoFramesStream } from './bga-video.ts';

const BASE_BGA_CHANNEL = '04';
const POOR_BGA_CHANNEL = '06';
const LAYER_BGA_CHANNEL = '07';
const LAYER2_BGA_CHANNEL = '0A';
const NORMAL_BGA_COMPOSITE_LAYER_ORDER = [BASE_BGA_CHANNEL, LAYER_BGA_CHANNEL, LAYER2_BGA_CHANNEL] as const;
const MAX_NORMAL_BGA_COMPOSITE_LAYERS = NORMAL_BGA_COMPOSITE_LAYER_ORDER.length;
const DEFAULT_BGA_ASCII_WIDTH = 34;
const DEFAULT_BGA_ASCII_HEIGHT = 20;
const DEFAULT_POOR_BGA_DISPLAY_SECONDS = 2;
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

type WorkerizedSpecFrameConverter = ((
  image: DecodedImage,
  mode: FrameMode,
  callback: (error: unknown, result: AnsiFrame) => void,
) => void) & { close: () => void };

let convertImageToSpecFrameWorker = createConvertImageToSpecFrameWorker();

export interface BgaAnsiOptions {
  baseDir: string;
  width?: number;
  height?: number;
  onLoadProgress?: (progress: BgaAnsiLoadProgress) => void;
  signal?: AbortSignal;
}

export interface BgaAnsiLoadProgress {
  ratio: number;
  detail: string;
}

export class BgaAnsiRenderer {
  private readonly baseTimeline: BgaCue[];

  private readonly poorTimeline: BgaCue[];

  private readonly layerTimeline: BgaCue[];

  private readonly layer2Timeline: BgaCue[];

  private readonly baseSourceFramesByKey: Map<string, FrameSource>;

  private readonly poorSourceFramesByKey: Map<string, FrameSource>;

  private readonly layerSourceFramesByKey: Map<string, FrameSource>;

  private readonly layer2SourceFramesByKey: Map<string, FrameSource>;

  private readonly stageFileSourceFrame?: FrameSource;

  private readonly missingBaseSourceFrame: AnsiFrame;

  private readonly missingPoorSourceFrame: AnsiFrame;

  private readonly missingLayerSourceFrame: AnsiFrame;

  private readonly poorFallbackKey?: string;

  private readonly poorFallbackUntilSeconds: number;

  private baseFramesByKey = new Map<string, FrameSource>();

  private poorFramesByKey = new Map<string, FrameSource>();

  private layerFramesByKey = new Map<string, FrameSource>();

  private layer2FramesByKey = new Map<string, FrameSource>();

  private stageFileFrame?: FrameSource;

  private missingBaseFrame: AnsiFrame;

  private missingPoorFrame: AnsiFrame;

  private missingLayerFrame: AnsiFrame;

  private displayWidth: number;

  private displayHeight: number;

  private cachedBaseKey = '__INIT__';

  private cachedLayerKey = '__INIT__';

  private cachedLayer2Key = '__INIT__';

  private cachedPoorKey = '__INIT__';

  private cachedBaseFrameIndex = -1;

  private cachedPoorFrameIndex = -1;

  private cachedLayerFrameIndex = -1;

  private cachedLayer2FrameIndex = -1;

  private cachedPoorActive = false;

  private cachedComposite?: CompositeFrame;

  private cachedLines?: string[];

  private blackBackgroundLines: string[];

  private poorActiveUntilSeconds = Number.NEGATIVE_INFINITY;

  constructor(params: {
    baseTimeline: BgaCue[];
    poorTimeline: BgaCue[];
    layerTimeline: BgaCue[];
    layer2Timeline: BgaCue[];
    baseSourceFramesByKey: Map<string, FrameSource>;
    poorSourceFramesByKey: Map<string, FrameSource>;
    layerSourceFramesByKey: Map<string, FrameSource>;
    layer2SourceFramesByKey: Map<string, FrameSource>;
    stageFileSourceFrame?: FrameSource;
    missingBaseSourceFrame: AnsiFrame;
    missingPoorSourceFrame: AnsiFrame;
    missingLayerSourceFrame: AnsiFrame;
    poorFallbackKey?: string;
    poorFallbackUntilSeconds: number;
    width: number;
    height: number;
  }) {
    this.baseTimeline = params.baseTimeline;
    this.poorTimeline = params.poorTimeline;
    this.layerTimeline = params.layerTimeline;
    this.layer2Timeline = params.layer2Timeline;
    this.baseSourceFramesByKey = params.baseSourceFramesByKey;
    this.poorSourceFramesByKey = params.poorSourceFramesByKey;
    this.layerSourceFramesByKey = params.layerSourceFramesByKey;
    this.layer2SourceFramesByKey = params.layer2SourceFramesByKey;
    this.stageFileSourceFrame = params.stageFileSourceFrame;
    this.missingBaseSourceFrame = params.missingBaseSourceFrame;
    this.missingPoorSourceFrame = params.missingPoorSourceFrame;
    this.missingLayerSourceFrame = params.missingLayerSourceFrame;
    this.poorFallbackKey = params.poorFallbackKey;
    this.poorFallbackUntilSeconds = params.poorFallbackUntilSeconds;
    this.displayWidth = params.width;
    this.displayHeight = params.height;
    this.blackBackgroundLines = [];
    this.missingBaseFrame = resizeAnsiFrame(this.missingBaseSourceFrame, this.displayWidth, this.displayHeight);
    this.missingPoorFrame = resizeAnsiFrame(this.missingPoorSourceFrame, this.displayWidth, this.displayHeight);
    this.missingLayerFrame = resizeAnsiFrame(this.missingLayerSourceFrame, this.displayWidth, this.displayHeight);
    this.rebuildFrames();
  }

  triggerPoor(currentSeconds: number): void {
    const safeCurrentSeconds = Number.isFinite(currentSeconds) ? currentSeconds : 0;
    const nextPoorActiveUntilSeconds = safeCurrentSeconds + DEFAULT_POOR_BGA_DISPLAY_SECONDS;
    if (nextPoorActiveUntilSeconds <= this.poorActiveUntilSeconds) {
      return;
    }
    this.poorActiveUntilSeconds = nextPoorActiveUntilSeconds;
    this.cachedPoorActive = false;
    this.cachedComposite = undefined;
    this.cachedLines = undefined;
  }

  clearPoor(): void {
    if (this.poorActiveUntilSeconds === Number.NEGATIVE_INFINITY) {
      return;
    }
    this.poorActiveUntilSeconds = Number.NEGATIVE_INFINITY;
    this.cachedPoorActive = false;
    this.cachedComposite = undefined;
    this.cachedLines = undefined;
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
      return this.blackBackgroundLines;
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
    this.poorFramesByKey = resizeFrameSourceMap(this.poorSourceFramesByKey, this.displayWidth, this.displayHeight);
    this.layerFramesByKey = resizeFrameSourceMap(this.layerSourceFramesByKey, this.displayWidth, this.displayHeight);
    this.layer2FramesByKey = resizeFrameSourceMap(this.layer2SourceFramesByKey, this.displayWidth, this.displayHeight);
    this.stageFileFrame = this.stageFileSourceFrame
      ? resizeFrameSource(this.stageFileSourceFrame, this.displayWidth, this.displayHeight)
      : undefined;
    this.missingBaseFrame = resizeAnsiFrame(this.missingBaseSourceFrame, this.displayWidth, this.displayHeight);
    this.missingPoorFrame = resizeAnsiFrame(this.missingPoorSourceFrame, this.displayWidth, this.displayHeight);
    this.missingLayerFrame = resizeAnsiFrame(this.missingLayerSourceFrame, this.displayWidth, this.displayHeight);
    this.blackBackgroundLines = createBlackBackgroundAnsiLines(this.displayWidth, this.displayHeight);
    this.resetCache();
  }

  private resetCache(): void {
    this.cachedBaseKey = '__INIT__';
    this.cachedLayerKey = '__INIT__';
    this.cachedLayer2Key = '__INIT__';
    this.cachedPoorKey = '__INIT__';
    this.cachedBaseFrameIndex = -1;
    this.cachedLayerFrameIndex = -1;
    this.cachedLayer2FrameIndex = -1;
    this.cachedPoorFrameIndex = -1;
    this.cachedPoorActive = false;
    this.cachedComposite = undefined;
    this.cachedLines = undefined;
  }

  private refreshComposite(currentSeconds: number): void {
    const baseCue = findActiveCue(this.baseTimeline, currentSeconds);
    const layerCue = findActiveCue(this.layerTimeline, currentSeconds);
    const layer2Cue = findActiveCue(this.layer2Timeline, currentSeconds);

    const baseKey = baseCue?.key ?? '';
    const layerKey = layerCue?.key ?? '';
    const layer2Key = layer2Cue?.key ?? '';
    const baseSeconds = baseCue ? Math.max(0, currentSeconds - baseCue.seconds) : Math.max(0, currentSeconds);
    const layerSeconds = layerCue ? Math.max(0, currentSeconds - layerCue.seconds) : 0;
    const layer2Seconds = layer2Cue ? Math.max(0, currentSeconds - layer2Cue.seconds) : 0;

    const baseSelection = this.resolveBaseFrame(baseKey, baseSeconds);
    const layerSelection = this.resolveLayerFrame(layerKey, layerSeconds);
    const layer2Selection = this.resolveLayer2Frame(layer2Key, layer2Seconds);
    const poorActive = currentSeconds < this.poorActiveUntilSeconds;
    const poorSelection = poorActive ? this.resolvePoorFrame(currentSeconds) : { key: '', index: -1, frame: undefined };

    if (
      this.cachedBaseKey === baseKey &&
      this.cachedLayerKey === layerKey &&
      this.cachedLayer2Key === layer2Key &&
      this.cachedPoorKey === poorSelection.key &&
      this.cachedBaseFrameIndex === baseSelection.index &&
      this.cachedLayerFrameIndex === layerSelection.index &&
      this.cachedLayer2FrameIndex === layer2Selection.index &&
      this.cachedPoorFrameIndex === poorSelection.index &&
      this.cachedPoorActive === poorActive
    ) {
      return;
    }

    this.cachedBaseKey = baseKey;
    this.cachedLayerKey = layerKey;
    this.cachedLayer2Key = layer2Key;
    this.cachedPoorKey = poorSelection.key;
    this.cachedBaseFrameIndex = baseSelection.index;
    this.cachedLayerFrameIndex = layerSelection.index;
    this.cachedLayer2FrameIndex = layer2Selection.index;
    this.cachedPoorFrameIndex = poorSelection.index;
    this.cachedPoorActive = poorActive;
    this.cachedComposite =
      poorActive && poorSelection.frame
        ? mergeCompositeFrames(poorSelection.frame)
        : mergeCompositeFrames(
            ...[baseSelection.frame, layerSelection.frame, layer2Selection.frame].slice(
              0,
              MAX_NORMAL_BGA_COMPOSITE_LAYERS,
            ),
          );
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

  private resolveLayer2Frame(layer2Key: string, seconds: number): FrameSelection {
    if (!layer2Key) {
      return {
        frame: undefined,
        index: -1,
      };
    }
    const source = this.layer2FramesByKey.get(layer2Key) ?? createStaticFrameSource(this.missingLayerFrame);
    return selectFrameFromSource(source, seconds);
  }

  private resolvePoorFrame(currentSeconds: number): { key: string; frame?: AnsiFrame; index: number } {
    const poorCue = findActiveCue(this.poorTimeline, currentSeconds);
    const poorKey = this.resolvePoorKey(poorCue, currentSeconds);
    if (!poorKey) {
      return {
        key: '',
        frame: undefined,
        index: -1,
      };
    }
    const source = this.poorFramesByKey.get(poorKey) ?? createStaticFrameSource(this.missingPoorFrame);
    const seconds = poorCue ? Math.max(0, currentSeconds - poorCue.seconds) : Math.max(0, currentSeconds);
    const selected = selectFrameFromSource(source, seconds);
    return {
      key: poorKey,
      frame: selected.frame,
      index: selected.index,
    };
  }

  private resolvePoorKey(poorCue: BgaCue | undefined, currentSeconds: number): string | undefined {
    if (poorCue) {
      return poorCue.key;
    }
    if (this.poorFallbackKey && currentSeconds < this.poorFallbackUntilSeconds) {
      return this.poorFallbackKey;
    }
    return undefined;
  }
}

export async function createBgaAnsiRenderer(
  json: BeMusicJson,
  options: BgaAnsiOptions,
): Promise<BgaAnsiRenderer | undefined> {
  throwIfAborted(options.signal);
  const displaySize = normalizeDisplaySize(options.width, options.height);
  const resolver = createTimingResolver(json);
  const sortedEvents = sortEvents(json.events);

  const baseTimeline = buildBgaTimeline(sortedEvents, resolver, BASE_BGA_CHANNEL);
  const poorTimeline = buildBgaTimeline(sortedEvents, resolver, POOR_BGA_CHANNEL);
  const layerTimeline = buildBgaTimeline(sortedEvents, resolver, LAYER_BGA_CHANNEL);
  const layer2Timeline = buildBgaTimeline(sortedEvents, resolver, LAYER2_BGA_CHANNEL);

  const baseKeys = new Set(baseTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const poorKeys = new Set(poorTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const layerKeys = new Set(layerTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const layer2Keys = new Set(layer2Timeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const shouldUsePoorBmp00Fallback =
    typeof json.bms.poorBga !== 'string' &&
    typeof json.resources.bmp['00'] === 'string' &&
    json.resources.bmp['00'].length > 0;
  const poorFallbackKey = shouldUsePoorBmp00Fallback ? '00' : undefined;
  if (poorFallbackKey) {
    poorKeys.add(poorFallbackKey);
  }
  const poorFallbackUntilSeconds = poorTimeline[0]?.seconds ?? Number.POSITIVE_INFINITY;
  const totalLoadTargetCount =
    countMappedBmpResourceTargets(baseKeys, json.resources.bmp) +
    countMappedBmpResourceTargets(poorKeys, json.resources.bmp) +
    countMappedBmpResourceTargets(layerKeys, json.resources.bmp) +
    countMappedBmpResourceTargets(layer2Keys, json.resources.bmp) +
    countMappedStageFileTarget(json.metadata.stageFile);
  let loadedTargetCount = 0;
  const reportLoadProgress = (detail: string): void => {
    if (!options.onLoadProgress || totalLoadTargetCount <= 0) {
      return;
    }
    loadedTargetCount += 1;
    options.onLoadProgress({
      ratio: Math.max(0, Math.min(1, loadedTargetCount / totalLoadTargetCount)),
      detail: normalizeProgressDetail(detail),
    });
  };

  const baseSourceFramesByKey = await loadFramesByKeys({
    keys: baseKeys,
    resources: json.resources.bmp,
    baseDir: options.baseDir,
    mode: 'base',
    width: displaySize.width,
    height: displaySize.height,
    onLoadProgress: reportLoadProgress,
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  const poorSourceFramesByKey = await loadFramesByKeys({
    keys: poorKeys,
    resources: json.resources.bmp,
    baseDir: options.baseDir,
    mode: 'base',
    width: displaySize.width,
    height: displaySize.height,
    onLoadProgress: reportLoadProgress,
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  const layerSourceFramesByKey = await loadFramesByKeys({
    keys: layerKeys,
    resources: json.resources.bmp,
    baseDir: options.baseDir,
    mode: 'layer',
    width: displaySize.width,
    height: displaySize.height,
    onLoadProgress: reportLoadProgress,
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  const layer2SourceFramesByKey = await loadFramesByKeys({
    keys: layer2Keys,
    resources: json.resources.bmp,
    baseDir: options.baseDir,
    mode: 'layer',
    width: displaySize.width,
    height: displaySize.height,
    onLoadProgress: reportLoadProgress,
    signal: options.signal,
  });
  throwIfAborted(options.signal);

  let stageFileSourceFrame: FrameSource | undefined;
  if (json.metadata.stageFile) {
    reportLoadProgress(json.metadata.stageFile);
    const resolved = await resolveMediaPath(options.baseDir, json.metadata.stageFile, options.signal);
    if (resolved) {
      stageFileSourceFrame = await loadFrameSource(
        resolved,
        'base',
        displaySize.width,
        displaySize.height,
        options.signal,
      );
    }
  }

  if (
    baseSourceFramesByKey.size === 0 &&
    poorSourceFramesByKey.size === 0 &&
    layerSourceFramesByKey.size === 0 &&
    layer2SourceFramesByKey.size === 0 &&
    !stageFileSourceFrame
  ) {
    return undefined;
  }

  const missingBaseSourceFrame = createMissingSourceFrame('base');
  const missingPoorSourceFrame = createMissingSourceFrame('base');
  const missingLayerSourceFrame = createMissingSourceFrame('layer');

  return new BgaAnsiRenderer({
    baseTimeline,
    poorTimeline,
    layerTimeline,
    layer2Timeline,
    baseSourceFramesByKey,
    poorSourceFramesByKey,
    layerSourceFramesByKey,
    layer2SourceFramesByKey,
    stageFileSourceFrame,
    missingBaseSourceFrame,
    missingPoorSourceFrame,
    missingLayerSourceFrame,
    poorFallbackKey,
    poorFallbackUntilSeconds,
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
  onLoadProgress?: (detail: string) => void;
  signal?: AbortSignal;
}): Promise<Map<string, FrameSource>> {
  const { keys, resources, baseDir, mode, width, height, onLoadProgress, signal } = params;
  const map = new Map<string, FrameSource>();
  const cache = new Map<string, FrameSource | null>();

  for (const key of keys) {
    throwIfAborted(signal);
    const resourcePath = resources[key];
    if (!resourcePath) {
      continue;
    }
    onLoadProgress?.(resourcePath);
    const resolved = await resolveMediaPath(baseDir, resourcePath, signal);
    if (!resolved) {
      continue;
    }

    const cacheKey = `${mode}:${width}x${height}:${resolved}`;
    if (!cache.has(cacheKey)) {
      const source = await loadFrameSource(resolved, mode, width, height, signal);
      cache.set(cacheKey, source ?? null);
    }

    const source = cache.get(cacheKey);
    if (source) {
      map.set(key, source);
    }
  }

  return map;
}

function countMappedBmpResourceTargets(keys: ReadonlySet<string>, resources: Record<string, string>): number {
  let count = 0;
  for (const key of keys) {
    if (resources[key]) {
      count += 1;
    }
  }
  return count;
}

function countMappedStageFileTarget(stageFile: string | undefined): number {
  if (typeof stageFile !== 'string' || stageFile.length === 0) {
    return 0;
  }
  return 1;
}

function normalizeProgressDetail(detail: string): string {
  return detail.replaceAll('\\', '/');
}

function normalizeDisplaySize(width?: number, height?: number): { width: number; height: number } {
  return {
    width: Math.max(8, Math.floor(width ?? DEFAULT_BGA_ASCII_WIDTH)),
    height: Math.max(6, Math.floor(height ?? DEFAULT_BGA_ASCII_HEIGHT)),
  };
}

function resizeFrameSourceMap(
  sourceMap: Map<string, FrameSource>,
  width: number,
  height: number,
): Map<string, FrameSource> {
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

function mergeCompositeFrames(...sourceFrames: Array<AnsiFrame | undefined>): CompositeFrame | undefined {
  const frames = sourceFrames.filter((frame): frame is AnsiFrame => frame !== undefined);
  if (frames.length === 0) {
    return undefined;
  }

  let canvasWidth = 0;
  let canvasHeight = 0;
  for (const frame of frames) {
    canvasWidth = Math.max(canvasWidth, frame.width);
    canvasHeight = Math.max(canvasHeight, frame.height);
  }
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return undefined;
  }

  const rgb = new Uint8Array(canvasWidth * canvasHeight * 3);
  const opaqueMask = new Uint8Array(canvasWidth * canvasHeight);

  for (const frame of frames) {
    paintFrame(rgb, opaqueMask, canvasWidth, canvasHeight, frame);
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

function createBlackBackgroundAnsiLines(width: number, height: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const opaqueMask = new Uint8Array(safeWidth * safeHeight).fill(1);
  const rgb = new Uint8Array(safeWidth * safeHeight * 3);
  return composeAnsiLines(rgb, opaqueMask, safeWidth, safeHeight);
}

async function loadImageAsSpecFrame(
  imagePath: string,
  mode: FrameMode,
  signal?: AbortSignal,
): Promise<AnsiFrame | undefined> {
  const extension = extname(imagePath).toLowerCase();
  if (extension !== '.bmp' && extension !== '.png' && extension !== '.jpg' && extension !== '.jpeg') {
    return undefined;
  }
  try {
    throwIfAborted(signal);
    const buffer = await readFile(imagePath, { signal });
    throwIfAborted(signal);
    const decoded = decodeImageBuffer(buffer, imagePath);
    throwIfAborted(signal);
    return await convertImageToSpecFrameOffThread(decoded, mode, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return undefined;
  }
}

async function convertImageToSpecFrameOffThread(
  image: DecodedImage,
  mode: FrameMode,
  signal?: AbortSignal,
): Promise<AnsiFrame> {
  const activeWorker = convertImageToSpecFrameWorker;
  try {
    const frame = await invokeWorkerizedFunction(activeWorker, [image, mode], {
      signal,
      onAbort: () => {
        if (convertImageToSpecFrameWorker === activeWorker) {
          convertImageToSpecFrameWorker.close();
          convertImageToSpecFrameWorker = createConvertImageToSpecFrameWorker();
        }
      },
    });
    if (!frame || typeof frame.width !== 'number' || typeof frame.height !== 'number') {
      return convertImageToSpecFrame(image, mode);
    }
    return frame;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (convertImageToSpecFrameWorker === activeWorker) {
      convertImageToSpecFrameWorker.close();
      convertImageToSpecFrameWorker = createConvertImageToSpecFrameWorker();
    }
    return convertImageToSpecFrame(image, mode);
  }
}

function createConvertImageToSpecFrameWorker(): WorkerizedSpecFrameConverter {
  return workerize(
    (image: DecodedImage, mode: FrameMode) => convertImageToSpecFrame(image, mode),
    () => [
      convertImageToSpecFrame,
      createSolidAnsiFrame,
      fitSizeWithinSpecCanvas,
      isOpaquePixel,
      SPEC_BGA_CANVAS_SIZE,
      TRANSPARENT_ALPHA_THRESHOLD,
    ],
    true,
  ) as WorkerizedSpecFrameConverter;
}

async function loadFrameSource(
  resourcePath: string,
  mode: FrameMode,
  _width: number,
  _height: number,
  signal?: AbortSignal,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const imageFrame = await loadImageAsSpecFrame(resourcePath, mode, signal);
  if (imageFrame) {
    return createStaticFrameSource(imageFrame);
  }

  return loadVideoAsFrameSource(resourcePath, mode, signal);
}

async function loadVideoAsFrameSource(
  videoPath: string,
  mode: FrameMode,
  signal?: AbortSignal,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const frames: TimedAnsiFrame[] = [];
  const decoded = await decodeVideoFramesStream(
    videoPath,
    (frame) => {
      throwIfAborted(signal);
      const sourceFrame = convertImageToSourceFrame(
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
        frame: sourceFrame,
      });
    },
    signal,
  );
  throwIfAborted(signal);

  if (!decoded || frames.length === 0) {
    return undefined;
  }

  return {
    kind: 'video',
    frames,
  };
}

async function resolveMediaPath(baseDir: string, mediaPath: string, signal?: AbortSignal): Promise<string | undefined> {
  return resolveFirstExistingPath(baseDir, createMediaPathCandidates(mediaPath), signal);
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
  const bitsPerPixel = readBmpBitsPerPixel(buffer);
  if (bitsPerPixel <= 8) {
    return decodeIndexedBmp(buffer, bitsPerPixel);
  }

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

function readBmpBitsPerPixel(buffer: Buffer): number {
  if (buffer.length < 30) {
    throw new Error('invalid bmp header');
  }
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (dibHeaderSize === 12) {
    if (buffer.length < 26) {
      throw new Error('invalid bmp core header');
    }
    return buffer.readUInt16LE(24);
  }
  return buffer.readUInt16LE(28);
}

function decodeIndexedBmp(buffer: Buffer, bitsPerPixel: number): DecodedImage {
  if (bitsPerPixel !== 1 && bitsPerPixel !== 4 && bitsPerPixel !== 8) {
    throw new Error(`unsupported indexed bmp bit depth: ${bitsPerPixel}`);
  }

  const pixelDataOffset = buffer.readUInt32LE(10);
  const dibHeaderSize = buffer.readUInt32LE(14);
  const width = dibHeaderSize === 12 ? buffer.readUInt16LE(18) : buffer.readInt32LE(18);
  const rawHeight = dibHeaderSize === 12 ? buffer.readUInt16LE(20) : buffer.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const topDown = dibHeaderSize === 12 ? false : rawHeight < 0;
  if (width <= 0 || height <= 0) {
    throw new Error('invalid bmp dimensions');
  }

  const colorsUsed = dibHeaderSize >= 40 ? buffer.readUInt32LE(46) : 0;
  const paletteEntryCount = colorsUsed > 0 ? colorsUsed : 1 << bitsPerPixel;
  const paletteOffset = 14 + dibHeaderSize;
  const paletteEntrySize = dibHeaderSize === 12 ? 3 : 4;
  const palette: Array<[r: number, g: number, b: number, a: number]> = [];
  for (let index = 0; index < paletteEntryCount; index += 1) {
    const offset = paletteOffset + index * paletteEntrySize;
    if (offset + paletteEntrySize - 1 >= buffer.length) {
      break;
    }
    const b = buffer[offset] ?? 0;
    const g = buffer[offset + 1] ?? 0;
    const r = buffer[offset + 2] ?? 0;
    const a = paletteEntrySize >= 4 ? (buffer[offset + 3] ?? 255) : 255;
    palette.push([r, g, b, a]);
  }
  if (palette.length === 0) {
    throw new Error('bmp palette not found');
  }

  const rowStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const rowOffset = pixelDataOffset + sourceY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const paletteIndex = readIndexedBmpPaletteIndex(buffer, rowOffset, x, bitsPerPixel);
      const color = palette[paletteIndex] ?? [0, 0, 0, 255];
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = color[0];
      rgba[targetOffset + 1] = color[1];
      rgba[targetOffset + 2] = color[2];
      rgba[targetOffset + 3] = color[3];
    }
  }

  return {
    width,
    height,
    data: rgba,
    format: 'bmp',
  };
}

function readIndexedBmpPaletteIndex(buffer: Buffer, rowOffset: number, x: number, bitsPerPixel: number): number {
  if (bitsPerPixel === 8) {
    return buffer[rowOffset + x] ?? 0;
  }

  const byteOffset = rowOffset + Math.floor((x * bitsPerPixel) / 8);
  const byte = buffer[byteOffset] ?? 0;
  if (bitsPerPixel === 4) {
    return x % 2 === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
  }

  // bitsPerPixel === 1
  const bit = 7 - (x % 8);
  return (byte >> bit) & 0x01;
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
    rgba[targetOffset + 3] = safeChannels >= 4 ? toByte(data[sourceOffset + 3] ?? sampleMax, sampleMax) : 255;
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
  const fittedSize =
    image.format === 'video'
      ? {
          width: SPEC_BGA_CANVAS_SIZE,
          height: SPEC_BGA_CANVAS_SIZE,
        }
      : fitSizeWithinSpecCanvas(image.width, image.height);
  const offsetX = image.format === 'video' ? 0 : Math.floor((SPEC_BGA_CANVAS_SIZE - fittedSize.width) / 2);
  const offsetY = 0;

  for (let targetYWithinImage = 0; targetYWithinImage < fittedSize.height; targetYWithinImage += 1) {
    const sourceY = Math.min(
      image.height - 1,
      Math.max(0, Math.floor(((targetYWithinImage + 0.5) * image.height) / fittedSize.height)),
    );
    const targetY = targetYWithinImage + offsetY;
    if (targetY < 0 || targetY >= SPEC_BGA_CANVAS_SIZE) {
      continue;
    }

    for (let targetXWithinImage = 0; targetXWithinImage < fittedSize.width; targetXWithinImage += 1) {
      const sourceX = Math.min(
        image.width - 1,
        Math.max(0, Math.floor(((targetXWithinImage + 0.5) * image.width) / fittedSize.width)),
      );
      const targetX = targetXWithinImage + offsetX;
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

function convertImageToSourceFrame(image: DecodedImage, mode: FrameMode): AnsiFrame {
  const safeWidth = Math.max(1, Math.floor(image.width));
  const safeHeight = Math.max(1, Math.floor(image.height));
  const sourceFrame = createSolidAnsiFrame(safeWidth, safeHeight, 0, 0, 0, 0);

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const sourceOffset = (y * safeWidth + x) * 4;
      const r = image.data[sourceOffset] ?? 0;
      const g = image.data[sourceOffset + 1] ?? 0;
      const b = image.data[sourceOffset + 2] ?? 0;
      const a = image.data[sourceOffset + 3] ?? 255;
      if (!isOpaquePixel(r, g, b, a, image.format, mode)) {
        continue;
      }

      const targetPixelOffset = y * safeWidth + x;
      const targetRgbOffset = targetPixelOffset * 3;
      sourceFrame.rgb[targetRgbOffset] = r;
      sourceFrame.rgb[targetRgbOffset + 1] = g;
      sourceFrame.rgb[targetRgbOffset + 2] = b;
      sourceFrame.opaqueMask[targetPixelOffset] = 1;
    }
  }

  return sourceFrame;
}

function fitSizeWithinSpecCanvas(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, Math.floor(sourceWidth));
  const safeSourceHeight = Math.max(1, Math.floor(sourceHeight));
  const widthScale = SPEC_BGA_CANVAS_SIZE / safeSourceWidth;
  const heightScale = SPEC_BGA_CANVAS_SIZE / safeSourceHeight;
  const scale = Math.min(1, widthScale, heightScale);
  return {
    width: Math.max(1, Math.floor(safeSourceWidth * scale)),
    height: Math.max(1, Math.floor(safeSourceHeight * scale)),
  };
}

function resizeAnsiFrame(source: AnsiFrame, maxWidth: number, maxHeight: number): AnsiFrame {
  return resizeAnsiFrameWithAspect(source, maxWidth, maxHeight, TERMINAL_PIXEL_ASPECT_X, TERMINAL_PIXEL_ASPECT_Y);
}

function resizeAnsiFrameWithAspect(
  source: AnsiFrame,
  maxWidth: number,
  maxHeight: number,
  aspectX: number,
  aspectY: number,
): AnsiFrame {
  const canvasWidth = Math.max(1, maxWidth);
  const canvasHeight = Math.max(1, maxHeight);
  if (source.width === canvasWidth && source.height === canvasHeight && aspectX === 1 && aspectY === 1) {
    return source;
  }
  const fitted = fitSizeKeepingAspect(
    source.width * Math.max(1, aspectX),
    source.height * Math.max(1, aspectY),
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
