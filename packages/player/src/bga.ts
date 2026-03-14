import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { extname } from 'node:path';
import {
  invokeWorkerizedFunction,
  isAbortError,
  resolveFirstExistingPath,
  throwIfAborted,
  workerize,
} from '@be-music/utils';
import { sortEvents } from '@be-music/chart';
import { normalizeChannel, normalizeObjectKey, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
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
const KITTY_GRAPHICS_PIXEL_SCALE = 4;
const TRANSPARENT_ALPHA_THRESHOLD = 16;
const VIDEO_BLACK_BORDER_THRESHOLD = 8;
const ANSI_RESET = '\u001b[0m';
const SPEC_BGA_CANVAS_SIZE = 256;
const TERMINAL_PIXEL_ASPECT_X = 2;
const TERMINAL_PIXEL_ASPECT_Y = 1;
const BGA_SOURCE_LOAD_CONCURRENCY = Math.max(1, Math.min(8, availableParallelism()));

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
  durationSeconds?: number;
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

interface TerminalAnsiImageOptions extends Omit<BgaAnsiOptions, 'baseDir' | 'onLoadProgress'> {
  fitMode?: 'contain' | 'cover';
  includeKittyImage?: boolean;
}

export interface TerminalAnsiImage {
  width: number;
  height: number;
  rgb: Uint8Array;
  lines: string[];
  kittyImage?: TerminalKittyImage;
}

export interface TerminalKittyImage {
  pixelWidth: number;
  pixelHeight: number;
  cellWidth: number;
  cellHeight: number;
  rgb: Uint8Array;
}

export type StageFileAnsiImage = TerminalAnsiImage;
export type StageFileKittyImage = TerminalKittyImage;

type FrameSourceLoadCache = Map<string, Promise<FrameSource | null>>;

export interface BgaKittyImage {
  pixelWidth: number;
  pixelHeight: number;
  cellWidth: number;
  cellHeight: number;
  rgb: Uint8Array;
  token: string;
}

export async function loadTerminalAnsiImage(
  baseDir: string,
  mediaPath: string,
  options: TerminalAnsiImageOptions = {},
): Promise<TerminalAnsiImage | undefined> {
  const loaded = await loadTerminalAnsiImageInternal(baseDir, mediaPath, options);
  return loaded?.image;
}

export async function loadStageFileAnsiImage(
  json: BeMusicJson,
  options: Omit<BgaAnsiOptions, 'onLoadProgress'>,
): Promise<StageFileAnsiImage | undefined> {
  const stageFile = json.metadata.stageFile;
  if (typeof stageFile !== 'string' || stageFile.length === 0) {
    return undefined;
  }

  throwIfAborted(options.signal);
  const displaySize = normalizeDisplaySize(options.width, options.height);
  const loaded = await loadTerminalAnsiImageInternal(options.baseDir, stageFile, {
    width: displaySize.width,
    height: displaySize.height,
    signal: options.signal,
    fitMode: 'cover',
    includeKittyImage: true,
  });
  return loaded?.image;
}

export async function loadStageFileAnsiLines(
  json: BeMusicJson,
  options: Omit<BgaAnsiOptions, 'onLoadProgress'>,
): Promise<string[] | undefined> {
  return (await loadStageFileAnsiImage(json, options))?.lines;
}

export class BgaAnsiRenderer {
  readonly playbackEndSeconds: number;

  private readonly baseTimeline: BgaCue[];

  private readonly poorTimeline: BgaCue[];

  private readonly layerTimeline: BgaCue[];

  private readonly layer2Timeline: BgaCue[];

  private readonly baseSourceFramesByKey: Map<string, FrameSource>;

  private readonly poorSourceFramesByKey: Map<string, FrameSource>;

  private readonly layerSourceFramesByKey: Map<string, FrameSource>;

  private readonly layer2SourceFramesByKey: Map<string, FrameSource>;

  private readonly missingBaseSourceFrame: AnsiFrame;

  private readonly missingPoorSourceFrame: AnsiFrame;

  private readonly missingLayerSourceFrame: AnsiFrame;

  private readonly poorFallbackKey?: string;

  private readonly poorFallbackUntilSeconds: number;

  private baseFramesByKey = new Map<string, FrameSource>();

  private poorFramesByKey = new Map<string, FrameSource>();

  private layerFramesByKey = new Map<string, FrameSource>();

  private layer2FramesByKey = new Map<string, FrameSource>();

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

  private cachedKittyImage?: BgaKittyImage;

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
    missingBaseSourceFrame: AnsiFrame;
    missingPoorSourceFrame: AnsiFrame;
    missingLayerSourceFrame: AnsiFrame;
    poorFallbackKey?: string;
    poorFallbackUntilSeconds: number;
    playbackEndSeconds: number;
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
    this.missingBaseSourceFrame = params.missingBaseSourceFrame;
    this.missingPoorSourceFrame = params.missingPoorSourceFrame;
    this.missingLayerSourceFrame = params.missingLayerSourceFrame;
    this.poorFallbackKey = params.poorFallbackKey;
    this.poorFallbackUntilSeconds = params.poorFallbackUntilSeconds;
    this.playbackEndSeconds = params.playbackEndSeconds;
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
    this.cachedKittyImage = undefined;
  }

  clearPoor(): void {
    if (this.poorActiveUntilSeconds === Number.NEGATIVE_INFINITY) {
      return;
    }
    this.poorActiveUntilSeconds = Number.NEGATIVE_INFINITY;
    this.cachedPoorActive = false;
    this.cachedComposite = undefined;
    this.cachedLines = undefined;
    this.cachedKittyImage = undefined;
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

  getKittyImage(currentSeconds: number): BgaKittyImage {
    const state = this.resolveActiveState(currentSeconds);
    const pixelWidth = Math.max(1, this.displayWidth * KITTY_GRAPHICS_PIXEL_SCALE);
    const pixelHeight = Math.max(1, this.displayHeight * KITTY_GRAPHICS_PIXEL_SCALE);
    const baseSelection = resolveFrameSelection(
      this.baseSourceFramesByKey,
      this.missingBaseSourceFrame,
      state.baseKey,
      state.baseSeconds,
    );
    const layerSelection = resolveFrameSelection(
      this.layerSourceFramesByKey,
      this.missingLayerSourceFrame,
      state.layerKey,
      state.layerSeconds,
    );
    const layer2Selection = resolveFrameSelection(
      this.layer2SourceFramesByKey,
      this.missingLayerSourceFrame,
      state.layer2Key,
      state.layer2Seconds,
    );
    const poorSelection = state.poorActive
      ? resolveFrameSelection(this.poorSourceFramesByKey, this.missingPoorSourceFrame, state.poorKey, state.poorSeconds)
      : { frame: undefined, index: -1 };
    const token =
      `${pixelWidth}x${pixelHeight}:` +
      `${state.baseKey}:${baseSelection.index}:` +
      `${state.layerKey}:${layerSelection.index}:` +
      `${state.layer2Key}:${layer2Selection.index}:` +
      `${state.poorActive ? '1' : '0'}:${state.poorKey}:${poorSelection.index}`;
    if (this.cachedKittyImage?.token === token) {
      return this.cachedKittyImage;
    }

    const composite =
      state.poorActive && poorSelection.frame
        ? mergeCompositeFrames(resizeAnsiFrame(poorSelection.frame, pixelWidth, pixelHeight))
        : mergeCompositeFrames(
            ...[baseSelection.frame, layerSelection.frame, layer2Selection.frame]
              .slice(0, MAX_NORMAL_BGA_COMPOSITE_LAYERS)
              .map((frame) => (frame ? resizeAnsiFrame(frame, pixelWidth, pixelHeight) : undefined)),
          );
    const filledFrame = composite
      ? fillAnsiFrameBackground(composite, 0, 0, 0)
      : createSolidAnsiFrame(1, 1, 0, 0, 0, 1);
    const image = {
      pixelWidth: filledFrame.width,
      pixelHeight: filledFrame.height,
      cellWidth: this.displayWidth,
      cellHeight: this.displayHeight,
      rgb: filledFrame.rgb,
      token,
    };
    this.cachedKittyImage = image;
    return image;
  }

  private rebuildFrames(): void {
    this.baseFramesByKey = resizeFrameSourceMap(this.baseSourceFramesByKey, this.displayWidth, this.displayHeight);
    this.poorFramesByKey = resizeFrameSourceMap(this.poorSourceFramesByKey, this.displayWidth, this.displayHeight);
    this.layerFramesByKey = resizeFrameSourceMap(this.layerSourceFramesByKey, this.displayWidth, this.displayHeight);
    this.layer2FramesByKey = resizeFrameSourceMap(this.layer2SourceFramesByKey, this.displayWidth, this.displayHeight);
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
    this.cachedKittyImage = undefined;
  }

  private refreshComposite(currentSeconds: number): void {
    const state = this.resolveActiveState(currentSeconds);
    const baseSelection = this.resolveBaseFrame(state.baseKey, state.baseSeconds);
    const layerSelection = this.resolveLayerFrame(state.layerKey, state.layerSeconds);
    const layer2Selection = this.resolveLayer2Frame(state.layer2Key, state.layer2Seconds);
    const poorSelection = state.poorActive
      ? resolveFrameSelection(this.poorFramesByKey, this.missingPoorFrame, state.poorKey, state.poorSeconds)
      : { frame: undefined, index: -1 };

    if (
      this.cachedBaseKey === state.baseKey &&
      this.cachedLayerKey === state.layerKey &&
      this.cachedLayer2Key === state.layer2Key &&
      this.cachedPoorKey === state.poorKey &&
      this.cachedBaseFrameIndex === baseSelection.index &&
      this.cachedLayerFrameIndex === layerSelection.index &&
      this.cachedLayer2FrameIndex === layer2Selection.index &&
      this.cachedPoorFrameIndex === poorSelection.index &&
      this.cachedPoorActive === state.poorActive
    ) {
      return;
    }

    this.cachedBaseKey = state.baseKey;
    this.cachedLayerKey = state.layerKey;
    this.cachedLayer2Key = state.layer2Key;
    this.cachedPoorKey = state.poorKey;
    this.cachedBaseFrameIndex = baseSelection.index;
    this.cachedLayerFrameIndex = layerSelection.index;
    this.cachedLayer2FrameIndex = layer2Selection.index;
    this.cachedPoorFrameIndex = poorSelection.index;
    this.cachedPoorActive = state.poorActive;
    this.cachedComposite =
      state.poorActive && poorSelection.frame
        ? mergeCompositeFrames(poorSelection.frame)
        : mergeCompositeFrames(
            ...[baseSelection.frame, layerSelection.frame, layer2Selection.frame].slice(
              0,
              MAX_NORMAL_BGA_COMPOSITE_LAYERS,
            ),
          );
    this.cachedLines = undefined;
    this.cachedKittyImage = undefined;
  }

  private resolveActiveState(currentSeconds: number): {
    baseKey: string;
    layerKey: string;
    layer2Key: string;
    poorKey: string;
    baseSeconds: number;
    layerSeconds: number;
    layer2Seconds: number;
    poorSeconds: number;
    poorActive: boolean;
  } {
    const baseCue = findActiveCue(this.baseTimeline, currentSeconds);
    const layerCue = findActiveCue(this.layerTimeline, currentSeconds);
    const layer2Cue = findActiveCue(this.layer2Timeline, currentSeconds);
    const poorCue = findActiveCue(this.poorTimeline, currentSeconds);
    const poorActive = currentSeconds < this.poorActiveUntilSeconds;
    return {
      baseKey: baseCue?.key ?? '',
      layerKey: layerCue?.key ?? '',
      layer2Key: layer2Cue?.key ?? '',
      poorKey: poorActive ? (this.resolvePoorKey(poorCue, currentSeconds) ?? '') : '',
      baseSeconds: baseCue ? Math.max(0, currentSeconds - baseCue.seconds) : Math.max(0, currentSeconds),
      layerSeconds: layerCue ? Math.max(0, currentSeconds - layerCue.seconds) : 0,
      layer2Seconds: layer2Cue ? Math.max(0, currentSeconds - layer2Cue.seconds) : 0,
      poorSeconds: poorCue ? Math.max(0, currentSeconds - poorCue.seconds) : Math.max(0, currentSeconds),
      poorActive,
    };
  }

  private resolveBaseFrame(baseKey: string, seconds: number): FrameSelection {
    return resolveFrameSelection(this.baseFramesByKey, this.missingBaseFrame, baseKey, seconds);
  }

  private resolveLayerFrame(layerKey: string, seconds: number): FrameSelection {
    return resolveFrameSelection(this.layerFramesByKey, this.missingLayerFrame, layerKey, seconds);
  }

  private resolveLayer2Frame(layer2Key: string, seconds: number): FrameSelection {
    return resolveFrameSelection(this.layer2FramesByKey, this.missingLayerFrame, layer2Key, seconds);
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
    countMappedBmpResourceTargets(layer2Keys, json.resources.bmp);
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

  const sharedSourceCache: FrameSourceLoadCache = new Map();
  const [baseSourceFramesByKey, poorSourceFramesByKey, layerSourceFramesByKey, layer2SourceFramesByKey] =
    await Promise.all([
      loadFramesByKeys({
        keys: baseKeys,
        resources: json.resources.bmp,
        baseDir: options.baseDir,
        mode: 'base',
        width: displaySize.width,
        height: displaySize.height,
        onLoadProgress: reportLoadProgress,
        signal: options.signal,
        sharedSourceCache,
      }),
      loadFramesByKeys({
        keys: poorKeys,
        resources: json.resources.bmp,
        baseDir: options.baseDir,
        mode: 'base',
        width: displaySize.width,
        height: displaySize.height,
        onLoadProgress: reportLoadProgress,
        signal: options.signal,
        sharedSourceCache,
      }),
      loadFramesByKeys({
        keys: layerKeys,
        resources: json.resources.bmp,
        baseDir: options.baseDir,
        mode: 'layer',
        width: displaySize.width,
        height: displaySize.height,
        onLoadProgress: reportLoadProgress,
        signal: options.signal,
        sharedSourceCache,
      }),
      loadFramesByKeys({
        keys: layer2Keys,
        resources: json.resources.bmp,
        baseDir: options.baseDir,
        mode: 'layer',
        width: displaySize.width,
        height: displaySize.height,
        onLoadProgress: reportLoadProgress,
        signal: options.signal,
        sharedSourceCache,
      }),
    ]);
  throwIfAborted(options.signal);

  if (
    baseSourceFramesByKey.size === 0 &&
    poorSourceFramesByKey.size === 0 &&
    layerSourceFramesByKey.size === 0 &&
    layer2SourceFramesByKey.size === 0 &&
    baseTimeline.length === 0 &&
    poorTimeline.length === 0 &&
    layerTimeline.length === 0 &&
    layer2Timeline.length === 0
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
    missingBaseSourceFrame,
    missingPoorSourceFrame,
    missingLayerSourceFrame,
    poorFallbackKey,
    poorFallbackUntilSeconds,
    playbackEndSeconds: Math.max(
      resolveTimelinePlaybackEndSeconds(baseTimeline, baseSourceFramesByKey),
      resolveTimelinePlaybackEndSeconds(layerTimeline, layerSourceFramesByKey),
      resolveTimelinePlaybackEndSeconds(layer2Timeline, layer2SourceFramesByKey),
    ),
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
  sharedSourceCache: FrameSourceLoadCache;
}): Promise<Map<string, FrameSource>> {
  const { keys, resources, baseDir, mode, width, height, onLoadProgress, signal, sharedSourceCache } = params;
  const map = new Map<string, FrameSource>();
  const orderedKeys = [...keys];
  await mapWithConcurrency(
    orderedKeys,
    Math.min(orderedKeys.length || 1, BGA_SOURCE_LOAD_CONCURRENCY),
    async (key) => {
      throwIfAborted(signal);
      const resourcePath = resources[key];
      if (!resourcePath) {
        return;
      }
      const resolved = await resolveMediaPath(baseDir, resourcePath, signal);
      if (!resolved) {
        onLoadProgress?.(resourcePath);
        return;
      }

      const cacheKey = `${mode}:${width}x${height}:${resolved}`;
      let sourcePromise = sharedSourceCache.get(cacheKey);
      if (!sourcePromise) {
        sourcePromise = loadFrameSource(resolved, mode, width, height, signal).then((source) => source ?? null);
        sharedSourceCache.set(cacheKey, sourcePromise);
      }

      const source = await sourcePromise;
      if (source) {
        map.set(key, source);
      }
      onLoadProgress?.(resourcePath);
    },
    signal,
  );

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

function normalizeProgressDetail(detail: string): string {
  return detail.replaceAll('\\', '/');
}

function normalizeDisplaySize(width?: number, height?: number): { width: number; height: number } {
  return {
    width: Math.max(8, Math.floor(width ?? DEFAULT_BGA_ASCII_WIDTH)),
    height: Math.max(6, Math.floor(height ?? DEFAULT_BGA_ASCII_HEIGHT)),
  };
}

async function mapWithConcurrency<TInput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        throwIfAborted(signal);
        const currentIndex = nextIndex;
        if (currentIndex >= items.length) {
          return;
        }
        nextIndex += 1;
        await worker(items[currentIndex]!, currentIndex);
      }
    }),
  );
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

