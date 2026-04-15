import { unzipSync } from 'fflate';
import { type BeMusicJson, type BeMusicPlayLevel } from '@be-music/json';
import { decodeBmsText, parseChart, resolveBmsControlFlow } from '@be-music/parser/browser';
import {
  resolveDisplayedDifficultyValue,
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from '../../player/src/utils.ts';
import { resolveBrowserPreviewContinueKey } from './browser-preview-identity.ts';
import type {
  BrowserSongAssetSource,
  BrowserSongCollection,
  BrowserSongCollectionError,
  BrowserSongEntry,
  BrowserSongSourceKind,
} from './types.ts';
import { createTimingResolver } from './timing.ts';
import { extractWebTimedNotes } from './web-playable-notes.ts';

type DropDirectoryEntry = {
  isDirectory: true;
  isFile: false;
  name: string;
  createReader: () => {
    readEntries: (successCallback: (entries: DropFileSystemEntry[]) => void, errorCallback?: (error: DOMException) => void) => void;
  };
};

type DropFileEntry = {
  isDirectory: false;
  isFile: true;
  name: string;
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
};

type DropFileSystemEntry = DropDirectoryEntry | DropFileEntry;

type WebkitDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => DropFileSystemEntry | null;
};

type BrowserSongSourceInput = {
  id: string;
  kind: BrowserSongSourceKind;
  label: string;
  files: Map<string, Uint8Array>;
};

const CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson', '.json']);

export async function loadSongCollectionFromDrop(dataTransfer: DataTransfer): Promise<BrowserSongCollection> {
  const sources: BrowserSongSourceInput[] = [];
  if (dataTransfer.items.length > 0) {
    const looseFiles = new Map<string, Uint8Array>();
    for (let index = 0; index < dataTransfer.items.length; index += 1) {
      const item = dataTransfer.items[index] as WebkitDataTransferItem;
      if (item.kind !== 'file') {
        continue;
      }
      const entry = item.webkitGetAsEntry?.();
      if (isDropDirectoryEntry(entry)) {
        const files = await readDirectoryEntry(entry);
        sources.push({
          id: createSourceId('directory', entry.name, sources.length),
          kind: 'directory',
          label: entry.name,
          files,
        });
        continue;
      }
      const file = item.getAsFile();
      if (!file) {
        continue;
      }
      if (hasZipExtension(file.name)) {
        sources.push(await loadZipSource(file, sources.length));
        continue;
      }
      looseFiles.set(normalizePath(file.webkitRelativePath || file.name), new Uint8Array(await file.arrayBuffer()));
    }
    if (looseFiles.size > 0) {
      sources.push({
        id: createSourceId('files', 'Dropped files', sources.length),
        kind: 'files',
        label: 'Dropped files',
        files: looseFiles,
      });
    }
  } else if (dataTransfer.files.length > 0) {
    return loadSongCollectionFromFiles(dataTransfer.files);
  }
  return buildSongCollectionFromSources(sources);
}

export async function loadSongCollectionFromFiles(files: Iterable<File>): Promise<BrowserSongCollection> {
  const sources = new Map<string, BrowserSongSourceInput>();
  for (const file of files) {
    const relativePath = normalizePath(file.webkitRelativePath || file.name);
    if (hasZipExtension(file.name) && relativePath === normalizePath(file.name)) {
      const zipSource = await loadZipSource(file, sources.size);
      sources.set(zipSource.id, zipSource);
      continue;
    }
    const rootLabel = resolveRootLabel(relativePath);
    const sourceId = createSourceId(relativePath.includes('/') ? 'directory' : 'files', rootLabel, sources.size);
    const source =
      sources.get(sourceId) ??
      {
        id: sourceId,
        kind: relativePath.includes('/') ? 'directory' : 'files',
        label: rootLabel,
        files: new Map<string, Uint8Array>(),
      };
    source.files.set(stripRootPrefix(relativePath), new Uint8Array(await file.arrayBuffer()));
    sources.set(sourceId, source);
  }
  return buildSongCollectionFromSources([...sources.values()]);
}

