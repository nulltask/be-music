import { dirname } from 'node:path';
import { isAbortError } from '@be-music/utils/core';
import readline from 'node:readline';
import { loadTerminalANSIImage, type TerminalANSIImage } from '../bga.ts';
import type { ImageResizeAlgorithm } from '@be-music/player/display';
import {
  buildKittyGraphicsDeleteImageSequence,
  buildKittyGraphicsRenderSequence,
  supportsKittyGraphicsProtocol,
} from '../tui/kitty-graphics.ts';
import {
  cyclePlayMode,
  decreaseHighSpeed,
  formatHighSpeedLabel,
  formatPlayModeLabel,
  increaseHighSpeed,
  type PlayMode,
} from './config.ts';
import {
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolveMusicSelectDifficultyFilter,
  resolveMusicSelectNavigationAction,
  resolveVisibleEntryRange,
  type MusicSelectDifficultyFilter,
  type MusicSelectPageDirection,
} from './music-select-navigation.ts';
import {
  createSelectionColumnLayout,
  formatSelectionColumnHeader,
  formatSelectionEntryLabel,
  truncateForDisplay,
} from './selection-format.ts';
import { buildChartSelectionEntries, type ChartSelectionEntry } from './chart-selection.ts';
import { createMusicSelectState, getEntryFocusKey } from './music-select-state.ts';
import { createChartPreviewController, formatMusicSelectAudioBackendLabel } from './chart-preview.ts';
import { beginRawInputCapture } from './input-capture.ts';

interface SelectChartInteractivelyOptions {
  audio: boolean;
  kittyGraphics?: boolean;
  imageResizeAlgorithm: ImageResizeAlgorithm;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  entries?: ChartSelectionEntry[];
  initialFocusKey?: string;
  initialPlayMode?: PlayMode;
  initialHighSpeed?: number;
  initialDifficultyFilter?: MusicSelectDifficultyFilter;
}

type SelectChartInteractivelyExitReason = 'selected' | 'escape' | 'ctrl-c';

export interface SelectChartInteractivelyResult {
  reason: SelectChartInteractivelyExitReason;
  selectedPath?: string;
  focusKey?: string;
  playMode: PlayMode;
  highSpeed: number;
  difficultyFilter?: MusicSelectDifficultyFilter;
}

interface MusicSelectMetadataRenderOptions {
  bannerLines?: readonly string[];
  bannerWidth?: number;
}

interface MusicSelectBannerLayout {
  visibleBannerLines: readonly string[];
  requestedBannerWidth: number;
}

interface MusicSelectBannerState {
  cache: Map<string, TerminalANSIImage | null>;
  activeCacheKey?: string;
  activeImage?: TerminalANSIImage;
  loadController?: AbortController;
  loadSequence: number;
  kittyVisible: boolean;
}

interface MusicSelectBannerDisplayState {
  reservedWidth?: number;
}

const MUSIC_SELECT_NON_ENTRY_ROWS = 13;
const MUSIC_SELECT_PREVIEW_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const MUSIC_SELECT_PREVIEW_SPINNER_INTERVAL_MS = 80;
const MUSIC_SELECT_HELP_LINE =
  'Select chart  [↑/↓ or k/j: move]  [←/→ or h/l: page]  [Ctrl+b/f: page]  [1-5: DIFF filter]  [0: clear DIFF]  [a: MANUAL/AUTO SCRATCH/AUTO]  [s/S: HS +/-]  [Enter: play]  [Ctrl+C/Esc: exit]';
const MUSIC_SELECT_BANNER_KITTY_IMAGE_ID = 7_332;
const MUSIC_SELECT_METADATA_SECONDARY_COLOR = '\u001b[38;2;160;160;160m';
const ANSI_RESET = '\u001b[0m';
const MUSIC_SELECT_BANNER_HEIGHT = 4;
const MUSIC_SELECT_BANNER_GAP = 2;
const MUSIC_SELECT_BANNER_MAX_WIDTH = 18;
const MUSIC_SELECT_BANNER_MIN_WIDTH = 10;
const MUSIC_SELECT_BANNER_MIN_TEXT_WIDTH = 36;

