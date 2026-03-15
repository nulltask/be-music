import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { availableParallelism, homedir } from 'node:os';
import { dirname, extname, relative, resolve } from 'node:path';
import { invokeWorkerizedFunction, isAbortError, throwIfAborted, workerize } from '@be-music/utils';
import { type BeMusicJson, type BeMusicPlayLevel } from '@be-music/json';
import { decodeBmsText, parseChart, resolveBmsControlFlow } from '@be-music/parser';
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
  bannerPath?: string;
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

type PersistedChartSummaryItem = Omit<ChartSummaryItem, 'filePath' | 'relativePath' | 'directoryLabel' | 'fileLabel'>;

interface PersistedChartSelectionCacheFileEntry {
  contentHash: string;
  cacheHash: string;
  summary: PersistedChartSummaryItem;
}

interface PersistedChartSelectionCacheDirectoryEntry {
  files: Record<string, PersistedChartSelectionCacheFileEntry>;
}

interface PersistedChartSelectionCache {
  format: typeof CHART_SELECTION_CACHE_FORMAT;
  directories: Record<string, PersistedChartSelectionCacheDirectoryEntry>;
}

interface ResolvedChartSummaryCacheEntry {
  summary: ChartSummaryItem;
  cacheEntry?: PersistedChartSelectionCacheFileEntry;
  cacheHit: boolean;
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
      bannerPath?: string;
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
const CHART_SELECTION_CACHE_FORMAT = 'be-music-player-chart-selection-cache/4';
const CHART_SELECTION_BUILD_CONCURRENCY = Math.max(1, Math.min(8, availableParallelism()));
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
  const cache = await loadPersistedChartSelectionCache();
  const cachedEntries = cache.directories[rootDir]?.files ?? {};
  const nextCachedEntries: Record<string, PersistedChartSelectionCacheFileEntry> = {};
  let cacheDirty = cache.directories[rootDir] === undefined || Object.keys(cachedEntries).length !== files.length;
  let completedFileCount = 0;
  const resolvedEntries = await mapWithConcurrency(
    files,
    Math.min(files.length || 1, CHART_SELECTION_BUILD_CONCURRENCY),
    async (filePath) => {
      throwIfAborted(options.signal);
      const relativePath = resolveChartSummaryRelativePath(rootDir, filePath);
      const resolvedEntry = await buildChartSummaryWithCache(
        rootDir,
        filePath,
        relativePath,
        cachedEntries[relativePath],
        options.signal,
      );
      completedFileCount += 1;
      options.onLoadingFile?.({
        filePath,
        currentIndex: completedFileCount,
        totalCount: files.length,
      });
      return resolvedEntry;
    },
    options.signal,
  );
  const summaries = resolvedEntries.map((entry) => entry.summary);
  for (let index = 0; index < files.length; index += 1) {
    const filePath = files[index]!;
    const relativePath = resolveChartSummaryRelativePath(rootDir, filePath);
    const resolvedEntry = resolvedEntries[index]!;
    if (!resolvedEntry.cacheHit) {
      cacheDirty = true;
    }
    if (resolvedEntry.cacheEntry) {
      nextCachedEntries[relativePath] = resolvedEntry.cacheEntry;
    }
  }
  if (cacheDirty) {
    cache.directories[rootDir] = { files: nextCachedEntries };
    await savePersistedChartSelectionCache(cache);
  }
  throwIfAborted(options.signal);
  return buildChartSelectionEntriesFromSummariesOffThread(summaries, options.signal);
}

