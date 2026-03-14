import { stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAbortError, resolveCliPath } from '@be-music/utils';
import readline from 'node:readline';
import type { BeMusicPlayLevel } from '@be-music/json';
import { parseChartFile } from '@be-music/parser';
import { renderJson, writeAudioFile } from '@be-music/audio-renderer';
import {
  PlayerInterruptedError,
  type PlayerLoadComponentStatus,
  type PlayerLoadProgress,
  type PlayerSummary,
} from '../index.ts';
import {
  loadStageFileAnsiImage,
  loadTerminalAnsiImage,
  type StageFileAnsiImage,
  type TerminalAnsiImage,
} from '../bga.ts';
import { runNodeGameplayRuntime } from '../node/node-gameplay-runtime.ts';
import {
  buildKittyGraphicsDeleteImageSequence,
  buildKittyGraphicsRenderSequence,
  supportsKittyGraphicsProtocol,
} from '../tui/kitty-graphics.ts';
import {
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from '../utils.ts';
import {
  HIGH_SPEED_STEP,
  MAX_HIGH_SPEED,
  MIN_HIGH_SPEED,
  applyPersistedPlayerConfigToArgs,
  applySongSelectConfigToArgs,
  createDefaultPersistedPlayerConfig,
  cyclePlayMode,
  decreaseHighSpeed,
  formatHighSpeedLabel,
  formatPlayModeLabel,
  increaseHighSpeed,
  loadPersistedPlayerConfig,
  normalizeHighSpeedValue,
  resolveCliConfigOverrideFlags,
  resolvePersistedPlayerConfigFromArgs,
  resolvePlayModeFromArgs,
  savePersistedPlayerConfig,
  type PersistedPlayerConfig,
  type PlayMode,
} from './config.ts';
import {
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolveResultScreenActionFromKey,
  resolveSongSelectDifficultyFilter,
  resolveSongSelectNavigationAction,
  resolveVisibleEntryRange,
  type ResultScreenAction,
  type SongSelectDifficultyFilter,
  type SongSelectPageDirection,
} from './song-select-navigation.ts';
import {
  createSelectionColumnLayout,
  formatPlayLevelLabel,
  formatPlayerLabel,
  formatRankLabel,
  formatSelectionColumnHeader,
  formatSelectionEntryLabel,
  truncateForDisplay,
} from './selection-format.ts';
import {
  buildChartSelectionEntries,
  listChartFiles,
  type ChartSelectionEntry,
  type ChartSummaryLoadingProgress,
} from './chart-selection.ts';
import { createChartFocusKey, createSongSelectState, getEntryFocusKey } from './song-select-state.ts';
import { createChartPreviewController, formatSongSelectAudioBackendLabel } from './chart-preview.ts';

export {
  applyPersistedPlayerConfigToArgs,
  cyclePlayMode,
  formatPlayModeLabel,
  resolveCliConfigOverrideFlags,
  resolvePersistedPlayerConfigFromArgs,
  resolvePlayModeFromArgs,
} from './config.ts';
export {
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolveResultScreenActionFromKey,
  resolveSongSelectDifficultyFilter,
  resolveSongSelectNavigationAction,
  resolveVisibleEntryRange,
} from './song-select-navigation.ts';

interface CliArgs {
  input?: string;
  auto: boolean;
  autoScratch: boolean;
  kittyGraphics: boolean;
  inferBmsLnTypeWhenMissing: boolean;
  showInvisibleNotes: boolean;
  compressor: boolean;
  compressorThresholdDb?: number;
  compressorRatio?: number;
  compressorAttackMs?: number;
  compressorReleaseMs?: number;
  compressorMakeupDb?: number;
  limiter: boolean;
  limiterCeilingDb?: number;
  limiterReleaseMs?: number;
  speed?: number;
  uiFps: number;
  highSpeed?: number;
  judgeWindowMs?: number;
  judgeWindowSource?: 'debug' | 'legacy';
  debugActiveAudio: boolean;
  renderAudioPath?: string;
  audio: boolean;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  audioTailSeconds?: number;
  audioOffsetMs?: number;
  audioHeadPaddingMs?: number;
  audioLeadMs?: number;
  audioLeadMaxMs?: number;
  audioLeadStepUpMs?: number;
  audioLeadStepDownMs?: number;
  tui: boolean;
}

interface PlayLoadingProgress {
  ratio: number;
  message: string;
  detail?: string;
  audioStatus?: PlayerLoadComponentStatus;
  graphicsStatus?: PlayerLoadComponentStatus;
}

interface PlayLoadingScreenRenderState {
  initialized: boolean;
  stageFileDrawn: boolean;
  stageFileKittyVisible: boolean;
}

interface SelectChartInteractivelyOptions {
  audio: boolean;
  kittyGraphics?: boolean;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  entries?: ChartSelectionEntry[];
  initialFocusKey?: string;
  initialPlayMode?: PlayMode;
  initialHighSpeed?: number;
  initialDifficultyFilter?: SongSelectDifficultyFilter;
}

type SelectChartInteractivelyExitReason = 'selected' | 'escape' | 'ctrl-c';

interface SelectChartInteractivelyResult {
  reason: SelectChartInteractivelyExitReason;
  selectedPath?: string;
  focusKey?: string;
  playMode: PlayMode;
  highSpeed: number;
  difficultyFilter?: SongSelectDifficultyFilter;
}

interface SongSelectMetadataRenderOptions {
  bannerLines?: readonly string[];
  bannerWidth?: number;
}

interface SongSelectBannerLayout {
  visibleBannerLines: readonly string[];
  requestedBannerWidth: number;
}

interface SongSelectBannerState {
  cache: Map<string, TerminalAnsiImage | null>;
  activeCacheKey?: string;
  activeImage?: TerminalAnsiImage;
  loadController?: AbortController;
  loadSequence: number;
  kittyVisible: boolean;
}

interface SongSelectBannerDisplayState {
  reservedWidth?: number;
}

interface PlayedChartResult {
  chartPath: string;
  summary: PlayerSummary;
  title?: string;
  artist?: string;
  player?: number;
  rank?: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
}

const SONG_SELECT_NON_ENTRY_ROWS = 13;

type DirectorySceneState =
  | {
      kind: 'select';
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
      difficultyFilter?: SongSelectDifficultyFilter;
    }
  | {
      kind: 'play';
      chartPath: string;
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
      difficultyFilter?: SongSelectDifficultyFilter;
    }
  | {
      kind: 'result';
      played: PlayedChartResult;
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
      difficultyFilter?: SongSelectDifficultyFilter;
    }
  | {
      kind: 'exit';
      exitCode: number;
    };

interface RawInputCapture {
  stdin: NodeJS.ReadStream & { isRaw?: boolean };
  restore: () => void;
}

type LoadingCancelReason = 'escape' | 'ctrl-c';

interface LoadingAbortCapture {
  signal: AbortSignal;
  getReason: () => LoadingCancelReason | undefined;
  dispose: () => void;
}

interface ResultScreenOptions {
  allowReplay?: boolean;
  nextActionLabel?: string;
}

type ResultScreenExitAction = Exclude<ResultScreenAction, 'replay'>;
const SONG_SELECT_PREVIEW_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SONG_SELECT_PREVIEW_SPINNER_INTERVAL_MS = 80;
const SONG_SELECT_HELP_LINE =
  'Select chart  [↑/↓ or k/j: move]  [←/→ or h/l: page]  [Ctrl+b/f: page]  [1-5: DIFF filter]  [0: clear DIFF]  [a: MANUAL/AUTO SCRATCH/AUTO]  [s/S: HS +/-]  [Enter: play]  [Ctrl+C/Esc: exit]';
const DIRECTORY_CHART_EXTENSIONS_LABEL = '.bms, .bme, .bml, .pms, .bmson';
const PLAY_LOADING_STAGEFILE_KITTY_IMAGE_ID = 7_331;
const SONG_SELECT_BANNER_KITTY_IMAGE_ID = 7_332;
const SONG_SELECT_METADATA_SECONDARY_COLOR = '\u001b[38;2;160;160;160m';
const ANSI_RESET = '\u001b[0m';
const DEFAULT_TUI_FPS = 60;
const SONG_SELECT_BANNER_HEIGHT = 4;
const SONG_SELECT_BANNER_GAP = 2;
const SONG_SELECT_BANNER_MAX_WIDTH = 18;
const SONG_SELECT_BANNER_MIN_WIDTH = 10;
const SONG_SELECT_BANNER_MIN_TEXT_WIDTH = 36;

export async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    return;
  }
  const overrideFlags = resolveCliConfigOverrideFlags(rawArgs);
  let args: CliArgs;
  try {
    args = parseArgs(rawArgs);
  } catch (error) {
    process.stdout.write(`${formatCliParseError(error)}\n\n`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  let persistedConfig = createDefaultPersistedPlayerConfig();
  try {
    persistedConfig = await loadPersistedPlayerConfig();
  } catch (error) {
    process.stdout.write(`Warning: failed to load ~/.be-music/player.json (${formatCliParseError(error)}).\n`);
  }
  args = applyPersistedPlayerConfigToArgs(args, persistedConfig, overrideFlags);
  let nextPersistedConfig = resolvePersistedPlayerConfigFromArgs(args, persistedConfig);

  if (!args.input) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.judgeWindowSource === 'legacy') {
    process.stdout.write('Warning: --judge-window is deprecated. Use --debug-judge-window for debugging only.\n');
  }
  if (typeof args.judgeWindowMs === 'number' && Number.isFinite(args.judgeWindowMs)) {
    process.stdout.write(`Warning: debug judge override enabled (BAD window: ${Math.round(args.judgeWindowMs)}ms).\n`);
  }

  const inputPath = resolveCliPath(args.input);
  try {
    const inputStat = await stat(inputPath);
    if (inputStat.isDirectory()) {
      nextPersistedConfig = await runDirectoryInput(inputPath, args, nextPersistedConfig);
      return;
    }
    const action = await playSingleChartUntilExit(inputPath, dirname(inputPath), args);
    if (action === 'ctrl-c') {
      nextPersistedConfig = resolvePersistedPlayerConfigFromArgs(args, nextPersistedConfig);
      process.exitCode = 130;
      return;
    }
    nextPersistedConfig = resolvePersistedPlayerConfigFromArgs(args, nextPersistedConfig);
  } catch (error) {
    if (error instanceof PlayerInterruptedError) {
      nextPersistedConfig = resolvePersistedPlayerConfigFromArgs(args, nextPersistedConfig);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  } finally {
    try {
      await savePersistedPlayerConfig(nextPersistedConfig);
    } catch (error) {
      process.stdout.write(`Warning: failed to save ~/.be-music/player.json (${formatCliParseError(error)}).\n`);
    }
  }
}

async function runDirectoryInput(
  rootDir: string,
  args: CliArgs,
  initialConfig: PersistedPlayerConfig,
): Promise<PersistedPlayerConfig> {
  let persistedConfig = resolvePersistedConfigForSongSelect(
    {
      playMode: initialConfig.playMode,
      highSpeed: normalizeHighSpeedValue(initialConfig.highSpeed),
    },
    rootDir,
    undefined,
    undefined,
    initialConfig,
  );
  let candidates: string[];
  const startupLoadingAbortCapture = beginLoadingAbortCapture();
  try {
    candidates = await listChartFiles(rootDir, {
      signal: startupLoadingAbortCapture?.signal,
    });
  } catch (error) {
    const cancelReason = resolveLoadingCancelReason(error, startupLoadingAbortCapture);
    if (cancelReason) {
      applyLoadingCancel(cancelReason);
      return persistedConfig;
    }
    throw error;
  } finally {
    startupLoadingAbortCapture?.dispose();
  }
  if (candidates.length === 0) {
    process.stdout.write(
      `No chart files found in directory: ${rootDir} (searched for ${DIRECTORY_CHART_EXTENSIONS_LABEL})\n`,
    );
    process.exitCode = 1;
    return persistedConfig;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const selected = candidates[0];
    process.stdout.write(`Selected chart: ${selected}\n`);
    try {
      await playChartOnce(selected, args);
      persistedConfig = resolvePersistedConfigForSongSelect(
        resolvePersistedPlayerConfigFromArgs(args, persistedConfig),
        rootDir,
        selected,
        createChartFocusKey(selected),
        persistedConfig,
      );
    } catch (error) {
      if (error instanceof PlayerInterruptedError) {
        persistedConfig = resolvePersistedConfigForSongSelect(
          resolvePersistedPlayerConfigFromArgs(args, persistedConfig),
          rootDir,
          selected,
          createChartFocusKey(selected),
          persistedConfig,
        );
        process.exitCode = error.exitCode;
        return persistedConfig;
      }
      throw error;
    }
    return persistedConfig;
  }

  if (candidates.length === 1) {
    const selected = candidates[0];
    process.stdout.write(`Selected chart: ${selected}\n`);
    try {
      const action = await playSingleChartUntilExit(selected, rootDir, args);
      persistedConfig = resolvePersistedConfigForSongSelect(
        resolvePersistedPlayerConfigFromArgs(args, persistedConfig),
        rootDir,
        selected,
        createChartFocusKey(selected),
        persistedConfig,
      );
      if (action === 'ctrl-c') {
        process.exitCode = 130;
      }
    } catch (error) {
      if (error instanceof PlayerInterruptedError) {
        persistedConfig = resolvePersistedConfigForSongSelect(
          resolvePersistedPlayerConfigFromArgs(args, persistedConfig),
          rootDir,
          selected,
          createChartFocusKey(selected),
          persistedConfig,
        );
        process.exitCode = error.exitCode;
        return persistedConfig;
      }
      throw error;
    }
    return persistedConfig;
  }

  const entries = await loadChartSelectionEntries(rootDir, candidates);
  if (!entries) {
    return persistedConfig;
  }

  let state: DirectorySceneState = {
    kind: 'select',
    focusKey: resolveSongSelectInitialFocusKey(
      candidates,
      resolveLastSelectedChartFileForDirectory(initialConfig, rootDir),
      resolveLastSongSelectFocusKeyForDirectory(initialConfig, rootDir),
    ),
    playMode: persistedConfig.playMode,
    highSpeed: persistedConfig.highSpeed,
    difficultyFilter: undefined,
  };

  while (state.kind !== 'exit') {
    if (state.kind === 'select') {
      const selection = await selectChartInteractively(rootDir, candidates, {
        audio: args.audio,
        kittyGraphics: args.kittyGraphics,
        volume: args.volume,
        bgmVolume: args.bgmVolume,
        playVolume: args.playVolume,
        entries,
        initialFocusKey: state.focusKey,
        initialPlayMode: state.playMode,
        initialHighSpeed: state.highSpeed,
        initialDifficultyFilter: state.difficultyFilter,
      });
      persistedConfig = resolvePersistedConfigForSongSelect(
        {
          playMode: selection.playMode,
          highSpeed: normalizeHighSpeedValue(selection.highSpeed),
        },
        rootDir,
        resolveLastSelectedChartFile(selection),
        selection.focusKey,
        persistedConfig,
      );
      state = resolveDirectoryStateFromSelection(selection);
      continue;
    }

    if (state.kind === 'play') {
      const playState = state;
      const playArgs = applySongSelectConfigToArgs(args, playState.playMode, playState.highSpeed);
      persistedConfig = resolvePersistedConfigForSongSelect(
        {
          playMode: playState.playMode,
          highSpeed: normalizeHighSpeedValue(playArgs.highSpeed),
        },
        rootDir,
        playState.chartPath,
        playState.focusKey,
        persistedConfig,
      );
      try {
        const played = await playChartOnce(playState.chartPath, playArgs);
        const resolvedHighSpeed = normalizeHighSpeedValue(playArgs.highSpeed);
        persistedConfig = resolvePersistedConfigForSongSelect(
          {
            playMode: playState.playMode,
            highSpeed: resolvedHighSpeed,
          },
          rootDir,
          playState.chartPath,
          playState.focusKey,
          persistedConfig,
        );
        state = {
          kind: 'result',
          played,
          focusKey: playState.focusKey,
          playMode: playState.playMode,
          highSpeed: resolvedHighSpeed,
          difficultyFilter: playState.difficultyFilter,
        };
      } catch (error) {
        if (error instanceof PlayerInterruptedError) {
          const resolvedHighSpeed = normalizeHighSpeedValue(playArgs.highSpeed);
          persistedConfig = resolvePersistedConfigForSongSelect(
            {
              playMode: playState.playMode,
              highSpeed: resolvedHighSpeed,
            },
            rootDir,
            playState.chartPath,
            playState.focusKey,
            persistedConfig,
          );
          state = resolveDirectoryStateFromPlayInterrupt(error.reason, {
            ...playState,
            highSpeed: resolvedHighSpeed,
          });
          continue;
        }
        throw error;
      }
      continue;
    }

    const resultAction = await showResultScreen(rootDir, state.played);
    state = resolveDirectoryStateFromResultAction(resultAction, state);
  }

  process.exitCode = state.exitCode;
  return persistedConfig;
}

function resolvePersistedConfigForSongSelect(
  base: Pick<PersistedPlayerConfig, 'playMode' | 'highSpeed'>,
  directoryPath: string | undefined,
  preferredLastSelectedChartFile?: string,
  preferredFocusKey?: string,
  previous?: PersistedPlayerConfig,
): PersistedPlayerConfig {
  const resolved: PersistedPlayerConfig = {
    playMode: base.playMode,
    highSpeed: normalizeHighSpeedValue(base.highSpeed),
  };
  if (previous?.lastSelectedChartFileByDirectory) {
    resolved.lastSelectedChartFileByDirectory = { ...previous.lastSelectedChartFileByDirectory };
  }
  if (previous?.lastSongSelectFocusKeyByDirectory) {
    resolved.lastSongSelectFocusKeyByDirectory = { ...previous.lastSongSelectFocusKeyByDirectory };
  }
  const preferred = preferredLastSelectedChartFile?.trim();
  if (preferred) {
    if (directoryPath && directoryPath.length > 0) {
      const byDirectory = { ...(resolved.lastSelectedChartFileByDirectory ?? {}) };
      byDirectory[directoryPath] = preferred;
      resolved.lastSelectedChartFileByDirectory = byDirectory;
    }
  }
  const normalizedFocusKey = preferredFocusKey?.trim();
  if (normalizedFocusKey) {
    if (directoryPath && directoryPath.length > 0) {
      const byDirectory = { ...(resolved.lastSongSelectFocusKeyByDirectory ?? {}) };
      byDirectory[directoryPath] = normalizedFocusKey;
      resolved.lastSongSelectFocusKeyByDirectory = byDirectory;
    }
  }
  if (
    resolved.lastSelectedChartFileByDirectory &&
    Object.keys(resolved.lastSelectedChartFileByDirectory).length === 0
  ) {
    delete resolved.lastSelectedChartFileByDirectory;
  }
  if (
    resolved.lastSongSelectFocusKeyByDirectory &&
    Object.keys(resolved.lastSongSelectFocusKeyByDirectory).length === 0
  ) {
    delete resolved.lastSongSelectFocusKeyByDirectory;
  }
  return resolved;
}

function resolveLastSelectedChartFile(selection: SelectChartInteractivelyResult): string | undefined {
  if (typeof selection.selectedPath === 'string' && selection.selectedPath.length > 0) {
    return selection.selectedPath;
  }
  return resolveChartFileFromFocusKey(selection.focusKey);
}

function resolveLastSelectedChartFileForDirectory(
  config: PersistedPlayerConfig,
  directoryPath: string,
): string | undefined {
  const byDirectory = config.lastSelectedChartFileByDirectory;
  if (byDirectory) {
    const scoped = byDirectory[directoryPath];
    if (typeof scoped === 'string' && scoped.trim().length > 0) {
      return scoped;
    }
  }
  return undefined;
}

function resolveLastSongSelectFocusKeyForDirectory(
  config: PersistedPlayerConfig,
  directoryPath: string,
): string | undefined {
  const byDirectory = config.lastSongSelectFocusKeyByDirectory;
  if (byDirectory) {
    const scoped = byDirectory[directoryPath];
    if (typeof scoped === 'string' && scoped.trim().length > 0) {
      return scoped;
    }
  }
  return undefined;
}

function resolveDirectoryStateFromSelection(selection: SelectChartInteractivelyResult): DirectorySceneState {
  if (selection.reason === 'ctrl-c') {
    return {
      kind: 'exit',
      exitCode: 130,
    };
  }

  if (selection.reason === 'escape' || !selection.selectedPath) {
    return {
      kind: 'exit',
      exitCode: 0,
    };
  }

  return {
    kind: 'play',
    chartPath: selection.selectedPath,
    focusKey: selection.focusKey,
    playMode: selection.playMode,
    highSpeed: selection.highSpeed,
    difficultyFilter: selection.difficultyFilter,
  };
}

function resolveDirectoryStateFromPlayInterrupt(
  reason: PlayerInterruptedError['reason'],
  state: Extract<DirectorySceneState, { kind: 'play' }>,
): DirectorySceneState {
  if (reason === 'restart') {
    return {
      kind: 'play',
      chartPath: state.chartPath,
      focusKey: state.focusKey,
      playMode: state.playMode,
      highSpeed: state.highSpeed,
      difficultyFilter: state.difficultyFilter,
    };
  }
  if (reason === 'escape') {
    return {
      kind: 'select',
      focusKey: state.focusKey,
      playMode: state.playMode,
      highSpeed: state.highSpeed,
      difficultyFilter: state.difficultyFilter,
    };
  }
  return {
    kind: 'exit',
    exitCode: 130,
  };
}

function resolveDirectoryStateFromResultAction(
  action: ResultScreenAction,
  state: Extract<DirectorySceneState, { kind: 'result' }>,
): DirectorySceneState {
  if (action === 'replay') {
    return {
      kind: 'play',
      chartPath: state.played.chartPath,
      focusKey: state.focusKey,
      playMode: state.playMode,
      highSpeed: state.highSpeed,
      difficultyFilter: state.difficultyFilter,
    };
  }

  if (action === 'enter' || action === 'escape') {
    return {
      kind: 'select',
      focusKey: state.focusKey,
      playMode: state.playMode,
      highSpeed: state.highSpeed,
      difficultyFilter: state.difficultyFilter,
    };
  }

  return {
    kind: 'exit',
    exitCode: action === 'ctrl-c' ? 130 : 0,
  };
}

async function playChartOnce(chartPath: string, args: CliArgs): Promise<PlayedChartResult> {
  let resolvedHighSpeed = normalizeHighSpeedValue(args.highSpeed);
  let playLoadingStageFileImage: StageFileAnsiImage | undefined;
  const useKittyGraphicsForStageFile =
    args.kittyGraphics === true && Boolean(process.stdout.isTTY) && supportsKittyGraphicsProtocol(process.env);
  const playLoadingScreenRenderState: PlayLoadingScreenRenderState = {
    initialized: false,
    stageFileDrawn: false,
    stageFileKittyVisible: false,
  };
  let resolvedChartMetadata:
    | {
        title?: string;
        artist?: string;
        player?: number;
        rank: number;
        rankLabel?: string;
        playLevel?: BeMusicPlayLevel;
      }
    | undefined;
  const reportPlayLoadingProgress = process.stdout.isTTY
    ? (progress: PlayLoadingProgress): void => {
        renderPlayLoadingProgress(chartPath, progress, {
          columns: process.stdout.columns,
          stageFileImage: playLoadingStageFileImage,
          useKittyGraphics: useKittyGraphicsForStageFile,
          state: playLoadingScreenRenderState,
        });
      }
    : undefined;
  const chartLoadingAbortCapture = beginLoadingAbortCapture();
  let json: Awaited<ReturnType<typeof parseChartFile>>;
  try {
    reportPlayLoadingProgress?.({
      ratio: 0.03,
      message: 'Parsing chart file...',
    });
    json = await parseChartFile(chartPath, {
      signal: chartLoadingAbortCapture?.signal,
    });
    if (process.stdout.isTTY && typeof json.metadata.stageFile === 'string' && json.metadata.stageFile.length > 0) {
      reportPlayLoadingProgress?.({
        ratio: 0.12,
        message: 'Loading stage image...',
        detail: json.metadata.stageFile.replaceAll('\\', '/'),
      });
      const stageFileDisplaySize = resolvePlayLoadingStageFileDisplaySize(process.stdout.columns, process.stdout.rows);
      playLoadingStageFileImage = await loadStageFileAnsiImage(json, {
        baseDir: dirname(chartPath),
        width: stageFileDisplaySize.width,
        height: stageFileDisplaySize.height,
        signal: chartLoadingAbortCapture?.signal,
      });
    }
    reportPlayLoadingProgress?.({
      ratio: 0.16,
      message: 'Chart parsed.',
    });

    if (args.renderAudioPath) {
      reportPlayLoadingProgress?.({
        ratio: 0.2,
        message: 'Rendering preview audio...',
      });
      const outputPath = resolveCliPath(args.renderAudioPath);
      const audioRendered = await renderJson(json, {
        baseDir: dirname(chartPath),
        inferBmsLnTypeWhenMissing: args.inferBmsLnTypeWhenMissing,
        signal: chartLoadingAbortCapture?.signal,
      });
      await writeAudioFile(outputPath, audioRendered);
      process.stdout.write(`Rendered preview audio: ${outputPath}\n`);
      reportPlayLoadingProgress?.({
        ratio: 0.32,
        message: 'Preview audio rendered.',
      });
    }
  } catch (error) {
    const cancelReason = resolveLoadingCancelReason(error, chartLoadingAbortCapture);
    if (cancelReason) {
      throw new PlayerInterruptedError(cancelReason);
    }
    throw error;
  } finally {
    chartLoadingAbortCapture?.dispose();
  }

  const playOptions = {
    inferBmsLnTypeWhenMissing: args.inferBmsLnTypeWhenMissing,
    showInvisibleNotes: args.showInvisibleNotes,
    compressor: args.compressor,
    compressorThresholdDb: args.compressorThresholdDb,
    compressorRatio: args.compressorRatio,
    compressorAttackMs: args.compressorAttackMs,
    compressorReleaseMs: args.compressorReleaseMs,
    compressorMakeupDb: args.compressorMakeupDb,
    limiter: args.limiter,
    limiterCeilingDb: args.limiterCeilingDb,
    limiterReleaseMs: args.limiterReleaseMs,
    speed: args.speed,
    uiFps: args.uiFps,
    highSpeed: args.highSpeed,
    judgeWindowMs: args.judgeWindowMs,
    debugActiveAudio: args.debugActiveAudio,
    audio: args.audio,
    volume: args.volume,
    bgmVolume: args.bgmVolume,
    playVolume: args.playVolume,
    audioBaseDir: dirname(chartPath),
    audioTailSeconds: args.audioTailSeconds,
    audioOffsetMs: args.audioOffsetMs,
    audioHeadPaddingMs: args.audioHeadPaddingMs,
    audioLeadMs: args.audioLeadMs,
    audioLeadMaxMs: args.audioLeadMaxMs,
    audioLeadStepUpMs: args.audioLeadStepUpMs,
    audioLeadStepDownMs: args.audioLeadStepDownMs,
    laneModeExtension: (() => {
      const extension = extname(chartPath).toLowerCase();
      return extension.length > 0 ? extension : undefined;
    })(),
    tui: args.tui,
    kittyGraphics: args.kittyGraphics,
  };

  let summary: PlayerSummary;
  while (true) {
    let playbackLoadingAbortCapture = beginLoadingAbortCapture();
    const disposePlaybackLoadingAbortCapture = (): void => {
      playbackLoadingAbortCapture?.dispose();
      playbackLoadingAbortCapture = undefined;
    };
    try {
      summary = await runNodeGameplayRuntime({
        json,
        mode: args.auto ? 'auto' : 'manual',
        autoScratch: args.autoScratch,
        playOptions,
        signal: playbackLoadingAbortCapture?.signal,
        writeOutput: (text: string): void => {
          process.stdout.write(text);
        },
        onHighSpeedChange: (value: number): void => {
          resolvedHighSpeed = normalizeHighSpeedValue(value);
        },
        onLoadProgress: reportPlayLoadingProgress
          ? (progress: PlayerLoadProgress): void => {
              const mappedRatio = 0.22 + Math.max(0, Math.min(1, progress.ratio)) * 0.76;
              reportPlayLoadingProgress({
                ratio: mappedRatio,
                message: progress.message,
                detail: progress.detail,
                audioStatus: progress.audioStatus,
                graphicsStatus: progress.graphicsStatus,
              });
            }
          : undefined,
        onLoadComplete: () => {
          clearPlayLoadingStageFileImage(playLoadingScreenRenderState);
          disposePlaybackLoadingAbortCapture();
        },
        onResolvedChart: (metadata) => {
          resolvedChartMetadata = metadata;
        },
      });
      break;
    } catch (error) {
      const cancelReason = resolveLoadingCancelReason(error, playbackLoadingAbortCapture);
      if (cancelReason) {
        throw new PlayerInterruptedError(cancelReason);
      }
      if (error instanceof PlayerInterruptedError && error.reason === 'restart') {
        playLoadingScreenRenderState.stageFileDrawn = false;
        reportPlayLoadingProgress?.({
          ratio: 0.34,
          message: 'Restarting playback...',
        });
        continue;
      }
      throw error;
    } finally {
      clearPlayLoadingStageFileImage(playLoadingScreenRenderState);
      disposePlaybackLoadingAbortCapture();
      args.highSpeed = resolvedHighSpeed;
    }
  }
  const title = sanitizeMetadataText(json.metadata.title);
  const artist = sanitizeMetadataText(json.metadata.artist);

  return {
    chartPath,
    summary,
    title: sanitizeMetadataText(resolvedChartMetadata?.title) ?? title,
    artist: sanitizeMetadataText(resolvedChartMetadata?.artist) ?? artist,
    player: resolvedChartMetadata?.player ?? json.bms.player,
    rank: resolvedChartMetadata?.rank ?? resolveDisplayedJudgeRankValue(json),
    rankLabel: resolvedChartMetadata?.rankLabel ?? resolveDisplayedJudgeRankLabel(json),
    playLevel: resolvedChartMetadata?.playLevel ?? resolveDisplayedPlayLevelValue(json),
  };
}

async function playSingleChartUntilExit(
  chartPath: string,
  rootDir: string,
  args: CliArgs,
): Promise<ResultScreenExitAction> {
  while (true) {
    const played = await playChartOnce(chartPath, args);
    const action = await showResultScreen(rootDir, played, {
      allowReplay: true,
      nextActionLabel: 'exit player',
    });
    if (action === 'replay') {
      continue;
    }
    return action;
  }
}

function sanitizeMetadataText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function createSongSelectSelectedMetadataLines(
  entry: ChartSelectionEntry | undefined,
  lineWidth: number,
  options: SongSelectMetadataRenderOptions = {},
): string[] {
  const bannerLayout = resolveSongSelectMetadataBannerLayout(lineWidth, options);
  const metadataWidth = bannerLayout
    ? Math.max(8, lineWidth - bannerLayout.requestedBannerWidth - SONG_SELECT_BANNER_GAP)
    : lineWidth;
  const title =
    entry?.kind === 'chart' ? (sanitizeMetadataText(entry.title) ?? sanitizeMetadataText(entry.fileLabel)) : '-';
  const subtitle = entry?.kind === 'chart' ? sanitizeMetadataText(entry.subtitle) : undefined;
  const artist = entry?.kind === 'chart' ? sanitizeMetadataText(entry.artist) : '-';
  const subartist = entry?.kind === 'chart' ? sanitizeMetadataText(entry.subartist) : undefined;
  const genre = entry?.kind === 'chart' ? sanitizeMetadataText(entry.genre) : '-';
  const comment = entry?.kind === 'chart' ? sanitizeMetadataText(entry.comment) : '-';
  const baseLines = [
    formatSongSelectMetadataLine('TITLE', title ?? '-', subtitle, metadataWidth),
    formatSongSelectMetadataLine('ARTIST', artist ?? '-', subartist, metadataWidth),
    formatSongSelectMetadataLine('GENRE', genre ?? '-', undefined, metadataWidth),
    formatSongSelectMetadataLine('COMMENT', comment ?? '-', undefined, metadataWidth),
  ];
  return bannerLayout ? composeSongSelectMetadataLinesWithBanner(baseLines, lineWidth, bannerLayout) : baseLines;
}

function resolveSongSelectMetadataBannerLayout(
  lineWidth: number,
  options: SongSelectMetadataRenderOptions,
): SongSelectBannerLayout | undefined {
  const visibleBannerLines = options.bannerLines?.filter((line) => measureSongSelectDisplayWidth(line) > 0) ?? [];
  const requestedBannerWidth =
    visibleBannerLines.length > 0
      ? visibleBannerLines.reduce((max, line) => Math.max(max, measureSongSelectDisplayWidth(line)), 0)
      : Math.max(0, Math.floor(options.bannerWidth ?? 0));
  if (requestedBannerWidth <= 0 || requestedBannerWidth + SONG_SELECT_BANNER_GAP >= lineWidth) {
    return undefined;
  }
  return {
    visibleBannerLines,
    requestedBannerWidth,
  };
}

function composeSongSelectMetadataLinesWithBanner(
  baseLines: readonly string[],
  lineWidth: number,
  layout: SongSelectBannerLayout,
): string[] {
  return baseLines.map((line, index) => {
    const bannerLine = layout.visibleBannerLines[index];
    const leftVisibleWidth = measureSongSelectDisplayWidth(line);
    const paddingWidth = Math.max(
      bannerLine ? SONG_SELECT_BANNER_GAP : 0,
      lineWidth - layout.requestedBannerWidth - leftVisibleWidth,
    );
    if (!bannerLine) {
      return `${line}${' '.repeat(Math.max(0, lineWidth - leftVisibleWidth))}`;
    }
    return `${line}${' '.repeat(paddingWidth)}${bannerLine}`;
  });
}

function formatSongSelectMetadataLine(
  label: 'TITLE' | 'ARTIST' | 'GENRE' | 'COMMENT',
  primary: string,
  secondary: string | undefined,
  lineWidth: number,
): string {
  const base = truncateForDisplay(`${label} ${primary}`, lineWidth);
  if (!secondary) {
    return base;
  }

  const baseWidth = measureSongSelectDisplayWidth(base);
  if (baseWidth >= lineWidth) {
    return base;
  }

  const secondaryWidthBudget = lineWidth - baseWidth - 1;
  if (secondaryWidthBudget <= 0) {
    return base;
  }

  const suffix = truncateForDisplay(secondary, secondaryWidthBudget);
  return suffix.length > 0 ? `${base} ${SONG_SELECT_METADATA_SECONDARY_COLOR}${suffix}${ANSI_RESET}` : base;
}

function measureSongSelectDisplayWidth(value: string): number {
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
    width += measureSongSelectCharacterDisplayWidth(char);
  }
  return width;
}

