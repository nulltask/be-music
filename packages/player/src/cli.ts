#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BmsJson } from '@be-music/json';
import { resolveCliPath } from '@be-music/utils';
import readline from 'node:readline';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import { createTimingResolver, type RenderResult, renderJson, writeAudioFile } from '@be-music/audio-renderer';
import {
  autoPlay,
  extractPlayableNotes,
  manualPlay,
  PlayerInterruptedError,
  type PlayerLoadProgress,
  type PlayerSummary,
} from './index.ts';
import {
  createAudioOutputBackend,
  isAudioBackendName,
  type AudioBackendName,
} from './audio-backend.ts';

interface CliArgs {
  input?: string;
  auto: boolean;
  speed?: number;
  judgeWindowMs?: number;
  renderAudioPath?: string;
  audio: boolean;
  previewAudio: boolean;
  bgmVolume?: number;
  audioTailSeconds?: number;
  audioOffsetMs?: number;
  audioHeadPaddingMs?: number;
  audioBackend?: AudioBackendName;
  tui: boolean;
}

interface ChartSummaryItem {
  filePath: string;
  relativePath: string;
  directoryLabel: string;
  fileLabel: string;
  totalNotes?: number;
  player?: number;
  rank?: number;
  playLevel?: number;
  bpmInitial?: number;
  bpmMin?: number;
  bpmMax?: number;
}

type ChartSelectionEntry =
  | {
      kind: 'random';
      label: string;
    }
  | {
      kind: 'group';
      label: string;
    }
  | {
      kind: 'chart';
      filePath: string;
      fileLabel: string;
      totalNotes?: number;
      player?: number;
      rank?: number;
      playLevel?: number;
      bpmInitial?: number;
      bpmMin?: number;
      bpmMax?: number;
    };

interface ChartSummaryLoadingProgress {
  filePath: string;
  currentIndex: number;
  totalCount: number;
}

interface PlayLoadingProgress {
  ratio: number;
  message: string;
  detail?: string;
}

interface BuildChartSelectionEntriesOptions {
  onLoadingFile?: (progress: ChartSummaryLoadingProgress) => void;
  getCancelReason?: () => LoadingCancelReason | undefined;
}

interface SelectChartInteractivelyOptions {
  previewAudio: boolean;
  audioBackend: AudioBackendName;
  entries?: ChartSelectionEntry[];
  initialFocusKey?: string;
  initialAuto?: boolean;
}

type SelectChartInteractivelyExitReason = 'selected' | 'escape' | 'ctrl-c';

interface SelectChartInteractivelyResult {
  reason: SelectChartInteractivelyExitReason;
  selectedPath?: string;
  focusKey?: string;
  auto: boolean;
}

type ResultScreenAction = 'enter' | 'escape' | 'ctrl-c';
type LoadingCancelReason = 'escape' | 'ctrl-c';

interface PlayedChartResult {
  chartPath: string;
  summary: PlayerSummary;
  title?: string;
  artist?: string;
  player?: number;
  rank?: number;
  playLevel?: number;
}

class ChartSelectionLoadingCanceledError extends Error {
  readonly reason: LoadingCancelReason;

  /**
   * constructor に対応する処理を実行します。
   * @param reason - キャンセル要因。
   * @returns 戻り値はありません。
   */
  constructor(reason: LoadingCancelReason) {
    super(`Chart loading canceled: ${reason}`);
    this.reason = reason;
  }
}

interface ChartPreviewController {
  focus: (filePath: string | undefined) => void;
  dispose: () => Promise<void>;
}

interface PreviewPlaybackHandle {
  stop: () => void;
  done: Promise<void>;
}

const SELECTABLE_CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms']);
const PREVIEW_CHUNK_FRAMES = 256;
const PREVIEW_MAX_SECONDS = 30;
const PREVIEW_SILENCE_THRESHOLD = 0.0001;
const PREVIEW_STOP_TIMEOUT_MS = 180;
const PREVIEW_BACKPRESSURE_TIMEOUT_MS = 800;

/**
 * プレビュー再生で試行する音声バックエンド順を返します。
 * @param requested - CLI で指定されたバックエンド。
 * @returns 試行順に並べたバックエンド名の配列。
 */
function createPreviewBackendCandidates(requested: AudioBackendName): AudioBackendName[] {
  if (requested !== 'auto') {
    return [requested];
  }
  return ['audio-io', 'audify', 'speaker'];
}

/**
 * 非同期でmain に対応する処理を実行します。
 * @returns 戻り値はありません。
 */