async function buildChartSummaryWithCache(
  rootDir: string,
  filePath: string,
  relativePath: string,
  cachedEntry: PersistedChartSelectionCacheFileEntry | undefined,
  signal?: AbortSignal,
): Promise<ResolvedChartSummaryCacheEntry> {
  throwIfAborted(signal);
  const pathFields = createChartSummaryPathFields(rootDir, filePath, relativePath);

  let sourceBuffer: Buffer | undefined;
  try {
    sourceBuffer = await readFile(filePath, { signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
  }

  const contentHash = sourceBuffer ? buildChartSelectionContentHash(sourceBuffer) : undefined;
  if (
    cachedEntry &&
    typeof contentHash === 'string' &&
    cachedEntry.contentHash === contentHash &&
    isPersistedChartSelectionCacheFileEntryValid(cachedEntry)
  ) {
    return {
      summary: restoreChartSummary(pathFields, cachedEntry.summary),
      cacheEntry: cachedEntry,
      cacheHit: true,
    };
  }

  const summary = await buildChartSummary(rootDir, filePath, signal, sourceBuffer);
  return {
    summary,
    cacheEntry:
      typeof contentHash === 'string'
        ? createPersistedChartSelectionCacheFileEntry(persistChartSummary(summary), contentHash)
        : undefined,
    cacheHit: false,
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
  signal?: AbortSignal,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        throwIfAborted(signal);
        const currentIndex = nextIndex;
        if (currentIndex >= items.length) {
          return;
        }
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
      }
    }),
  );
  return results;
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
        bannerPath: chart.bannerPath,
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

async function buildChartSummary(
  rootDir: string,
  filePath: string,
  signal?: AbortSignal,
  sourceBuffer?: Buffer,
): Promise<ChartSummaryItem> {
  throwIfAborted(signal);
  const pathFields = createChartSummaryPathFields(rootDir, filePath);

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
  let bannerPath: string | undefined;
  let previewContinueKey: string | undefined;
  let difficulty: number | undefined;
  try {
    throwIfAborted(signal);
    const chart = sourceBuffer ? parseChartSelectionSourceBuffer(filePath, sourceBuffer) : await parseChartFileWithCacheMiss(filePath, signal);
    throwIfAborted(signal);
    const resolvedChart = resolveBmsControlFlow(chart, { random: () => 0 });
    throwIfAborted(signal);
    title = sanitizeChartSelectionMetadataText(chart.metadata.title);
    subtitle = sanitizeChartSelectionMetadataText(chart.metadata.subtitle);
    artist = sanitizeChartSelectionMetadataText(chart.metadata.artist);
    subartist = resolveChartSelectionSubartist(chart);
    genre = sanitizeChartSelectionMetadataText(chart.metadata.genre);
    comment = sanitizeChartSelectionMetadataText(chart.metadata.comment);
    bannerPath = resolveChartSelectionBannerPath(chart);
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
    ...pathFields,
    title,
    subtitle,
    artist,
    subartist,
    genre,
    comment,
    bannerPath,
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

async function parseChartFileWithCacheMiss(filePath: string, signal?: AbortSignal): Promise<BeMusicJson> {
  const sourceBuffer = await readFile(filePath, { signal });
  return parseChartSelectionSourceBuffer(filePath, sourceBuffer);
}

function parseChartSelectionSourceBuffer(filePath: string, sourceBuffer: Buffer): BeMusicJson {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.bmson') {
    return parseChart(decodeUtf8Buffer(sourceBuffer), 'bmson');
  }
  if (extension === '.json') {
    return parseChart(decodeUtf8Buffer(sourceBuffer), 'json');
  }
  return parseChart(decodeBmsText(sourceBuffer).text);
}

function decodeUtf8Buffer(buffer: Buffer): string {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

function buildChartSelectionContentHash(sourceBuffer: Buffer): string {
  return createHash('sha256').update(sourceBuffer).digest('hex');
}

function buildChartSelectionCacheHash(entry: {
  contentHash: string;
  summary: PersistedChartSummaryItem;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        entry.contentHash,
        entry.summary.title ?? null,
        entry.summary.subtitle ?? null,
        entry.summary.artist ?? null,
        entry.summary.subartist ?? null,
        entry.summary.genre ?? null,
        entry.summary.comment ?? null,
        entry.summary.bannerPath ?? null,
        entry.summary.previewContinueKey ?? null,
        entry.summary.totalNotes ?? null,
        entry.summary.player ?? null,
        entry.summary.difficulty ?? null,
        entry.summary.rank ?? null,
        entry.summary.rankLabel ?? null,
        entry.summary.playLevel ?? null,
        entry.summary.bpmInitial ?? null,
        entry.summary.bpmMin ?? null,
        entry.summary.bpmMax ?? null,
      ]),
    )
    .digest('hex');
}