async function buildSongCollectionFromSources(sourcesInput: BrowserSongSourceInput[]): Promise<BrowserSongCollection> {
  const sources: BrowserSongAssetSource[] = [];
  const songs: BrowserSongEntry[] = [];
  const errors: BrowserSongCollectionError[] = [];

  for (const sourceInput of sourcesInput) {
    const files = new Map<string, Uint8Array>();
    for (const [path, bytes] of sourceInput.files) {
      files.set(normalizePath(path), bytes);
    }

    const source: BrowserSongAssetSource = {
      id: sourceInput.id,
      kind: sourceInput.kind,
      label: sourceInput.label,
      files,
    };
    sources.push(source);

    const chartPaths = [...files.keys()].filter((path) => CHART_EXTENSIONS.has(extensionOf(path)));
    chartPaths.sort((left, right) => left.localeCompare(right, 'ja'));

    for (const chartPath of chartPaths) {
      try {
        const bytes = files.get(chartPath)!;
        const chart = parseChartBytes(chartPath, bytes);
        songs.push(createSongEntry(source, chartPath, chart));
      } catch (error) {
        errors.push({
          sourceId: source.id,
          path: chartPath,
          message: error instanceof Error ? error.message : 'Failed to parse chart.',
        });
      }
    }
  }

  songs.sort(compareSongEntries);

  return {
    sources,
    songs,
    errors,
  };
}

function parseChartBytes(path: string, bytes: Uint8Array): BeMusicJson {
  const extension = extensionOf(path);
  if (extension === '.bmson') {
    return parseChart(decodeUtf8(bytes), 'bmson');
  }
  if (extension === '.json') {
    return parseChart(decodeUtf8(bytes), 'json');
  }
  return parseChart(decodeBmsText(bytes).text);
}

function createSongEntry(source: BrowserSongAssetSource, chartPath: string, chart: BeMusicJson): BrowserSongEntry {
  const summaryChart = resolveChartForSongSummary(chart);
  const bpmSummary = extractChartBpmSummary(summaryChart);
  const normalizedPath = normalizePath(chartPath);
  const slashIndex = normalizedPath.lastIndexOf('/');
  const fileLabel = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const directoryLabel = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : '.';
  return {
    id: `${source.id}:${normalizedPath}`,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceKind: source.kind,
    chartPath: normalizedPath,
    directoryLabel,
    fileLabel,
    title: resolveTitle(chart, fileLabel),
    subtitle: sanitizeText(chart.metadata.subtitle),
    artist: sanitizeText(chart.metadata.artist),
    subartist: resolveSubartist(chart),
    genre: sanitizeText(chart.metadata.genre),
    comment: sanitizeText(chart.metadata.comment),
    bannerPath: resolveBannerPath(chart),
    previewContinueKey: resolveBrowserPreviewContinueKey(summaryChart, source, normalizedPath),
    totalNotes: extractWebTimedNotes(summaryChart).playableNotes.length,
    player: Number.isFinite(chart.bms.player) ? chart.bms.player : undefined,
    difficulty: resolveDisplayedDifficultyValue(chart),
    rank: resolveDisplayedJudgeRankValue(summaryChart),
    rankLabel: resolveDisplayedJudgeRankLabel(summaryChart),
    playLevel: resolveDisplayedPlayLevelValue(chart),
    bpm: bpmSummary?.initial ?? (Number.isFinite(chart.metadata.bpm) && chart.metadata.bpm > 0 ? chart.metadata.bpm : undefined),
    bpmInitial: bpmSummary?.initial,
    bpmMin: bpmSummary?.min,
    bpmMax: bpmSummary?.max,
    chart,
  };
}

function resolveTitle(chart: BeMusicJson, fallbackFileLabel: string): string {
  return sanitizeText(chart.metadata.title) ?? fallbackFileLabel.replace(/\.[^.]+$/, '');
}

function resolveSubartist(chart: BeMusicJson): string | undefined {
  if (Array.isArray(chart.bmson.info.subartists) && chart.bmson.info.subartists.length > 0) {
    const values = chart.bmson.info.subartists
      .map((value) => sanitizeText(value))
      .filter((value): value is string => value !== undefined);
    if (values.length > 0) {
      return values.join(', ');
    }
  }
  return sanitizeText(chart.metadata.extras.SUBARTIST);
}