async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${formatCliParseError(error)}\n\n`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!args.input) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const inputPath = resolveCliPath(args.input);
  const inputStat = await stat(inputPath);
  if (inputStat.isDirectory()) {
    await runDirectoryInput(inputPath, args);
    return;
  }
  try {
    await playChartOnce(inputPath, args);
  } catch (error) {
    if (error instanceof PlayerInterruptedError) {
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

/**
 * 非同期でディレクトリ入力時の選曲ループを実行します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @param args - CLI 引数。
 * @returns 戻り値はありません。
 */
async function runDirectoryInput(rootDir: string, args: CliArgs): Promise<void> {
  const candidates = await listChartFiles(rootDir);
  if (candidates.length === 0) {
    process.stdout.write(`No chart files found in directory: ${rootDir}\n`);
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY || candidates.length === 1) {
    const selected = candidates[0];
    process.stdout.write(`Selected chart: ${selected}\n`);
    try {
      await playChartOnce(selected, args);
    } catch (error) {
      if (error instanceof PlayerInterruptedError) {
        process.exitCode = error.exitCode;
        return;
      }
      throw error;
    }
    return;
  }

  const entries = await loadChartSelectionEntries(rootDir, candidates);
  if (!entries) {
    return;
  }

  let focusKey: string | undefined;
  let auto = args.auto;
  while (true) {
    const selection = await selectChartInteractively(rootDir, candidates, {
      previewAudio: args.audio && args.previewAudio,
      audioBackend: args.audioBackend ?? 'auto',
      entries,
      initialFocusKey: focusKey,
      initialAuto: auto,
    });

    if (selection.reason === 'ctrl-c') {
      process.exitCode = 130;
      return;
    }
    if (selection.reason === 'escape' || !selection.selectedPath) {
      process.exitCode = 0;
      return;
    }

    focusKey = selection.focusKey;
    auto = selection.auto;
    let played: PlayedChartResult;
    try {
      played = await playChartOnce(selection.selectedPath, { ...args, auto });
    } catch (error) {
      if (error instanceof PlayerInterruptedError) {
        if (error.reason === 'escape') {
          continue;
        }
        process.exitCode = error.exitCode;
        return;
      }
      throw error;
    }
    const resultAction = await showResultScreen(rootDir, played);
    if (resultAction === 'enter') {
      continue;
    }
    process.exitCode = resultAction === 'ctrl-c' ? 130 : 0;
    return;
  }
}

/**
 * 非同期で譜面を 1 回再生し、結果表示向けの情報を返します。
 * @param chartPath - 処理対象の譜面パス。
 * @param args - CLI 引数。
 * @returns 非同期処理完了後の結果（PlayedChartResult）を解決する Promise。
 */
async function playChartOnce(chartPath: string, args: CliArgs): Promise<PlayedChartResult> {
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
    speed: args.speed,
    judgeWindowMs: args.judgeWindowMs,
    audio: args.audio,
    bgmVolume: args.bgmVolume,
    audioBaseDir: dirname(chartPath),
    audioTailSeconds: args.audioTailSeconds,
    audioOffsetMs: args.audioOffsetMs,
    audioHeadPaddingMs: args.audioHeadPaddingMs,
    audioBackend: args.audioBackend,
    tui: args.tui,
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

  const summary = args.auto
    ? await autoPlay(json, { ...playOptions, auto: true })
    : await manualPlay(json, playOptions);
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

/**
 * メタ情報文字列を表示向けに整形します。
 * @param value - 処理対象の値。
 * @returns 変換後または整形後の文字列。
 */
function sanitizeMetadataText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * 入力データを解析し、内部処理で扱う形式に変換します。
 * @param rawArgs - CLI から渡される引数配列。
 * @returns 処理結果（CliArgs）。
 */
export function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = { auto: false, audio: true, previewAudio: false, tui: true };
  const positional: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--auto') {
      args.auto = true;
      continue;
    }
    if (token === '--speed') {
      args.speed = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--judge-window') {
      args.judgeWindowMs = Number.parseInt(rawArgs[index + 1], 10);
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
    if (token === '--audio-backend') {
      const backend = rawArgs[index + 1];
      if (!backend) {
        throw new Error('Missing value for --audio-backend');
      }
      if (!isAudioBackendName(backend)) {
        throw new Error('Invalid --audio-backend value: ' + backend);
      }
      args.audioBackend = backend;
      index += 1;
      continue;
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
      args.previewAudio = true;
      continue;
    }
    if (token === '--no-preview' || token === '--no-preview-audio') {
      args.previewAudio = false;
      continue;
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

/**
 * CLI 引数解析エラーを表示用メッセージに整形します。
 * @param error - 例外オブジェクト。
 * @returns 変換後または整形後の文字列。
 */
function formatCliParseError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Failed to parse CLI arguments';
}

/**
 * print Usage に対応する処理を実行します。
 * @returns 戻り値はありません。
 */
function printUsage(): void {
  process.stdout.write(
    [
      'Usage: bms-player <input.(bms|bme|bml|pms|bmson|json)|directory> [options]',
      '',
      'Options:',
      '  --auto                    Enable auto play mode',
      '  --speed <rate>            Playback speed multiplier (default: 1)',
      '  --judge-window <ms>       Judgment window for manual mode (default: 120)',
      '  --render-audio <path>     Render audio preview before playing',
      '  --audio / --no-audio      Enable or disable in-game audio playback (default: on)',
      '  --preview / --no-preview  Enable or disable song-preview audio in song-select (default: off)',
      '  --audio-backend <name>    Audio backend: auto | speaker | audify | audio-io (default: auto)',
      '  --bgm-volume <value>      Volume multiplier for non-play lanes (default: 1, 0 disables BGM)',
      '  --audio-tail <seconds>    Audio tail length when rendering playback buffer (default: 1.5)',
      '  --audio-offset-ms <ms>    Timing offset for audio sync calibration (default: 0)',
      '  --audio-head-padding-ms   Silent head padding before chart start (default: 0)',
      '  --tui / --no-tui          Enable or disable TUI play screen (default: on in TTY)',
    ].join('\n') + '\n',
  );
}

/**
 * 非同期で譜面一覧メタ情報を読み込み、選曲エントリを構築します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @param files - 処理対象のファイル一覧。
 * @returns 非同期処理完了後の結果（ChartSelectionEntry[] | undefined）を解決する Promise。
 */
async function loadChartSelectionEntries(rootDir: string, files: string[]): Promise<ChartSelectionEntry[] | undefined> {
  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRawMode = Boolean(stdin.isRaw);
  let cancelReason: LoadingCancelReason | undefined;

  readline.emitKeypressEvents(process.stdin);
  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }
  stdin.resume();
  process.stdout.write('\u001b[?25l');

  /**
   * on Key Press に対応する処理を実行します。
   * @param _chunk - キー入力から取得した文字列チャンク。
   * @param key - キー入力イベント情報。
   * @returns 戻り値はありません。
   */
  const onKeyPress = (_chunk: string | undefined, key: readline.Key): void => {
    if (key.sequence === '\u0003') {
      cancelReason = 'ctrl-c';
      return;
    }
    if (key.name?.toLowerCase() === 'escape' || key.sequence === '\u001b') {
      cancelReason = 'escape';
    }
  };
  process.stdin.on('keypress', onKeyPress);

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
    process.stdin.removeListener('keypress', onKeyPress);
    if (stdin.isTTY) {
      stdin.setRawMode(wasRawMode);
    }
    process.stdout.write('\u001b[?25h');
  }
}

/**
 * ロード中の進捗表示を描画します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @param progress - 現在の読み込み進捗。
 * @returns 戻り値はありません。
 */
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

/**
 * 選曲後の譜面ロード進捗表示を描画します。
 * @param chartPath - 処理対象の譜面パス。
 * @param progress - 現在の読み込み進捗。
 * @returns 戻り値はありません。
 */
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

/**
 * 非同期で対象データの一覧を返します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @returns 非同期処理完了後の結果（string[]）を解決する Promise。
 */
async function listChartFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const dot = entry.name.lastIndexOf('.');
      const extension = dot >= 0 ? entry.name.slice(dot).toLowerCase() : '';
      if (SELECTABLE_CHART_EXTENSIONS.has(extension)) {
        files.push(absolute);
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right, 'ja'));
  return files;
}

/**
 * 非同期でselect Chart Interactively に対応する処理を実行します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @param files - 処理対象のファイル一覧。
 * @returns 非同期処理完了後の結果（SelectChartInteractivelyResult）を解決する Promise。
 */
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
    return { reason: 'escape', auto: options.initialAuto ?? false };
  }

  const previewController =
    options.previewAudio && process.stdout.isTTY
      ? createChartPreviewController({
          audioBackend: options.audioBackend,
        })
      : undefined;

  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRawMode = Boolean(stdin.isRaw);
  let selectedIndex = selectableIndexes[0];
  let auto = options.initialAuto ?? false;
  if (options.initialFocusKey) {
    const found = selectableIndexes.find((index) => getEntryFocusKey(entries[index]) === options.initialFocusKey);
    if (typeof found === 'number') {
      selectedIndex = found;
    }
  }

  readline.emitKeypressEvents(process.stdin);
  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }
  stdin.resume();
  process.stdout.write('\u001b[?25l');

  /**
   * 現在の選択状態に応じてプレビュー再生対象を更新します。
   * @returns 戻り値はありません。
   */
  const syncPreview = (): void => {
    const entry = entries[selectedIndex];
    const filePath = entry?.kind === 'chart' ? entry.filePath : undefined;
    previewController?.focus(filePath);
  };

  /**
   * 描画または音声レンダリングを行い、結果を返します。
   * @returns 戻り値はありません。
   */
  const render = (): void => {
    const columns = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
    const listRows = Math.max(5, rows - 8);
    const numberWidth = String(Math.max(1, chartCount)).length;
    const lineWidth = Math.max(16, columns - 2);
    const itemLabelWidth = Math.max(8, lineWidth - numberWidth - 4);
    const columnLayout = createSelectionColumnLayout(itemLabelWidth, entries);

    const half = Math.floor(listRows / 2);
    let start = Math.max(0, selectedIndex - half);
    if (start + listRows > entries.length) {
      start = Math.max(0, entries.length - listRows);
    }
    const end = Math.min(entries.length, start + listRows);

    const lines: string[] = [];
    lines.push('Select chart  [↑/↓ or k/j: move]  [a: AUTO/MANUAL]  [Enter: play]  [Ctrl+C/Esc: exit]');
    lines.push(truncateForDisplay(`Directory: ${rootDir}`, lineWidth));
    lines.push(`Mode: ${auto ? 'AUTO' : 'MANUAL'}`);
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

    /**
     * cleanup に対応する処理を実行します。
     * @param result - result に対応する入力値。
     * @returns 戻り値はありません。
     */
    const cleanup = (result: SelectChartInteractivelyResult): void => {
      if (finished) {
        return;
      }
      finished = true;
      process.stdin.removeListener('keypress', onKeyPress);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRawMode);
      }
      process.stdout.write('\u001b[?25h\u001b[2J\u001b[H');
      void (async () => {
        await previewController?.dispose();
        resolvePromise(result);
      })();
    };

    /**
     * move Selection に対応する処理を実行します。
     * @param delta - delta に対応する入力値。
     * @returns 戻り値はありません。
     */
    const moveSelection = (delta: number): void => {
      const currentSelectableIndex = selectableIndexByEntryIndex.get(selectedIndex) ?? 0;
      const nextSelectableIndex = Math.max(0, Math.min(selectableIndexes.length - 1, currentSelectableIndex + delta));
      selectedIndex = selectableIndexes[nextSelectableIndex];
      syncPreview();
      render();
    };

    /**
     * on Key Press に対応する処理を実行します。
     * @param chunk - キー入力から取得した文字列チャンク。
     * @param key - キー入力イベント情報。
     * @returns 戻り値はありません。
     */
    const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
      if (key.sequence === '\u0003') {
        cleanup({
          reason: 'ctrl-c',
          focusKey: getEntryFocusKey(entries[selectedIndex]),
          auto,
        });
        return;
      }

      const lowerChunk = typeof chunk === 'string' ? chunk.toLowerCase() : '';
      const keyName = key.name?.toLowerCase();

      if (keyName === 'up' || lowerChunk === 'k') {
        moveSelection(-1);
        return;
      }
      if (keyName === 'down' || lowerChunk === 'j') {
        moveSelection(1);
        return;
      }
      if (keyName === 'home' || lowerChunk === 'g') {
        selectedIndex = selectableIndexes[0];
        syncPreview();
        render();
        return;
      }
      if (keyName === 'end' || chunk === 'G') {
        selectedIndex = selectableIndexes[selectableIndexes.length - 1];
        syncPreview();
        render();
        return;
      }
      if (keyName === 'return' || keyName === 'enter') {
        const selectedEntry = entries[selectedIndex];
        if (selectedEntry?.kind === 'random') {
          const randomIndex = Math.floor(Math.random() * files.length);
          cleanup({
            reason: 'selected',
            selectedPath: files[randomIndex],
            focusKey: getEntryFocusKey(selectedEntry),
            auto,
          });
          return;
        }
        if (selectedEntry?.kind === 'chart') {
          cleanup({
            reason: 'selected',
            selectedPath: selectedEntry.filePath,
            focusKey: getEntryFocusKey(selectedEntry),
            auto,
          });
          return;
        }
        return;
      }
      if (lowerChunk === 'a') {
        auto = !auto;
        render();
        return;
      }
      if (keyName === 'escape' || key.sequence === '\u001b') {
        cleanup({
          reason: 'escape',
          focusKey: getEntryFocusKey(entries[selectedIndex]),
          auto,
        });
      }
    };

    process.stdin.on('keypress', onKeyPress);
    syncPreview();
    render();
  });
}

/**
 * 選択位置復元用のフォーカスキーを返します。
 * @param entry - 対象エントリ。
 * @returns 変換後または整形後の文字列。
 */
function getEntryFocusKey(entry: ChartSelectionEntry | undefined): string | undefined {
  if (!entry) {
    return undefined;
  }
  if (entry.kind === 'random') {
    return 'random';
  }
  if (entry.kind === 'chart') {
    return `chart:${entry.filePath}`;
  }
  return undefined;
}

/**
 * 非同期でリザルト画面を表示し、次アクションを返します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @param played - 再生結果情報。
 * @returns 非同期処理完了後の結果（ResultScreenAction）を解決する Promise。
 */
async function showResultScreen(rootDir: string, played: PlayedChartResult): Promise<ResultScreenAction> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'enter';
  }

  const relativePath = relative(rootDir, played.chartPath).replaceAll('\\', '/');
  const titleLine = played.title ?? relativePath;
  const artistLine = played.artist ? `ARTIST ${played.artist}` : undefined;
  const totalNotes = Math.max(0, Math.floor(played.summary.total));
  const judgedNotes = Math.max(
    0,
    Math.floor(played.summary.perfect + played.summary.great + played.summary.good + played.summary.miss),
  );
  const notesProgress = `${Math.min(totalNotes, judgedNotes)}/${totalNotes}`;

  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRawMode = Boolean(stdin.isRaw);

  readline.emitKeypressEvents(process.stdin);
  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }
  stdin.resume();
  process.stdout.write('\u001b[?25l');

  /**
   * 描画または音声レンダリングを行い、結果を返します。
   * @returns 戻り値はありません。
   */
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
    lines.push(`PERFECT ${played.summary.perfect}  GREAT ${played.summary.great}`);
    lines.push(`GOOD ${played.summary.good}  MISS ${played.summary.miss}`);
    lines.push('');
    lines.push('Press Enter to return to song selection.');
    lines.push('Press Ctrl+C or Esc to quit.');
    process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\u001b[J`);
  };

  return new Promise<ResultScreenAction>((resolvePromise) => {
    let finished = false;

    /**
     * cleanup に対応する処理を実行します。
     * @param action - action に対応する入力値。
     * @returns 戻り値はありません。
     */
    const cleanup = (action: ResultScreenAction): void => {
      if (finished) {
        return;
      }
      finished = true;
      process.stdin.removeListener('keypress', onKeyPress);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRawMode);
      }
      process.stdout.write('\u001b[?25h\u001b[2J\u001b[H');
      resolvePromise(action);
    };

    /**
     * on Key Press に対応する処理を実行します。
     * @param _chunk - キー入力から取得した文字列チャンク。
     * @param key - キー入力イベント情報。
     * @returns 戻り値はありません。
     */
    const onKeyPress = (_chunk: string | undefined, key: readline.Key): void => {
      if (key.sequence === '\u0003') {
        cleanup('ctrl-c');
        return;
      }
      const keyName = key.name?.toLowerCase();
      if (keyName === 'return' || keyName === 'enter') {
        cleanup('enter');
        return;
      }
      if (keyName === 'escape' || key.sequence === '\u001b') {
        cleanup('escape');
      }
    };

    process.stdin.on('keypress', onKeyPress);
    render();
  });
}

