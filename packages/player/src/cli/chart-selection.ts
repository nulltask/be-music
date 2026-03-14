import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { invokeWorkerizedFunction, isAbortError, throwIfAborted, workerize } from '@be-music/utils';
import { type BeMusicJson, type BeMusicPlayLevel } from '@be-music/json';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import { createTimingResolver } from '@be-music/audio-renderer';
import { extractPlayableNotes } from '../index.ts';
import {
  resolveDisplayedDifficultyValue,
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from '../utils.ts';
import { resolvePreviewContinueKeyFromChart } from './chart-preview.ts';

interface ChartSummaryItem {
  filePath: string;
  relativePath: string;
  directoryLabel: string;
  fileLabel: string;
  title?: string;
  subtitle?: string;
  artist?: string;
  subartist?: string;
  genre?: string;
  comment?: string;
  previewContinueKey?: string;
  totalNotes?: number;
  player?: number;
  difficulty?: number;
  rank?: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
  bpmInitial?: number;
  bpmMin?: number;
  bpmMax?: number;
}

type WorkerizedChartSelectionEntriesBuilder = ((
  summaries: ChartSummaryItem[],
  callback: (error: unknown, result: ChartSelectionEntry[]) => void,
) => void) & { close: () => void };

export type ChartSelectionEntry =
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
      title?: string;
      subtitle?: string;
      artist?: string;
      subartist?: string;
      genre?: string;
      comment?: string;
      previewContinueKey?: string;
      totalNotes?: number;
      player?: number;
      difficulty?: number;
      rank?: number;
      rankLabel?: string;
      playLevel?: BeMusicPlayLevel;
      bpmInitial?: number;
      bpmMin?: number;
      bpmMax?: number;
    };

export interface ChartSummaryLoadingProgress {
  filePath: string;
  currentIndex: number;
  totalCount: number;
}

export interface BuildChartSelectionEntriesOptions {
  onLoadingFile?: (progress: ChartSummaryLoadingProgress) => void;
  signal?: AbortSignal;
}

export interface ListChartFilesOptions {
  signal?: AbortSignal;
}

const SELECTABLE_CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);
let buildChartSelectionEntriesWorker = createBuildChartSelectionEntriesWorker();

export async function listChartFiles(rootDir: string, options: ListChartFilesOptions = {}): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [rootDir];

  for (let index = 0; index < queue.length; index += 1) {
    throwIfAborted(options.signal);
    const current = queue[index]!;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      throwIfAborted(options.signal);
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

export async function buildChartSelectionEntries(
  rootDir: string,
  files: string[],
  options: BuildChartSelectionEntriesOptions = {},
): Promise<ChartSelectionEntry[]> {
  throwIfAborted(options.signal);
  let summaries: ChartSummaryItem[];
  if (!options.onLoadingFile) {
    summaries = await Promise.all(files.map((filePath) => buildChartSummary(rootDir, filePath, options.signal)));
  } else {
    summaries = [];
    for (let index = 0; index < files.length; index += 1) {
      throwIfAborted(options.signal);
      const filePath = files[index];
      options.onLoadingFile?.({
        filePath,
        currentIndex: index + 1,
        totalCount: files.length,
      });
      summaries.push(await buildChartSummary(rootDir, filePath, options.signal));
    }
  }
  throwIfAborted(options.signal);
  return buildChartSelectionEntriesFromSummariesOffThread(summaries, options.signal);
}

async function buildChartSelectionEntriesFromSummariesOffThread(
  summaries: ChartSummaryItem[],
  signal?: AbortSignal,
): Promise<ChartSelectionEntry[]> {
  const activeWorker = buildChartSelectionEntriesWorker;
  try {
    const result = await invokeWorkerizedFunction(activeWorker, [summaries], {
      signal,
      onAbort: () => {
        if (buildChartSelectionEntriesWorker === activeWorker) {
          buildChartSelectionEntriesWorker.close();
          buildChartSelectionEntriesWorker = createBuildChartSelectionEntriesWorker();
        }
      },
    });
    if (!Array.isArray(result)) {
      return buildChartSelectionEntriesFromSummaries(summaries);
    }
    return result;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (buildChartSelectionEntriesWorker === activeWorker) {
      buildChartSelectionEntriesWorker.close();
      buildChartSelectionEntriesWorker = createBuildChartSelectionEntriesWorker();
    }
    return buildChartSelectionEntriesFromSummaries(summaries);
  }
}

function createBuildChartSelectionEntriesWorker(): WorkerizedChartSelectionEntriesBuilder {
  return workerize(
    (summaries: ChartSummaryItem[]) => buildChartSelectionEntriesFromSummaries(summaries),
    () => [buildChartSelectionEntriesFromSummaries, compareOptionalNumber, compareOptionalPlayLevel],
    true,
  ) as WorkerizedChartSelectionEntriesBuilder;
}

function buildChartSelectionEntriesFromSummaries(summariesInput: readonly ChartSummaryItem[]): ChartSelectionEntry[] {
  const summaries = [...summariesInput];
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
      const difficultyDiff = compareOptionalNumber(left.difficulty, right.difficulty);
      if (difficultyDiff !== 0) {
        return difficultyDiff;
      }
      const playLevelDiff = compareOptionalPlayLevel(left.playLevel, right.playLevel);
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
        title: chart.title,
        subtitle: chart.subtitle,
        artist: chart.artist,
        subartist: chart.subartist,
        genre: chart.genre,
        comment: chart.comment,
        previewContinueKey: chart.previewContinueKey,
        totalNotes: chart.totalNotes,
        player: chart.player,
        difficulty: chart.difficulty,
        rank: chart.rank,
        rankLabel: chart.rankLabel,
        playLevel: chart.playLevel,
        bpmInitial: chart.bpmInitial,
        bpmMin: chart.bpmMin,
        bpmMax: chart.bpmMax,
      });
    }
  }
  return entries;
}

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

