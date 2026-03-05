import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { invokeWorkerizedFunction, throwIfAborted, workerize } from '@be-music/utils';
import { type BeMusicJson } from '@be-music/json';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import { createTimingResolver } from '@be-music/audio-renderer';
import { extractPlayableNotes } from '../index.ts';
import { resolvePreviewContinueKeyFromChart } from './chart-preview.ts';

interface ChartSummaryItem {
  filePath: string;
  relativePath: string;
  directoryLabel: string;
  fileLabel: string;
  previewContinueKey?: string;
  totalNotes?: number;
  player?: number;
  rank?: number;
  playLevel?: number;
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
      previewContinueKey?: string;
      totalNotes?: number;
      player?: number;
      rank?: number;
      playLevel?: number;
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

const SELECTABLE_CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms']);
let buildChartSelectionEntriesWorker = createBuildChartSelectionEntriesWorker();

export async function listChartFiles(rootDir: string, options: ListChartFilesOptions = {}): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    throwIfAborted(options.signal);
    const current = queue.shift();
    if (!current) {
      continue;
    }

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
    () => [buildChartSelectionEntriesFromSummaries, compareOptionalNumber],
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
        previewContinueKey: chart.previewContinueKey,
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

async function buildChartSummary(rootDir: string, filePath: string, signal?: AbortSignal): Promise<ChartSummaryItem> {
  throwIfAborted(signal);
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
  let previewContinueKey: string | undefined;
  try {
    throwIfAborted(signal);
    const chart = await parseChartFile(filePath, { signal });
    throwIfAborted(signal);
    const resolvedChart = resolveBmsControlFlow(chart, { random: () => 0 });
    throwIfAborted(signal);
    totalNotes = extractPlayableNotes(resolvedChart).length;
    player = chart.bms.player;
    rank = chart.metadata.rank;
    playLevel = chart.metadata.playLevel;
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
    previewContinueKey,
    totalNotes,
    player,
    rank,
    playLevel,
    bpmInitial,
    bpmMin,
    bpmMax,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
