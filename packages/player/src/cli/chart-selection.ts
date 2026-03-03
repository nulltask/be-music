import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
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

export type LoadingCancelReason = 'escape' | 'ctrl-c';

export interface BuildChartSelectionEntriesOptions {
  onLoadingFile?: (progress: ChartSummaryLoadingProgress) => void;
  getCancelReason?: () => LoadingCancelReason | undefined;
}

export class ChartSelectionLoadingCanceledError extends Error {
  readonly reason: LoadingCancelReason;

  constructor(reason: LoadingCancelReason) {
    super(`Chart loading canceled: ${reason}`);
    this.reason = reason;
  }
}

const SELECTABLE_CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms']);

export async function listChartFiles(rootDir: string): Promise<string[]> {
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

export async function buildChartSelectionEntries(
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
  let previewContinueKey: string | undefined;
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
    previewContinueKey = await resolvePreviewContinueKeyFromChart(resolvedChart, filePath);
  } catch {
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
