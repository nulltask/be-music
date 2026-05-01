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
  LoadProgressCallback,
} from './types.ts';
import { isChartFilePath } from './drop.ts';
import { lookupBytesCaseInsensitive } from './file-lookup.ts';

export { basename, dirname, normalizePath } from '@be-music/utils/core';

/**
 * Optional progress hook for the dropped-folder loaders. When
 * supplied, the loader fires the callback as it walks through the
 * `enumerating` / `reading` / `parsing` phases. UIs can use this
 * to render a determinate progress bar so a multi-thousand-file
 * drop doesn't look like a frozen page.
 */
export interface LoadProgressOptions {
  onProgress?: LoadProgressCallback;
}

export class BrowserSongLibrary {
  public collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };

  public async loadFromFiles(files: Iterable<File>, options: LoadProgressOptions = {}): Promise<BrowserSongCollection> {
    this.collection = await loadSongCollectionFromFiles(files, options);
    return this.collection;
  }

  public async loadFromDrop(
    dataTransfer: DataTransfer,
    options: LoadProgressOptions = {},
  ): Promise<BrowserSongCollection> {
    this.collection = await loadSongCollectionFromDrop(dataTransfer, options);
    return this.collection;
  }
}

export async function loadSongCollectionFromDrop(
  dataTransfer: DataTransfer,
  options: LoadProgressOptions = {},
): Promise<BrowserSongCollection> {
  const files = await collectFilesFromDataTransfer(dataTransfer, options.onProgress);
  return loadSongCollectionFromFiles(files, options);
}

export async function readDroppedFiles(dataTransfer: DataTransfer, options: LoadProgressOptions = {}): Promise<File[]> {
  return collectFilesFromDataTransfer(dataTransfer, options.onProgress);
}

async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer,
  onProgress?: LoadProgressCallback,
): Promise<File[]> {
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
      // Total is unknown while we're still walking the FileSystem
      // tree (the FileSystemEntry API doesn't expose a directory's
      // file count up-front), so we report `total: -1` and let the
      // host UI show an indeterminate "Collecting…" indicator.
      onProgress?.({ phase: 'enumerating', current: 0, total: -1 });
      for (const entry of entries) {
        await collectFilesFromEntry(entry, '', collected, onProgress);
      }
      onProgress?.({ phase: 'enumerating', current: collected.length, total: collected.length });
      return collected;
    }
  }
  const fallback = dataTransfer.files ? [...dataTransfer.files] : [];
  if (fallback.length > 0) {
    onProgress?.({ phase: 'enumerating', current: fallback.length, total: fallback.length });
  }
  return fallback;
}

async function collectFilesFromEntry(
  entry: FileSystemEntry,
  prefix: string,
  files: File[],
  onProgress?: LoadProgressCallback,
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    const relativePath = prefix ? `${prefix}${file.name}` : file.name;
    files.push(withRelativePath(file, relativePath));
    // Throttle the per-file progress emit: a 4000-file walk
    // doesn't need 4000 React-style updates. Keep one in every
    // 32 entries plus the very first, which is enough for a
    // visibly-moving counter without thrashing the host UI.
    if (onProgress && (files.length & 0x1f) === 1) {
      onProgress({ phase: 'enumerating', current: files.length, total: -1, label: relativePath });
    }
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
      // Walk all children of this batch in parallel — the
      // FileSystemEntry API is async so each `entry.file()` /
      // sub-directory `readEntries` call would otherwise stall
      // the next one. With a deep song-pack tree (one folder
      // per chart × thousands of charts) the serial walk took
      // tens of seconds for a real-world drop; parallel walk
      // pushes the whole walk into the I/O concurrency limit
      // the browser sets internally.
      await Promise.all(batch.map((child) => collectFilesFromEntry(child, nextPrefix, files, onProgress)));
    }
  }
}

/**
 * Default concurrency cap for parallel file reads. Tuned high
 * enough that 4000 small files saturate disk I/O without the
 * browser starting to thrash on micro-task scheduling. Tweakable
 * per-call via {@link readFilesIntoBytesMap}'s options.
 */