/**
 * 非同期で選曲画面に表示する一覧を生成します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @param files - 処理対象のファイル一覧。
 * @returns 非同期処理完了後の結果（ChartSelectionEntry[]）を解決する Promise。
 */
async function buildChartSelectionEntries(
  rootDir: string,
  files: string[],
  options: BuildChartSelectionEntriesOptions = {},
): Promise<ChartSelectionEntry[]> {
  let summaries: ChartSummaryItem[];
  if (!options.onLoadingFile && !options.getCancelReason) {
    summaries = await Promise.all(files.map((filePath) => buildChartSummary(rootDir, filePath)));
  } else {
    summaries = [];
    for (let index = 0; index < files.length; index += 1) {
      const cancelReason = options.getCancelReason?.();
      if (cancelReason) {
        throw new ChartSelectionLoadingCanceledError(cancelReason);
      }
      const filePath = files[index];
      options.onLoadingFile?.({
        filePath,
        currentIndex: index + 1,
        totalCount: files.length,
      });
      summaries.push(await buildChartSummary(rootDir, filePath));
      const cancelAfterReason = options.getCancelReason?.();
      if (cancelAfterReason) {
        throw new ChartSelectionLoadingCanceledError(cancelAfterReason);
      }
    }
  }
  summaries.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'ja'));

  const groupedByDirectory = new Map<string, ChartSummaryItem[]>();
  for (const summary of summaries) {
    const group = groupedByDirectory.get(summary.directoryLabel);
    if (group) {
      group.push(summary);
      continue;
    }
    groupedByDirectory.set(summary.directoryLabel, [summary]);
  }

  const directoryLabels = [...groupedByDirectory.keys()].sort((left, right) => {
    if (left === '.') {
      return right === '.' ? 0 : -1;
    }
    if (right === '.') {
      return 1;
    }
    return left.localeCompare(right, 'ja');
  });

  const entries: ChartSelectionEntry[] = [{ kind: 'random', label: '[Random] Select a chart randomly' }];
  for (const directoryLabel of directoryLabels) {
    const charts = groupedByDirectory.get(directoryLabel);
    if (!charts || charts.length === 0) {
      continue;
    }
    const sortedCharts = [...charts].sort((left, right) => {
      const playerDiff = compareOptionalNumber(left.player, right.player);
      if (playerDiff !== 0) {
        return playerDiff;
      }
      const playLevelDiff = compareOptionalNumber(left.playLevel, right.playLevel);
      if (playLevelDiff !== 0) {
        return playLevelDiff;
      }
      const fileDiff = left.fileLabel.localeCompare(right.fileLabel, 'ja');
      if (fileDiff !== 0) {
        return fileDiff;
      }
      return left.relativePath.localeCompare(right.relativePath, 'ja');
    });

    entries.push({
      kind: 'group',
      label: directoryLabel === '.' ? '[Folder] (root)' : `[Folder] ${directoryLabel}`,
    });

    for (const chart of sortedCharts) {
      entries.push({
        kind: 'chart',
        filePath: chart.filePath,
        fileLabel: chart.fileLabel,
        totalNotes: chart.totalNotes,
        player: chart.player,
        rank: chart.rank,
        playLevel: chart.playLevel,
        bpmInitial: chart.bpmInitial,
        bpmMin: chart.bpmMin,
        bpmMax: chart.bpmMax,
      });
    }
  }
  return entries;
}

