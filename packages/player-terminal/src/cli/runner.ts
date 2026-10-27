import { isCLIEntryPoint } from '@be-music/shared-utils/cli';
import { stat } from 'node:fs/promises';
import { dirname, extname, relative } from 'node:path';
import { resolveCLIPath } from '@be-music/shared-utils/cli-path';
import {
  createFileLogger,
  createNoopLogger,
  type LogEntry,
  type Logger,
  type LogLevel,
} from '@be-music/shared-utils/log';
import type { BeMusicPlayLevel } from '@be-music/chart-source';
import { parseChartFile } from '@be-music/chart-parser';
import { renderJSON, writeAudioFile } from '@be-music/chart-audio-renderer';
import {
  PlayerInterruptedError,
  type PlayerLoadProgress,
  type PlayerSummary,
  resolvePlayChart,
  type ResolvedPlayChart,
} from '@be-music/player-engine';
import { loadStageFileANSIImage, type StageFileANSIImage } from '../bga.ts';
import { runNodeGameplayRuntime } from '../node/node-gameplay-runtime.ts';
import { ensureSEAEmbeddedNodeModules } from '../node/sea-embedded-modules.ts';
import { supportsKittyGraphicsProtocol } from '../tui/kitty-graphics.ts';
import {
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from '@be-music/player-engine/display';
import { beginSharedRawInputCapture } from '../raw-input-capture.ts';
import {
  applyPersistedPlayerConfigToArgs,
  applyMusicSelectConfigToArgs,
  createDefaultPersistedPlayerConfig,
  loadPersistedPlayerConfig,
  normalizeHighSpeedValue,
  resolveCLIConfigOverrideFlags,
  resolveDefaultPlayerLogPath,
  resolvePersistedPlayerConfigFromArgs,
  resolvePlayModeFromArgs,
  savePersistedPlayerConfig,
  type PersistedPlayerConfig,
  type PlayMode,
} from './config.ts';
import type { ResultScreenAction, MusicSelectDifficultyFilter } from './music-select-navigation.ts';
import { truncateForDisplay } from './selection-format.ts';
import {
  buildChartSelectionEntries,
  listChartFiles,
  type ChartSelectionEntry,
  type ChartSummaryLoadingProgress,
} from './chart-selection.ts';
import { createChartFocusKey } from './music-select-state.ts';
import { type CLIArgs, parseArgs, printUsage } from './args.ts';
import {
  type RawInputCapture,
  beginLoadingAbortCapture,
  resolveLoadingCancelReason,
  applyLoadingCancel,
} from './input-capture.ts';
import {
  type PlayLoadingProgress,
  type PlayLoadingScreenRenderState,
  resolvePlayLoadingStageFileDisplaySize,
  createPlayLoadingProgressScreenOutput,
  clearPlayLoadingScreen,
  clearPlayLoadingStageFileImage,
} from './play-loading-screen.ts';
import { type PlayedChartResult, showResultScreen } from './result-screen.ts';
import {
  type SelectChartInteractivelyResult,
  sanitizeMetadataText,
  selectChartInteractively,
} from './music-select-screen.ts';

export {
  applyPersistedPlayerConfigToArgs,
  cyclePlayMode,
  formatPlayModeLabel,
  resolveCLIConfigOverrideFlags,
  resolveDefaultPlayerLogPath,
  resolvePersistedPlayerConfigFromArgs,
  resolvePlayModeFromArgs,
} from './config.ts';
export {
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolveResultScreenActionFromKey,
  resolveMusicSelectDifficultyFilter,
  resolveMusicSelectNavigationAction,
  resolveVisibleEntryRange,
} from './music-select-navigation.ts';
export { parseArgs } from './args.ts';
export {
  resolvePlayLoadingStageFileDisplaySize,
  createPlayLoadingProgressScreenLines,
  createPlayLoadingProgressScreenOutput,
} from './play-loading-screen.ts';
export { createMusicSelectSelectedMetadataLines, createMusicSelectControlLines } from './music-select-screen.ts';

type DirectorySceneState =
  | {
      kind: 'select';
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
      difficultyFilter?: MusicSelectDifficultyFilter;
    }
  | {
      kind: 'play';
      chartPath: string;
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
      difficultyFilter?: MusicSelectDifficultyFilter;
    }
  | {
      kind: 'result';
      played: PlayedChartResult;
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
      difficultyFilter?: MusicSelectDifficultyFilter;
    }
  | {
      kind: 'exit';
      exitCode: number;
    };

type ResultScreenExitAction = Exclude<ResultScreenAction, 'replay'>;
const DIRECTORY_CHART_EXTENSIONS_LABEL = '.bms, .bme, .bml, .pms, .bmson';
let activePlayerLogger: Logger = createNoopLogger();

export async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    return;
  }
  const overrideFlags = resolveCLIConfigOverrideFlags(rawArgs);
  let args: CLIArgs;
  try {
    args = parseArgs(rawArgs);
  } catch (error) {
    process.stdout.write(`${formatCLIParseError(error)}\n\n`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  let persistedConfig = createDefaultPersistedPlayerConfig();
  try {
    persistedConfig = await loadPersistedPlayerConfig();
  } catch (error) {
    process.stdout.write(`Warning: failed to load ~/.be-music/player.json (${formatCLIParseError(error)}).\n`);
  }
  args = applyPersistedPlayerConfigToArgs(args, persistedConfig, overrideFlags);
  let nextPersistedConfig = resolvePersistedPlayerConfigFromArgs(args, persistedConfig);

  if (!args.input) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedLogFilePath =
    typeof args.logFile === 'string' && args.logFile.length > 0
      ? resolveCLIPath(args.logFile)
      : resolveDefaultPlayerLogPath();
  activePlayerLogger = await createFileLogger(resolvedLogFilePath);
  logCLI('info', 'cli.start', {
    input: args.input,
    logFile: resolvedLogFilePath,
  });

  try {
    // Must run before any worker spawn so the extraction directory propagates through the environment.
    await ensureSEAEmbeddedNodeModules();
  } catch (error) {
    process.stdout.write(`Warning: failed to extract embedded optional modules (${formatCLIParseError(error)}).\n`);
  }

  if (typeof args.judgeWindowMs === 'number' && Number.isFinite(args.judgeWindowMs)) {
    process.stdout.write(`Warning: debug judge override enabled (BAD window: ${Math.round(args.judgeWindowMs)}ms).\n`);
  }

  const inputPath = resolveCLIPath(args.input);
  let sessionInputCapture: RawInputCapture | undefined;
  try {
    const inputStat = await stat(inputPath);
    if (process.stdin.isTTY && process.stdout.isTTY && (inputStat.isDirectory() || args.tui)) {
      sessionInputCapture = beginSharedRawInputCapture({
        forceResetRawMode: process.platform === 'win32',
      });
      logCLI('info', 'cli.session-input-capture.started', {
        inputIsDirectory: inputStat.isDirectory(),
        tui: args.tui,
        stdinIsRaw: Boolean(sessionInputCapture.stdin.isRaw),
      });
    }
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
    sessionInputCapture?.restore();
    if (sessionInputCapture) {
      logCLI('info', 'cli.session-input-capture.stopped', {
        stdinIsRaw: Boolean((process.stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw),
      });
      sessionInputCapture = undefined;
    }
    try {
      await savePersistedPlayerConfig(nextPersistedConfig);
    } catch (error) {
      process.stdout.write(`Warning: failed to save ~/.be-music/player.json (${formatCLIParseError(error)}).\n`);
    }
    logCLI('info', 'cli.finish', {
      exitCode: process.exitCode ?? 0,
    });
    try {
      await activePlayerLogger.close();
    } catch (error) {
      process.stderr.write(`Warning: failed to close log file (${formatCLIParseError(error)}).\n`);
    }
    activePlayerLogger = createNoopLogger();
  }
}

async function runDirectoryInput(
  rootDir: string,
  args: CLIArgs,
  initialConfig: PersistedPlayerConfig,
): Promise<PersistedPlayerConfig> {
  let persistedConfig = persistMusicSelectConfig(initialConfig, rootDir, {
    playMode: initialConfig.playMode,
    highSpeed: initialConfig.highSpeed,
  });
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
      persistedConfig = persistMusicSelectConfig(resolvePersistedPlayerConfigFromArgs(args, persistedConfig), rootDir, {
        playMode: resolvePlayModeFromArgs(args),
        highSpeed: args.highSpeed,
        selectedChartFile: selected,
        focusKey: createChartFocusKey(selected),
      });
    } catch (error) {
      if (error instanceof PlayerInterruptedError) {
        persistedConfig = persistMusicSelectConfig(
          resolvePersistedPlayerConfigFromArgs(args, persistedConfig),
          rootDir,
          {
            playMode: resolvePlayModeFromArgs(args),
            highSpeed: args.highSpeed,
            selectedChartFile: selected,
            focusKey: createChartFocusKey(selected),
          },
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
      persistedConfig = persistMusicSelectConfig(resolvePersistedPlayerConfigFromArgs(args, persistedConfig), rootDir, {
        playMode: resolvePlayModeFromArgs(args),
        highSpeed: args.highSpeed,
        selectedChartFile: selected,
        focusKey: createChartFocusKey(selected),
      });
      if (action === 'ctrl-c') {
        process.exitCode = 130;
      }
    } catch (error) {
      if (error instanceof PlayerInterruptedError) {
        persistedConfig = persistMusicSelectConfig(
          resolvePersistedPlayerConfigFromArgs(args, persistedConfig),
          rootDir,
          {
            playMode: resolvePlayModeFromArgs(args),
            highSpeed: args.highSpeed,
            selectedChartFile: selected,
            focusKey: createChartFocusKey(selected),
          },
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
    focusKey: resolveMusicSelectInitialFocusKey(
      candidates,
      resolveLastSelectedChartFileForDirectory(initialConfig, rootDir),
      resolveLastMusicSelectFocusKeyForDirectory(initialConfig, rootDir),
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
        imageResizeAlgorithm: args.imageResizeAlgorithm,
        volume: args.volume,
        bgmVolume: args.bgmVolume,
        playVolume: args.playVolume,
        entries,
        initialFocusKey: state.focusKey,
        initialPlayMode: state.playMode,
        initialHighSpeed: state.highSpeed,
        initialDifficultyFilter: state.difficultyFilter,
      });
      persistedConfig = persistMusicSelectConfig(persistedConfig, rootDir, {
        playMode: selection.playMode,
        highSpeed: selection.highSpeed,
        selectedChartFile: resolveLastSelectedChartFile(selection),
        focusKey: selection.focusKey,
      });
      state = resolveDirectoryStateFromSelection(selection);
      continue;
    }

    if (state.kind === 'play') {
      const playState = state;
      const playArgs = applyMusicSelectConfigToArgs(args, playState.playMode, playState.highSpeed);
      persistedConfig = persistMusicSelectConfig(persistedConfig, rootDir, {
        playMode: playState.playMode,
        highSpeed: playArgs.highSpeed,
        selectedChartFile: playState.chartPath,
        focusKey: playState.focusKey,
      });
      try {
        const played = await playChartOnce(playState.chartPath, playArgs);
        const resolvedHighSpeed = normalizeHighSpeedValue(playArgs.highSpeed);
        persistedConfig = persistMusicSelectConfig(persistedConfig, rootDir, {
          playMode: playState.playMode,
          highSpeed: resolvedHighSpeed,
          selectedChartFile: playState.chartPath,
          focusKey: playState.focusKey,
        });
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
          persistedConfig = persistMusicSelectConfig(persistedConfig, rootDir, {
            playMode: playState.playMode,
            highSpeed: resolvedHighSpeed,
            selectedChartFile: playState.chartPath,
            focusKey: playState.focusKey,
          });
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

function resolvePersistedConfigForMusicSelect(
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
  if (previous?.lastMusicSelectFocusKeyByDirectory) {
    resolved.lastMusicSelectFocusKeyByDirectory = { ...previous.lastMusicSelectFocusKeyByDirectory };
  }
  const preferred = preferredLastSelectedChartFile?.trim();
  if (preferred) {
    if (directoryPath && directoryPath.length > 0) {
      const byDirectory = { ...resolved.lastSelectedChartFileByDirectory };
      byDirectory[directoryPath] = preferred;
      resolved.lastSelectedChartFileByDirectory = byDirectory;
    }
  }
  const normalizedFocusKey = preferredFocusKey?.trim();
  if (normalizedFocusKey) {
    if (directoryPath && directoryPath.length > 0) {
      const byDirectory = { ...resolved.lastMusicSelectFocusKeyByDirectory };
      byDirectory[directoryPath] = normalizedFocusKey;
      resolved.lastMusicSelectFocusKeyByDirectory = byDirectory;
    }
  }
  if (
    resolved.lastSelectedChartFileByDirectory &&
    Object.keys(resolved.lastSelectedChartFileByDirectory).length === 0
  ) {
    delete resolved.lastSelectedChartFileByDirectory;
  }
  if (
    resolved.lastMusicSelectFocusKeyByDirectory &&
    Object.keys(resolved.lastMusicSelectFocusKeyByDirectory).length === 0
  ) {
    delete resolved.lastMusicSelectFocusKeyByDirectory;
  }
  return resolved;
}

function persistMusicSelectConfig(
  previous: PersistedPlayerConfig,
  directoryPath: string | undefined,
  state: {
    playMode: PlayMode;
    highSpeed: number | undefined;
    selectedChartFile?: string;
    focusKey?: string;
  },
): PersistedPlayerConfig {
  return resolvePersistedConfigForMusicSelect(
    {
      playMode: state.playMode,
      highSpeed: normalizeHighSpeedValue(state.highSpeed),
    },
    directoryPath,
    state.selectedChartFile,
    state.focusKey,
    previous,
  );
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

function resolveLastMusicSelectFocusKeyForDirectory(
  config: PersistedPlayerConfig,
  directoryPath: string,
): string | undefined {
  const byDirectory = config.lastMusicSelectFocusKeyByDirectory;
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

async function playChartOnce(chartPath: string, args: CLIArgs): Promise<PlayedChartResult> {
  let resolvedHighSpeed = normalizeHighSpeedValue(args.highSpeed);
  const effectivePlayMode = resolveEffectivePlayModeFromCLIArgs(args);
  let playLoadingStageFileImage: StageFileANSIImage | undefined;
  const stageFileKittySupported = supportsKittyGraphicsProtocol(process.env);
  const useKittyGraphicsForStageFile = args.kittyGraphics && Boolean(process.stdout.isTTY) && stageFileKittySupported;
  logCLI('info', 'play.loading.stagefile.mode', {
    chartPath,
    kittyGraphicsRequested: Boolean(args.kittyGraphics),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    kittyGraphicsSupported: stageFileKittySupported,
    useKittyGraphicsForStageFile,
  });
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
  let playChart: ResolvedPlayChart;
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
      playLoadingStageFileImage = await loadStageFileANSIImage(json, {
        baseDir: dirname(chartPath),
        width: stageFileDisplaySize.width,
        height: stageFileDisplaySize.height,
        imageResizeAlgorithm: args.imageResizeAlgorithm,
        signal: chartLoadingAbortCapture?.signal,
      });
      logCLI('info', 'play.loading.stagefile.loaded', {
        chartPath,
        stageFile: json.metadata.stageFile.replaceAll('\\', '/'),
        requestedWidth: stageFileDisplaySize.width,
        requestedHeight: stageFileDisplaySize.height,
        loaded: Boolean(playLoadingStageFileImage),
        width: playLoadingStageFileImage?.width,
        height: playLoadingStageFileImage?.height,
        hasKittyImage: Boolean(playLoadingStageFileImage?.kittyImage),
        kittyCellWidth: playLoadingStageFileImage?.kittyImage?.cellWidth,
        kittyCellHeight: playLoadingStageFileImage?.kittyImage?.cellHeight,
        kittyPixelWidth: playLoadingStageFileImage?.kittyImage?.pixelWidth,
        kittyPixelHeight: playLoadingStageFileImage?.kittyImage?.pixelHeight,
      });
    }
    reportPlayLoadingProgress?.({
      ratio: 0.16,
      message: 'Chart parsed.',
    });
    // Resolve `#RANDOM` / `#SWITCH` once here, so the preview render and the play below use the same branches and
    // the engine never draws on its own. A restart draws again (LR2 / beatoraja re-roll each play).
    playChart = resolvePlayChart(json);

    if (args.renderAudioPath) {
      reportPlayLoadingProgress?.({
        ratio: 0.2,
        message: 'Rendering preview audio...',
      });
      const outputPath = resolveCLIPath(args.renderAudioPath);
      const audioRendered = await renderJSON(playChart.chart, {
        baseDir: dirname(chartPath),
        inferBmsLNTypeWhenMissing: args.inferBmsLNTypeWhenMissing,
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

  const playOptions = createPlayOptionsFromCLIArgs(args, chartPath);
  logCLI('info', 'play.start', {
    chartPath,
    mode: effectivePlayMode,
    kittyGraphics: args.kittyGraphics,
    videoBGAStreaming: args.videoBGAStreaming,
  });

  let summary: PlayerSummary;
  while (true) {
    let playbackLoadingAbortCapture = beginLoadingAbortCapture();
    const disposePlaybackLoadingAbortCapture = (): void => {
      playbackLoadingAbortCapture?.dispose();
      playbackLoadingAbortCapture = undefined;
    };
    try {
      summary = await runNodeGameplayRuntime({
        json: playChart.chart,
        randomDraws: playChart.randomDraws,
        mode: effectivePlayMode === 'auto' ? 'auto' : 'manual',
        autoScratch: effectivePlayMode === 'auto-scratch',
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
          logCLI('info', 'play.loading.complete', {
            chartPath,
          });
          clearPlayLoadingScreen(playLoadingScreenRenderState);
          disposePlaybackLoadingAbortCapture();
        },
        onLog: (entry) => {
          activePlayerLogger.log(entry);
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
        playChart = resolvePlayChart(json);
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

function createPlayOptionsFromCLIArgs(args: CLIArgs, chartPath: string) {
  return {
    inferBmsLNTypeWhenMissing: args.inferBmsLNTypeWhenMissing,
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
    uiFPS: args.uiFPS,
    tuiVisibleNotesLimit: args.tuiVisibleNotesLimit,
    tuiNoteHeight: args.tuiNoteHeight,
    imageResizeAlgorithm: args.imageResizeAlgorithm,
    highSpeed: args.highSpeed,
    judgeWindowMs: args.judgeWindowMs,
    judgeRuleset: args.judgeRuleset,
    gauge: args.gauge,
    endOnFailure: args.endOnFailure,
    debugActiveAudio: args.debugActiveAudio,
    audio: args.audio,
    volume: args.volume,
    bgmVolume: args.bgmVolume,
    playVolume: args.playVolume,
    audioBaseDir: dirname(chartPath),
    audioTailSeconds: args.audioTailSeconds,
    audioHeadPaddingMs: args.audioHeadPaddingMs,
    audioLeadMs: args.audioLeadMs,
    audioLeadMaxMs: args.audioLeadMaxMs,
    audioLeadStepUpMs: args.audioLeadStepUpMs,
    audioLeadStepDownMs: args.audioLeadStepDownMs,
    laneModeExtension: resolveChartLaneModeExtension(chartPath),
    tui: args.tui,
    kittyGraphics: args.kittyGraphics,
    videoBGAStreaming: args.videoBGAStreaming,
  };
}

export function resolveEffectivePlayModeFromCLIArgs(args: Pick<CLIArgs, 'auto' | 'autoScratch' | 'tui'>): PlayMode {
  if (!args.tui) {
    return 'auto';
  }
  return resolvePlayModeFromArgs(args);
}

function resolveChartLaneModeExtension(chartPath: string): string | undefined {
  const extension = extname(chartPath).toLowerCase();
  return extension.length > 0 ? extension : undefined;
}

async function playSingleChartUntilExit(
  chartPath: string,
  rootDir: string,
  args: CLIArgs,
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

function logCLI(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  const entry: LogEntry = {
    source: 'cli',
    level,
    event,
    fields,
  };
  activePlayerLogger.log(entry);
}

function formatCLIParseError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Failed to parse CLI arguments';
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

function renderPlayLoadingProgress(
  chartPath: string,
  progress: PlayLoadingProgress,
  options: {
    columns?: number;
    stageFileImage?: StageFileANSIImage;
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
  if (options.state.lastOutput === output) {
    return;
  }
  if (shouldRedrawStageFile && options.stageFileImage && !options.state.stageFileRenderLogged) {
    logCLI('info', 'play.loading.stagefile.render', {
      useKittyGraphics: options.useKittyGraphics === true && options.stageFileImage.kittyImage !== undefined,
      width: options.stageFileImage.width,
      height: options.stageFileImage.height,
      hasKittyImage: Boolean(options.stageFileImage.kittyImage),
    });
    options.state.stageFileRenderLogged = true;
  }
  process.stdout.write(output);
  options.state.initialized = true;
  options.state.lastOutput = output;
  if (options.stageFileImage) {
    options.state.stageFileDrawn = true;
    options.state.stageFileKittyVisible =
      options.useKittyGraphics === true && options.stageFileImage.kittyImage !== undefined;
  }
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

export function resolveMusicSelectInitialFocusKey(
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

if (isCLIEntryPoint(() => (import.meta as { url?: unknown }).url)) {
  void main()
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((error) => {
      process.stderr.write(`${formatCLIParseError(error)}\n`);
      process.exit(1);
    });
}
