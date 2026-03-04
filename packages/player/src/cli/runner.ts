#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliPath } from '@be-music/utils';
import readline from 'node:readline';
import { parseChartFile } from '@be-music/parser';
import { renderJson, writeAudioFile } from '@be-music/audio-renderer';
import {
  autoPlay,
  manualPlay,
  PlayerInterruptedError,
  type PlayerLoadProgress,
  type PlayerSummary,
} from '../index.ts';
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
} from './player-config.ts';
import {
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolveResultScreenActionFromKey,
  resolveSongSelectNavigationAction,
  resolveVisibleEntryRange,
  type ResultScreenAction,
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
  ChartSelectionLoadingCanceledError,
  listChartFiles,
  type ChartSelectionEntry,
  type ChartSummaryLoadingProgress,
  type LoadingCancelReason,
} from './chart-selection.ts';
import { createChartPreviewController, formatSongSelectAudioBackendLabel } from './chart-preview.ts';

export {
  applyPersistedPlayerConfigToArgs,
  cyclePlayMode,
  formatPlayModeLabel,
  resolveCliConfigOverrideFlags,
  resolvePersistedPlayerConfigFromArgs,
  resolvePlayModeFromArgs,
} from './player-config.ts';
export {
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolveResultScreenActionFromKey,
  resolveSongSelectNavigationAction,
  resolveVisibleEntryRange,
} from './song-select-navigation.ts';

interface CliArgs {
  input?: string;
  auto: boolean;
  autoScratch: boolean;
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
  highSpeed?: number;
  judgeWindowMs?: number;
  judgeWindowSource?: 'debug' | 'legacy';
  debugActiveAudio: boolean;
  renderAudioPath?: string;
  audio: boolean;
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
}

interface SelectChartInteractivelyOptions {
  audio: boolean;
  entries?: ChartSelectionEntry[];
  initialFocusKey?: string;
  initialPlayMode?: PlayMode;
  initialHighSpeed?: number;
}

type SelectChartInteractivelyExitReason = 'selected' | 'escape' | 'ctrl-c';

interface SelectChartInteractivelyResult {
  reason: SelectChartInteractivelyExitReason;
  selectedPath?: string;
  focusKey?: string;
  playMode: PlayMode;
  highSpeed: number;
}

interface PlayedChartResult {
  chartPath: string;
  summary: PlayerSummary;
  title?: string;
  artist?: string;
  player?: number;
  rank?: number;
  playLevel?: number;
}

type DirectorySceneState =
  | {
      kind: 'select';
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
    }
  | {
      kind: 'play';
      chartPath: string;
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
    }
  | {
      kind: 'result';
      played: PlayedChartResult;
      focusKey?: string;
      playMode: PlayMode;
      highSpeed: number;
    }
  | {
      kind: 'exit';
      exitCode: number;
    };