function resolveFrameSelection(
  sourceFramesByKey: ReadonlyMap<string, FrameSource>,
  missingFrame: AnsiFrame,
  key: string,
  seconds: number,
): FrameSelection {
  if (!key) {
    return {
      frame: undefined,
      index: -1,
    };
  }
  const source = sourceFramesByKey.get(key) ?? createStaticFrameSource(missingFrame);
  return selectFrameFromSource(source, seconds);
}

function buildTerminalKittyImage(
  source: FrameSource,
  cellWidth: number,
  cellHeight: number,
  fitMode: 'contain' | 'cover',
  aspectX = TERMINAL_PIXEL_ASPECT_X,
  aspectY = TERMINAL_PIXEL_ASPECT_Y,
): TerminalKittyImage | undefined {
  const pixelWidth = Math.max(1, Math.floor(cellWidth) * KITTY_GRAPHICS_PIXEL_SCALE);
  const pixelHeight = Math.max(1, Math.floor(cellHeight) * KITTY_GRAPHICS_PIXEL_SCALE);
  const resizedSource = resizeFrameSourceWithAspectMode(source, pixelWidth, pixelHeight, aspectX, aspectY, fitMode);
  const frame = selectFrameFromSource(resizedSource, 0).frame;
  if (!frame) {
    return undefined;
  }
  const filledFrame = fillAnsiFrameBackground(frame, 0, 0, 0);
  return {
    pixelWidth: filledFrame.width,
    pixelHeight: filledFrame.height,
    cellWidth: Math.max(1, Math.floor(cellWidth)),
    cellHeight: Math.max(1, Math.floor(cellHeight)),
    rgb: filledFrame.rgb,
  };
}

