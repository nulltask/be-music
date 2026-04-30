import { unzipSync } from 'fflate';
import { normalizeChannel } from '@be-music/json';
import { parseBms, parseBmson } from '@be-music/parser';
import { extractPlayableNotes } from '@be-music/player/playable-notes';
import { basename, dirname, normalizePath } from '@be-music/utils/core';
import type {
  BrowserFolderNode,
  BrowserSongAssetSource,
  BrowserSongCollection,
  BrowserSongEntry,
  BrowserSongSourceKind,
} from './types.ts';
import { isChartFilePath } from './drop.ts';

export { basename, dirname, normalizePath } from '@be-music/utils/core';

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
      if (!isChartFilePath(path)) {
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

export function describeSongCollection(collection: BrowserSongCollection): string {
  return `${collection.songs.length} charts loaded${
    collection.errors.length > 0 ? `, ${collection.errors.length} errors` : ''
  }`;
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

/**
 * Inspects a chart entry's playable note channels and reports which
 * `play_<variant>.lr2skin` should be loaded for it. Mapping:
 *
 *   - any `2X` channel → DP
 *     - any 6/7 key (18 / 19 / 28 / 29) → `'14'`
 *     - otherwise                       → `'10'`
 *   - SP only
 *     - any 6/7 key → `'7'`
 *     - otherwise   → `'5'`
 *
 * Pop'n (9K) detection isn't wired yet — those charts still resolve
 * to `'7'` which the LR2 default skin tolerates.
 */
export function resolveChartPlayVariant(song: BrowserSongEntry): '5' | '7' | '10' | '14' {
  const channels = new Set<string>();
  for (const event of song.chart.events) {
    const ch = normalizeChannel(event.channel);
    if (isScoreTargetChannel(ch)) {
      channels.add(ch);
    }
  }
  const usesPlayer2 = [...channels].some((ch) => ch.startsWith('2'));
  const uses6or7 = ['18', '19', '28', '29'].some((ch) => channels.has(ch));
  if (usesPlayer2) {
    return uses6or7 ? '14' : '10';
  }
  return uses6or7 ? '7' : '5';
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

/**
 * Resolves a chart-relative asset path (BMP, WAV, banner, …) to its
 * decoded byte array within a song asset source. Mirrors the BMS
 * convention of looking next to the chart file first, then falling
 * back to the source's root and the basename. Used by both gameplay
 * (BGA/audio) and select (banner / preview) loaders.
 */
export function resolveChartAsset(
  source: BrowserSongAssetSource,
  chartPath: string,
  assetPath: string,
): Uint8Array | undefined {
  const base = dirname(chartPath);
  const normalized = normalizePath(assetPath);
  const baseName = basename(normalized);
  const candidates = [
    normalizePath(`${base}/${normalized}`),
    normalized,
    normalizePath(`${base}/${baseName}`),
    baseName,
  ];
  return candidates.map((path) => source.files.get(path)).find(Boolean);
}

/**
 * Audio-asset variant of `resolveChartAsset` that walks codec
 * substitutions when the chart's declared file isn't present.
 *
 * BMS charts almost always declare `#WAVxx test.wav`, but real-world
 * archives ship the audio as `.opus` / `.ogg` / `.mp3` to save space.
 * Mirrors the `packages/player` audio loader's "try the alternative
 * codecs before giving up" behaviour, with the order tweaked for the
 * browser case:
 *
 *   1. `.opus` (highest compression-to-quality ratio)
 *   2. `.ogg` (broadly supported, small)
 *   3. `.mp3` (universal, slightly larger)
 *   4. `.wav` (always-correct fallback)
 *   5. the original path verbatim (covers `.flac` / `.oga` / etc.)
 *
 * Each step also tries the upper-case variant for case-sensitive
 * source maps (zip drops, `webkitRelativePath` directories on
 * non-Mac). Returns the first matching byte array, or undefined.
 */
export function resolveChartAudioAsset(
  source: BrowserSongAssetSource,
  chartPath: string,
  assetPath: string,
): Uint8Array | undefined {
  for (const candidate of audioFallbackPaths(assetPath)) {
    const bytes = resolveChartAsset(source, chartPath, candidate);
    if (bytes) {
      return bytes;
    }
  }
  return undefined;
}

function audioFallbackPaths(path: string): string[] {
  const lastSlash = path.lastIndexOf('/');
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex < lastSlash) {
    return [path];
  }
  const base = path.slice(0, dotIndex);
  const candidates = [
    `${base}.opus`,
    `${base}.OPUS`,
    `${base}.ogg`,
    `${base}.OGG`,
    `${base}.mp3`,
    `${base}.MP3`,
    `${base}.wav`,
    `${base}.WAV`,
  ];
  if (!candidates.includes(path)) {
    candidates.push(path);
  }
  return candidates;
}

/**
 * Groups a flat song list into top-level folders for the select-screen
 * bar list. The grouping key is the **first segment** of each song's
 * `directoryLabel` (relative to its source) — so a song at
 * `LunaticCrave/SongA/song.bms` lands in the `LunaticCrave` folder.
 * Songs without a directory (e.g. dropped a single file) fall back to
 * their source label so they still appear under a sensible group.
 *
 * The result is sorted by label using Japanese-aware locale ordering,
 * matching how LR2 sorts folders alphabetically. Each folder's songs
 * preserve their original order, which keeps the chart-difficulty
 * sequence stable when iterating inside a folder.
 */
export function groupSongsByFolder(songs: readonly BrowserSongEntry[]): BrowserFolderNode[] {
  const buckets = new Map<string, BrowserSongEntry[]>();
  for (const song of songs) {
    const label = topLevelFolderLabel(song);
    const bucket = buckets.get(label) ?? [];
    bucket.push(song);
    buckets.set(label, bucket);
  }
  return [...buckets.entries()]
    .map(([label, entries]): BrowserFolderNode => ({ label, songs: entries }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ja'));
}

function topLevelFolderLabel(song: BrowserSongEntry): string {
  const dir = song.directoryLabel;
  if (!dir) {
    return song.sourceLabel;
  }
  const slash = dir.indexOf('/');
  return slash >= 0 ? dir.slice(0, slash) : dir;
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
