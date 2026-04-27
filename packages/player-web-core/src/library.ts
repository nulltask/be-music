import { unzipSync } from 'fflate';
import { normalizeChannel } from '@be-music/json';
import { parseBms, parseBmson } from '@be-music/parser';
import { extractPlayableNotes } from '../../player/src/playable-notes.ts';
import type {
  BrowserSongAssetSource,
  BrowserSongCollection,
  BrowserSongEntry,
  BrowserSongSourceKind,
} from './types.ts';

const CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);

export class BrowserSongLibrary {
  public collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };

  public async loadFromFiles(files: Iterable<File>): Promise<BrowserSongCollection> {
    this.collection = await loadSongCollectionFromFiles(files);
    return this.collection;
  }

  public async loadFromDrop(dataTransfer: DataTransfer): Promise<BrowserSongCollection> {
    this.collection = await loadSongCollectionFromDrop(dataTransfer);
    return this.collection;
  }
}

export async function loadSongCollectionFromDrop(dataTransfer: DataTransfer): Promise<BrowserSongCollection> {
  const files = await collectFilesFromDataTransfer(dataTransfer);
  return loadSongCollectionFromFiles(files);
}

export async function readDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  return collectFilesFromDataTransfer(dataTransfer);
}

async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const entry = items[index]?.webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      const collected: File[] = [];
      for (const entry of entries) {
        await collectFilesFromEntry(entry, '', collected);
      }
      return collected;
    }
  }
  return dataTransfer.files ? [...dataTransfer.files] : [];
}

async function collectFilesFromEntry(entry: FileSystemEntry, prefix: string, files: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    const relativePath = prefix ? `${prefix}${file.name}` : file.name;
    files.push(withRelativePath(file, relativePath));
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const nextPrefix = `${prefix}${entry.name}/`;
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (batch.length === 0) {
        return;
      }
      for (const child of batch) {
        await collectFilesFromEntry(child, nextPrefix, files);
      }
    }
  }
}

function withRelativePath(file: File, relativePath: string): File {
  if (file.webkitRelativePath === relativePath) {
    return file;
  }
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      enumerable: true,
      value: relativePath,
      writable: false,
    });
    return file;
  } catch {
    return new Proxy(file, {
      get(target, property) {
        if (property === 'webkitRelativePath') {
          return relativePath;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}

export async function loadSongCollectionFromFiles(files: Iterable<File>): Promise<BrowserSongCollection> {
  const sources: BrowserSongAssetSource[] = [];
  const looseFiles = new Map<string, Uint8Array>();
  const looseLabels = new Set<string>();

  for (const file of files) {
    const relativePath = normalizePath(file.webkitRelativePath || file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (extensionOf(file.name) === '.zip' && !file.webkitRelativePath) {
      sources.push(createZipSource(file.name, bytes));
      continue;
    }
    looseFiles.set(relativePath, bytes);
    looseLabels.add(firstPathSegment(relativePath) || file.name);
  }

  if (looseFiles.size > 0) {
    sources.push({
      id: `files:${sources.length}`,
      kind: inferSourceKind(looseFiles),
      label: looseLabels.size === 1 ? [...looseLabels][0]! : 'Dropped files',
      files: looseFiles,
    });
  }

  const songs: BrowserSongEntry[] = [];
  const errors: BrowserSongCollection['errors'] = [];
  for (const source of sources) {
    for (const path of [...source.files.keys()].sort((left, right) => left.localeCompare(right, 'ja'))) {
      if (!CHART_EXTENSIONS.has(extensionOf(path))) {
        continue;
      }
      try {
        const chart = parseChart(path, source.files.get(path)!);
        const notes = extractPlayableNotes(chart, { inferBmsLnTypeWhenMissing: true });
        songs.push({
          id: `${source.id}:${path}`,
          sourceId: source.id,
          sourceLabel: source.label,
          sourceKind: source.kind,
          chartPath: path,
          directoryLabel: dirname(path) || source.label,
          fileLabel: basename(path),
          title: chart.metadata.title || basenameWithoutExtension(path),
          subtitle: chart.metadata.subtitle,
          artist: chart.metadata.artist,
          genre: chart.metadata.genre,
          playLevel: chart.metadata.playLevel,
          bpm: chart.metadata.bpm,
          totalNotes: notes.filter((note) => isScoreTargetChannel(note.channel)).length,
          chart,
        });
      } catch (error) {
        errors.push({
          sourceId: source.id,
          path,
          message: error instanceof Error ? error.message : 'failed to parse chart',
        });
      }
    }
  }

  return { sources, songs, errors };
}

function createZipSource(name: string, bytes: Uint8Array): BrowserSongAssetSource {
  const entries = unzipSync(bytes);
  const files = new Map<string, Uint8Array>();
  for (const [path, entryBytes] of Object.entries(entries)) {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath || normalizedPath.endsWith('/')) {
      continue;
    }
    files.set(normalizedPath, entryBytes);
  }
  return {
    id: `zip:${name}`,
    kind: 'zip',
    label: name,
    files,
  };
}

function parseChart(path: string, bytes: Uint8Array) {
  if (extensionOf(path) === '.bmson') {
    return parseBmson(decodeUtf8(bytes));
  }
  return parseBms(decodeBms(bytes));
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/u, '');
}

function decodeBms(bytes: Uint8Array): string {
  try {
    return new TextDecoder('shift_jis').decode(bytes).replace(/^\ufeff/u, '');
  } catch {
    return decodeUtf8(bytes);
  }
}

function isScoreTargetChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  return normalized.startsWith('1') || normalized.startsWith('2');
}

function inferSourceKind(files: ReadonlyMap<string, Uint8Array>): BrowserSongSourceKind {
  return [...files.keys()].some((path) => path.includes('/')) ? 'directory' : 'files';
}

export function resolveSongSource(
  collection: BrowserSongCollection,
  song: BrowserSongEntry,
): BrowserSongAssetSource | undefined {
  return collection.sources.find((source) => source.id === song.sourceId);
}

export function normalizePath(path: string): string {
  const segments = path.replaceAll('\\', '/').split('/');
  const normalizedSegments: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      normalizedSegments.pop();
      continue;
    }
    normalizedSegments.push(segment);
  }
  return normalizedSegments.join('/');
}

export function dirname(path: string): string {
  const normalizedPath = normalizePath(path);
  const slashIndex = normalizedPath.lastIndexOf('/');
  return slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : '';
}

export function basename(path: string): string {
  const normalizedPath = normalizePath(path);
  const slashIndex = normalizedPath.lastIndexOf('/');
  return slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
}

function basenameWithoutExtension(path: string): string {
  const name = basename(path);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(0, dotIndex) : name;
}

function firstPathSegment(path: string): string {
  return normalizePath(path).split('/')[0] ?? '';
}

function extensionOf(path: string): string {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex >= 0 ? path.slice(dotIndex).toLowerCase() : '';
}