function fillFrameSourceBackground(source: FrameSource, r: number, g: number, b: number): FrameSource {
  if (source.kind === 'static') {
    return createStaticFrameSource(fillAnsiFrameBackground(source.frame, r, g, b));
  }
  return {
    kind: 'video',
    durationSeconds: source.durationSeconds,
    frames: source.frames.map((entry) => ({
      seconds: entry.seconds,
      frame: fillAnsiFrameBackground(entry.frame, r, g, b),
    })),
  };
}

function resizeFrameSource(source: FrameSource, width: number, height: number): FrameSource {
  return resizeFrameSourceWithAspectMode(
    source,
    width,
    height,
    TERMINAL_PIXEL_ASPECT_X,
    TERMINAL_PIXEL_ASPECT_Y,
    'contain',
  );
}

function resizeFrameSourceCover(source: FrameSource, width: number, height: number): FrameSource {
  return resizeFrameSourceWithAspectMode(
    source,
    width,
    height,
    TERMINAL_PIXEL_ASPECT_X,
    TERMINAL_PIXEL_ASPECT_Y,
    'cover',
  );
}

function resizeFrameSourceWithAspectMode(
  source: FrameSource,
  width: number,
  height: number,
  aspectX: number,
  aspectY: number,
  mode: 'contain' | 'cover',
): FrameSource {
  if (source.kind === 'static') {
    return {
      kind: 'static',
      frame: resizeAnsiFrameWithAspectMode(source.frame, width, height, aspectX, aspectY, mode),
    };
  }

  return {
    kind: 'video',
    durationSeconds: source.durationSeconds,
    frames: source.frames.map((entry) => ({
      seconds: entry.seconds,
      frame: resizeAnsiFrameWithAspectMode(entry.frame, width, height, aspectX, aspectY, mode),
    })),
  };
}