function createChartSummaryPathFields(
  rootDir: string,
  filePath: string,
  relativePath = resolveChartSummaryRelativePath(rootDir, filePath),
): Pick<ChartSummaryItem, 'filePath' | 'relativePath' | 'directoryLabel' | 'fileLabel'> {
  const slashIndex = relativePath.lastIndexOf('/');
  return {
    filePath,
    relativePath,
    directoryLabel: slashIndex >= 0 ? relativePath.slice(0, slashIndex) : '.',
    fileLabel: slashIndex >= 0 ? relativePath.slice(slashIndex + 1) : relativePath,
  };
}

function resolveChartSummaryRelativePath(rootDir: string, filePath: string): string {
  return relative(rootDir, filePath).replaceAll('\\', '/');
}

function persistChartSummary(summary: ChartSummaryItem): PersistedChartSummaryItem {
  const { filePath: _filePath, relativePath: _relativePath, directoryLabel: _directoryLabel, fileLabel: _fileLabel, ...persisted } = summary;
  return persisted;
}

function createPersistedChartSelectionCacheFileEntry(
  summary: PersistedChartSummaryItem,
  contentHash: string,
): PersistedChartSelectionCacheFileEntry {
  return {
    contentHash,
    cacheHash: buildChartSelectionCacheHash({ contentHash, summary }),
    summary,
  };
}

function isPersistedChartSelectionCacheFileEntryValid(entry: PersistedChartSelectionCacheFileEntry): boolean {
  return entry.cacheHash === buildChartSelectionCacheHash({
    contentHash: entry.contentHash,
    summary: entry.summary,
  });
}