export function sanitizeMetadataText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function createMusicSelectSelectedMetadataLines(
  entry: ChartSelectionEntry | undefined,
  lineWidth: number,
  options: MusicSelectMetadataRenderOptions = {},
): string[] {
  const bannerLayout = resolveMusicSelectMetadataBannerLayout(lineWidth, options);
  const metadataWidth = bannerLayout
    ? Math.max(8, lineWidth - bannerLayout.requestedBannerWidth - MUSIC_SELECT_BANNER_GAP)
    : lineWidth;
  const title =
    entry?.kind === 'chart' ? (sanitizeMetadataText(entry.title) ?? sanitizeMetadataText(entry.fileLabel)) : '-';
  const subtitle = entry?.kind === 'chart' ? sanitizeMetadataText(entry.subtitle) : undefined;
  const artist = entry?.kind === 'chart' ? sanitizeMetadataText(entry.artist) : '-';
  const subartist = entry?.kind === 'chart' ? sanitizeMetadataText(entry.subartist) : undefined;
  const genre = entry?.kind === 'chart' ? sanitizeMetadataText(entry.genre) : '-';
  const comment = entry?.kind === 'chart' ? sanitizeMetadataText(entry.comment) : '-';
  const baseLines = [
    formatMusicSelectMetadataLine('TITLE', title ?? '-', subtitle, metadataWidth),
    formatMusicSelectMetadataLine('ARTIST', artist ?? '-', subartist, metadataWidth),
    formatMusicSelectMetadataLine('GENRE', genre ?? '-', undefined, metadataWidth),
    formatMusicSelectMetadataLine('COMMENT', comment ?? '-', undefined, metadataWidth),
  ];
  return bannerLayout ? composeMusicSelectMetadataLinesWithBanner(baseLines, lineWidth, bannerLayout) : baseLines;
}

function resolveMusicSelectMetadataBannerLayout(
  lineWidth: number,
  options: MusicSelectMetadataRenderOptions,
): MusicSelectBannerLayout | undefined {
  const visibleBannerLines = options.bannerLines?.filter((line) => measureMusicSelectDisplayWidth(line) > 0) ?? [];
  const requestedBannerWidth =
    visibleBannerLines.length > 0
      ? visibleBannerLines.reduce((max, line) => Math.max(max, measureMusicSelectDisplayWidth(line)), 0)
      : Math.max(0, Math.floor(options.bannerWidth ?? 0));
  if (requestedBannerWidth <= 0 || requestedBannerWidth + MUSIC_SELECT_BANNER_GAP >= lineWidth) {
    return undefined;
  }
  return {
    visibleBannerLines,
    requestedBannerWidth,
  };
}

function composeMusicSelectMetadataLinesWithBanner(
  baseLines: readonly string[],
  lineWidth: number,
  layout: MusicSelectBannerLayout,
): string[] {
  return baseLines.map((line, index) => {
    const bannerLine = layout.visibleBannerLines[index];
    const leftVisibleWidth = measureMusicSelectDisplayWidth(line);
    const paddingWidth = Math.max(
      bannerLine ? MUSIC_SELECT_BANNER_GAP : 0,
      lineWidth - layout.requestedBannerWidth - leftVisibleWidth,
    );
    if (!bannerLine) {
      return `${line}${' '.repeat(Math.max(0, lineWidth - leftVisibleWidth))}`;
    }
    return `${line}${' '.repeat(paddingWidth)}${bannerLine}`;
  });
}