function cropAnsiFrameToOpaqueBounds(source: AnsiFrame): AnsiFrame {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.opaqueMask[y * source.width + x] === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return createSolidAnsiFrame(1, 1, 0, 0, 0, 0);
  }
  if (minX === 0 && minY === 0 && maxX === source.width - 1 && maxY === source.height - 1) {
    return source;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cropped = createSolidAnsiFrame(width, height, 0, 0, 0, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourcePixelOffset = (minY + y) * source.width + (minX + x);
      if (source.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }
      const targetPixelOffset = y * width + x;
      const sourceRgbOffset = sourcePixelOffset * 3;
      const targetRgbOffset = targetPixelOffset * 3;
      cropped.rgb[targetRgbOffset] = source.rgb[sourceRgbOffset] ?? 0;
      cropped.rgb[targetRgbOffset + 1] = source.rgb[sourceRgbOffset + 1] ?? 0;
      cropped.rgb[targetRgbOffset + 2] = source.rgb[sourceRgbOffset + 2] ?? 0;
      cropped.opaqueMask[targetPixelOffset] = 1;
    }
  }

  return cropped;
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
  if (frames.length === 1) {
    return frames[0];
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

function fillAnsiFrameBackground(source: AnsiFrame, r: number, g: number, b: number): AnsiFrame {
  const frame = createSolidAnsiFrame(source.width, source.height, r, g, b, 1);
  for (let pixelOffset = 0; pixelOffset < source.width * source.height; pixelOffset += 1) {
    if (source.opaqueMask[pixelOffset] === 0) {
      continue;
    }
    const rgbOffset = pixelOffset * 3;
    frame.rgb[rgbOffset] = source.rgb[rgbOffset] ?? 0;
    frame.rgb[rgbOffset + 1] = source.rgb[rgbOffset + 1] ?? 0;
    frame.rgb[rgbOffset + 2] = source.rgb[rgbOffset + 2] ?? 0;
  }
  return frame;
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

async function loadImageAsSourceFrame(
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
    return convertImageToSourceFrame(decoded, mode);
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

async function loadTerminalAnsiImageInternal(
  baseDir: string,
  mediaPath: string,
  options: TerminalAnsiImageOptions = {},
): Promise<{ image: TerminalAnsiImage; sourceFrame: FrameSource } | undefined> {
  throwIfAborted(options.signal);
  const displaySize = normalizeTerminalImageDisplaySize(options.width, options.height);
  const sourceFrame = await loadTerminalImageSourceFrame(baseDir, mediaPath, options.signal);
  if (!sourceFrame) {
    return undefined;
  }

  const resizedSource =
    options.fitMode === 'cover'
      ? resizeFrameSourceCover(sourceFrame, displaySize.width, displaySize.height)
      : resizeFrameSource(sourceFrame, displaySize.width, displaySize.height);
  const selected = selectFrameFromSource(resizedSource, 0);
  if (!selected.frame) {
    return undefined;
  }
  const outputFrame = options.fitMode === 'cover' ? selected.frame : cropAnsiFrameToOpaqueBounds(selected.frame);
  const filledFrame = fillAnsiFrameBackground(outputFrame, 0, 0, 0);
  const kittyImage =
    options.includeKittyImage === true
      ? options.fitMode === 'cover'
        ? buildTerminalKittyImage(sourceFrame, displaySize.width, displaySize.height, 'cover')
        : buildTerminalKittyImage(sourceFrame, filledFrame.width, filledFrame.height, 'contain')
      : undefined;
  return {
    sourceFrame,
    image: {
      width: filledFrame.width,
      height: filledFrame.height,
      rgb: filledFrame.rgb,
      lines: composeAnsiLines(filledFrame.rgb, filledFrame.opaqueMask, filledFrame.width, filledFrame.height),
      kittyImage,
    },
  };
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
    durationSeconds: decoded.durationSeconds,
    frames,
  };
}

async function loadTerminalImageSourceFrame(
  baseDir: string,
  mediaPath: string,
  signal?: AbortSignal,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const resolved = await resolveMediaPath(baseDir, mediaPath, signal);
  if (!resolved) {
    return undefined;
  }
  const imageFrame = await loadImageAsSourceFrame(resolved, 'base', signal);
  if (imageFrame) {
    return createStaticFrameSource(imageFrame);
  }
  return loadVideoAsFrameSource(resolved, 'base', signal);
}

function normalizeTerminalImageDisplaySize(width?: number, height?: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(width ?? DEFAULT_BGA_ASCII_WIDTH)),
    height: Math.max(1, Math.floor(height ?? DEFAULT_BGA_ASCII_HEIGHT)),
  };
}