interface RawInputCapture {
  stdin: NodeJS.ReadStream & { isRaw?: boolean };
  restore: () => void;
}

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
    await playChartOnce(inputPath, args);
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
    initialConfig,
  );
  const candidates = await listChartFiles(rootDir);
  if (candidates.length === 0) {
    process.stdout.write(`No chart files found in directory: ${rootDir}\n`);
    process.exitCode = 1;
    return persistedConfig;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY || candidates.length === 1) {
    const selected = candidates[0];
    process.stdout.write(`Selected chart: ${selected}\n`);
    try {
      await playChartOnce(selected, args);
      persistedConfig = resolvePersistedConfigForSongSelect(
        resolvePersistedPlayerConfigFromArgs(args, persistedConfig),
        rootDir,
        selected,
        persistedConfig,
      );
    } catch (error) {
      if (error instanceof PlayerInterruptedError) {
        persistedConfig = resolvePersistedConfigForSongSelect(
          resolvePersistedPlayerConfigFromArgs(args, persistedConfig),
          rootDir,
          selected,
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
    ),
    playMode: persistedConfig.playMode,
    highSpeed: persistedConfig.highSpeed,
  };

  while (state.kind !== 'exit') {
    if (state.kind === 'select') {
      const selection = await selectChartInteractively(rootDir, candidates, {
        audio: args.audio,
        entries,
        initialFocusKey: state.focusKey,
        initialPlayMode: state.playMode,
        initialHighSpeed: state.highSpeed,
      });
      persistedConfig = resolvePersistedConfigForSongSelect(
        {
          playMode: selection.playMode,
          highSpeed: normalizeHighSpeedValue(selection.highSpeed),
        },
        rootDir,
        resolveLastSelectedChartFile(selection),
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
          persistedConfig,
        );
        state = {
          kind: 'result',
          played,
          focusKey: playState.focusKey,
          playMode: playState.playMode,
          highSpeed: resolvedHighSpeed,
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
  previous?: PersistedPlayerConfig,
): PersistedPlayerConfig {
  const resolved: PersistedPlayerConfig = {
    playMode: base.playMode,
    highSpeed: normalizeHighSpeedValue(base.highSpeed),
  };
  if (previous?.lastSelectedChartFileByDirectory) {
    resolved.lastSelectedChartFileByDirectory = { ...previous.lastSelectedChartFileByDirectory };
  }
  const preferred = preferredLastSelectedChartFile?.trim();
  if (preferred) {
    if (directoryPath && directoryPath.length > 0) {
      const byDirectory = { ...(resolved.lastSelectedChartFileByDirectory ?? {}) };
      byDirectory[directoryPath] = preferred;
      resolved.lastSelectedChartFileByDirectory = byDirectory;
    }
  }
  if (resolved.lastSelectedChartFileByDirectory && Object.keys(resolved.lastSelectedChartFileByDirectory).length === 0) {
    delete resolved.lastSelectedChartFileByDirectory;
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
  };
}

function resolveDirectoryStateFromPlayInterrupt(
  reason: PlayerInterruptedError['reason'],
  state: Extract<DirectorySceneState, { kind: 'play' }>,
): DirectorySceneState {
  if (reason === 'escape') {
    return {
      kind: 'select',
      focusKey: state.focusKey,
      playMode: state.playMode,
      highSpeed: state.highSpeed,
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
    };
  }

  if (action === 'enter' || action === 'escape') {
    return {
      kind: 'select',
      focusKey: state.focusKey,
      playMode: state.playMode,
      highSpeed: state.highSpeed,
    };
  }

  return {
    kind: 'exit',
    exitCode: action === 'ctrl-c' ? 130 : 0,
  };
}

async function playChartOnce(chartPath: string, args: CliArgs): Promise<PlayedChartResult> {
  let resolvedHighSpeed = normalizeHighSpeedValue(args.highSpeed);
  const reportPlayLoadingProgress = process.stdout.isTTY
    ? (progress: PlayLoadingProgress): void => {
        renderPlayLoadingProgress(chartPath, progress);
      }
    : undefined;
  reportPlayLoadingProgress?.({
    ratio: 0.03,
    message: 'Parsing chart file...',
  });
  const json = await parseChartFile(chartPath);
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
    });
    await writeAudioFile(outputPath, audioRendered);
    process.stdout.write(`Rendered preview audio: ${outputPath}\n`);
    reportPlayLoadingProgress?.({
      ratio: 0.32,
      message: 'Preview audio rendered.',
    });
  }

  const playOptions = {
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
    highSpeed: args.highSpeed,
    judgeWindowMs: args.judgeWindowMs,
    debugActiveAudio: args.debugActiveAudio,
    audio: args.audio,
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
    tui: args.tui,
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
          });
        }
      : undefined,
  };

  let summary: PlayerSummary;
  try {
    summary = args.auto
      ? await autoPlay(json, { ...playOptions, auto: true })
      : await manualPlay(json, { ...playOptions, autoScratch: args.autoScratch });
  } finally {
    args.highSpeed = resolvedHighSpeed;
  }
  const title = sanitizeMetadataText(json.metadata.title);
  const artist = sanitizeMetadataText(json.metadata.artist);

  return {
    chartPath,
    summary,
    title,
    artist,
    player: json.bms.player,
    rank: json.metadata.rank,
    playLevel: json.metadata.playLevel,
  };
}