const FILE_READ_CONCURRENCY = 32;

/**
 * Reads `files` into a `Map<path, bytes>` using a worker-pool
 * pattern so up to `concurrency` reads are in-flight at once.
 * Replaces the textbook `for ... await arrayBuffer()` serial
 * loop, which on a 4000-file drop spent the bulk of its time
 * idling on disk between reads.
 *
 * Every call passes `path = normalizePath(webkitRelativePath ||
 * name)`, matching the rest of the loader so a downstream
 * lookup (`source.files.get(path)`) doesn't need to negotiate
 * separator-style differences. Progress is reported once per
 * worker step but throttled to every ~32 reads in callers via
 * {@link createThrottledProgress} so the UI updates don't
 * dwarf the actual read work.
 */
export async function readFilesIntoBytesMap(
  files: ReadonlyArray<File>,
  options: {
    concurrency?: number;
    onRead?: (path: string, current: number, total: number) => void;
  } = {},
): Promise<Map<string, Uint8Array>> {
  const concurrency = Math.min(options.concurrency ?? FILE_READ_CONCURRENCY, files.length || 1);
  const result = new Map<string, Uint8Array>();
  let nextIndex = 0;
  let completed = 0;
  const total = files.length;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;
      const file = files[index]!;
      const path = normalizePath(file.webkitRelativePath || file.name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      result.set(path, bytes);
      completed += 1;
      options.onRead?.(path, completed, total);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}

/**
 * Returns a progress-emit wrapper that fires at most once per
 * `intervalMs` (default 32ms ≈ two display frames). Callers
 * always emit through this when they're producing progress
 * events from a hot loop — the host UI only needs ~30 updates a
 * second to look smooth, but `loadFromFiles` was firing 4000+
 * `onProgress` callbacks per drop, which dominated the load
 * time on weaker machines.
 *
 * The trailing-edge call inside the wrapper isn't synchronously
 * scheduled (no setTimeout) — callers should make a final
 * unthrottled call themselves at the end of their loop so the
 * 100 % tick always lands.
 */
function createThrottledProgress(
  onProgress: LoadProgressCallback | undefined,
  intervalMs = 32,
): LoadProgressCallback | undefined {
  if (!onProgress) return undefined;
  let lastEmit = 0;
  return (event) => {
    const now = performance.now();
    if (now - lastEmit < intervalMs) return;
    lastEmit = now;
    onProgress(event);
  };
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

export async function loadSongCollectionFromFiles(
  files: Iterable<File>,
  options: LoadProgressOptions = {},
): Promise<BrowserSongCollection> {
  const onProgress = options.onProgress;
  const sources: BrowserSongAssetSource[] = [];
  const looseFiles = new Map<string, Uint8Array>();
  const looseLabels = new Set<string>();

  // Materialise the iterable so we can report "X / N" totals up
  // front. The callers always pass an array today, so this is a
  // no-op spread; it just lets the typing accept any iterable.
  const fileList = [...files];
  onProgress?.({ phase: 'reading', current: 0, total: fileList.length });
  // Split ZIPs out before the parallel-read pool so we can keep
  // each archive's expansion tied to its own source label.
  // Everything else lands in the shared `looseFiles` map.
  const zipFiles: File[] = [];
  const looseEntries: File[] = [];
  for (const file of fileList) {
    if (extensionOf(file.name) === '.zip' && !file.webkitRelativePath) {
      zipFiles.push(file);
    } else {
      looseEntries.push(file);
      looseLabels.add(firstPathSegment(normalizePath(file.webkitRelativePath || file.name)) || file.name);
    }
  }
  // Pooled parallel read for the loose-file bucket — this is the
  // dominant cost on a real-world drop (4000+ small files were
  // previously read serially via `for ... await arrayBuffer()`).
  // The throttled progress wrapper keeps the 4000-emit storm from
  // dominating the read time on the host-UI side.
  const throttledProgress = createThrottledProgress(onProgress);
  if (looseEntries.length > 0) {
    const looseMap = await readFilesIntoBytesMap(looseEntries, {
      onRead: (path, current, total) => {
        throttledProgress?.({ phase: 'reading', current, total, label: path });
      },
    });
    for (const [path, bytes] of looseMap) {
      looseFiles.set(path, bytes);
    }
  }
  // ZIPs read after the loose pool — there's typically zero or
  // one of them per drop, so serialising here costs nothing.
  for (const file of zipFiles) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    sources.push(createZipSource(file.name, bytes));
  }
  // Final 100 % emit for the read phase — the throttled wrapper
  // may have suppressed the last one.
  onProgress?.({ phase: 'reading', current: fileList.length, total: fileList.length });

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
  // Build the chart-path lists in one pass per source so we don't
  // sort + filter the full path table twice (once for the count,
  // once for the parse loop). Sort the chart paths only — the
  // non-chart paths don't need ordering since they're just asset
  // lookups.
  const chartPathsBySource = sources.map((source) => {
    const paths: string[] = [];
    for (const path of source.files.keys()) {
      if (isChartFilePath(path)) paths.push(path);
    }
    paths.sort((left, right) => left.localeCompare(right, 'ja'));
    return paths;
  });
  const chartCount = chartPathsBySource.reduce((acc, list) => acc + list.length, 0);
  let parsedSoFar = 0;
  if (chartCount > 0) {
    onProgress?.({ phase: 'parsing', current: 0, total: chartCount });
  }
  const throttledParseProgress = createThrottledProgress(onProgress);
  // Yield to the event loop every few charts so the host can paint
  // a frame and run the throttled progress emit. Chart parsing is
  // CPU-bound and otherwise blocks the main thread for the entire
  // parse phase on a multi-hundred-chart drop.
  const PARSE_YIELD_INTERVAL = 32;
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex]!;
    const paths = chartPathsBySource[sourceIndex]!;
    for (const path of paths) {
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
      parsedSoFar += 1;
      throttledParseProgress?.({ phase: 'parsing', current: parsedSoFar, total: chartCount, label: path });
      // Cooperative yield — gives the browser a slot to paint
      // and flush the throttled progress callback.
      if (parsedSoFar % PARSE_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
    }
  }
  if (chartCount > 0) {
    onProgress?.({ phase: 'parsing', current: chartCount, total: chartCount });
  }

  return { sources, songs, errors };
}