function measureSongSelectCharacterDisplayWidth(char: string): number {
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
  return isSongSelectFullWidthCodePoint(codePoint) ? 2 : 1;
}

function isSongSelectFullWidthCodePoint(codePoint: number): boolean {
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

function resolveSongSelectBannerDisplayWidth(lineWidth: number): number {
  const available = Math.min(
    SONG_SELECT_BANNER_MAX_WIDTH,
    lineWidth - SONG_SELECT_BANNER_MIN_TEXT_WIDTH - SONG_SELECT_BANNER_GAP,
  );
  return available >= SONG_SELECT_BANNER_MIN_WIDTH ? available : 0;
}

function createSongSelectBannerState(): SongSelectBannerState {
  return {
    cache: new Map<string, TerminalAnsiImage | null>(),
    loadSequence: 0,
    kittyVisible: false,
  };
}

function resolveSongSelectBannerCacheKey(
  entry: ChartSelectionEntry | undefined,
  bannerWidth: number,
): string | undefined {
  if (entry?.kind !== 'chart' || typeof entry.bannerPath !== 'string' || bannerWidth <= 0) {
    return undefined;
  }
  return `${entry.filePath}\u0000${entry.bannerPath}\u0000${bannerWidth}`;
}

function clearSongSelectBannerLoad(state: SongSelectBannerState): void {
  state.loadController?.abort();
  state.loadController = undefined;
}

function syncSongSelectBanner(params: {
  state: SongSelectBannerState;
  entry: ChartSelectionEntry | undefined;
  lineWidth: number;
  useKittyGraphics: boolean;
  finished: boolean;
  onReady: () => void;
}): void {
  const bannerWidth = resolveSongSelectBannerDisplayWidth(params.lineWidth);
  const cacheKey = resolveSongSelectBannerCacheKey(params.entry, bannerWidth);
  if (!cacheKey || params.entry?.kind !== 'chart' || typeof params.entry.bannerPath !== 'string') {
    clearSongSelectBannerLoad(params.state);
    params.state.activeCacheKey = undefined;
    params.state.activeImage = undefined;
    return;
  }
  if (params.state.activeCacheKey === cacheKey) {
    return;
  }

  clearSongSelectBannerLoad(params.state);
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
  void loadTerminalAnsiImage(dirname(params.entry.filePath), params.entry.bannerPath, {
    width: bannerWidth,
    height: SONG_SELECT_BANNER_HEIGHT,
    signal: controller.signal,
    fitMode: 'contain',
    includeKittyImage: params.useKittyGraphics,
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

function resolveSongSelectBannerDisplayState(
  entry: ChartSelectionEntry | undefined,
  lineWidth: number,
  useKittyGraphics: boolean,
  state: SongSelectBannerState,
): SongSelectBannerDisplayState {
  const bannerWidth = resolveSongSelectBannerDisplayWidth(lineWidth);
  const cacheKey = resolveSongSelectBannerCacheKey(entry, bannerWidth);
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

function resolveSongSelectBannerOverlaySequence(params: {
  lineWidth: number;
  reservedWidth?: number;
  useKittyGraphics: boolean;
  state: SongSelectBannerState;
}): string {
  if (!(params.useKittyGraphics && params.state.activeImage?.kittyImage)) {
    return buildSongSelectBannerCleanupSequence(params.state);
  }
  const bannerBlockWidth = params.reservedWidth ?? params.state.activeImage.kittyImage.cellWidth;
  const column = Math.max(1, params.lineWidth - bannerBlockWidth + 1);
  params.state.kittyVisible = true;
  return buildKittyGraphicsRenderSequence({
    imageId: SONG_SELECT_BANNER_KITTY_IMAGE_ID,
    placementId: 1,
    row: 1,
    column,
    image: params.state.activeImage.kittyImage,
    zIndex: -1,
    doNotMoveCursor: true,
  });
}

function buildSongSelectBannerCleanupSequence(state: SongSelectBannerState): string {
  if (!state.kittyVisible) {
    return '';
  }
  state.kittyVisible = false;
  return buildKittyGraphicsDeleteImageSequence(SONG_SELECT_BANNER_KITTY_IMAGE_ID);
}

export function createSongSelectControlLines(options: {
  rootDir: string;
  lineWidth: number;
  playModeLabel: string;
  highSpeedLabel: string;
  difficultyFilterLabel: string;
  audioBackendLabel: string;
}): string[] {
  return [
    truncateForDisplay(SONG_SELECT_HELP_LINE, options.lineWidth),
    truncateForDisplay(`Directory: ${options.rootDir}`, options.lineWidth),
    truncateForDisplay(
      `Mode: ${options.playModeLabel}  HIGH-SPEED: x${options.highSpeedLabel}  DIFFICULTY: ${options.difficultyFilterLabel}`,
      options.lineWidth,
    ),
    truncateForDisplay(`Audio backend: ${options.audioBackendLabel}`, options.lineWidth),
  ];
}

export function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {
    auto: false,
    autoScratch: false,
    kittyGraphics: false,
    inferBmsLnTypeWhenMissing: false,
    showInvisibleNotes: false,
    compressor: false,
    limiter: true,
    audio: true,
    volume: undefined,
    tui: true,
    uiFps: DEFAULT_TUI_FPS,
    debugActiveAudio: false,
  };
  const positional: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--auto') {
      args.auto = true;
      args.autoScratch = false;
      continue;
    }
    if (token === '--auto-scratch') {
      args.auto = false;
      args.autoScratch = true;
      continue;
    }
    if (token === '--ln-type-auto') {
      args.inferBmsLnTypeWhenMissing = true;
      continue;
    }
    if (token === '--show-invisible-notes') {
      args.showInvisibleNotes = true;
      continue;
    }
    if (token === '--no-show-invisible-notes') {
      args.showInvisibleNotes = false;
      continue;
    }
    if (token === '--speed') {
      args.speed = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--high-speed') {
      args.highSpeed = parseHighSpeedArg(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--tui-fps') {
      args.uiFps = parseTuiFpsArg(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--compressor') {
      args.compressor = true;
      continue;
    }
    if (token === '--no-compressor') {
      args.compressor = false;
      continue;
    }
    if (token === '--compressor-threshold-db') {
      args.compressorThresholdDb = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--compressor-ratio') {
      args.compressorRatio = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--compressor-attack-ms') {
      args.compressorAttackMs = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--compressor-release-ms') {
      args.compressorReleaseMs = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--compressor-makeup-db') {
      args.compressorMakeupDb = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--limiter') {
      args.limiter = true;
      continue;
    }
    if (token === '--no-limiter') {
      args.limiter = false;
      continue;
    }
    if (token === '--limiter-ceiling-db') {
      args.limiterCeilingDb = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--limiter-release-ms') {
      args.limiterReleaseMs = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--debug-judge-window') {
      args.judgeWindowMs = Number.parseInt(rawArgs[index + 1], 10);
      args.judgeWindowSource = 'debug';
      index += 1;
      continue;
    }
    if (token === '--debug-active-audio') {
      args.debugActiveAudio = true;
      continue;
    }
    if (token === '--judge-window') {
      args.judgeWindowMs = Number.parseInt(rawArgs[index + 1], 10);
      args.judgeWindowSource = 'legacy';
      index += 1;
      continue;
    }
    if (token === '--render-audio') {
      args.renderAudioPath = rawArgs[index + 1];
      index += 1;
      continue;
    }
    if (token === '--audio-tail') {
      args.audioTailSeconds = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--bgm-volume') {
      args.bgmVolume = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--volume') {
      args.volume = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--play-volume' || token === '--key-volume') {
      args.playVolume = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--audio-offset-ms') {
      args.audioOffsetMs = Number.parseInt(rawArgs[index + 1], 10);
      index += 1;
      continue;
    }
    if (token === '--audio-head-padding-ms') {
      args.audioHeadPaddingMs = Number.parseInt(rawArgs[index + 1], 10);
      index += 1;
      continue;
    }
    if (token === '--audio-lead-ms') {
      args.audioLeadMs = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--audio-lead-max-ms') {
      args.audioLeadMaxMs = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--audio-lead-step-up-ms') {
      args.audioLeadStepUpMs = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--audio-lead-step-down-ms') {
      args.audioLeadStepDownMs = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (
      token === '--audio-io-buffer-ms' ||
      token === '--audio-io-high-water-ms' ||
      token === '--audio-io-low-water-ms'
    ) {
      throw new Error(`${token} is no longer supported; audio-io backend has been removed`);
    }
    if (token === '--audio-backend') {
      throw new Error('--audio-backend is no longer supported; node-web-audio-api is always used');
    }
    if (token === '--audify-high-water-ms' || token === '--audify-low-water-ms') {
      throw new Error(`${token} is no longer supported; audify backend has been removed`);
    }
    if (token === '--speaker-buffer-size' || token === '--speaker-samples-per-frame') {
      throw new Error(`${token} is no longer supported; speaker backend has been removed`);
    }
    if (token.startsWith('--audio-backend=')) {
      throw new Error('--audio-backend is no longer supported; node-web-audio-api is always used');
    }
    if (token.startsWith('--audify-')) {
      throw new Error(`${token.split('=')[0]} is no longer supported; audify backend has been removed`);
    }
    if (token.startsWith('--speaker-')) {
      throw new Error(`${token.split('=')[0]} is no longer supported; speaker backend has been removed`);
    }
    if (token === '--no-audio') {
      args.audio = false;
      continue;
    }
    if (token === '--audio') {
      args.audio = true;
      continue;
    }
    if (token === '--preview' || token === '--preview-audio') {
      continue;
    }
    if (token === '--no-preview' || token === '--no-preview-audio') {
      throw new Error(`${token} is no longer supported; song preview is always enabled`);
    }
    if (token === '--no-tui') {
      args.tui = false;
      continue;
    }
    if (token === '--tui') {
      args.tui = true;
      continue;
    }
    if (token === '--kitty-graphics') {
      args.kittyGraphics = true;
      continue;
    }
    if (token === '--no-kitty-graphics') {
      args.kittyGraphics = false;
      continue;
    }
    positional.push(token);
  }

  args.input = positional[0];
  return args;
}

function parseHighSpeedArg(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw ?? '');
  if (!Number.isFinite(parsed)) {
    throw new Error('--high-speed expects a numeric value');
  }
  if (parsed < MIN_HIGH_SPEED || parsed > MAX_HIGH_SPEED) {
    throw new Error(`--high-speed must be between ${MIN_HIGH_SPEED} and ${MAX_HIGH_SPEED}`);
  }
  const steps = parsed / HIGH_SPEED_STEP;
  const roundedSteps = Math.round(steps);
  if (Math.abs(steps - roundedSteps) > 1e-9) {
    throw new Error(`--high-speed must be in ${HIGH_SPEED_STEP} increments`);
  }
  return roundedSteps * HIGH_SPEED_STEP;
}

function parseTuiFpsArg(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw ?? '');
  if (!Number.isFinite(parsed)) {
    throw new Error('--tui-fps expects a numeric value');
  }
  if (parsed <= 0) {
    throw new Error('--tui-fps must be greater than 0');
  }
  return parsed;
}

function formatCliParseError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Failed to parse CLI arguments';
}

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: bms-player <input.(bms|bme|bml|pms|bmson|json)|directory> [options]',
      '',
      'Essential options:',
      '  --auto                    Enable auto play mode (default: off)',
      '  --auto-scratch            Enable scratch auto mode (16ch/26ch only)',
      '  --speed <rate>            Playback speed multiplier (default: 1)',
      `  --tui-fps <value>        Target TUI refresh rate while playing (default: ${DEFAULT_TUI_FPS})`,
      '  --high-speed <rate>       TUI note fall speed multiplier, 0.5-10.0 in 0.5 steps (default: 1.0)',
      '  --audio / --no-audio      Enable or disable in-game audio playback (default: on)',
      '                           Audio backend: node-web-audio-api (fixed)',
      '  --tui / --no-tui          Enable or disable TUI play screen (default: on in TTY)',
      '  --kitty-graphics          Enable Kitty graphics protocol BGA rendering when supported (default: off)',
      '',
      'Advanced tuning:',
      '  --show-invisible-notes    Show invisible channels (31-39/41-49) in TUI as green notes',
      '  --ln-type-auto            Auto-detect BMS #LNTYPE when omitted (default: off)',
      '  --render-audio <path>     Render audio preview before playing',
      '  --volume <value>          Global volume multiplier applied before bus-specific volumes (default: 1)',
      '  --bgm-volume <value>      Volume multiplier for non-play lanes (default: 1, 0 disables BGM)',
      '  --key-volume <value>      Volume multiplier for playable/key sounds (alias: --play-volume, default: 1)',
      '  --audio-tail <seconds>    Audio tail length when rendering playback buffer (default: 1.5)',
      '  --audio-offset-ms <ms>    Timing offset for audio sync calibration (default: 0)',
      '  --compressor / --no-compressor',
      '                            Enable or disable output compressor (default: off)',
      '  --compressor-threshold-db Compressor threshold in dBFS (default: -12)',
      '  --compressor-ratio        Compressor ratio (default: 2.5)',
      '  --compressor-attack-ms    Compressor attack time in ms (default: 8)',
      '  --compressor-release-ms   Compressor release time in ms (default: 120)',
      '  --compressor-makeup-db    Compressor makeup gain in dB (default: 0)',
      '  --limiter / --no-limiter  Enable or disable output limiter (default: on)',
      '  --limiter-ceiling-db      Limiter ceiling in dBFS (default: -0.3)',
      '  --limiter-release-ms      Limiter release time in ms (default: 80)',
      '  --audio-head-padding-ms   Silent head padding before chart start (default: 0)',
      '  --audio-lead-ms <ms>      Base lead time for real-time mixer scheduling (default: 10)',
      '  --audio-lead-max-ms <ms>  Maximum adaptive lead time under heavy load (default: 32)',
      '  --audio-lead-step-up-ms   Adaptive lead increment step (default: 1.5)',
      '  --audio-lead-step-down-ms Adaptive lead decrement step (default: 0.5)',
      '',
      'Developer/debug:',
      '  --debug-active-audio      Show currently sounding key-sound filenames on play screen (default: off)',
      '  --debug-judge-window <ms> Override BAD window for debugging',
      '  --judge-window <ms>       Deprecated alias for --debug-judge-window',
    ].join('\n') + '\n',
  );
}