/**
 * 省略可能な数値を比較し、ソート順を返します。
 * @param left - 比較対象の左側の値。
 * @param right - 比較対象の右側の値。
 * @returns 計算結果の数値。
 */
function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  const hasLeft = typeof left === 'number' && Number.isFinite(left);
  const hasRight = typeof right === 'number' && Number.isFinite(right);
  if (hasLeft && hasRight) {
    return left - right;
  }
  if (hasLeft) {
    return -1;
  }
  if (hasRight) {
    return 1;
  }
  return 0;
}

/**
 * 非同期で譜面一覧表示向けの情報を抽出して返します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @param filePath - 処理対象の譜面パス。
 * @returns 非同期処理完了後の結果（ChartSummaryItem）を解決する Promise。
 */
async function buildChartSummary(rootDir: string, filePath: string): Promise<ChartSummaryItem> {
  const relativePath = relative(rootDir, filePath).replaceAll('\\', '/');
  const slashIndex = relativePath.lastIndexOf('/');
  const directoryLabel = slashIndex >= 0 ? relativePath.slice(0, slashIndex) : '.';
  const fileLabel = slashIndex >= 0 ? relativePath.slice(slashIndex + 1) : relativePath;

  let player: number | undefined;
  let rank: number | undefined;
  let playLevel: number | undefined;
  let totalNotes: number | undefined;
  let bpmInitial: number | undefined;
  let bpmMin: number | undefined;
  let bpmMax: number | undefined;
  try {
    const chart = await parseChartFile(filePath);
    const resolvedChart = resolveBmsControlFlow(chart, { random: () => 0 });
    totalNotes = extractPlayableNotes(resolvedChart).length;
    player = chart.bms.player;
    rank = chart.metadata.rank;
    playLevel = chart.metadata.playLevel;
    const bpmSummary = extractChartBpmSummary(resolvedChart);
    bpmInitial = bpmSummary?.initial;
    bpmMin = bpmSummary?.min;
    bpmMax = bpmSummary?.max;
  } catch {
    // 一覧表示のメタ情報取得失敗は再生可否と分離し、欠損扱いで続行する。
  }

  return {
    filePath,
    relativePath,
    directoryLabel,
    fileLabel,
    totalNotes,
    player,
    rank,
    playLevel,
    bpmInitial,
    bpmMin,
    bpmMax,
  };
}