function resolveBannerPath(chart: BeMusicJson): string | undefined {
  const bmsonBanner = sanitizeText(chart.bmson.info.bannerImage);
  if (bmsonBanner) {
    return bmsonBanner;
  }
  return sanitizeText(chart.metadata.extras.BANNER);
}

function resolveChartForSongSummary(chart: BeMusicJson): BeMusicJson {
  if (chart.sourceFormat !== 'bms' || chart.bms.controlFlow.length === 0) {
    return chart;
  }
  return resolveBmsControlFlow(chart, {
    random: () => 0,
  });
}

function extractChartBpmSummary(chart: BeMusicJson): { initial: number; min: number; max: number } | undefined {
  const resolver = createTimingResolver(chart);
  const bpmValues = resolver.tempoPoints
    .map((point) => point.bpm)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (bpmValues.length === 0) {
    return undefined;
  }

  let min = bpmValues[0]!;
  let max = bpmValues[0]!;
  for (const bpm of bpmValues) {
    if (bpm < min) {
      min = bpm;
    }
    if (bpm > max) {
      max = bpm;
    }
  }

  return {
    initial: bpmValues[0]!,
    min,
    max,
  };
}

function sanitizeText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.replaceAll(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
}

function compareSongEntries(left: BrowserSongEntry, right: BrowserSongEntry): number {
  const sourceDiff = left.sourceLabel.localeCompare(right.sourceLabel, 'ja');
  if (sourceDiff !== 0) {
    return sourceDiff;
  }
  const directoryDiff = left.directoryLabel.localeCompare(right.directoryLabel, 'ja');
  if (directoryDiff !== 0) {
    return directoryDiff;
  }
  const titleDiff = left.title.localeCompare(right.title, 'ja');
  if (titleDiff !== 0) {
    return titleDiff;
  }
  return left.fileLabel.localeCompare(right.fileLabel, 'ja');
}

async function loadZipSource(file: File, index: number): Promise<BrowserSongSourceInput> {
  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  const zipped = unzipSync(archiveBytes);
  const files = new Map<string, Uint8Array>();
  for (const [rawPath, bytes] of Object.entries(zipped)) {
    const normalized = normalizePath(rawPath);
    if (normalized.endsWith('/')) {
      continue;
    }
    files.set(normalized, bytes);
  }
  return {
    id: createSourceId('zip', file.name, index),
    kind: 'zip',
    label: file.name,
    files,
  };
}

async function readDirectoryEntry(entry: DropDirectoryEntry, prefix = ''): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const reader = entry.createReader();
  while (true) {
    const entries = await readDirectoryReaderEntries(reader);
    if (entries.length === 0) {
      break;
    }
    for (const child of entries) {
      if (child.isDirectory) {
        const nestedFiles = await readDirectoryEntry(child, `${prefix}${child.name}/`);
        for (const [path, bytes] of nestedFiles) {
          files.set(path, bytes);
        }
        continue;
      }
      const file = await readDropFileEntry(child);
      files.set(`${prefix}${file.name}`, new Uint8Array(await file.arrayBuffer()));
    }
  }
  return files;
}

function readDirectoryReaderEntries(reader: DropDirectoryEntry['createReader'] extends () => infer T ? T : never): Promise<DropFileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

function readDropFileEntry(entry: DropFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function decodeUtf8(bytes: Uint8Array): string {
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

function extensionOf(path: string): string {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex >= 0 ? path.slice(dotIndex).toLowerCase() : '';
}

function hasZipExtension(name: string): boolean {
  return extensionOf(name) === '.zip';
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function resolveRootLabel(relativePath: string): string {
  const normalized = normalizePath(relativePath);
  const slashIndex = normalized.indexOf('/');
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : 'Dropped files';
}

function stripRootPrefix(relativePath: string): string {
  const normalized = normalizePath(relativePath);
  const slashIndex = normalized.indexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function createSourceId(kind: BrowserSongSourceKind, label: string, index: number): string {
  return `${kind}:${index}:${label}`;
}

function isDropDirectoryEntry(entry: FileSystemEntry | DropFileSystemEntry | null | undefined): entry is DropDirectoryEntry {
  return Boolean(entry && entry.isDirectory && 'createReader' in entry);
}