function formatMusicSelectMetadataLine(
  label: 'TITLE' | 'ARTIST' | 'GENRE' | 'COMMENT',
  primary: string,
  secondary: string | undefined,
  lineWidth: number,
): string {
  const base = truncateForDisplay(`${label} ${primary}`, lineWidth);
  if (!secondary) {
    return base;
  }

  const baseWidth = measureMusicSelectDisplayWidth(base);
  if (baseWidth >= lineWidth) {
    return base;
  }

  const secondaryWidthBudget = lineWidth - baseWidth - 1;
  if (secondaryWidthBudget <= 0) {
    return base;
  }

  const suffix = truncateForDisplay(secondary, secondaryWidthBudget);
  return suffix.length > 0 ? `${base} ${MUSIC_SELECT_METADATA_SECONDARY_COLOR}${suffix}${ANSI_RESET}` : base;
}

function measureMusicSelectDisplayWidth(value: string): number {
  let width = 0;
  let escape = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (escape) {
      if (char === 'm') {
        escape = false;
      }
      continue;
    }
    if (char === '\u001b') {
      escape = true;
      continue;
    }
    width += measureMusicSelectCharacterDisplayWidth(char);
  }
  return width;
}

function measureMusicSelectCharacterDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  if (
    codePoint === 0 ||
    codePoint < 32 ||
    (codePoint >= 0x7f && codePoint < 0xa0) ||
    codePoint === 0x200d ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    /\p{Mark}/u.test(char)
  ) {
    return 0;
  }
  return isMusicSelectFullWidthCodePoint(codePoint) ? 2 : 1;
}