/**
 * 譜面全体の BPM 統計（最小・初期・最大）を抽出します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 抽出結果。BPM を取得できない場合は `undefined`。
 */
function extractChartBpmSummary(json: BmsJson): { initial: number; min: number; max: number } | undefined {
  const resolver = createTimingResolver(json);
  const bpmValues = resolver.tempoPoints
    .map((point) => point.bpm)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (bpmValues.length === 0) {
    return undefined;
  }

  let min = bpmValues[0];
  let max = bpmValues[0];
  for (const bpm of bpmValues) {
    if (bpm < min) {
      min = bpm;
    }
    if (bpm > max) {
      max = bpm;
    }
  }

  return {
    initial: bpmValues[0],
    min,
    max,
  };
}

/**
 * 選曲画面向けのプレビュー再生コントローラーを生成します。
 * @param options - 動作を制御するオプション。
 * @returns 処理結果（ChartPreviewController）。
 */
function createChartPreviewController(options: { audioBackend: AudioBackendName }): ChartPreviewController {
  const previewCache = new Map<string, RenderResult>();
  let focusedFilePath: string | undefined;
  let sequence = 0;
  let disposed = false;
  let activePlayback: PreviewPlaybackHandle | undefined;

  /**
   * プレビュー再生停止を一定時間だけ待機し、UI 操作のハングを防ぎます。
   * @param playback - 停止対象の再生ハンドル。
   * @returns 停止待機完了を示す Promise。
   */
  const stopPlaybackSafely = async (playback: PreviewPlaybackHandle): Promise<void> => {
    playback.stop();
    await Promise.race([playback.done.catch(() => undefined), createTimeoutPromise(PREVIEW_STOP_TIMEOUT_MS)]);
  };

  const stopActivePlayback = async (): Promise<void> => {
    if (!activePlayback) {
      return;
    }
    const playback = activePlayback;
    activePlayback = undefined;
    await stopPlaybackSafely(playback);
  };

  return {
    focus: (filePath: string | undefined) => {
      if (disposed || focusedFilePath === filePath) {
        return;
      }
      focusedFilePath = filePath;
      sequence += 1;
      const currentSequence = sequence;

      void (async () => {
        await stopActivePlayback();
        if (disposed || currentSequence !== sequence || !filePath) {
          return;
        }

        let preview = previewCache.get(filePath);
        if (!preview) {
          preview = await renderChartPreview(filePath);
          if (!preview) {
            return;
          }
          previewCache.set(filePath, preview);
          while (previewCache.size > 8) {
            const oldest = previewCache.keys().next().value as string | undefined;
            if (!oldest) {
              break;
            }
            previewCache.delete(oldest);
          }
        }

        if (disposed || currentSequence !== sequence) {
          return;
        }

        const playback = await startPreviewPlayback(preview, options.audioBackend);
        if (!playback) {
          return;
        }
        if (disposed || currentSequence !== sequence) {
          await stopPlaybackSafely(playback);
          return;
        }
        activePlayback = playback;
      })();
    },
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      sequence += 1;
      focusedFilePath = undefined;
      previewCache.clear();
      await stopActivePlayback();
    },
  };
}