async function resolveMediaPath(baseDir: string, mediaPath: string, signal?: AbortSignal): Promise<string | undefined> {
  return resolveFirstExistingPath(baseDir, createMediaPathCandidates(mediaPath), signal);
}

function resolveTimelinePlaybackEndSeconds(
  timeline: ReadonlyArray<BgaCue>,
  sourcesByKey: ReadonlyMap<string, FrameSource>,
): number {
  const lastCue = timeline.at(-1);
  if (!lastCue) {
    return 0;
  }
  if (!lastCue.key) {
    return lastCue.seconds;
  }
  return lastCue.seconds + resolveFrameSourceDurationSeconds(sourcesByKey.get(lastCue.key));
}

function resolveFrameSourceDurationSeconds(source: FrameSource | undefined): number {
  if (!source || source.kind === 'static') {
    return 0;
  }
  const streamDuration = source.durationSeconds ?? 0;
  const lastFrameSeconds = source.frames.at(-1)?.seconds ?? 0;
  if (source.frames.length < 2) {
    return Math.max(streamDuration, lastFrameSeconds);
  }
  const previousFrameSeconds = source.frames.at(-2)?.seconds ?? 0;
  const estimatedTailSeconds = Math.max(0, lastFrameSeconds - previousFrameSeconds);
  return Math.max(streamDuration, lastFrameSeconds + estimatedTailSeconds);
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

  return image.format === 'video' ? trimBlackVideoFrameBorders(sourceFrame) : sourceFrame;
}

