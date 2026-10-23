import { availableParallelism } from 'node:os';
import { runWithConcurrency, throwIfAborted } from '@be-music/shared-utils/core';
import type { BeMusicJSON } from '@be-music/chart-source';
import { resolvePoorBGAMode, type PoorBGAMode, resolveChart, type BGACue } from '@be-music/chart-model';
import {
  DEFAULT_IMAGE_RESIZE_ALGORITHM,
  DEFAULT_POOR_BGA_DISPLAY_SECONDS,
  pickActiveBGACue,
  type ImageResizeAlgorithm,
} from '@be-music/player-engine/display';
import {
  TERMINAL_PIXEL_ASPECT_X,
  TERMINAL_PIXEL_ASPECT_Y,
  type FrameMode,
  type ANSIFrame,
  createMissingSourceFrame,
  createSolidANSIFrame,
  resizeANSIFrame,
} from './bga-frame.ts';
import {
  type FrameSource,
  type FrameSelection,
  resizeFrameSourceMap,
  resolveFrameSelection,
  resizeFrameSource,
  resizeFrameSourceCover,
  resizeFrameSourceWithAspectMode,
  selectFrameFromSource,
  resolveTimelinePlaybackEndSeconds,
  startStreamingFrameSourceMap,
} from './bga-frame-source.ts';
import {
  type CompositeFrame,
  cropANSIFrameToOpaqueBounds,
  mergeCompositeFrames,
  fillANSIFrameBackground,
  composeANSILines,
  createBlackBackgroundANSILines,
} from './bga-compose.ts';
import { loadFrameSource, loadTerminalImageSourceFrame, resolveMediaPath } from './bga-media.ts';

const MAX_NORMAL_BGA_COMPOSITE_LAYERS = 3;
const DEFAULT_BGA_ASCII_WIDTH = 34;
const DEFAULT_BGA_ASCII_HEIGHT = 20;
const KITTY_GRAPHICS_PIXEL_SCALE = 4;
const BGA_SOURCE_LOAD_CONCURRENCY = Math.max(1, Math.min(8, availableParallelism()));

export interface BgaANSIOptions {
  baseDir: string;
  width?: number;
  height?: number;
  imageResizeAlgorithm?: ImageResizeAlgorithm;
  videoBGAStreaming?: boolean;
  onLoadProgress?: (progress: BgaANSILoadProgress) => void;
  signal?: AbortSignal;
}

export interface BgaANSILoadProgress {
  ratio: number;
  detail: string;
}

interface TerminalANSIImageOptions extends Omit<BgaANSIOptions, 'baseDir' | 'onLoadProgress'> {
  fitMode?: 'contain' | 'cover';
  includeKittyImage?: boolean;
}

export interface TerminalANSIImage {
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

export type StageFileANSIImage = TerminalANSIImage;
export type StageFileKittyImage = TerminalKittyImage;

type FrameSourceLoadCache = Map<string, Promise<FrameSource | null>>;

export interface BGAKittyImage {
  pixelWidth: number;
  pixelHeight: number;
  cellWidth: number;
  cellHeight: number;
  rgb: Uint8Array;
  token: string;
}

export async function loadTerminalANSIImage(
  baseDir: string,
  mediaPath: string,
  options: TerminalANSIImageOptions = {},
): Promise<TerminalANSIImage | undefined> {
  const loaded = await loadTerminalANSIImageInternal(baseDir, mediaPath, options);
  return loaded?.image;
}

export async function loadStageFileANSIImage(
  json: BeMusicJSON,
  options: Omit<BgaANSIOptions, 'onLoadProgress'>,
): Promise<StageFileANSIImage | undefined> {
  const stageFile = json.metadata.stageFile;
  if (typeof stageFile !== 'string' || stageFile.length === 0) {
    return undefined;
  }

  throwIfAborted(options.signal);
  const displaySize = normalizeDisplaySize(options.width, options.height);
  const loaded = await loadTerminalANSIImageInternal(options.baseDir, stageFile, {
    width: displaySize.width,
    height: displaySize.height,
    imageResizeAlgorithm: options.imageResizeAlgorithm,
    signal: options.signal,
    fitMode: 'cover',
    includeKittyImage: true,
  });
  return loaded?.image;
}

export async function loadStageFileANSILines(
  json: BeMusicJSON,
  options: Omit<BgaANSIOptions, 'onLoadProgress'>,
): Promise<string[] | undefined> {
  return (await loadStageFileANSIImage(json, options))?.lines;
}

export class BgaANSIRenderer {
  readonly playbackEndSeconds: number;