/**
 * 非同期で譜面プレビュー音声をレンダリングして返します。
 * @param filePath - 処理対象の譜面パス。
 * @returns 非同期処理完了後の結果（RenderResult | undefined）を解決する Promise。
 */
async function renderChartPreview(filePath: string): Promise<RenderResult | undefined> {
  const chart = await parseChartFile(filePath);
  const resolved = resolveBmsControlFlow(chart, { random: () => 0 });
  const rendered = await renderJson(resolved, {
    baseDir: dirname(filePath),
    tailSeconds: 0.6,
  });
  const trimmed = trimPreviewLeadingSilence(rendered);
  const maxFrames = Math.max(1, Math.floor(trimmed.sampleRate * PREVIEW_MAX_SECONDS));
  if (trimmed.left.length <= maxFrames) {
    return trimmed;
  }
  return {
    ...trimmed,
    left: trimmed.left.subarray(0, maxFrames),
    right: trimmed.right.subarray(0, maxFrames),
    durationSeconds: maxFrames / trimmed.sampleRate,
  };
}

/**
 * プレビュー音声の先頭無音を削って再生開始位置を前倒しします。
 * @param rendered - 処理対象の音声データ。
 * @returns 処理結果（RenderResult）。
 */
function trimPreviewLeadingSilence(rendered: RenderResult): RenderResult {
  const length = Math.min(rendered.left.length, rendered.right.length);
  let start = 0;
  while (start < length) {
    const left = Math.abs(rendered.left[start]);
    const right = Math.abs(rendered.right[start]);
    if (left > PREVIEW_SILENCE_THRESHOLD || right > PREVIEW_SILENCE_THRESHOLD) {
      break;
    }
    start += 1;
  }
  if (start <= 0 || start >= length) {
    return rendered;
  }
  const left = rendered.left.subarray(start);
  const right = rendered.right.subarray(start);
  return {
    ...rendered,
    left,
    right,
    durationSeconds: left.length / rendered.sampleRate,
  };
}

/**
 * 非同期でプレビュー再生を開始し、制御ハンドルを返します。
 * @param rendered - 処理対象の音声データ。
 * @param audioBackend - 利用する音声バックエンド。
 * @returns 非同期処理完了後の結果（PreviewPlaybackHandle | undefined）を解決する Promise。
 */
async function startPreviewPlayback(
  rendered: RenderResult,
  audioBackend: AudioBackendName,
): Promise<PreviewPlaybackHandle | undefined> {
  for (const candidate of createPreviewBackendCandidates(audioBackend)) {
    const playback = await startPreviewPlaybackWithBackend(rendered, candidate);
    if (playback) {
      return playback;
    }
  }
  return undefined;
}

/**
 * 非同期で指定バックエンドによるプレビュー再生を開始します。
 * @param rendered - 処理対象の音声データ。
 * @param audioBackend - 利用する音声バックエンド。
 * @returns 非同期処理完了後の結果（PreviewPlaybackHandle | undefined）を解決する Promise。
 */