function compareOptionalPlayLevel(left: BeMusicPlayLevel | undefined, right: BeMusicPlayLevel | undefined): number {
  const hasLeft = typeof left === 'number' ? Number.isFinite(left) : typeof left === 'string' && left.trim().length > 0;
  const hasRight =
    typeof right === 'number' ? Number.isFinite(right) : typeof right === 'string' && right.trim().length > 0;
  if (hasLeft && hasRight) {
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }
    if (typeof left === 'string' && typeof right === 'string') {
      return left.localeCompare(right, 'ja');
    }
    return typeof left === 'number' ? -1 : 1;
  }
  if (hasLeft) {
    return -1;
  }
  if (hasRight) {
    return 1;
  }
  return 0;
}

async function buildChartSummary(rootDir: string, filePath: string, signal?: AbortSignal): Promise<ChartSummaryItem> {
  throwIfAborted(signal);
  const relativePath = relative(rootDir, filePath).replaceAll('\\', '/');
  const slashIndex = relativePath.lastIndexOf('/');
  const directoryLabel = slashIndex >= 0 ? relativePath.slice(0, slashIndex) : '.';
  const fileLabel = slashIndex >= 0 ? relativePath.slice(slashIndex + 1) : relativePath;

  let player: number | undefined;
  let rank: number | undefined;
  let rankLabel: string | undefined;
  let playLevel: BeMusicPlayLevel | undefined;
  let totalNotes: number | undefined;
  let bpmInitial: number | undefined;
  let bpmMin: number | undefined;
  let bpmMax: number | undefined;
  let title: string | undefined;
  let subtitle: string | undefined;
  let artist: string | undefined;
  let subartist: string | undefined;
  let genre: string | undefined;
  let comment: string | undefined;
  let previewContinueKey: string | undefined;
  let difficulty: number | undefined;
  try {
    throwIfAborted(signal);
    const chart = await parseChartFile(filePath, { signal });
    throwIfAborted(signal);
    const resolvedChart = resolveBmsControlFlow(chart, { random: () => 0 });
    throwIfAborted(signal);
    title = sanitizeChartSelectionMetadataText(chart.metadata.title);
    subtitle = sanitizeChartSelectionMetadataText(chart.metadata.subtitle);
    artist = sanitizeChartSelectionMetadataText(chart.metadata.artist);
    subartist = resolveChartSelectionSubartist(chart);
    genre = sanitizeChartSelectionMetadataText(chart.metadata.genre);
    comment = sanitizeChartSelectionMetadataText(chart.metadata.comment);
    totalNotes = extractPlayableNotes(resolvedChart).length;
    player = chart.bms.player;
    difficulty = resolveDisplayedDifficultyValue(chart);
    rank = resolveDisplayedJudgeRankValue(resolvedChart);
    rankLabel = resolveDisplayedJudgeRankLabel(resolvedChart);
    playLevel = resolveDisplayedPlayLevelValue(chart);
    const bpmSummary = extractChartBpmSummary(resolvedChart);
    bpmInitial = bpmSummary?.initial;
    bpmMin = bpmSummary?.min;
    bpmMax = bpmSummary?.max;
    previewContinueKey = await resolvePreviewContinueKeyFromChart(resolvedChart, filePath, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    // 一覧表示のメタ情報取得失敗は再生可否と分離し、欠損扱いで続行する。
  }

  return {
    filePath,
    relativePath,
    directoryLabel,
    fileLabel,
    title,
    subtitle,
    artist,
    subartist,
    genre,
    comment,
    previewContinueKey,
    totalNotes,
    player,
    difficulty,
    rank,
    rankLabel,
    playLevel,
    bpmInitial,
    bpmMin,
    bpmMax,
  };
}

function sanitizeChartSelectionMetadataText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveChartSelectionSubartist(json: BeMusicJson): string | undefined {
  if (Array.isArray(json.bmson.info.subartists) && json.bmson.info.subartists.length > 0) {
    const subartists = json.bmson.info.subartists
      .map((value) => sanitizeChartSelectionMetadataText(value))
      .filter((value): value is string => value !== undefined);
    if (subartists.length > 0) {
      return subartists.join(', ');
    }
  }

  return sanitizeChartSelectionMetadataText(json.metadata.extras.SUBARTIST);
}

function extractChartBpmSummary(json: BeMusicJson): { initial: number; min: number; max: number } | undefined {
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