function beginRawInputCapture(): RawInputCapture {
  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRawMode = Boolean(stdin.isRaw);
  let restored = false;
  readline.emitKeypressEvents(process.stdin);
  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }
  stdin.resume();
  return {
    stdin,
    restore: () => {
      if (restored) {
        return;
      }
      restored = true;
      if (stdin.isTTY) {
        stdin.setRawMode(wasRawMode);
      }
    },
  };
}

function beginLoadingAbortCapture(): LoadingAbortCapture | undefined {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }
  const inputCapture = beginRawInputCapture();
  const controller = new AbortController();
  let reason: LoadingCancelReason | undefined;
  const onKeyPress = (_chunk: string | undefined, key: readline.Key): void => {
    if (key.sequence === '\u0003') {
      reason = 'ctrl-c';
      controller.abort();
      return;
    }
    if (key.name?.toLowerCase() === 'escape' || key.sequence === '\u001b') {
      reason = 'escape';
      controller.abort();
    }
  };
  inputCapture.stdin.on('keypress', onKeyPress);
  return {
    signal: controller.signal,
    getReason: () => reason,
    dispose: () => {
      inputCapture.stdin.removeListener('keypress', onKeyPress);
      inputCapture.restore();
    },
  };
}

function resolveLoadingCancelReason(
  error: unknown,
  capture: LoadingAbortCapture | undefined,
): LoadingCancelReason | undefined {
  if (!isAbortError(error)) {
    return undefined;
  }
  return capture?.getReason();
}