async function startPreviewPlaybackWithBackend(
  rendered: RenderResult,
  audioBackend: AudioBackendName,
): Promise<PreviewPlaybackHandle | undefined> {
  if (rendered.left.length === 0 || rendered.right.length === 0) {
    return undefined;
  }

  let stopRequested = false;
  let startupFailed = false;
  let playhead = 0;

  const output = await createAudioOutputBackend(audioBackend, {
    sampleRate: rendered.sampleRate,
    channels: 2,
    samplesPerFrame: PREVIEW_CHUNK_FRAMES,
    mode: 'auto',
  });

  if (!output) {
    return undefined;
  }

  output.onError(() => {
    if (playhead <= 0) {
      startupFailed = true;
    }
    stopRequested = true;
  });

  const chunk = Buffer.allocUnsafe(PREVIEW_CHUNK_FRAMES * 4);

  // 起動直後の失敗を検知するため、最初のチャンクを先に書き込む。
  const firstFrameCount = Math.min(PREVIEW_CHUNK_FRAMES, rendered.left.length - playhead);
  if (firstFrameCount > 0) {
    writePreviewPcmChunk(chunk, rendered, playhead, firstFrameCount);
    playhead += firstFrameCount;

    const writable = output.write(chunk);
    if (!writable) {
      const becameWritable = await waitPreviewWritableWithTimeout(output, () => stopRequested);
      if (!becameWritable) {
        stopRequested = true;
      }
    }
  }

  if (startupFailed || stopRequested) {
    output.destroy();
    return undefined;
  }

  const done = (async () => {
    while (!stopRequested && playhead < rendered.left.length) {
      const frameCount = Math.min(PREVIEW_CHUNK_FRAMES, rendered.left.length - playhead);
      writePreviewPcmChunk(chunk, rendered, playhead, frameCount);
      playhead += frameCount;

      const writable = output.write(chunk);
      if (!writable) {
        const becameWritable = await waitPreviewWritableWithTimeout(output, () => stopRequested);
        if (!becameWritable) {
          stopRequested = true;
          break;
        }
      }
    }

    if (stopRequested) {
      output.destroy();
      return;
    }
    await output.end();
  })().catch(() => undefined);

  return {
    stop: () => {
      stopRequested = true;
      output.destroy();
    },
    done,
  };
}

/**
 * バックプレッシャー解除待機をタイムアウト付きで行います。
 * @param output - 音声出力バックエンド。
 * @param shouldStop - 停止判定関数。
 * @returns 書き込み可能状態へ遷移したら `true`、停止またはタイムアウト時は `false`。
 */
async function waitPreviewWritableWithTimeout(
  output: { waitWritable: (shouldStop: () => boolean) => Promise<void> },
  shouldStop: () => boolean,
): Promise<boolean> {
  if (shouldStop()) {
    return false;
  }

  const waitWritableTask = output
    .waitWritable(shouldStop)
    .then(() => true)
    .catch(() => false);
  const timeoutTask = createTimeoutPromise(PREVIEW_BACKPRESSURE_TIMEOUT_MS).then(() => false);
  const writable = await Promise.race([waitWritableTask, timeoutTask]);
  return writable && !shouldStop();
}

/**
 * 指定ミリ秒後に解決する Promise を生成します。
 * @param ms - 待機時間（ミリ秒）。
 * @returns 待機完了を示す Promise。
 */
function createTimeoutPromise(ms: number): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/**
 * プレビュー再生用 PCM チャンクを書き込みます。
 * @param chunk - 書き込み先のバッファ。
 * @param rendered - 処理対象の音声データ。
 * @param startFrame - 読み取り開始フレーム。
 * @param frameCount - 読み取るフレーム数。
 * @returns 戻り値はありません。
 */
function writePreviewPcmChunk(chunk: Buffer, rendered: RenderResult, startFrame: number, frameCount: number): void {
  for (let frame = 0; frame < frameCount; frame += 1) {
    const source = startFrame + frame;
    const offset = frame * 4;
    chunk.writeInt16LE(floatToInt16(rendered.left[source]), offset);
    chunk.writeInt16LE(floatToInt16(rendered.right[source]), offset + 2);
  }
  const writtenBytes = frameCount * 4;
  if (writtenBytes < chunk.length) {
    chunk.fill(0, writtenBytes);
  }
}

/**
 * 入力値を 16bit PCM 整数へ変換します。
 * @param value - 処理対象の値。
 * @returns 計算結果の数値。
 */
function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
}

interface SelectionColumnLayout {
  fileWidth: number;
  playerWidth: number;
  rankWidth: number;
  playLevelWidth: number;
  bpmWidth: number;
  notesWidth: number;
}

/**
 * 選曲リストの列レイアウトを計算します。
 * @param itemLabelWidth - label に割り当て可能な横幅。
 * @param entries - 描画対象の選択エントリ一覧。
 * @returns 処理結果（SelectionColumnLayout）。
 */
function createSelectionColumnLayout(itemLabelWidth: number, entries: ChartSelectionEntry[]): SelectionColumnLayout {
  const fileHeaderWidth = 'File'.length;
  let playerWidth = 'PLAYER'.length;
  let rankWidth = 'RANK'.length;
  let playLevelWidth = 'PLAYLEVEL'.length;
  let bpmWidth = 'BPM'.length;
  let notesWidth = 'NOTES'.length;
  for (const entry of entries) {
    if (entry.kind !== 'chart') {
      continue;
    }
    playerWidth = Math.max(playerWidth, formatPlayerLabel(entry.player).length);
    rankWidth = Math.max(rankWidth, formatRankLabel(entry.rank).length);
    playLevelWidth = Math.max(playLevelWidth, formatPlayLevelLabel(entry.playLevel).length);
    bpmWidth = Math.max(bpmWidth, formatBpmLabel(entry.bpmMin, entry.bpmInitial, entry.bpmMax).length);
    notesWidth = Math.max(notesWidth, formatTotalNotesLabel(entry.totalNotes).length);
  }

  const spacingWidth = 10;
  const fixedMetaWidth = playerWidth + rankWidth + playLevelWidth + bpmWidth + notesWidth + spacingWidth;
  const fileWidth = Math.max(fileHeaderWidth, Math.max(8, itemLabelWidth - fixedMetaWidth));

  return {
    fileWidth,
    playerWidth,
    rankWidth,
    playLevelWidth,
    bpmWidth,
    notesWidth,
  };
}

/**
 * 列ヘッダーの表示文字列を生成します。
 * @param layout - 列幅レイアウト情報。
 * @returns 変換後または整形後の文字列。
 */