  private readonly baseTimeline: BGACue[];

  private readonly poorTimeline: BGACue[];

  private readonly layerTimeline: BGACue[];

  private readonly layer2Timeline: BGACue[];

  private readonly baseSourceFramesByKey: Map<string, FrameSource>;

  private readonly poorSourceFramesByKey: Map<string, FrameSource>;

  private readonly layerSourceFramesByKey: Map<string, FrameSource>;

  private readonly layer2SourceFramesByKey: Map<string, FrameSource>;

  private readonly missingBaseSourceFrame: ANSIFrame;

  private readonly missingPoorSourceFrame: ANSIFrame;

  private readonly missingLayerSourceFrame: ANSIFrame;

  private readonly poorFallbackKey?: string;

  private readonly poorFallbackUntilSeconds: number;

  private baseFramesByKey = new Map<string, FrameSource>();

  private poorFramesByKey = new Map<string, FrameSource>();

  private layerFramesByKey = new Map<string, FrameSource>();

  private layer2FramesByKey = new Map<string, FrameSource>();

  private missingBaseFrame: ANSIFrame;

  private missingPoorFrame: ANSIFrame;

  private missingLayerFrame: ANSIFrame;

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

  private cachedKittyImage?: BGAKittyImage;

  private blackBackgroundLines: string[];

  private readonly poorBGAMode: PoorBGAMode;
  private poorActiveUntilSeconds = Number.NEGATIVE_INFINITY;

  /**
   * LR2 negative-BPM reversal: its event pump stops firing BGA cues there, so cue selection never looks past this
   * chart time. Elapsed time inside a cue (a movie that is already playing) and the POOR window stay on the true
   * clock. `+Infinity` when the chart has no reversal.
   */
  private readonly cueFreezeSeconds: number;