/**
 * Schedules a microtask that resolves on the next browser
 * macrotask, giving the event loop a chance to paint a frame
 * and dispatch any pending progress events. Cheaper than
 * `setTimeout(0)` (no minimum-delay clamp) and works in
 * Node-environment tests too (the Promise resolves on the
 * next tick).
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(resolve);
    } else {
      Promise.resolve().then(resolve);
    }
  });
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
 *
 * Lookup is **case-insensitive** at every candidate step: real-world
 * BMS archives routinely mix `KICK.WAV` / `kick.WAV` / `Kick.wav`,
 * and demanding the chart's casing match the file's would scuttle a
 * large fraction of legitimate drops on case-sensitive filesystems
 * (and in `webkitRelativePath` directory drops). The
 * `lookupBytesCaseInsensitive` helper builds a lazy lower-key index
 * the first time it's called per source and caches it via WeakMap.
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
  for (const candidate of candidates) {
    const bytes = lookupBytesCaseInsensitive(source.files, candidate);
    if (bytes) {
      return bytes;
    }
  }
  return undefined;
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
 * Case is handled by `resolveChartAsset` itself (case-insensitive
 * lookup), so this list no longer needs explicit upper-case
 * duplicates — `kick.OPUS` and `kick.opus` both resolve through
 * the lower-cased extension variant.
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
  const candidates = [`${base}.opus`, `${base}.ogg`, `${base}.mp3`, `${base}.wav`];
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