function isMusicSelectFullWidthCodePoint(codePoint: number): boolean {
  if (codePoint < 0x1100) {
    return false;
  }
  return (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function resolveMusicSelectBannerDisplayWidth(lineWidth: number): number {
  const available = Math.min(
    MUSIC_SELECT_BANNER_MAX_WIDTH,
    lineWidth - MUSIC_SELECT_BANNER_MIN_TEXT_WIDTH - MUSIC_SELECT_BANNER_GAP,
  );
  return available >= MUSIC_SELECT_BANNER_MIN_WIDTH ? available : 0;
}

function createMusicSelectBannerState(): MusicSelectBannerState {
  return {
    cache: new Map<string, TerminalANSIImage | null>(),
    loadSequence: 0,
    kittyVisible: false,
  };
}

function resolveMusicSelectBannerCacheKey(
  entry: ChartSelectionEntry | undefined,
  bannerWidth: number,
): string | undefined {
  if (entry?.kind !== 'chart' || typeof entry.bannerPath !== 'string' || bannerWidth <= 0) {
    return undefined;
  }
  return `${entry.filePath}\u0000${entry.bannerPath}\u0000${bannerWidth}`;
}

function clearMusicSelectBannerLoad(state: MusicSelectBannerState): void {
  state.loadController?.abort();
  state.loadController = undefined;
}

function syncMusicSelectBanner(params: {
  state: MusicSelectBannerState;
  entry: ChartSelectionEntry | undefined;
  lineWidth: number;
  useKittyGraphics: boolean;
  imageResizeAlgorithm: ImageResizeAlgorithm;
  finished: boolean;
  onReady: () => void;
}): void {
  const bannerWidth = resolveMusicSelectBannerDisplayWidth(params.lineWidth);
  const cacheKey = resolveMusicSelectBannerCacheKey(params.entry, bannerWidth);
  if (!cacheKey || params.entry?.kind !== 'chart' || typeof params.entry.bannerPath !== 'string') {
    clearMusicSelectBannerLoad(params.state);
    params.state.activeCacheKey = undefined;
    params.state.activeImage = undefined;
    return;
  }
  if (params.state.activeCacheKey === cacheKey) {
    return;
  }

  clearMusicSelectBannerLoad(params.state);
  params.state.activeCacheKey = cacheKey;
  const cached = params.state.cache.get(cacheKey);
  if (cached !== undefined) {
    params.state.activeImage = cached ?? undefined;
    return;
  }

  params.state.activeImage = undefined;
  const controller = new AbortController();
  params.state.loadController = controller;
  const requestSequence = ++params.state.loadSequence;
  void loadTerminalANSIImage(dirname(params.entry.filePath), params.entry.bannerPath, {
    width: bannerWidth,
    height: MUSIC_SELECT_BANNER_HEIGHT,
    signal: controller.signal,
    fitMode: 'contain',
    includeKittyImage: params.useKittyGraphics,
    imageResizeAlgorithm: params.imageResizeAlgorithm,
  })
    .then((image) => {
      if (
        params.finished ||
        controller.signal.aborted ||
        requestSequence !== params.state.loadSequence ||
        params.state.activeCacheKey !== cacheKey
      ) {
        return;
      }
      params.state.cache.set(cacheKey, image ?? null);
      params.state.activeImage = image;
      params.onReady();
    })
    .catch((error) => {
      if (params.finished || controller.signal.aborted || requestSequence !== params.state.loadSequence) {
        return;
      }
      if (isAbortError(error)) {
        return;
      }
      params.state.cache.set(cacheKey, null);
      params.state.activeImage = undefined;
      params.onReady();
    });
}

function resolveMusicSelectBannerDisplayState(
  entry: ChartSelectionEntry | undefined,
  lineWidth: number,
  useKittyGraphics: boolean,
  state: MusicSelectBannerState,
): MusicSelectBannerDisplayState {
  const bannerWidth = resolveMusicSelectBannerDisplayWidth(lineWidth);
  const cacheKey = resolveMusicSelectBannerCacheKey(entry, bannerWidth);
  const cachedImage = cacheKey ? state.cache.get(cacheKey) : undefined;
  return {
    reservedWidth:
      useKittyGraphics &&
      bannerWidth > 0 &&
      cacheKey !== undefined &&
      (cachedImage === undefined || (cachedImage !== null && cachedImage.kittyImage !== undefined))
        ? bannerWidth
        : undefined,
  };
}

function resolveMusicSelectBannerOverlaySequence(params: {
  lineWidth: number;
  reservedWidth?: number;
  useKittyGraphics: boolean;
  state: MusicSelectBannerState;
}): string {
  if (!(params.useKittyGraphics && params.state.activeImage?.kittyImage)) {
    return buildMusicSelectBannerCleanupSequence(params.state);
  }
  const bannerBlockWidth = params.reservedWidth ?? params.state.activeImage.kittyImage.cellWidth;
  const column = Math.max(1, params.lineWidth - bannerBlockWidth + 1);
  params.state.kittyVisible = true;
  return buildKittyGraphicsRenderSequence({
    imageId: MUSIC_SELECT_BANNER_KITTY_IMAGE_ID,
    placementId: 1,
    row: 1,
    column,
    image: params.state.activeImage.kittyImage,
    zIndex: -1,
    doNotMoveCursor: true,
  });
}

function buildMusicSelectBannerCleanupSequence(state: MusicSelectBannerState): string {
  if (!state.kittyVisible) {
    return '';
  }
  state.kittyVisible = false;
  return buildKittyGraphicsDeleteImageSequence(MUSIC_SELECT_BANNER_KITTY_IMAGE_ID);
}

export function createMusicSelectControlLines(options: {
  rootDir: string;
  lineWidth: number;
  playModeLabel: string;
  highSpeedLabel: string;
  difficultyFilterLabel: string;
  audioBackendLabel: string;
}): string[] {
  return [
    truncateForDisplay(MUSIC_SELECT_HELP_LINE, options.lineWidth),
    truncateForDisplay(`Directory: ${options.rootDir}`, options.lineWidth),
    truncateForDisplay(
      `Mode: ${options.playModeLabel}  HIGH-SPEED: x${options.highSpeedLabel}  DIFFICULTY: ${options.difficultyFilterLabel}`,
      options.lineWidth,
    ),
    truncateForDisplay(`Audio backend: ${options.audioBackendLabel}`, options.lineWidth),
  ];
}

function formatMusicSelectDifficultyFilterLabel(value: MusicSelectDifficultyFilter | undefined): string {
  return typeof value === 'number' ? String(value) : 'ALL';
}

export async function selectChartInteractively(
  rootDir: string,
  files: string[],
  options: SelectChartInteractivelyOptions,
): Promise<SelectChartInteractivelyResult> {
  const allEntries = options.entries ?? (await buildChartSelectionEntries(rootDir, files));
  const previewController =
    options.audio && process.stdout.isTTY
      ? createChartPreviewController({
          volume: options.volume,
          bgmVolume: options.bgmVolume,
          playVolume: options.playVolume,
        })
      : undefined;
  let previewSpinnerFrame = 0;
  let previewSpinnerTimer: NodeJS.Timeout | undefined;
  let wasSpinnerVisible = false;
  let cachedColumnLayoutEntries: readonly ChartSelectionEntry[] | undefined;
  let cachedColumnLayoutWidth = -1;
  let cachedColumnLayout: ReturnType<typeof createSelectionColumnLayout> | undefined;
  let cachedColumnHeaderLayout: ReturnType<typeof createSelectionColumnLayout> | undefined;
  let cachedColumnHeader = '';
  let cachedEntryLabelsLayout: ReturnType<typeof createSelectionColumnLayout> | undefined;
  let cachedEntryLabels = new WeakMap<ChartSelectionEntry, string>();
  const useKittyGraphicsForBanner =
    Boolean(options.kittyGraphics) && Boolean(process.stdout.isTTY) && supportsKittyGraphicsProtocol(process.env);
  const bannerState = createMusicSelectBannerState();
  let finished = false;

  const inputCapture = beginRawInputCapture();
  const musicSelectState = createMusicSelectState(allEntries, {
    initialDifficultyFilter: options.initialDifficultyFilter,
    initialPlayMode: options.initialPlayMode,
    initialHighSpeed: options.initialHighSpeed,
    initialFocusKey: options.initialFocusKey,
  });

  process.stdout.write('\u001b[?25l');

  const syncPreview = (): void => {
    const view = musicSelectState.view();
    const entry = view.entries[musicSelectState.selectedIndex()];
    if (entry?.kind === 'chart') {
      previewController?.focus({
        filePath: entry.filePath,
        previewContinueKey: entry.previewContinueKey,
      });
      return;
    }
    previewController?.focus({});
  };

  const listRowsForViewport = (): number => {
    const rows = process.stdout.rows ?? 24;
    return Math.max(5, rows - MUSIC_SELECT_NON_ENTRY_ROWS);
  };

  const resolveSelectionColumnLayout = (
    entries: readonly ChartSelectionEntry[],
    itemLabelWidth: number,
  ): ReturnType<typeof createSelectionColumnLayout> => {
    if (cachedColumnLayout && cachedColumnLayoutEntries === entries && cachedColumnLayoutWidth === itemLabelWidth) {
      return cachedColumnLayout;
    }
    cachedColumnLayout = createSelectionColumnLayout(itemLabelWidth, entries);
    cachedColumnLayoutEntries = entries;
    cachedColumnLayoutWidth = itemLabelWidth;
    return cachedColumnLayout;
  };

  const resolveSelectionColumnHeader = (
    layout: ReturnType<typeof createSelectionColumnLayout>,
    itemLabelWidth: number,
  ): string => {
    if (cachedColumnHeaderLayout === layout) {
      return cachedColumnHeader;
    }
    cachedColumnHeader = truncateForDisplay(formatSelectionColumnHeader(layout), itemLabelWidth);
    cachedColumnHeaderLayout = layout;
    return cachedColumnHeader;
  };

  const resolveSelectionEntryLabel = (
    entry: ChartSelectionEntry,
    layout: ReturnType<typeof createSelectionColumnLayout>,
    itemLabelWidth: number,
  ): string => {
    if (cachedEntryLabelsLayout !== layout) {
      cachedEntryLabelsLayout = layout;
      cachedEntryLabels = new WeakMap<ChartSelectionEntry, string>();
    }
    const cached = cachedEntryLabels.get(entry);
    if (cached) {
      return cached;
    }
    const label = truncateForDisplay(formatSelectionEntryLabel(entry, layout), itemLabelWidth);
    cachedEntryLabels.set(entry, label);
    return label;
  };

  const render = (): void => {
    const view = musicSelectState.view();
    const columns = process.stdout.columns ?? 80;
    const listRows = listRowsForViewport();
    const numberWidth = String(Math.max(1, view.chartCount)).length;
    const lineWidth = Math.max(16, columns - 2);
    const itemLabelWidth = Math.max(8, lineWidth - numberWidth - 4);
    const columnLayout = resolveSelectionColumnLayout(view.entries, itemLabelWidth);

    const { start, end } = resolveVisibleEntryRange(musicSelectState.selectedIndex(), view.entries.length, listRows);

    const lines: string[] = [];
    const selectedEntry = view.entries[musicSelectState.selectedIndex()];
    syncMusicSelectBanner({
      state: bannerState,
      entry: selectedEntry,
      lineWidth,
      useKittyGraphics: useKittyGraphicsForBanner,
      imageResizeAlgorithm: options.imageResizeAlgorithm,
      finished,
      onReady: render,
    });
    const bannerDisplayState = resolveMusicSelectBannerDisplayState(
      selectedEntry,
      lineWidth,
      useKittyGraphicsForBanner,
      bannerState,
    );
    lines.push(
      ...createMusicSelectSelectedMetadataLines(selectedEntry, lineWidth, {
        bannerLines:
          useKittyGraphicsForBanner && bannerState.activeImage?.kittyImage !== undefined
            ? undefined
            : bannerState.activeImage?.lines,
        bannerWidth: bannerDisplayState.reservedWidth,
      }),
    );
    lines.push('');
    const headerPrefix = `  ${' '.repeat(numberWidth)} `;
    lines.push(`${headerPrefix}${resolveSelectionColumnHeader(columnLayout, itemLabelWidth)}`);

    if (view.entries.length === 0) {
      lines.push('');
      lines.push(truncateForDisplay('No charts match the current DIFFICULTY filter.', lineWidth));
    }

    for (let index = start; index < end; index += 1) {
      const entry = view.entries[index];
      const marker = index === musicSelectState.selectedIndex() ? '>' : ' ';
      const chartNumber = view.chartIndexByEntryIndex.get(index);
      const number =
        typeof chartNumber === 'number' ? String(chartNumber + 1).padStart(numberWidth, ' ') : ' '.repeat(numberWidth);
      let displayEntry = entry;
      if (
        index === musicSelectState.selectedIndex() &&
        entry.kind === 'chart' &&
        previewController?.getRenderingFilePath() === entry.filePath
      ) {
        displayEntry = {
          ...entry,
          fileLabel: `${MUSIC_SELECT_PREVIEW_SPINNER_FRAMES[previewSpinnerFrame]} ${entry.fileLabel}`,
        };
      }
      const label =
        displayEntry === entry
          ? resolveSelectionEntryLabel(entry, columnLayout, itemLabelWidth)
          : truncateForDisplay(formatSelectionEntryLabel(displayEntry, columnLayout), itemLabelWidth);
      const line = `${marker} ${number} ${label}`;
      if (index === musicSelectState.selectedIndex()) {
        lines.push(`\u001b[7m${line.padEnd(lineWidth, ' ')}\u001b[0m`);
      } else {
        lines.push(line);
      }
    }

    lines.push('');
    lines.push(
      ...createMusicSelectControlLines({
        rootDir,
        lineWidth,
        playModeLabel: formatPlayModeLabel(musicSelectState.playMode()),
        highSpeedLabel: formatHighSpeedLabel(musicSelectState.highSpeed()),
        difficultyFilterLabel: formatMusicSelectDifficultyFilterLabel(musicSelectState.difficultyFilter()),
        audioBackendLabel: formatMusicSelectAudioBackendLabel(options.audio, previewController?.getActiveBackend()),
      }),
    );
    lines.push('');
    const selectedChartIndex = view.chartIndexByEntryIndex.get(musicSelectState.selectedIndex());
    if (typeof selectedChartIndex === 'number') {
      lines.push(`${selectedChartIndex + 1}/${view.chartCount}`);
    } else if (view.chartCount > 0) {
      const selectedEntry = view.entries[musicSelectState.selectedIndex()];
      lines.push(selectedEntry?.kind === 'random' ? `RANDOM/${view.chartCount}` : `0/${view.chartCount}`);
    } else {
      lines.push('0/0');
    }
    const overlaySequence = resolveMusicSelectBannerOverlaySequence({
      lineWidth,
      reservedWidth: bannerDisplayState.reservedWidth,
      useKittyGraphics: useKittyGraphicsForBanner,
      state: bannerState,
    });
    process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\u001b[J${overlaySequence}`);
  };

  return new Promise<SelectChartInteractivelyResult>((resolvePromise) => {
    const isSelectedEntryPreviewRendering = (): boolean => {
      const view = musicSelectState.view();
      const selectedEntry = view.entries[musicSelectState.selectedIndex()];
      if (!previewController || selectedEntry?.kind !== 'chart') {
        return false;
      }
      return previewController.getRenderingFilePath() === selectedEntry.filePath;
    };
    const ensurePreviewSpinnerTimer = (): void => {
      if (!previewController || previewSpinnerTimer) {
        return;
      }
      previewSpinnerTimer = setInterval(() => {
        if (!isSelectedEntryPreviewRendering()) {
          if (wasSpinnerVisible) {
            wasSpinnerVisible = false;
            previewSpinnerFrame = 0;
            render();
          }
          return;
        }
        wasSpinnerVisible = true;
        previewSpinnerFrame = (previewSpinnerFrame + 1) % MUSIC_SELECT_PREVIEW_SPINNER_FRAMES.length;
        render();
      }, MUSIC_SELECT_PREVIEW_SPINNER_INTERVAL_MS);
    };

    const cleanup = (result: SelectChartInteractivelyResult): void => {
      if (finished) {
        return;
      }
      finished = true;
      if (previewSpinnerTimer) {
        clearInterval(previewSpinnerTimer);
        previewSpinnerTimer = undefined;
      }
      clearMusicSelectBannerLoad(bannerState);
      process.stdout.write(buildMusicSelectBannerCleanupSequence(bannerState));
      inputCapture.stdin.removeListener('keypress', onKeyPress);
      inputCapture.restore();
      process.stdout.write('\u001b[?25h\u001b[2J\u001b[H');
      void (async () => {
        await previewController?.dispose();
        resolvePromise(result);
      })();
    };

    const moveSelection = (delta: number): void => {
      const view = musicSelectState.view();
      if (view.selectableIndexes.length === 0) {
        return;
      }
      const currentSelectableIndex = view.selectableIndexByEntryIndex.get(musicSelectState.selectedIndex()) ?? 0;
      const nextSelectableIndex = resolveCircularSelectableIndex(
        currentSelectableIndex,
        delta,
        view.selectableIndexes.length,
      );
      musicSelectState.selectedIndex(view.selectableIndexes[nextSelectableIndex]!);
      syncPreview();
      render();
    };

    const moveSelectionByPage = (direction: MusicSelectPageDirection): void => {
      const view = musicSelectState.view();
      if (view.selectableIndexes.length === 0) {
        return;
      }
      const pageSize = listRowsForViewport();
      musicSelectState.selectedIndex(
        resolvePageSelectableIndex(
          view.selectableIndexes,
          musicSelectState.selectedIndex(),
          view.entries.length,
          pageSize,
          direction,
        ),
      );
      syncPreview();
      render();
    };

    const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
      const nextDifficultyFilter = resolveMusicSelectDifficultyFilter(chunk);
      if (nextDifficultyFilter !== undefined) {
        const focusKey = getEntryFocusKey(musicSelectState.view().entries[musicSelectState.selectedIndex()]);
        musicSelectState.difficultyFilter(nextDifficultyFilter ?? undefined);
        musicSelectState.ensureSelectedIndex(focusKey);
        syncPreview();
        render();
        return;
      }

      const action = resolveMusicSelectNavigationAction(chunk, key);
      if (action === 'ctrl-c') {
        const view = musicSelectState.view();
        cleanup({
          reason: 'ctrl-c',
          focusKey: getEntryFocusKey(view.entries[musicSelectState.selectedIndex()]),
          playMode: musicSelectState.playMode(),
          highSpeed: musicSelectState.highSpeed(),
          difficultyFilter: musicSelectState.difficultyFilter(),
        });
        return;
      }
      if (action === 'move-up') {
        moveSelection(-1);
        return;
      }
      if (action === 'move-down') {
        moveSelection(1);
        return;
      }
      if (action === 'page-up') {
        moveSelectionByPage('up');
        return;
      }
      if (action === 'page-down') {
        moveSelectionByPage('down');
        return;
      }
      if (action === 'first') {
        const view = musicSelectState.view();
        if (view.selectableIndexes.length === 0) {
          return;
        }
        musicSelectState.selectedIndex(view.selectableIndexes[0]!);
        syncPreview();
        render();
        return;
      }
      if (action === 'last') {
        const view = musicSelectState.view();
        if (view.selectableIndexes.length === 0) {
          return;
        }
        musicSelectState.selectedIndex(view.selectableIndexes[view.selectableIndexes.length - 1]!);
        syncPreview();
        render();
        return;
      }
      if (action === 'confirm') {
        const view = musicSelectState.view();
        const selectedEntry = view.entries[musicSelectState.selectedIndex()];
        if (selectedEntry?.kind === 'random') {
          const randomIndex = Math.floor(Math.random() * view.chartFiles.length);
          cleanup({
            reason: 'selected',
            selectedPath: view.chartFiles[randomIndex],
            focusKey: getEntryFocusKey(selectedEntry),
            playMode: musicSelectState.playMode(),
            highSpeed: musicSelectState.highSpeed(),
            difficultyFilter: musicSelectState.difficultyFilter(),
          });
          return;
        }
        if (selectedEntry?.kind === 'chart') {
          cleanup({
            reason: 'selected',
            selectedPath: selectedEntry.filePath,
            focusKey: getEntryFocusKey(selectedEntry),
            playMode: musicSelectState.playMode(),
            highSpeed: musicSelectState.highSpeed(),
            difficultyFilter: musicSelectState.difficultyFilter(),
          });
          return;
        }
        return;
      }
      if (action === 'toggle-auto') {
        musicSelectState.playMode(cyclePlayMode(musicSelectState.playMode()));
        render();
        return;
      }
      if (action === 'increase-high-speed') {
        musicSelectState.highSpeed(increaseHighSpeed(musicSelectState.highSpeed()));
        render();
        return;
      }
      if (action === 'decrease-high-speed') {
        musicSelectState.highSpeed(decreaseHighSpeed(musicSelectState.highSpeed()));
        render();
        return;
      }
      if (action === 'escape') {
        const view = musicSelectState.view();
        cleanup({
          reason: 'escape',
          focusKey: getEntryFocusKey(view.entries[musicSelectState.selectedIndex()]),
          playMode: musicSelectState.playMode(),
          highSpeed: musicSelectState.highSpeed(),
          difficultyFilter: musicSelectState.difficultyFilter(),
        });
      }
    };

    inputCapture.stdin.on('keypress', onKeyPress);
    ensurePreviewSpinnerTimer();
    syncPreview();
    render();
  });
}