function applyLoadingCancel(reason: LoadingCancelReason): void {
  process.exitCode = reason === 'ctrl-c' ? 130 : 0;
  if (process.stdout.isTTY) {
    process.stdout.write('\u001b[2J\u001b[H');
  }
}

async function loadChartSelectionEntries(rootDir: string, files: string[]): Promise<ChartSelectionEntry[] | undefined> {
  const loadingAbortCapture = beginLoadingAbortCapture();
  process.stdout.write('\u001b[?25l');

  try {
    const entries = await buildChartSelectionEntries(rootDir, files, {
      onLoadingFile: (progress) => {
        renderChartLoadingProgress(rootDir, progress);
      },
      signal: loadingAbortCapture?.signal,
    });
    return entries;
  } catch (error) {
    const cancelReason = resolveLoadingCancelReason(error, loadingAbortCapture);
    if (cancelReason) {
      applyLoadingCancel(cancelReason);
      return undefined;
    }
    throw error;
  } finally {
    loadingAbortCapture?.dispose();
    process.stdout.write('\u001b[?25h');
  }
}

function renderChartLoadingProgress(rootDir: string, progress: ChartSummaryLoadingProgress): void {
  const columns = process.stdout.columns ?? 80;
  const lineWidth = Math.max(16, columns - 2);
  const relativePath = relative(rootDir, progress.filePath).replaceAll('\\', '/');
  const ratio = progress.totalCount > 0 ? progress.currentIndex / progress.totalCount : 0;
  const barWidth = Math.max(10, Math.min(48, lineWidth - 8));
  const filled = Math.max(0, Math.min(barWidth, Math.round(barWidth * ratio)));
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(barWidth - filled)}] ${Math.round(ratio * 100)}%`;
  const lines = [
    `Loading charts... (${progress.currentIndex}/${progress.totalCount})`,
    truncateForDisplay(bar, lineWidth),
    truncateForDisplay(`Loading: ${relativePath}`, lineWidth),
    '',
    'Press Ctrl+C or Esc to exit.',
  ];
  process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\u001b[J`);
}