function restoreChartSummary(
  pathFields: Pick<ChartSummaryItem, 'filePath' | 'relativePath' | 'directoryLabel' | 'fileLabel'>,
  summary: PersistedChartSummaryItem,
): ChartSummaryItem {
  return {
    ...pathFields,
    ...summary,
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

function resolveChartSelectionBannerPath(json: BeMusicJson): string | undefined {
  const bmsonBanner = sanitizeChartSelectionMetadataText(json.bmson.info.bannerImage);
  if (bmsonBanner) {
    return bmsonBanner;
  }
  return sanitizeChartSelectionMetadataText(json.metadata.extras.BANNER);
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

function resolveChartSelectionCachePath(): string {
  return resolve(homedir(), '.be-music', 'chart-selection-cache.json');
}

function createDefaultPersistedChartSelectionCache(): PersistedChartSelectionCache {
  return {
    format: CHART_SELECTION_CACHE_FORMAT,
    directories: {},
  };
}

function parsePersistedChartSelectionCache(value: unknown): PersistedChartSelectionCache {
  if (typeof value !== 'object' || value === null) {
    return createDefaultPersistedChartSelectionCache();
  }
  const objectValue = value as {
    format?: unknown;
    directories?: unknown;
  };
  if (objectValue.format !== CHART_SELECTION_CACHE_FORMAT) {
    return createDefaultPersistedChartSelectionCache();
  }
  if (typeof objectValue.directories !== 'object' || objectValue.directories === null) {
    return createDefaultPersistedChartSelectionCache();
  }

  const directories: PersistedChartSelectionCache['directories'] = {};
  for (const [directoryPath, rawDirectoryEntry] of Object.entries(objectValue.directories as Record<string, unknown>)) {
    if (typeof rawDirectoryEntry !== 'object' || rawDirectoryEntry === null) {
      continue;
    }
    const filesValue = (rawDirectoryEntry as { files?: unknown }).files;
    if (typeof filesValue !== 'object' || filesValue === null) {
      continue;
    }
    const files: PersistedChartSelectionCacheDirectoryEntry['files'] = {};
    for (const [filePath, rawFileEntry] of Object.entries(filesValue as Record<string, unknown>)) {
      if (typeof rawFileEntry !== 'object' || rawFileEntry === null) {
        continue;
      }
      const fileEntry = rawFileEntry as {
        contentHash?: unknown;
        cacheHash?: unknown;
        summary?: unknown;
      };
      if (typeof fileEntry.contentHash !== 'string' || fileEntry.contentHash.length === 0) {
        continue;
      }
      if (typeof fileEntry.cacheHash !== 'string' || fileEntry.cacheHash.length === 0) {
        continue;
      }
      if (typeof fileEntry.summary !== 'object' || fileEntry.summary === null) {
        continue;
      }
      const summary = parsePersistedChartSummary(fileEntry.summary);
      if (!summary) {
        continue;
      }
      const parsedEntry: PersistedChartSelectionCacheFileEntry = {
        contentHash: fileEntry.contentHash,
        cacheHash: fileEntry.cacheHash,
        summary,
      };
      if (!isPersistedChartSelectionCacheFileEntryValid(parsedEntry)) {
        continue;
      }
      files[filePath] = parsedEntry;
    }
    if (Object.keys(files).length > 0) {
      directories[directoryPath] = { files };
    }
  }
  return {
    format: CHART_SELECTION_CACHE_FORMAT,
    directories,
  };
}

async function loadPersistedChartSelectionCache(): Promise<PersistedChartSelectionCache> {
  const cachePath = resolveChartSelectionCachePath();
  let content: string;
  try {
    content = await readFile(cachePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return createDefaultPersistedChartSelectionCache();
    }
    return createDefaultPersistedChartSelectionCache();
  }

  try {
    return parsePersistedChartSelectionCache(JSON.parse(content));
  } catch {
    return createDefaultPersistedChartSelectionCache();
  }
}

function parsePersistedChartSummary(value: unknown): PersistedChartSummaryItem | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const objectValue = value as Record<string, unknown>;
  const summary: PersistedChartSummaryItem = {};

  assignOptionalString(summary, 'title', objectValue.title);
  assignOptionalString(summary, 'subtitle', objectValue.subtitle);
  assignOptionalString(summary, 'artist', objectValue.artist);
  assignOptionalString(summary, 'subartist', objectValue.subartist);
  assignOptionalString(summary, 'genre', objectValue.genre);
  assignOptionalString(summary, 'comment', objectValue.comment);
  assignOptionalString(summary, 'bannerPath', objectValue.bannerPath);
  assignOptionalString(summary, 'previewContinueKey', objectValue.previewContinueKey);
  assignOptionalNumber(summary, 'totalNotes', objectValue.totalNotes);
  assignOptionalNumber(summary, 'player', objectValue.player);
  assignOptionalNumber(summary, 'difficulty', objectValue.difficulty);
  assignOptionalNumber(summary, 'rank', objectValue.rank);
  assignOptionalString(summary, 'rankLabel', objectValue.rankLabel);
  if (typeof objectValue.playLevel === 'number' && Number.isFinite(objectValue.playLevel)) {
    summary.playLevel = objectValue.playLevel;
  } else if (typeof objectValue.playLevel === 'string') {
    summary.playLevel = objectValue.playLevel;
  }
  assignOptionalNumber(summary, 'bpmInitial', objectValue.bpmInitial);
  assignOptionalNumber(summary, 'bpmMin', objectValue.bpmMin);
  assignOptionalNumber(summary, 'bpmMax', objectValue.bpmMax);

  return summary;
}

function assignOptionalString<TKey extends keyof PersistedChartSummaryItem>(
  target: PersistedChartSummaryItem,
  key: TKey,
  value: unknown,
): void {
  if (typeof value === 'string') {
    target[key] = value as PersistedChartSummaryItem[TKey];
  }
}

function assignOptionalNumber<TKey extends keyof PersistedChartSummaryItem>(
  target: PersistedChartSummaryItem,
  key: TKey,
  value: unknown,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = value as PersistedChartSummaryItem[TKey];
  }
}

async function savePersistedChartSelectionCache(cache: PersistedChartSelectionCache): Promise<void> {
  const cachePath = resolveChartSelectionCachePath();
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch {
    // Chart list caching is a performance optimization only.
  }
}