  constructor(params: {
    baseTimeline: BGACue[];
    poorTimeline: BGACue[];
    layerTimeline: BGACue[];
    layer2Timeline: BGACue[];
    baseSourceFramesByKey: Map<string, FrameSource>;
    poorSourceFramesByKey: Map<string, FrameSource>;
    layerSourceFramesByKey: Map<string, FrameSource>;
    layer2SourceFramesByKey: Map<string, FrameSource>;
    missingBaseSourceFrame: ANSIFrame;
    missingPoorSourceFrame: ANSIFrame;
    missingLayerSourceFrame: ANSIFrame;
    poorBGAMode?: PoorBGAMode;
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
    this.poorBGAMode = params.poorBGAMode ?? 0;
    this.poorFallbackKey = params.poorFallbackKey;
    this.poorFallbackUntilSeconds = params.poorFallbackUntilSeconds;
    this.playbackEndSeconds = params.playbackEndSeconds;
    this.cueFreezeSeconds = params.cueFreezeSeconds ?? Number.POSITIVE_INFINITY;
    this.displayWidth = params.width;
    this.displayHeight = params.height;
    this.resizeAlgorithm = params.resizeAlgorithm;
    this.blackBackgroundLines = [];
    this.missingBaseFrame = resizeANSIFrame(
      this.missingBaseSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingPoorFrame = resizeANSIFrame(
      this.missingPoorSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingLayerFrame = resizeANSIFrame(
      this.missingLayerSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.rebuildFrames();
  }

  triggerPoor(currentSeconds: number): void {
    if (this.poorBGAMode === 2) return;
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

  getANSILines(currentSeconds: number): string[] | undefined {
    this.refreshComposite(currentSeconds);
    if (!this.cachedComposite) {
      return this.blackBackgroundLines;
    }
    if (!this.cachedLines) {
      this.cachedLines = composeANSILines(
        this.cachedComposite.rgb,
        this.cachedComposite.opaqueMask,
        this.cachedComposite.width,
        this.cachedComposite.height,
      );
    }
    return this.cachedLines;
  }

  getKittyImage(currentSeconds: number): BGAKittyImage {
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

    const normalFrames = [baseSelection.frame, layerSelection.frame, layer2Selection.frame].slice(
      0,
      MAX_NORMAL_BGA_COMPOSITE_LAYERS,
    );
    const frames =
      state.poorActive && poorSelection.frame
        ? this.poorBGAMode === 1
          ? [...normalFrames, poorSelection.frame]
          : [poorSelection.frame]
        : normalFrames;
    const composite = mergeCompositeFrames(
      ...frames.map((frame) =>
        frame ? resizeANSIFrame(frame, pixelWidth, pixelHeight, this.resizeAlgorithm) : undefined,
      ),
    );
    const filledFrame = composite
      ? fillANSIFrameBackground(composite, 0, 0, 0)
      : createSolidANSIFrame(1, 1, 0, 0, 0, 1);
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
    this.missingBaseFrame = resizeANSIFrame(
      this.missingBaseSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingPoorFrame = resizeANSIFrame(
      this.missingPoorSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.missingLayerFrame = resizeANSIFrame(
      this.missingLayerSourceFrame,
      this.displayWidth,
      this.displayHeight,
      this.resizeAlgorithm,
    );
    this.blackBackgroundLines = createBlackBackgroundANSILines(this.displayWidth, this.displayHeight);
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
    const normalFrames = [baseSelection.frame, layerSelection.frame, layer2Selection.frame].slice(
      0,
      MAX_NORMAL_BGA_COMPOSITE_LAYERS,
    );
    this.cachedComposite = mergeCompositeFrames(
      ...(state.poorActive && poorSelection.frame
        ? this.poorBGAMode === 1
          ? [...normalFrames, poorSelection.frame]
          : [poorSelection.frame]
        : normalFrames),
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
    const baseCue = pickActiveBGACue(this.baseTimeline, cueSeconds);
    const layerCue = pickActiveBGACue(this.layerTimeline, cueSeconds);
    const layer2Cue = pickActiveBGACue(this.layer2Timeline, cueSeconds);
    const poorCue = pickActiveBGACue(this.poorTimeline, cueSeconds);
    const poorActive = this.poorBGAMode !== 2 && currentSeconds < this.poorActiveUntilSeconds;
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

  private resolvePoorKey(poorCue: BGACue | undefined, currentSeconds: number): string | undefined {
    if (poorCue) {
      return poorCue.key;
    }
    if (this.poorFallbackKey && currentSeconds < this.poorFallbackUntilSeconds) {
      return this.poorFallbackKey;
    }
    return undefined;
  }
}

export async function createBgaANSIRenderer(
  json: BeMusicJSON,
  options: BgaANSIOptions,
): Promise<BgaANSIRenderer | undefined> {
  throwIfAborted(options.signal);
  const displaySize = normalizeDisplaySize(options.width, options.height);
  const resizeAlgorithm = options.imageResizeAlgorithm ?? DEFAULT_IMAGE_RESIZE_ALGORITHM;
  const resolved = resolveChart(json);
  const { base: baseTimeline, poor: poorTimeline, layer: layerTimeline, layer2: layer2Timeline } = resolved.bga;

  const baseKeys = new Set(baseTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const poorKeys = new Set(poorTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const layerKeys = new Set(layerTimeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  const layer2Keys = new Set(layer2Timeline.flatMap((cue) => (cue.key ? [cue.key] : [])));
  // LR2 starts its miss layer from `#BMP00`; only `#POORBGA 2` (no POOR image) turns that off.
  const shouldUsePoorBMP00Fallback =
    resolvePoorBGAMode(json.bms.poorBGA) !== 2 &&
    typeof json.resources.bmp['00'] === 'string' &&
    json.resources.bmp['00'].length > 0;
  const poorFallbackKey = shouldUsePoorBMP00Fallback ? '00' : undefined;
  if (poorFallbackKey) {
    poorKeys.add(poorFallbackKey);
  }
  const poorFallbackUntilSeconds = poorTimeline[0]?.seconds ?? Number.POSITIVE_INFINITY;
  const totalLoadTargetCount =
    countMappedBMPResourceTargets(baseKeys, json.resources.bmp) +
    countMappedBMPResourceTargets(poorKeys, json.resources.bmp) +
    countMappedBMPResourceTargets(layerKeys, json.resources.bmp) +
    countMappedBMPResourceTargets(layer2Keys, json.resources.bmp);
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
        videoBGAStreaming: options.videoBGAStreaming,
        onLoadProgress: reportLoadProgress,
        signal: options.signal,
        sharedSourceCache,
      }),
      loadFramesByKeys({
        keys: poorKeys,
        resources: json.resources.bmp,
        baseDir: options.baseDir,
        mode: resolvePoorBGAMode(json.bms.poorBGA) === 1 ? 'bmson-layer' : 'base',
        width: displaySize.width,
        height: displaySize.height,
        imageResizeAlgorithm: resizeAlgorithm,
        videoBGAStreaming: options.videoBGAStreaming,
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
        videoBGAStreaming: options.videoBGAStreaming,
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
        videoBGAStreaming: options.videoBGAStreaming,
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

  return new BgaANSIRenderer({
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
    poorBGAMode: resolvePoorBGAMode(json.bms.poorBGA),
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
  videoBGAStreaming?: boolean;
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
    videoBGAStreaming,
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
        `${videoBGAStreaming === false ? 'full' : 'stream'}:${resolved}`;
      let sourcePromise = sharedSourceCache.get(cacheKey);
      if (!sourcePromise) {
        sourcePromise = loadFrameSource(
          resolved,
          mode,
          width,
          height,
          imageResizeAlgorithm,
          videoBGAStreaming,
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

function countMappedBMPResourceTargets(keys: ReadonlySet<string>, resources: Record<string, string>): number {
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
  const filledFrame = fillANSIFrameBackground(frame, 0, 0, 0);
  return {
    pixelWidth: filledFrame.width,
    pixelHeight: filledFrame.height,
    cellWidth: Math.max(1, Math.floor(cellWidth)),
    cellHeight: Math.max(1, Math.floor(cellHeight)),
    rgb: filledFrame.rgb,
  };
}

async function loadTerminalANSIImageInternal(
  baseDir: string,
  mediaPath: string,
  options: TerminalANSIImageOptions = {},
): Promise<{ image: TerminalANSIImage; sourceFrame: FrameSource } | undefined> {
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
  const outputFrame = options.fitMode === 'cover' ? selected.frame : cropANSIFrameToOpaqueBounds(selected.frame);
  const filledFrame = fillANSIFrameBackground(outputFrame, 0, 0, 0);
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
      lines: composeANSILines(filledFrame.rgb, filledFrame.opaqueMask, filledFrame.width, filledFrame.height),
      kittyImage,
    },
  };
}

function normalizeTerminalImageDisplaySize(width?: number, height?: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(width ?? DEFAULT_BGA_ASCII_WIDTH)),
    height: Math.max(1, Math.floor(height ?? DEFAULT_BGA_ASCII_HEIGHT)),
  };
}