function trimBlackVideoFrameBorders(source: AnsiFrame): AnsiFrame {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const pixelOffset = y * source.width + x;
      if (source.opaqueMask[pixelOffset] === 0) {
        continue;
      }
      const rgbOffset = pixelOffset * 3;
      const r = source.rgb[rgbOffset] ?? 0;
      const g = source.rgb[rgbOffset + 1] ?? 0;
      const b = source.rgb[rgbOffset + 2] ?? 0;
      if (r <= VIDEO_BLACK_BORDER_THRESHOLD && g <= VIDEO_BLACK_BORDER_THRESHOLD && b <= VIDEO_BLACK_BORDER_THRESHOLD) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return source;
  }
  if (minX === 0 && minY === 0 && maxX === source.width - 1 && maxY === source.height - 1) {
    return source;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const trimmed = createSolidAnsiFrame(width, height, 0, 0, 0, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = minX + x;
      const sourceY = minY + y;
      const sourcePixelOffset = sourceY * source.width + sourceX;
      if (source.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }
      const targetPixelOffset = y * width + x;
      const sourceRgbOffset = sourcePixelOffset * 3;
      const targetRgbOffset = targetPixelOffset * 3;
      trimmed.rgb[targetRgbOffset] = source.rgb[sourceRgbOffset] ?? 0;
      trimmed.rgb[targetRgbOffset + 1] = source.rgb[sourceRgbOffset + 1] ?? 0;
      trimmed.rgb[targetRgbOffset + 2] = source.rgb[sourceRgbOffset + 2] ?? 0;
      trimmed.opaqueMask[targetPixelOffset] = 1;
    }
  }

  return trimmed;
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