function sanitizeMetadataText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {
    auto: false,
    autoScratch: false,
    showInvisibleNotes: false,
    compressor: false,
    limiter: true,
    audio: true,
    tui: true,
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
    if (token === '--play-volume') {
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
      '  --high-speed <rate>       TUI note fall speed multiplier, 0.5-10.0 in 0.5 steps (default: 1.0)',
      '  --audio / --no-audio      Enable or disable in-game audio playback (default: on)',
      '                           Audio backend: node-web-audio-api (fixed)',
      '  --tui / --no-tui          Enable or disable TUI play screen (default: on in TTY)',
      '',
      'Advanced tuning:',
      '  --show-invisible-notes    Show invisible channels (31-39/41-49) in TUI as green notes',
      '  --render-audio <path>     Render audio preview before playing',
      '  --bgm-volume <value>      Volume multiplier for non-play lanes (default: 1, 0 disables BGM)',
      '  --play-volume <value>     Volume multiplier for playable/key sounds (default: 1)',
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

async function loadChartSelectionEntries(rootDir: string, files: string[]): Promise<ChartSelectionEntry[] | undefined> {
  const inputCapture = beginRawInputCapture();
  let cancelReason: LoadingCancelReason | undefined;
  process.stdout.write('\u001b[?25l');

  const onKeyPress = (_chunk: string | undefined, key: readline.Key): void => {
    if (key.sequence === '\u0003') {
      cancelReason = 'ctrl-c';
      return;
    }
    if (key.name?.toLowerCase() === 'escape' || key.sequence === '\u001b') {
      cancelReason = 'escape';
    }
  };
  inputCapture.stdin.on('keypress', onKeyPress);

  try {
    const entries = await buildChartSelectionEntries(rootDir, files, {
      onLoadingFile: (progress) => {
        renderChartLoadingProgress(rootDir, progress);
      },
      getCancelReason: () => cancelReason,
    });
    if (cancelReason) {
      process.exitCode = cancelReason === 'ctrl-c' ? 130 : 0;
      process.stdout.write('\u001b[2J\u001b[H');
      return undefined;
    }
    return entries;
  } catch (error) {
    if (error instanceof ChartSelectionLoadingCanceledError) {
      process.exitCode = error.reason === 'ctrl-c' ? 130 : 0;
      process.stdout.write('\u001b[2J\u001b[H');
      return undefined;
    }
    throw error;
  } finally {
    inputCapture.stdin.removeListener('keypress', onKeyPress);
    inputCapture.restore();
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

function renderPlayLoadingProgress(chartPath: string, progress: PlayLoadingProgress): void {
  const columns = process.stdout.columns ?? 80;
  const lineWidth = Math.max(16, columns - 2);
  const fileLabel = chartPath.replaceAll('\\', '/');
  const ratio = Math.max(0, Math.min(1, progress.ratio));
  const barWidth = Math.max(10, Math.min(48, lineWidth - 8));
  const filled = Math.max(0, Math.min(barWidth, Math.round(barWidth * ratio)));
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(barWidth - filled)}] ${Math.round(ratio * 100)}%`;
  const lines = [
    'Loading selected chart...',
    truncateForDisplay(bar, lineWidth),
    truncateForDisplay(`Step: ${progress.message}`, lineWidth),
    truncateForDisplay(`File: ${fileLabel}`, lineWidth),
  ];
  if (typeof progress.detail === 'string' && progress.detail.length > 0) {
    lines.push(truncateForDisplay(`Detail: ${progress.detail}`, lineWidth));
  }
  process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\u001b[J`);
}

async function selectChartInteractively(
  rootDir: string,
  files: string[],
  options: SelectChartInteractivelyOptions,
): Promise<SelectChartInteractivelyResult> {
  const entries = options.entries ?? (await buildChartSelectionEntries(rootDir, files));
  const selectableIndexes = entries.flatMap((entry, index) => (entry.kind === 'group' ? [] : [index]));
  const chartIndexes = entries.flatMap((entry, index) => (entry.kind === 'chart' ? [index] : []));
  const chartCount = chartIndexes.length;
  const selectableIndexByEntryIndex = new Map<number, number>();
  const chartIndexByEntryIndex = new Map<number, number>();
  for (let index = 0; index < selectableIndexes.length; index += 1) {
    selectableIndexByEntryIndex.set(selectableIndexes[index], index);
  }
  for (let index = 0; index < chartIndexes.length; index += 1) {
    chartIndexByEntryIndex.set(chartIndexes[index], index);
  }

  if (selectableIndexes.length === 0) {
    return {
      reason: 'escape',
      playMode: options.initialPlayMode ?? 'manual',
      highSpeed: normalizeHighSpeedValue(options.initialHighSpeed),
    };
  }

  const previewController = options.audio && process.stdout.isTTY ? createChartPreviewController() : undefined;

  const inputCapture = beginRawInputCapture();
  let selectedIndex = selectableIndexes[0];
  let playMode: PlayMode = options.initialPlayMode ?? 'manual';
  let highSpeed = normalizeHighSpeedValue(options.initialHighSpeed);
  if (options.initialFocusKey) {
    const found = selectableIndexes.find((index) => getEntryFocusKey(entries[index]) === options.initialFocusKey);
    if (typeof found === 'number') {
      selectedIndex = found;
    }
  }

  process.stdout.write('\u001b[?25l');

  const syncPreview = (): void => {
    const entry = entries[selectedIndex];
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
    return Math.max(5, rows - 8);
  };

  const render = (): void => {
    const columns = process.stdout.columns ?? 80;
    const listRows = listRowsForViewport();
    const numberWidth = String(Math.max(1, chartCount)).length;
    const lineWidth = Math.max(16, columns - 2);
    const itemLabelWidth = Math.max(8, lineWidth - numberWidth - 4);
    const columnLayout = createSelectionColumnLayout(itemLabelWidth, entries);

    const { start, end } = resolveVisibleEntryRange(selectedIndex, entries.length, listRows);

    const lines: string[] = [];
    lines.push(
      'Select chart  [↑/↓ or k/j: move]  [←/→ or h/l: page]  [Ctrl+b/f: page]  [a: MANUAL/AUTO SCRATCH/AUTO]  [s/S: HS +/-]  [Enter: play]  [Ctrl+C/Esc: exit]',
    );
    lines.push(truncateForDisplay(`Directory: ${rootDir}`, lineWidth));
    lines.push(`Mode: ${formatPlayModeLabel(playMode)}  HIGH-SPEED: x${formatHighSpeedLabel(highSpeed)}`);
    lines.push(
      `Audio backend: ${formatSongSelectAudioBackendLabel(options.audio, previewController?.getActiveBackend())}`,
    );
    lines.push('');
    const headerPrefix = `  ${' '.repeat(numberWidth)} `;
    const columnHeader = formatSelectionColumnHeader(columnLayout);
    lines.push(`${headerPrefix}${truncateForDisplay(columnHeader, itemLabelWidth)}`);

    for (let index = start; index < end; index += 1) {
      const entry = entries[index];
      const marker = index === selectedIndex ? '>' : ' ';
      const chartNumber = chartIndexByEntryIndex.get(index);
      const number =
        typeof chartNumber === 'number' ? String(chartNumber + 1).padStart(numberWidth, ' ') : ' '.repeat(numberWidth);
      const label = truncateForDisplay(formatSelectionEntryLabel(entry, columnLayout), itemLabelWidth);
      const line = `${marker} ${number} ${label}`;
      if (index === selectedIndex) {
        lines.push(`\u001b[7m${line.padEnd(lineWidth, ' ')}\u001b[0m`);
      } else {
        lines.push(line);
      }
    }

    lines.push('');
    const selectedChartIndex = chartIndexByEntryIndex.get(selectedIndex);
    if (typeof selectedChartIndex === 'number') {
      lines.push(`${selectedChartIndex + 1}/${chartCount}`);
    } else {
      lines.push(`RANDOM/${chartCount}`);
    }
    process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\u001b[J`);
  };

  return new Promise<SelectChartInteractivelyResult>((resolvePromise) => {
    let finished = false;

    const cleanup = (result: SelectChartInteractivelyResult): void => {
      if (finished) {
        return;
      }
      finished = true;
      inputCapture.stdin.removeListener('keypress', onKeyPress);
      inputCapture.restore();
      process.stdout.write('\u001b[?25h\u001b[2J\u001b[H');
      void (async () => {
        await previewController?.dispose();
        resolvePromise(result);
      })();
    };

    const moveSelection = (delta: number): void => {
      const currentSelectableIndex = selectableIndexByEntryIndex.get(selectedIndex) ?? 0;
      const nextSelectableIndex = resolveCircularSelectableIndex(
        currentSelectableIndex,
        delta,
        selectableIndexes.length,
      );
      selectedIndex = selectableIndexes[nextSelectableIndex];
      syncPreview();
      render();
    };

    const moveSelectionByPage = (direction: SongSelectPageDirection): void => {
      const pageSize = listRowsForViewport();
      selectedIndex = resolvePageSelectableIndex(selectableIndexes, selectedIndex, entries.length, pageSize, direction);
      syncPreview();
      render();
    };

    const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
      const action = resolveSongSelectNavigationAction(chunk, key);
      if (action === 'ctrl-c') {
        cleanup({
          reason: 'ctrl-c',
          focusKey: getEntryFocusKey(entries[selectedIndex]),
          playMode,
          highSpeed,
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
        selectedIndex = selectableIndexes[0];
        syncPreview();
        render();
        return;
      }
      if (action === 'last') {
        selectedIndex = selectableIndexes[selectableIndexes.length - 1];
        syncPreview();
        render();
        return;
      }
      if (action === 'confirm') {
        const selectedEntry = entries[selectedIndex];
        if (selectedEntry?.kind === 'random') {
          const randomIndex = Math.floor(Math.random() * files.length);
          cleanup({
            reason: 'selected',
            selectedPath: files[randomIndex],
            focusKey: getEntryFocusKey(selectedEntry),
            playMode,
            highSpeed,
          });
          return;
        }
        if (selectedEntry?.kind === 'chart') {
          cleanup({
            reason: 'selected',
            selectedPath: selectedEntry.filePath,
            focusKey: getEntryFocusKey(selectedEntry),
            playMode,
            highSpeed,
          });
          return;
        }
        return;
      }
      if (action === 'toggle-auto') {
        playMode = cyclePlayMode(playMode);
        render();
        return;
      }
      if (action === 'increase-high-speed') {
        highSpeed = increaseHighSpeed(highSpeed);
        render();
        return;
      }
      if (action === 'decrease-high-speed') {
        highSpeed = decreaseHighSpeed(highSpeed);
        render();
        return;
      }
      if (action === 'escape') {
        cleanup({
          reason: 'escape',
          focusKey: getEntryFocusKey(entries[selectedIndex]),
          playMode,
          highSpeed,
        });
      }
    };

    inputCapture.stdin.on('keypress', onKeyPress);
    syncPreview();
    render();
  });
}


function getEntryFocusKey(entry: ChartSelectionEntry | undefined): string | undefined {
  if (!entry) {
    return undefined;
  }
  if (entry.kind === 'random') {
    return 'random';
  }
  if (entry.kind === 'chart') {
    return createChartFocusKey(entry.filePath);
  }
  return undefined;
}

function createChartFocusKey(filePath: string): string {
  return `chart:${filePath}`;
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
): string | undefined {
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

async function showResultScreen(rootDir: string, played: PlayedChartResult): Promise<ResultScreenAction> {
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
      `PLAYER ${formatPlayerLabel(played.player)}  RANK ${formatRankLabel(played.rank)}  PLAYLEVEL ${formatPlayLevelLabel(played.playLevel)}`,
    );
    lines.push(`NOTES ${notesProgress}`);
    lines.push(`EX-SCORE ${played.summary.exScore}/${maxExScore}  SCORE ${played.summary.score}/200000`);
    lines.push(`PERFECT ${played.summary.perfect}  GREAT ${played.summary.great}`);
    lines.push(`FAST ${played.summary.fast}  SLOW ${played.summary.slow}`);
    lines.push(`GOOD ${played.summary.good}  BAD ${played.summary.bad}  POOR ${played.summary.poor}`);
    lines.push('');
    lines.push('Press r to replay this chart.');
    lines.push('Press Enter or Esc to return to song selection.');
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
      if (action) {
        cleanup(action);
      }
    };

    inputCapture.stdin.on('keypress', onKeyPress);
    render();
  });
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
