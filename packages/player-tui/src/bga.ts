import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { extname } from 'node:path';
import { isAbortError, runWithConcurrency, throwIfAborted } from '@be-music/utils/core';
import { resolveFirstExistingPath } from '@be-music/utils/path';
import type { BeMusicJson } from '@be-music/json';
import { resolveChart } from '@be-music/chart';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS, pickActiveBgaCue, type BgaCue } from '@be-music/player/core/bga-timeline';
import { decodeVideoFramesStream, decodeVideoFramesToSourceFramesInWorker } from './bga-video.ts';
import { DEFAULT_IMAGE_RESIZE_ALGORITHM, type ImageResizeAlgorithm } from '@be-music/player/image-resize-algorithm';
import { decodeImageBuffer } from './bga-image.ts';
import {
  TERMINAL_PIXEL_ASPECT_X,
  TERMINAL_PIXEL_ASPECT_Y,
  type FrameMode,
  type AnsiFrame,
  convertImageToSpecFrameOffThread,
  createMissingSourceFrame,
  createSolidAnsiFrame,
  convertImageToSourceFrame,
  resizeAnsiFrame,
  resizeAnsiFrameWithAspectMode,
} from './bga-frame.ts';

const MAX_NORMAL_BGA_COMPOSITE_LAYERS = 3;
const DEFAULT_BGA_ASCII_WIDTH = 34;
const DEFAULT_BGA_ASCII_HEIGHT = 20;
const KITTY_GRAPHICS_PIXEL_SCALE = 4;
const ANSI_RESET = '\u001b[0m';
const BGA_SOURCE_LOAD_CONCURRENCY = Math.max(1, Math.min(8, availableParallelism()));

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
  ensureStreaming?: () => void;
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
  imageResizeAlgorithm?: ImageResizeAlgorithm;
  videoBgaStreaming?: boolean;
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
    imageResizeAlgorithm: options.imageResizeAlgorithm,
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

  private readonly resizeAlgorithm: ImageResizeAlgorithm;

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

  /**
   * LR2 negative-BPM reversal: its event pump stops firing BGA cues there, so cue selection never looks past this
   * chart time. Elapsed time inside a cue (a movie that is already playing) and the POOR window stay on the true
   * clock. `+Infinity` when the chart has no reversal.
   */
  private readonly cueFreezeSeconds: number;

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
    /** Chart time at which BGA cues stop changing (the LR2 negative-BPM reversal). Defaults to never. */
    cueFreezeSeconds?: number;
    width: number;
    height: number;
    resizeAlgorithm: ImageResizeAlgorithm;
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
    this.cueFreezeSeconds = params.cueFreezeSeconds ?? Number.POSITIVE_INFINITY;
    this.displayWidth = params.width;
    this.displayHeight = params.height;
    this.resizeAlgorithm = params.resizeAlgorithm;
    this.blackBackgroundLines = [];
    this.missingBaseFrame = resizeAnsiFrame(
      this.missingBaseSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingPoorFrame = resizeAnsiFrame(
      this.missingPoorSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingLayerFrame = resizeAnsiFrame(
      this.missingLayerSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
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

  startStreaming(): void {
    const seen = new Set<FrameSource>();
    startStreamingFrameSourceMap(this.baseSourceFramesByKey, seen);
    startStreamingFrameSourceMap(this.poorSourceFramesByKey, seen);
    startStreamingFrameSourceMap(this.layerSourceFramesByKey, seen);
    startStreamingFrameSourceMap(this.layer2SourceFramesByKey, seen);
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
        ? mergeCompositeFrames(resizeAnsiFrame(poorSelection.frame, pixelWidth, pixelHeight, this.resizeAlgorithm))
        : mergeCompositeFrames(
            ...[baseSelection.frame, layerSelection.frame, layer2Selection.frame]
              .slice(0, MAX_NORMAL_BGA_COMPOSITE_LAYERS)
              .map((frame) =>
                frame ? resizeAnsiFrame(frame, pixelWidth, pixelHeight, this.resizeAlgorithm) : undefined,
              ),
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
    this.baseFramesByKey = resizeFrameSourceMap(
      this.baseSourceFramesByKey,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.poorFramesByKey = resizeFrameSourceMap(
      this.poorSourceFramesByKey,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.layerFramesByKey = resizeFrameSourceMap(
      this.layerSourceFramesByKey,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.layer2FramesByKey = resizeFrameSourceMap(
      this.layer2SourceFramesByKey,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingBaseFrame = resizeAnsiFrame(
      this.missingBaseSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingPoorFrame = resizeAnsiFrame(
      this.missingPoorSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingLayerFrame = resizeAnsiFrame(
      this.missingLayerSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
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
    const cueSeconds = Math.min(currentSeconds, this.cueFreezeSeconds);
    const baseCue = pickActiveBgaCue(this.baseTimeline, cueSeconds);
    const layerCue = pickActiveBgaCue(this.layerTimeline, cueSeconds);
    const layer2Cue = pickActiveBgaCue(this.layer2Timeline, cueSeconds);
    const poorCue = pickActiveBgaCue(this.poorTimeline, cueSeconds);
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
  const resizeAlgorithm = options.imageResizeAlgorithm ?? DEFAULT_IMAGE_RESIZE_ALGORITHM;
  const resolved = resolveChart(json);
  const { base: baseTimeline, poor: poorTimeline, layer: layerTimeline, layer2: layer2Timeline } = resolved.bga;

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
  // bmson 1.0.0 spec — layer images "will not have black pixels made transparent", unlike BMS `#xxx07`. Pick the
  // spec-aware overlay mode for bmson charts so the layer compositor skips the black chroma-key while still honoring
  // the PNG alpha channel. BMS / json sources stay on the historical `'layer'` mode.
  const layerMode: FrameMode = json.sourceFormat === 'bmson' ? 'bmson-layer' : 'layer';
  const [baseSourceFramesByKey, poorSourceFramesByKey, layerSourceFramesByKey, layer2SourceFramesByKey] =
    await Promise.all([
      loadFramesByKeys({
        keys: baseKeys,
        resources: json.resources.bmp,
        baseDir: options.baseDir,
        mode: 'base',
        width: displaySize.width,
        height: displaySize.height,
        imageResizeAlgorithm: resizeAlgorithm,
        videoBgaStreaming: options.videoBgaStreaming,
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
        imageResizeAlgorithm: resizeAlgorithm,
        videoBgaStreaming: options.videoBgaStreaming,
        onLoadProgress: reportLoadProgress,
        signal: options.signal,
        sharedSourceCache,
      }),
      loadFramesByKeys({
        keys: layerKeys,
        resources: json.resources.bmp,
        baseDir: options.baseDir,
        mode: layerMode,
        width: displaySize.width,
        height: displaySize.height,
        imageResizeAlgorithm: resizeAlgorithm,
        videoBgaStreaming: options.videoBgaStreaming,
        onLoadProgress: reportLoadProgress,
        signal: options.signal,
        sharedSourceCache,
      }),
      loadFramesByKeys({
        keys: layer2Keys,
        resources: json.resources.bmp,
        baseDir: options.baseDir,
        mode: layerMode,
        width: displaySize.width,
        height: displaySize.height,
        imageResizeAlgorithm: resizeAlgorithm,
        videoBgaStreaming: options.videoBgaStreaming,
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
    // BGA cues on the LR2 reversal tick still fire (ops 4/6/7 precede the negative BPM's op 8); later ones never do.
    cueFreezeSeconds: resolved.reversal?.seconds,
    width: displaySize.width,
    height: displaySize.height,
    resizeAlgorithm,
  });
}

async function loadFramesByKeys(params: {
  keys: ReadonlySet<string>;
  resources: Record<string, string>;
  baseDir: string;
  mode: FrameMode;
  width: number;
  height: number;
  imageResizeAlgorithm: ImageResizeAlgorithm;
  videoBgaStreaming?: boolean;
  onLoadProgress?: (detail: string) => void;
  signal?: AbortSignal;
  sharedSourceCache: FrameSourceLoadCache;
}): Promise<Map<string, FrameSource>> {
  const {
    keys,
    resources,
    baseDir,
    mode,
    width,
    height,
    imageResizeAlgorithm,
    videoBgaStreaming,
    onLoadProgress,
    signal,
    sharedSourceCache,
  } = params;
  const map = new Map<string, FrameSource>();
  const orderedKeys = [...keys];
  await runWithConcurrency(
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

      const cacheKey =
        `${mode}:${width}x${height}:${imageResizeAlgorithm}:` +
        `${videoBgaStreaming === false ? 'full' : 'stream'}:${resolved}`;
      let sourcePromise = sharedSourceCache.get(cacheKey);
      if (!sourcePromise) {
        sourcePromise = loadFrameSource(
          resolved,
          mode,
          width,
          height,
          imageResizeAlgorithm,
          videoBgaStreaming,
          signal,
        ).then((source) => source ?? null);
        sharedSourceCache.set(cacheKey, sourcePromise);
      }

      const source = await sourcePromise;
      if (source) {
        map.set(key, source);
      }
      onLoadProgress?.(resourcePath);
    },
    { signal },
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

function resizeFrameSourceMap(
  sourceMap: Map<string, FrameSource>,
  width: number,
  height: number,
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): Map<string, FrameSource> {
  const map = new Map<string, FrameSource>();
  const cache = new WeakMap<FrameSource, FrameSource>();
  for (const [key, source] of sourceMap) {
    let resized = cache.get(source);
    if (!resized) {
      resized = resizeFrameSource(source, width, height, resizeAlgorithm);
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
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
  aspectX = TERMINAL_PIXEL_ASPECT_X,
  aspectY = TERMINAL_PIXEL_ASPECT_Y,
): TerminalKittyImage | undefined {
  const pixelWidth = Math.max(1, Math.floor(cellWidth) * KITTY_GRAPHICS_PIXEL_SCALE);
  const pixelHeight = Math.max(1, Math.floor(cellHeight) * KITTY_GRAPHICS_PIXEL_SCALE);
  const resizedSource = resizeFrameSourceWithAspectMode(
    source,
    pixelWidth,
    pixelHeight,
    aspectX,
    aspectY,
    fitMode,
    resizeAlgorithm,
  );
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

function resizeFrameSource(
  source: FrameSource,
  width: number,
  height: number,
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): FrameSource {
  return resizeFrameSourceWithAspectMode(
    source,
    width,
    height,
    TERMINAL_PIXEL_ASPECT_X,
    TERMINAL_PIXEL_ASPECT_Y,
    'contain',
    resizeAlgorithm,
  );
}

function resizeFrameSourceCover(
  source: FrameSource,
  width: number,
  height: number,
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): FrameSource {
  return resizeFrameSourceWithAspectMode(
    source,
    width,
    height,
    TERMINAL_PIXEL_ASPECT_X,
    TERMINAL_PIXEL_ASPECT_Y,
    'cover',
    resizeAlgorithm,
  );
}

function resizeFrameSourceWithAspectMode(
  source: FrameSource,
  width: number,
  height: number,
  aspectX: number,
  aspectY: number,
  mode: 'contain' | 'cover',
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): FrameSource {
  if (source.kind === 'static') {
    return {
      kind: 'static',
      frame: resizeAnsiFrameWithAspectMode(source.frame, width, height, aspectX, aspectY, mode, resizeAlgorithm),
    };
  }

  const resizedFrames: TimedAnsiFrame[] = [];
  return {
    kind: 'video',
    get durationSeconds() {
      return source.durationSeconds;
    },
    ensureStreaming: () => {
      source.ensureStreaming?.();
    },
    get frames() {
      for (let index = resizedFrames.length; index < source.frames.length; index += 1) {
        const entry = source.frames[index]!;
        resizedFrames.push({
          seconds: entry.seconds,
          frame: resizeAnsiFrameWithAspectMode(entry.frame, width, height, aspectX, aspectY, mode, resizeAlgorithm),
        });
      }
      return resizedFrames;
    },
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
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
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
    return await convertImageToSpecFrameOffThread(decoded, mode, resizeAlgorithm, signal);
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

async function loadFrameSource(
  resourcePath: string,
  mode: FrameMode,
  _width: number,
  _height: number,
  imageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
  videoBgaStreaming = true,
  signal?: AbortSignal,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const imageFrame = await loadImageAsSpecFrame(resourcePath, mode, imageResizeAlgorithm, signal);
  if (imageFrame) {
    return createStaticFrameSource(imageFrame);
  }

  return loadVideoAsFrameSource(resourcePath, mode, videoBgaStreaming, signal);
}

async function loadTerminalAnsiImageInternal(
  baseDir: string,
  mediaPath: string,
  options: TerminalAnsiImageOptions = {},
): Promise<{ image: TerminalAnsiImage; sourceFrame: FrameSource } | undefined> {
  throwIfAborted(options.signal);
  const displaySize = normalizeTerminalImageDisplaySize(options.width, options.height);
  const resizeAlgorithm = options.imageResizeAlgorithm ?? DEFAULT_IMAGE_RESIZE_ALGORITHM;
  const sourceFrame = await loadTerminalImageSourceFrame(baseDir, mediaPath, options.signal);
  if (!sourceFrame) {
    return undefined;
  }

  const resizedSource =
    options.fitMode === 'cover'
      ? resizeFrameSourceCover(sourceFrame, displaySize.width, displaySize.height, resizeAlgorithm)
      : resizeFrameSource(sourceFrame, displaySize.width, displaySize.height, resizeAlgorithm);
  const selected = selectFrameFromSource(resizedSource, 0);
  if (!selected.frame) {
    return undefined;
  }
  const outputFrame = options.fitMode === 'cover' ? selected.frame : cropAnsiFrameToOpaqueBounds(selected.frame);
  const filledFrame = fillAnsiFrameBackground(outputFrame, 0, 0, 0);
  const kittyImage = options.includeKittyImage
    ? options.fitMode === 'cover'
      ? buildTerminalKittyImage(sourceFrame, displaySize.width, displaySize.height, 'cover', resizeAlgorithm)
      : buildTerminalKittyImage(sourceFrame, filledFrame.width, filledFrame.height, 'contain', resizeAlgorithm)
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
  videoBgaStreaming = true,
  signal?: AbortSignal,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const frames: TimedAnsiFrame[] = [];
  const source: VideoFrameSource = {
    kind: 'video',
    frames,
    durationSeconds: undefined,
  };

  let settleFirstFrame: ((hasFrame: boolean) => void) | undefined;
  let rejectFirstFrame: ((error: unknown) => void) | undefined;
  let firstFrameSettled = false;
  const firstFramePromise = new Promise<boolean>((resolve, reject) => {
    settleFirstFrame = resolve;
    rejectFirstFrame = reject;
  });

  const settleHasFirstFrame = (hasFrame: boolean): void => {
    if (firstFrameSettled) {
      return;
    }
    firstFrameSettled = true;
    settleFirstFrame?.(hasFrame);
  };

  const appendFrame = (frame: { seconds: number; width: number; height: number; rgba: Uint8Array }): void => {
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
  };

  if (!videoBgaStreaming) {
    const decoded = await decodeVideoFramesStream(
      videoPath,
      (frame) => {
        appendFrame(frame);
      },
      signal,
      {
        onReady: (info) => {
          source.durationSeconds = info.durationSeconds;
        },
      },
    );
    if (decoded) {
      source.durationSeconds = decoded.durationSeconds;
    }
    throwIfAborted(signal);
    return frames.length > 0 ? source : undefined;
  }

  void decodeVideoFramesStream(
    videoPath,
    (frame) => {
      appendFrame(frame);
      settleHasFirstFrame(true);
    },
    signal,
    {
      onReady: (info) => {
        source.durationSeconds = info.durationSeconds;
      },
      stopAfterFirstFrame: true,
    },
  )
    .then((decoded) => {
      if (decoded) {
        source.durationSeconds = decoded.durationSeconds;
      }
      settleHasFirstFrame(frames.length > 0);
    })
    .catch((error) => {
      if (isAbortError(error)) {
        if (!firstFrameSettled) {
          firstFrameSettled = true;
          rejectFirstFrame?.(error);
        }
        return;
      }
      settleHasFirstFrame(false);
    });

  const hasFirstFrame = await firstFramePromise;
  throwIfAborted(signal);
  if (!hasFirstFrame) {
    return undefined;
  }

  let streamingStarted = false;
  source.ensureStreaming = () => {
    if (streamingStarted) {
      return;
    }
    streamingStarted = true;
    void (async () => {
      let skipFrameCount = frames.length;
      try {
        throwIfAborted(signal);
        const decoded = await decodeVideoFramesToSourceFramesInWorker(
          videoPath,
          mode,
          (frame) => {
            if (skipFrameCount > 0) {
              skipFrameCount -= 1;
              return;
            }
            frames.push({
              seconds: frame.seconds,
              frame: {
                width: frame.width,
                height: frame.height,
                rgb: frame.rgb,
                opaqueMask: frame.opaqueMask,
              },
            });
          },
          signal,
          {
            onReady: (info) => {
              source.durationSeconds = info.durationSeconds;
            },
          },
        );
        if (decoded) {
          source.durationSeconds = decoded.durationSeconds;
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
      }
    })();
  };

  return source;
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
  return loadVideoAsFrameSource(resolved, 'base', true, signal);
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

function startStreamingFrameSourceMap(sourceMap: ReadonlyMap<string, FrameSource>, seen: Set<FrameSource>): void {
  for (const source of sourceMap.values()) {
    startStreamingFrameSource(source, seen);
  }
}

function startStreamingFrameSource(source: FrameSource | undefined, seen: Set<FrameSource>): void {
  if (!source || source.kind === 'static' || seen.has(source)) {
    return;
  }
  seen.add(source);
  source.ensureStreaming?.();
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