function formatSelectionColumnHeader(layout: SelectionColumnLayout): string {
  const file = formatColumnCell('File', layout.fileWidth);
  const player = formatColumnCell('PLAYER', layout.playerWidth, 'right');
  const rank = formatColumnCell('RANK', layout.rankWidth, 'right');
  const playLevel = formatColumnCell('PLAYLEVEL', layout.playLevelWidth, 'left');
  const bpm = formatColumnCell('BPM', layout.bpmWidth, 'right');
  const notes = formatColumnCell('NOTES', layout.notesWidth, 'right');
  return `${file}  ${player}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
}

/**
 * エントリ種別に応じた表示文字列を生成します。
 * @param entry - 処理対象の選択エントリ。
 * @param layout - 列幅レイアウト情報。
 * @returns 変換後または整形後の文字列。
 */
function formatSelectionEntryLabel(entry: ChartSelectionEntry, layout: SelectionColumnLayout): string {
  if (entry.kind === 'group') {
    return entry.label;
  }
  if (entry.kind === 'random') {
    const file = formatColumnCell(entry.label, layout.fileWidth);
    const player = formatColumnCell('-', layout.playerWidth, 'right');
    const rank = formatColumnCell('-', layout.rankWidth, 'right');
    const playLevel = formatColumnCell('-', layout.playLevelWidth, 'left');
    const bpm = formatColumnCell('-', layout.bpmWidth, 'right');
    const notes = formatColumnCell('-', layout.notesWidth, 'right');
    return `${file}  ${player}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
  }

  const file = formatColumnCell(`  ${entry.fileLabel}`, layout.fileWidth);
  const player = formatColumnCell(formatPlayerLabel(entry.player), layout.playerWidth, 'right');
  const rank = formatColumnCell(formatRankLabel(entry.rank), layout.rankWidth, 'right');
  const playLevel = formatColumnCell(formatPlayLevelLabel(entry.playLevel), layout.playLevelWidth, 'left');
  const bpm = formatColumnCell(formatBpmLabel(entry.bpmMin, entry.bpmInitial, entry.bpmMax), layout.bpmWidth, 'right');
  const notes = formatColumnCell(formatTotalNotesLabel(entry.totalNotes), layout.notesWidth, 'right');
  return `${file}  ${player}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
}

/**
 * 列セル向けに文字列を整形します。
 * @param value - 処理対象の値。
 * @param width - width に対応する入力値。
 * @param align - align に対応する入力値。
 * @returns 変換後または整形後の文字列。
 */
function formatColumnCell(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const truncated = truncateForDisplay(value, width);
  return align === 'right' ? truncated.padStart(width, ' ') : truncated.padEnd(width, ' ');
}

/**
 * 表示用の PLAYER 値をラベルへ変換します。
 * @param value - 処理対象の値。
 * @returns 変換後または整形後の文字列。
 */
function formatPlayerLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return '-';
  }
  const normalized = Math.floor(value);
  if (normalized === 1) {
    return 'SINGLE';
  }
  if (normalized === 2) {
    return 'COUPLE';
  }
  if (normalized === 3) {
    return 'DOUBLE';
  }
  if (normalized === 4) {
    return 'BATTLE';
  }
  return String(normalized);
}

/**
 * 表示用の RANK 値をラベルへ変換します。
 * @param value - 処理対象の値。
 * @returns 変換後または整形後の文字列。
 */
function formatRankLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return '-';
  }
  const normalized = Math.floor(value);
  if (normalized === 0) {
    return 'VERY HARD';
  }
  if (normalized === 1) {
    return 'HARD';
  }
  if (normalized === 2) {
    return 'NORMAL';
  }
  if (normalized === 3) {
    return 'EASY';
  }
  if (normalized === 4) {
    return 'VERY EASY';
  }
  return String(normalized);
}

/**
 * 表示用の PLAYLEVEL 値を星表記へ変換します。
 * @param value - 処理対象の値。
 * @returns 変換後または整形後の文字列。
 */
function formatPlayLevelLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return '-';
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return '-';
  }
  return '*'.repeat(Math.min(32, normalized));
}

/**
 * 表示用のトータルノート数を整形します。
 * @param value - 処理対象の値。
 * @returns 変換後または整形後の文字列。
 */
function formatTotalNotesLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-';
  }
  return String(Math.floor(value));
}

/**
 * 表示用の BPM 値を整形します。
 * @param min - 最低 BPM。
 * @param initial - 最初の BPM。
 * @param max - 最大 BPM。
 * @returns 変換後または整形後の文字列。
 */
function formatBpmLabel(min: number | undefined, initial: number | undefined, max: number | undefined): string {
  if (
    typeof min !== 'number' ||
    typeof initial !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(initial) ||
    !Number.isFinite(max) ||
    min <= 0 ||
    initial <= 0 ||
    max <= 0
  ) {
    return '-';
  }

  const values = [formatBpmValue(min), formatBpmValue(initial), formatBpmValue(max)];
  const collapsed = values.filter((value, index) => index === 0 || value !== values[index - 1]);
  if (collapsed.length <= 1) {
    return collapsed[0] ?? '-';
  }
  return collapsed.join('-');
}

/**
 * BPM の数値を表示向けに丸めて文字列化します。
 * @param value - 処理対象の BPM 値。
 * @returns 変換後または整形後の文字列。
 */
function formatBpmValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

/**
 * truncate For Display に対応する処理を実行します。
 * @param value - 処理対象の値。
 * @param width - width に対応する入力値。
 * @returns 変換後または整形後の文字列。
 */
function truncateForDisplay(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  if (width <= 1) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 1)}…`;
}

/**
 * 実行中モジュールが CLI エントリポイントかどうかを判定します。
 * @returns 条件を満たす場合は `true`、それ以外は `false`。
 */
function isCliEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return resolve(entry) === fileURLToPath(import.meta.url);
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