function resizeAnsiFrameCover(source: AnsiFrame, maxWidth: number, maxHeight: number): AnsiFrame {
  return resizeAnsiFrameWithAspectMode(
    source,
    maxWidth,
    maxHeight,
    TERMINAL_PIXEL_ASPECT_X,
    TERMINAL_PIXEL_ASPECT_Y,
    'cover',
  );
}

function resizeAnsiFrameWithAspect(
  source: AnsiFrame,
  maxWidth: number,
  maxHeight: number,
  aspectX: number,
  aspectY: number,
): AnsiFrame {
  return resizeAnsiFrameWithAspectMode(source, maxWidth, maxHeight, aspectX, aspectY, 'contain');
}

function resizeAnsiFrameWithAspectMode(
  source: AnsiFrame,
  maxWidth: number,
  maxHeight: number,
  aspectX: number,
  aspectY: number,
  mode: 'contain' | 'cover',
): AnsiFrame {
  const canvasWidth = Math.max(1, maxWidth);
  const canvasHeight = Math.max(1, maxHeight);
  if (source.width === canvasWidth && source.height === canvasHeight && aspectX === 1 && aspectY === 1) {
    return source;
  }
  const fitted =
    mode === 'cover'
      ? fitSizeCoveringAspect(
          source.width * Math.max(1, aspectX),
          source.height * Math.max(1, aspectY),
          canvasWidth,
          canvasHeight,
        )
      : fitSizeKeepingAspect(
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

function fitSizeCoveringAspect(
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
  let height = Math.max(1, Math.ceil(width / aspect));

  if (height < safeMaxHeight) {
    height = safeMaxHeight;
    width = Math.max(1, Math.ceil(height * aspect));
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