export function resolvePlayLoadingStageFileDisplaySize(
  columns?: number,
  rows?: number,
): {
  width: number;
  height: number;
} {
  const safeColumns = Math.max(16, Math.floor(columns ?? 80));
  const safeRows = Math.max(8, Math.floor(rows ?? 24));
  return {
    width: safeColumns,
    height: safeRows,
  };
}

function formatPlayLoadingComponentStatus(label: string, status: PlayerLoadComponentStatus | undefined): string {
  if (!status) {
    return `${label}: -`;
  }
  if (status.state === 'ready' || status.state === 'disabled') {
    return `${label}: ${status.message}`;
  }
  return typeof status.detail === 'string' && status.detail.length > 0
    ? `${label}: ${status.message} (${status.detail})`
    : `${label}: ${status.message}`;
}

function resolvePlayLoadingStepLabel(progress: PlayLoadingProgress): string {
  if (progress.audioStatus || progress.graphicsStatus) {
    return 'Loading playback resources...';
  }
  if (
    progress.message === 'Parsing chart file...' ||
    progress.message === 'Loading stage image...' ||
    progress.message === 'Chart parsed.'
  ) {
    return 'Loading chart resources...';
  }
  return progress.message;
}

export function createPlayLoadingProgressScreenLines(
  chartPath: string,
  progress: PlayLoadingProgress,
  options: {
    columns?: number;
    stageFileImage?: StageFileAnsiImage;
  } = {},
): string[] {
  const columns = options.columns ?? 80;
  const lineWidth = Math.max(16, columns);
  const fileLabel = chartPath.replaceAll('\\', '/');
  const ratio = Math.max(0, Math.min(1, progress.ratio));
  const barWidth = Math.max(10, Math.min(48, lineWidth - 8));
  const filled = Math.max(0, Math.min(barWidth, Math.round(barWidth * ratio)));
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(barWidth - filled)}] ${Math.round(ratio * 100)}%`;
  const rawLines = [
    'Loading selected chart...',
    bar,
    `Step: ${resolvePlayLoadingStepLabel(progress)}`,
    formatPlayLoadingComponentStatus('Sound', progress.audioStatus),
    formatPlayLoadingComponentStatus('Visual', progress.graphicsStatus),
    `File: ${fileLabel}`,
  ];
  return rawLines.map((line, index) =>
    options.stageFileImage
      ? stylePlayLoadingOverlayLineOnImage(line, lineWidth, index, options.stageFileImage)
      : stylePlayLoadingOverlayFallbackLine(line, lineWidth),
  );
}

export function createPlayLoadingProgressScreenOutput(
  chartPath: string,
  progress: PlayLoadingProgress,
  options: {
    columns?: number;
    stageFileImage?: StageFileAnsiImage;
    useKittyGraphics?: boolean;
    resetScreen?: boolean;
    includeStageFileImage?: boolean;
  } = {},
): string {
  const overlayLines = createPlayLoadingProgressScreenLines(chartPath, progress, {
    columns: options.columns,
    stageFileImage: options.stageFileImage,
  });
  const imageBlock = resolvePlayLoadingStageFileBlock(options.stageFileImage, {
    includeStageFileImage: options.includeStageFileImage,
    useKittyGraphics: options.useKittyGraphics,
  });
  const prefix = options.resetScreen === false ? '\u001b[H' : '\u001b[2J\u001b[H';
  return `${prefix}${imageBlock}${overlayLines.join('\n')}`;
}

function renderPlayLoadingProgress(
  chartPath: string,
  progress: PlayLoadingProgress,
  options: {
    columns?: number;
    stageFileImage?: StageFileAnsiImage;
    useKittyGraphics?: boolean;
    state: PlayLoadingScreenRenderState;
  },
): void {
  const shouldRedrawStageFile = Boolean(options.stageFileImage) && !options.state.stageFileDrawn;
  const shouldResetScreen = !options.state.initialized || shouldRedrawStageFile;
  const output = createPlayLoadingProgressScreenOutput(chartPath, progress, {
    columns: options.columns,
    stageFileImage: options.stageFileImage,
    useKittyGraphics: options.useKittyGraphics,
    resetScreen: shouldResetScreen,
    includeStageFileImage: shouldRedrawStageFile,
  });
  process.stdout.write(output);
  options.state.initialized = true;
  if (options.stageFileImage) {
    options.state.stageFileDrawn = true;
    options.state.stageFileKittyVisible =
      options.useKittyGraphics === true && options.stageFileImage.kittyImage !== undefined;
  }
}

function resolvePlayLoadingStageFileBlock(
  stageFileImage: StageFileAnsiImage | undefined,
  options: {
    includeStageFileImage?: boolean;
    useKittyGraphics?: boolean;
  },
): string {
  if (options.includeStageFileImage === false || !stageFileImage) {
    return '';
  }
  if (options.useKittyGraphics === true && stageFileImage.kittyImage) {
    return (
      buildKittyGraphicsRenderSequence({
        imageId: PLAY_LOADING_STAGEFILE_KITTY_IMAGE_ID,
        placementId: 1,
        row: 1,
        column: 1,
        image: stageFileImage.kittyImage,
        zIndex: -1,
        doNotMoveCursor: true,
      }) + '\u001b[H'
    );
  }
  return stageFileImage.lines.length > 0 ? `${stageFileImage.lines.join('\n')}\u001b[H` : '';
}

function clearPlayLoadingStageFileImage(state: PlayLoadingScreenRenderState): void {
  if (!state.stageFileKittyVisible) {
    return;
  }
  process.stdout.write(buildKittyGraphicsDeleteImageSequence(PLAY_LOADING_STAGEFILE_KITTY_IMAGE_ID));
  state.stageFileKittyVisible = false;
}

function stylePlayLoadingOverlayFallbackLine(text: string, lineWidth: number): string {
  return `\u001b[38;2;255;255;255;48;2;0;0;0m${truncateForDisplay(text, lineWidth).padEnd(lineWidth, ' ')}\u001b[0m`;
}

function stylePlayLoadingOverlayLineOnImage(
  text: string,
  lineWidth: number,
  rowIndex: number,
  stageFileImage: StageFileAnsiImage,
): string {
  const content = truncateForDisplay(text, lineWidth).padEnd(lineWidth, ' ');
  if (rowIndex >= stageFileImage.height) {
    return stylePlayLoadingOverlayFallbackLine(content, lineWidth);
  }

  let line = '';
  let currentStyle = '';
  for (let index = 0; index < content.length; index += 1) {
    const bg = getStageFilePixel(stageFileImage, rowIndex, index);
    const fg = resolveOverlayTextColor(bg.r, bg.g, bg.b);
    const nextStyle = `\u001b[38;2;${fg.r};${fg.g};${fg.b};48;2;${bg.r};${bg.g};${bg.b}m`;
    if (nextStyle !== currentStyle) {
      line += nextStyle;
      currentStyle = nextStyle;
    }
    line += content[index];
  }
  if (currentStyle.length > 0) {
    line += '\u001b[0m';
  }
  return line;
}

function getStageFilePixel(
  stageFileImage: StageFileAnsiImage,
  rowIndex: number,
  columnIndex: number,
): { r: number; g: number; b: number } {
  const x = Math.max(0, Math.min(stageFileImage.width - 1, columnIndex));
  const y = Math.max(0, Math.min(stageFileImage.height - 1, rowIndex));
  const rgbOffset = (y * stageFileImage.width + x) * 3;
  return {
    r: stageFileImage.rgb[rgbOffset] ?? 0,
    g: stageFileImage.rgb[rgbOffset + 1] ?? 0,
    b: stageFileImage.rgb[rgbOffset + 2] ?? 0,
  };
}

function resolveOverlayTextColor(r: number, g: number, b: number): { r: 0 | 255; g: 0 | 255; b: 0 | 255 } {
  const whiteContrast = calculateContrastRatio(r, g, b, 255, 255, 255);
  const blackContrast = calculateContrastRatio(r, g, b, 0, 0, 0);
  return whiteContrast >= blackContrast ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
}

function calculateContrastRatio(
  backgroundR: number,
  backgroundG: number,
  backgroundB: number,
  foregroundR: number,
  foregroundG: number,
  foregroundB: number,
): number {
  const backgroundLuminance = calculateRelativeLuminance(backgroundR, backgroundG, backgroundB);
  const foregroundLuminance = calculateRelativeLuminance(foregroundR, foregroundG, foregroundB);
  const lighter = Math.max(backgroundLuminance, foregroundLuminance);
  const darker = Math.min(backgroundLuminance, foregroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function calculateRelativeLuminance(r: number, g: number, b: number): number {
  const red = convertSrgbChannelToLinear(r);
  const green = convertSrgbChannelToLinear(g);
  const blue = convertSrgbChannelToLinear(b);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function convertSrgbChannelToLinear(value: number): number {
  const normalized = Math.max(0, Math.min(255, value)) / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function formatSongSelectDifficultyFilterLabel(value: SongSelectDifficultyFilter | undefined): string {
  return typeof value === 'number' ? String(value) : 'ALL';
}

async function selectChartInteractively(
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
    options.kittyGraphics === true && Boolean(process.stdout.isTTY) && supportsKittyGraphicsProtocol(process.env);
  const bannerState = createSongSelectBannerState();
  let finished = false;

  const inputCapture = beginRawInputCapture();
  const songSelectState = createSongSelectState(allEntries, {
    initialDifficultyFilter: options.initialDifficultyFilter,
    initialPlayMode: options.initialPlayMode,
    initialHighSpeed: options.initialHighSpeed,
    initialFocusKey: options.initialFocusKey,
  });

  process.stdout.write('\u001b[?25l');

  const syncPreview = (): void => {
    const view = songSelectState.view();
    const entry = view.entries[songSelectState.selectedIndex()];
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
    return Math.max(5, rows - SONG_SELECT_NON_ENTRY_ROWS);
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
    const view = songSelectState.view();
    const columns = process.stdout.columns ?? 80;
    const listRows = listRowsForViewport();
    const numberWidth = String(Math.max(1, view.chartCount)).length;
    const lineWidth = Math.max(16, columns - 2);
    const itemLabelWidth = Math.max(8, lineWidth - numberWidth - 4);
    const columnLayout = resolveSelectionColumnLayout(view.entries, itemLabelWidth);

    const { start, end } = resolveVisibleEntryRange(songSelectState.selectedIndex(), view.entries.length, listRows);

    const lines: string[] = [];
    const selectedEntry = view.entries[songSelectState.selectedIndex()];
    syncSongSelectBanner({
      state: bannerState,
      entry: selectedEntry,
      lineWidth,
      useKittyGraphics: useKittyGraphicsForBanner,
      finished,
      onReady: render,
    });
    const bannerDisplayState = resolveSongSelectBannerDisplayState(
      selectedEntry,
      lineWidth,
      useKittyGraphicsForBanner,
      bannerState,
    );
    lines.push(
      ...createSongSelectSelectedMetadataLines(selectedEntry, lineWidth, {
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
      const marker = index === songSelectState.selectedIndex() ? '>' : ' ';
      const chartNumber = view.chartIndexByEntryIndex.get(index);
      const number =
        typeof chartNumber === 'number' ? String(chartNumber + 1).padStart(numberWidth, ' ') : ' '.repeat(numberWidth);
      let displayEntry = entry;
      if (
        index === songSelectState.selectedIndex() &&
        entry.kind === 'chart' &&
        previewController?.getRenderingFilePath() === entry.filePath
      ) {
        displayEntry = {
          ...entry,
          fileLabel: `${SONG_SELECT_PREVIEW_SPINNER_FRAMES[previewSpinnerFrame]} ${entry.fileLabel}`,
        };
      }
      const label =
        displayEntry === entry
          ? resolveSelectionEntryLabel(entry, columnLayout, itemLabelWidth)
          : truncateForDisplay(formatSelectionEntryLabel(displayEntry, columnLayout), itemLabelWidth);
      const line = `${marker} ${number} ${label}`;
      if (index === songSelectState.selectedIndex()) {
        lines.push(`\u001b[7m${line.padEnd(lineWidth, ' ')}\u001b[0m`);
      } else {
        lines.push(line);
      }
    }

    lines.push('');
    lines.push(
      ...createSongSelectControlLines({
        rootDir,
        lineWidth,
        playModeLabel: formatPlayModeLabel(songSelectState.playMode()),
        highSpeedLabel: formatHighSpeedLabel(songSelectState.highSpeed()),
        difficultyFilterLabel: formatSongSelectDifficultyFilterLabel(songSelectState.difficultyFilter()),
        audioBackendLabel: formatSongSelectAudioBackendLabel(options.audio, previewController?.getActiveBackend()),
      }),
    );
    lines.push('');
    const selectedChartIndex = view.chartIndexByEntryIndex.get(songSelectState.selectedIndex());
    if (typeof selectedChartIndex === 'number') {
      lines.push(`${selectedChartIndex + 1}/${view.chartCount}`);
    } else if (view.chartCount > 0) {
      const selectedEntry = view.entries[songSelectState.selectedIndex()];
      lines.push(selectedEntry?.kind === 'random' ? `RANDOM/${view.chartCount}` : `0/${view.chartCount}`);
    } else {
      lines.push('0/0');
    }
    const overlaySequence = resolveSongSelectBannerOverlaySequence({
      lineWidth,
      reservedWidth: bannerDisplayState.reservedWidth,
      useKittyGraphics: useKittyGraphicsForBanner,
      state: bannerState,
    });
    process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\u001b[J${overlaySequence}`);
  };

  return new Promise<SelectChartInteractivelyResult>((resolvePromise) => {
    const isSelectedEntryPreviewRendering = (): boolean => {
      const view = songSelectState.view();
      const selectedEntry = view.entries[songSelectState.selectedIndex()];
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
        previewSpinnerFrame = (previewSpinnerFrame + 1) % SONG_SELECT_PREVIEW_SPINNER_FRAMES.length;
        render();
      }, SONG_SELECT_PREVIEW_SPINNER_INTERVAL_MS);
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
      clearSongSelectBannerLoad(bannerState);
      process.stdout.write(buildSongSelectBannerCleanupSequence(bannerState));
      inputCapture.stdin.removeListener('keypress', onKeyPress);
      inputCapture.restore();
      process.stdout.write('\u001b[?25h\u001b[2J\u001b[H');
      void (async () => {
        await previewController?.dispose();
        resolvePromise(result);
      })();
    };

    const moveSelection = (delta: number): void => {
      const view = songSelectState.view();
      if (view.selectableIndexes.length === 0) {
        return;
      }
      const currentSelectableIndex = view.selectableIndexByEntryIndex.get(songSelectState.selectedIndex()) ?? 0;
      const nextSelectableIndex = resolveCircularSelectableIndex(
        currentSelectableIndex,
        delta,
        view.selectableIndexes.length,
      );
      songSelectState.selectedIndex(view.selectableIndexes[nextSelectableIndex]!);
      syncPreview();
      render();
    };

    const moveSelectionByPage = (direction: SongSelectPageDirection): void => {
      const view = songSelectState.view();
      if (view.selectableIndexes.length === 0) {
        return;
      }
      const pageSize = listRowsForViewport();
      songSelectState.selectedIndex(
        resolvePageSelectableIndex(
          view.selectableIndexes,
          songSelectState.selectedIndex(),
          view.entries.length,
          pageSize,
          direction,
        ),
      );
      syncPreview();
      render();
    };

    const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
      const nextDifficultyFilter = resolveSongSelectDifficultyFilter(chunk);
      if (nextDifficultyFilter !== undefined) {
        const focusKey = getEntryFocusKey(songSelectState.view().entries[songSelectState.selectedIndex()]);
        songSelectState.difficultyFilter(nextDifficultyFilter ?? undefined);
        songSelectState.ensureSelectedIndex(focusKey);
        syncPreview();
        render();
        return;
      }

      const action = resolveSongSelectNavigationAction(chunk, key);
      if (action === 'ctrl-c') {
        const view = songSelectState.view();
        cleanup({
          reason: 'ctrl-c',
          focusKey: getEntryFocusKey(view.entries[songSelectState.selectedIndex()]),
          playMode: songSelectState.playMode(),
          highSpeed: songSelectState.highSpeed(),
          difficultyFilter: songSelectState.difficultyFilter(),
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
        const view = songSelectState.view();
        if (view.selectableIndexes.length === 0) {
          return;
        }
        songSelectState.selectedIndex(view.selectableIndexes[0]!);
        syncPreview();
        render();
        return;
      }
      if (action === 'last') {
        const view = songSelectState.view();
        if (view.selectableIndexes.length === 0) {
          return;
        }
        songSelectState.selectedIndex(view.selectableIndexes[view.selectableIndexes.length - 1]!);
        syncPreview();
        render();
        return;
      }
      if (action === 'confirm') {
        const view = songSelectState.view();
        const selectedEntry = view.entries[songSelectState.selectedIndex()];
        if (selectedEntry?.kind === 'random') {
          const randomIndex = Math.floor(Math.random() * view.chartFiles.length);
          cleanup({
            reason: 'selected',
            selectedPath: view.chartFiles[randomIndex],
            focusKey: getEntryFocusKey(selectedEntry),
            playMode: songSelectState.playMode(),
            highSpeed: songSelectState.highSpeed(),
            difficultyFilter: songSelectState.difficultyFilter(),
          });
          return;
        }
        if (selectedEntry?.kind === 'chart') {
          cleanup({
            reason: 'selected',
            selectedPath: selectedEntry.filePath,
            focusKey: getEntryFocusKey(selectedEntry),
            playMode: songSelectState.playMode(),
            highSpeed: songSelectState.highSpeed(),
            difficultyFilter: songSelectState.difficultyFilter(),
          });
          return;
        }
        return;
      }
      if (action === 'toggle-auto') {
        songSelectState.playMode(cyclePlayMode(songSelectState.playMode()));
        render();
        return;
      }
      if (action === 'increase-high-speed') {
        songSelectState.highSpeed(increaseHighSpeed(songSelectState.highSpeed()));
        render();
        return;
      }
      if (action === 'decrease-high-speed') {
        songSelectState.highSpeed(decreaseHighSpeed(songSelectState.highSpeed()));
        render();
        return;
      }
      if (action === 'escape') {
        const view = songSelectState.view();
        cleanup({
          reason: 'escape',
          focusKey: getEntryFocusKey(view.entries[songSelectState.selectedIndex()]),
          playMode: songSelectState.playMode(),
          highSpeed: songSelectState.highSpeed(),
          difficultyFilter: songSelectState.difficultyFilter(),
        });
      }
    };

    inputCapture.stdin.on('keypress', onKeyPress);
    ensurePreviewSpinnerTimer();
    syncPreview();
    render();
  });
}

function resolveChartFileFromFocusKey(focusKey: string | undefined): string | undefined {
  if (typeof focusKey !== 'string') {
    return undefined;
  }
  if (!focusKey.startsWith('chart:')) {
    return undefined;
  }
  const filePath = focusKey.slice('chart:'.length).trim();
  return filePath.length > 0 ? filePath : undefined;
}

export function resolveSongSelectInitialFocusKey(
  files: readonly string[],
  selectedChartFile: string | undefined,
  persistedFocusKey?: string,
): string | undefined {
  if (typeof persistedFocusKey === 'string') {
    const normalizedFocusKey = persistedFocusKey.trim();
    if (normalizedFocusKey === 'random') {
      return normalizedFocusKey;
    }
    const focusedChartFile = resolveChartFileFromFocusKey(normalizedFocusKey);
    if (focusedChartFile && files.includes(focusedChartFile)) {
      return normalizedFocusKey;
    }
  }
  if (typeof selectedChartFile !== 'string') {
    return undefined;
  }
  const normalized = selectedChartFile.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (!files.includes(normalized)) {
    return undefined;
  }
  return createChartFocusKey(normalized);
}

async function showResultScreen(
  rootDir: string,
  played: PlayedChartResult,
  options: ResultScreenOptions = {},
): Promise<ResultScreenAction> {
  const allowReplay = options.allowReplay ?? true;
  const nextActionLabel = options.nextActionLabel ?? 'return to song selection';
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'enter';
  }

  const relativePath = relative(rootDir, played.chartPath).replaceAll('\\', '/');
  const titleLine = played.title ?? relativePath;
  const artistLine = played.artist ? `ARTIST ${played.artist}` : undefined;
  const totalNotes = Math.max(0, Math.floor(played.summary.total));
  const maxExScore = Math.max(0, totalNotes * 2);
  const judgedNotes = Math.max(
    0,
    Math.floor(
      played.summary.perfect + played.summary.great + played.summary.good + played.summary.bad + played.summary.poor,
    ),
  );
  const notesProgress = `${Math.min(totalNotes, judgedNotes)}/${totalNotes}`;
  const gaugeLine = formatGrooveGaugeResultLine(played.summary);

  const inputCapture = beginRawInputCapture();
  process.stdout.write('\u001b[?25l');

  const render = (): void => {
    const columns = process.stdout.columns ?? 80;
    const lineWidth = Math.max(16, columns - 2);
    const lines: string[] = [];
    lines.push('RESULT');
    lines.push(truncateForDisplay(titleLine, lineWidth));
    if (artistLine) {
      lines.push(truncateForDisplay(artistLine, lineWidth));
    }
    lines.push(truncateForDisplay(`FILE ${relativePath}`, lineWidth));
    lines.push('');
    lines.push(
      `PLAYER ${formatPlayerLabel(played.player)}  RANK ${played.rankLabel ?? formatRankLabel(played.rank)}  PLAYLEVEL ${formatPlayLevelLabel(played.playLevel)}`,
    );
    if (gaugeLine) {
      lines.push(truncateForDisplay(gaugeLine, lineWidth));
    }
    lines.push(`NOTES ${notesProgress}`);
    lines.push(`EX-SCORE ${played.summary.exScore}/${maxExScore}  SCORE ${played.summary.score}/200000`);
    lines.push(
      `PGREAT ${played.summary.perfect}  GREAT ${played.summary.great}  GOOD ${played.summary.good}  BAD ${played.summary.bad}  POOR ${played.summary.poor}`,
    );
    lines.push(`FAST ${played.summary.fast}  SLOW ${played.summary.slow}`);
    lines.push('');
    if (allowReplay) {
      lines.push('Press r to replay this chart.');
    }
    lines.push('Press Enter or Esc to close result screen.');
    lines.push(`Next: ${nextActionLabel}.`);
    lines.push('Press Ctrl+C to quit.');
    process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\u001b[J`);
  };

  return new Promise<ResultScreenAction>((resolvePromise) => {
    let finished = false;

    const cleanup = (action: ResultScreenAction): void => {
      if (finished) {
        return;
      }
      finished = true;
      inputCapture.stdin.removeListener('keypress', onKeyPress);
      inputCapture.restore();
      process.stdout.write('\u001b[?25h\u001b[2J\u001b[H');
      resolvePromise(action);
    };

    const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
      const action = resolveResultScreenActionFromKey(chunk, key);
      if (!action) {
        return;
      }
      if (action === 'replay' && !allowReplay) {
        return;
      }
      cleanup(action);
    };

    inputCapture.stdin.on('keypress', onKeyPress);
    render();
  });
}

function formatGrooveGaugeResultLine(summary: PlayerSummary): string | undefined {
  const gauge = summary.gauge;
  if (!gauge) {
    return undefined;
  }
  const status = gauge.cleared ? 'CLEAR' : 'FAILED';
  return `GAUGE ${renderPlainGrooveGaugeBar(gauge.current, gauge.max, 24)} ${gauge.current.toFixed(2)}% ${status} TOTAL ${formatGrooveGaugeNumber(gauge.effectiveTotal)}`;
}

function renderPlainGrooveGaugeBar(current: number, max: number, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const filled = Math.round(safeWidth * Math.max(0, Math.min(1, current / safeMax)));
  return `[${'#'.repeat(filled)}${'-'.repeat(safeWidth - filled)}]`;
}

function formatGrooveGaugeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= 1e-9 ? String(rounded) : value.toFixed(2);
}

function isCliEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    const moduleUrl = (import.meta as { url?: unknown }).url;
    if (typeof moduleUrl !== 'string' || moduleUrl.length === 0) {
      return false;
    }
    return resolve(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  void main()
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((error) => {
      process.stderr.write(`${formatCliParseError(error)}\n`);
      process.exit(1);
    });
}
