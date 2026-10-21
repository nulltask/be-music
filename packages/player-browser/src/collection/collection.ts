import { runBrowserTask, getBrowserWorkerCount } from '../compute/index.ts';
import { parseChartTask, unzipTask } from '../compute/tasks.ts';
import { seedLibraryChartPlayVariant, type ChartSourceKind, type LibraryChart } from '@be-music/player-scene-model';
import {
  basename,
  dirname,
  normalizePath,
  readFilesIntoEntryMap,
  runWithConcurrency,
} from '@be-music/shared-utils/core';
import type { BrowserAssetEntry, BrowserAssetSource, BrowserChartCollection, LoadProgressCallback } from './types.ts';
import { createEagerDropPathPredicate, isChartFilePath } from '../browser/drop.ts';
import { restorePackedCollectionChart } from './compact-chart.ts';
import {
  type BrowserDroppedFile,
  DeferredDroppedFile,
  materializeDroppedFiles,
  withRelativePath,
} from './dropped-file.ts';
import { isMaliciousAssetPath, loadAssetBytes, lookupBytesCaseInsensitive } from './file-lookup.ts';
import { logger } from '../logger.ts';

export { loadAssetBytes, asLoadedBytes } from './file-lookup.ts';
export { type BrowserDroppedFile, DeferredDroppedFile, materializeDroppedFiles } from './dropped-file.ts';

const log = logger('drop');
const MAX_ZIP_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

/**
 * Optional progress hook for the dropped-folder loaders. When supplied, the loader fires the callback as it walks
 * through the `enumerating` / `reading` / `parsing` phases. UIs can use this to render a determinate progress bar so a
 * multi-thousand-file drop doesn't look like a frozen page.
 */
export interface LoadProgressOptions {
  onProgress?: LoadProgressCallback;
}

export class BrowserChartCollectionStore {
  public collection: BrowserChartCollection = { sources: [], charts: [], errors: [] };
  /**
   * Monotonic counter that prefixes every appended drop's source ids so subsequent drops don't collide with the
   * previous one's `files:0` / `bundle:0` ids. The counter is incremented every time a drop produces at least one new
   * source.
   */
  private dropSeq = 0;

  /**
   * Replace the store's collection with the chart pack parsed from `files`. Used for the explicit "load these and ONLY
   * these" entry point — the file-input picker, the initial drop before any songs have been added, etc.
   */
  public async loadFromFiles(
    files: Iterable<BrowserDroppedFile>,
    options: LoadProgressOptions = {},
  ): Promise<BrowserChartCollection> {
    this.collection = await loadChartCollectionFromFiles(files, options);
    this.dropSeq = 0;
    return this.collection;
  }

  /**
   * Append the chart pack parsed from `files` onto the existing collection. This is the "drop another folder onto an
   * already-loaded collection" entry point — the user's previous songs stay, and the new drop's sources / songs are
   * merged in.
   *
   * Source ids and song ids are re-prefixed with a per-drop tag (`drop1-files:0`, `drop2-bundle:0`, …) so the new
   * entries don't collide with previously-loaded ones (each `loadSong*` call internally numbers sources from `0`, so
   * without a prefix a second drop would overwrite the first's lookup keys).
   */
  public async appendFromFiles(
    files: Iterable<BrowserDroppedFile>,
    options: LoadProgressOptions = {},
  ): Promise<BrowserChartCollection> {
    const incoming = await loadChartCollectionFromFiles(files, options);
    if (incoming.sources.length === 0 && incoming.charts.length === 0 && incoming.errors.length === 0) {
      return this.collection;
    }
    this.dropSeq += 1;
    const prefix = `drop${this.dropSeq}-`;
    const remappedSources: BrowserAssetSource[] = incoming.sources.map((source) => ({
      ...source,
      id: prefix + source.id,
    }));
    const remappedCharts: LibraryChart[] = incoming.charts.map((chart) => ({
      ...chart,
      sourceId: prefix + chart.sourceId,
      id: prefix + chart.id,
    }));
    const remappedErrors = incoming.errors.map((error) => ({
      ...error,
      sourceId: prefix + error.sourceId,
    }));
    this.collection = {
      sources: [...this.collection.sources, ...remappedSources],
      charts: [...this.collection.charts, ...remappedCharts],
      errors: [...this.collection.errors, ...remappedErrors],
    };
    return this.collection;
  }

  public async loadFromDrop(
    dataTransfer: DataTransfer,
    options: LoadProgressOptions = {},
  ): Promise<BrowserChartCollection> {
    this.collection = await loadChartCollectionFromDrop(dataTransfer, options);
    this.dropSeq = 0;
    return this.collection;
  }
}

export async function loadChartCollectionFromDrop(
  dataTransfer: DataTransfer,
  options: LoadProgressOptions = {},
): Promise<BrowserChartCollection> {
  const files = await collectFilesFromDataTransfer(dataTransfer, options.onProgress);
  return loadChartCollectionFromFiles(files, options);
}

/**
 * Lists a drop's files. Files the host needs straight away (theme candidates outside chart directories, replays,
 * archives) come back as opened `File`s; song-bundle files come back as {@link DeferredDroppedFile} handles that open
 * on first read. Pass theme-side files through {@link materializeDroppedFiles} before handing them to an API that
 * needs real `File`s.
 */
export async function readDroppedFiles(
  dataTransfer: DataTransfer,
  options: LoadProgressOptions = {},
): Promise<BrowserDroppedFile[]> {
  return collectFilesFromDataTransfer(dataTransfer, options.onProgress);
}

async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer,
  onProgress?: LoadProgressCallback,
): Promise<BrowserDroppedFile[]> {
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
      const listed: ListedDropEntry[] = [];
      // Total is unknown while we're still walking the FileSystem tree (the FileSystemEntry API doesn't expose a
      // directory's file count up-front), so we report `total: -1` and let the host UI show an indeterminate
      // "Collecting…" indicator.
      onProgress?.({ phase: 'enumerating', current: 0, total: -1 });
      for (const entry of entries) {
        await listDropEntries(entry, '', listed, onProgress);
      }
      const files = await openListedDropEntries(listed);
      onProgress?.({ phase: 'enumerating', current: files.length, total: files.length });
      return files;
    }
  }
  const fallback = dataTransfer.files ? [...dataTransfer.files] : [];
  if (fallback.length > 0) {
    onProgress?.({ phase: 'enumerating', current: fallback.length, total: fallback.length });
  }
  return fallback;
}

/**
 * Cap on how many `entry.file()` / sub-directory `readEntries` calls can be in flight at once during the
 * FileSystemEntry walk. Chrome's FileSystem API silently rejects (or drops) some calls when the in-flight set grows
 * large, manifesting as a mid-load abort on multi-thousand-file drops. 16 is enough to keep disk I/O saturated without
 * bumping that limit.
 */
const ENTRY_WALK_CONCURRENCY = 16;

interface ListedDropEntry {
  entry: FileSystemFileEntry;
  path: string;
}

/**
 * Lists every file entry under `entry` without opening any of them. Listing is cheap (one `readEntries` per batch of a
 * directory); opening is not — `FileSystemFileEntry.file()` is a serialised browser round trip per file — so the
 * walk defers that choice to {@link openListedDropEntries}, which only opens the files needed right away.
 */
async function listDropEntries(
  entry: FileSystemEntry,
  prefix: string,
  listed: ListedDropEntry[],
  onProgress?: LoadProgressCallback,
): Promise<void> {
  if (entry.isFile) {
    const path = `${prefix}${entry.name}`;
    listed.push({ entry: entry as FileSystemFileEntry, path });
    // Throttle the per-file progress emit: a 4000-file walk doesn't need 4000 React-style updates. Keep one in every 32
    // entries plus the very first, which is enough for a visibly-moving counter without thrashing the host UI.
    if (onProgress && (listed.length & 0x1f) === 1) {
      onProgress({ phase: 'enumerating', current: listed.length, total: -1, label: path });
    }
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const nextPrefix = `${prefix}${entry.name}/`;
    while (true) {
      let batch: FileSystemEntry[];
      try {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
      } catch (error) {
        // A directory readEntries failure aborts iteration on THIS directory — the parent walk continues with what we
        // already collected. Logged because this is unusual (file-system errors are uncommon in dropped folders).
        log.warn(`skipped (readEntries failed): ${nextPrefix}`, error);
        return;
      }
      if (batch.length === 0) {
        return;
      }
      // Walk children with a bounded-concurrency pool. The unbounded `Promise.all(batch.map(...))` from before fanned
      // out into the recursive walks too, piling up hundreds of pending FileSystemEntry handles for deep trees.
      // Chrome's FileSystem API has an internal in-flight cap that, when exceeded, silently rejects later calls —
      // observable on the user side as a partial / interrupted load. Bounding the walk here keeps disk I/O saturated
      // without tripping that cap. Children are wrapped in `.catch` so one bad sub-tree doesn't reject the whole pool.
      await runWithConcurrency(batch, ENTRY_WALK_CONCURRENCY, async (child) => {
        try {
          await listDropEntries(child, nextPrefix, listed, onProgress);
        } catch (error) {
          log.warn(`skipped (child walk failed): ${nextPrefix}${child.name}`, error);
        }
      });
    }
  }
}

/**
 * Opens the listed entries the host needs immediately (see {@link createEagerDropPathPredicate}) and wraps the rest as
 * {@link DeferredDroppedFile} handles. On a large BMS pack the song audio / BGA make up nearly every file, so this
 * skips almost all of the per-file `file()` round trips that used to dominate the drop.
 */
async function openListedDropEntries(listed: readonly ListedDropEntry[]): Promise<BrowserDroppedFile[]> {
  const isEager = createEagerDropPathPredicate(listed.map((item) => normalizePath(item.path)));
  const files: Array<BrowserDroppedFile | undefined> = listed.map((item) =>
    isEager(normalizePath(item.path)) ? undefined : new DeferredDroppedFile(item.entry, item.path),
  );
  const eagerIndices: number[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (files[index] === undefined) eagerIndices.push(index);
  }
  await runWithConcurrency(eagerIndices, ENTRY_WALK_CONCURRENCY, async (index) => {
    const { entry, path } = listed[index]!;
    try {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
      });
      files[index] = withRelativePath(file, path);
    } catch (error) {
      // A single file failing to materialize (permission denied, stale entry, network drive disconnect, …) shouldn't
      // kill the entire drop. Log and skip — the resulting collection simply omits that file, matching what real LR2
      // does when an asset is missing.
      log.warn(`skipped (entry.file failed): ${path}`, error);
    }
  });
  return files.filter((file): file is BrowserDroppedFile => file !== undefined);
}

/**
 * Reads `files` into a `Map<path, bytes>` using a worker-pool pattern so up to `concurrency` reads are in-flight at
 * once. Replaces the textbook `for ... await arrayBuffer()` serial loop, which on a 4000-file drop spent the bulk of
 * its time idling on disk between reads.
 *
 * Every call passes `path = normalizePath(webkitRelativePath || name)`, matching the rest of the loader so a downstream
 * lookup (`source.files.get(path)`) doesn't need to negotiate separator-style differences. Progress is reported once
 * per worker step but throttled to every ~32 reads in callers via {@link createThrottledProgress} so the UI updates
 * don't dwarf the actual read work.
 */
export async function readFilesIntoBytesMap(
  files: ReadonlyArray<BrowserDroppedFile>,
  options: {
    concurrency?: number;
    onRead?: (path: string, current: number, total: number) => void;
    /**
     * When `true` (default), audio files (`.wav` / `.ogg` / `.mp3` / `.opus` / `.flac` / `.oga`) are stored as the
     * original `File` reference instead of being slurped into a `Uint8Array`. The gameplay scene reads the bytes on
     * demand via {@link loadAssetBytes}. Ignored when {@link shouldDefer} is supplied — that callback is the source of
     * truth.
     */
    deferAudio?: boolean;
    /**
     * Per-file decision callback. Returning `true` keeps the file as a lazy `File` reference; `false` reads the bytes
     * eagerly. Overrides {@link deferAudio} when supplied. Used by the song-collection loader to defer EVERY
     * song-bundle file (charts plus assets) so a multi-thousand-file pack doesn't sit gigabytes-resident in the heap
     * while the user is just browsing the bar list — the chart parser then pulls each chart's bytes through
     * `loadAssetBytes` on demand and lets them be GC'd as soon as parsing finishes.
     */
    shouldDefer?: (path: string) => boolean;
  } = {},
): Promise<Map<string, BrowserAssetEntry>> {
  return readFilesIntoEntryMap(files, {
    concurrency: options.concurrency,
    onRead: options.onRead,
    deferAudio: options.deferAudio,
    shouldDefer: options.shouldDefer,
    onReadError: (path, error) => {
      // A single file failing to read shouldn't kill the entire drop. The map simply omits that path; the caller's
      // chart parser / asset resolver will treat it as missing, which matches what happens for genuinely-missing
      // files.
      log.warn(`skipped (arrayBuffer failed): ${path}`, error);
    },
  });
}

/**
 * Returns a progress-emit wrapper that fires at most once per `intervalMs` (default 32ms ≈ two display frames). Callers
 * always emit through this when they're producing progress events from a hot loop — the host UI only needs ~30 updates
 * a second to look smooth, but `loadFromFiles` was firing 4000+ `onProgress` callbacks per drop, which dominated the
 * load time on weaker machines.
 *
 * The trailing-edge call inside the wrapper isn't synchronously scheduled (no setTimeout) — callers should make a final
 * unthrottled call themselves at the end of their loop so the 100 % tick always lands.
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

export async function loadChartCollectionFromFiles(
  files: Iterable<BrowserDroppedFile>,
  options: LoadProgressOptions = {},
): Promise<BrowserChartCollection> {
  const onProgress = options.onProgress;
  const sources: BrowserAssetSource[] = [];
  const looseFiles = new Map<string, BrowserAssetEntry>();
  const looseLabels = new Set<string>();
  const errors: BrowserChartCollection['errors'] = [];

  // Materialize the iterable so we can report "X / N" totals up front. The callers always pass an array today, so this
  // is a no-op spread; it just lets the typing accept any iterable.
  const fileList = [...files];
  onProgress?.({ phase: 'reading', current: 0, total: fileList.length });
  // Split ZIPs out before the parallel-read pool so we can keep each archive's expansion tied to its own source label.
  // Everything else lands in the shared `looseFiles` map.
  const zipFiles: BrowserDroppedFile[] = [];
  const looseEntries: BrowserDroppedFile[] = [];
  for (const file of fileList) {
    if (extensionOf(file.name) === '.zip' && !file.webkitRelativePath) {
      zipFiles.push(file);
    } else {
      looseEntries.push(file);
      looseLabels.add(firstPathSegment(normalizePath(file.webkitRelativePath || file.name)) || file.name);
    }
  }
  // Defer EVERY song-bundle file. Charts get read on demand by the parse loop below (each chart's bytes are released as
  // soon as the parser produces its `BeMusicJSON`), and asset files (BGA images, audio, video, banner, …) stay as lazy
  // `File` references until gameplay-mount actually needs them. This keeps the at-rest heap to "parsed chart metadata
  // only" for the song bundle — the dropped pack itself sits on disk until the user picks a song. The throttled
  // progress wrapper keeps the 4000-emit storm from dominating the read time.
  const throttledProgress = createThrottledProgress(onProgress);
  if (looseEntries.length > 0) {
    const looseMap = await readFilesIntoBytesMap(looseEntries, {
      shouldDefer: () => true,
      onRead: (path, current, total) => {
        throttledProgress?.({ phase: 'reading', current, total, label: path });
      },
    });
    for (const [path, bytes] of looseMap) {
      looseFiles.set(path, bytes);
    }
  }
  const zipSources: Array<BrowserAssetSource | undefined> = Array.from({ length: zipFiles.length });
  const zipErrors: BrowserChartCollection['errors'][] = Array.from({ length: zipFiles.length }, () => []);
  await runWithConcurrency(zipFiles, getBrowserWorkerCount(), async (dropped, index) => {
    const sourceId = `zip:${dropped.name}`;
    const [file] = await materializeDroppedFiles([dropped]);
    if (!file) {
      zipErrors[index]!.push({ sourceId, message: 'failed to open ZIP archive' });
      return;
    }
    if (file.size > MAX_ZIP_ARCHIVE_BYTES) {
      zipErrors[index]!.push({
        sourceId,
        message: `ZIP archive is too large (${formatBytes(file.size)}; limit ${formatBytes(MAX_ZIP_ARCHIVE_BYTES)})`,
      });
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      zipSources[index] = await createZipSource(file.name, bytes);
    } catch (error) {
      zipErrors[index]!.push({
        sourceId,
        message: error instanceof Error ? error.message : 'failed to read ZIP archive',
      });
    }
  });
  sources.push(...zipSources.filter((source): source is BrowserAssetSource => source !== undefined));
  errors.push(...zipErrors.flat());
  // Final 100 % emit for the read phase — the throttled wrapper may have suppressed the last one.
  onProgress?.({ phase: 'reading', current: fileList.length, total: fileList.length });

  if (looseFiles.size > 0) {
    sources.push({
      id: `files:${sources.length}`,
      kind: inferSourceKind(looseFiles),
      label: looseLabels.size === 1 ? [...looseLabels][0]! : 'Dropped files',
      files: looseFiles,
    });
  }

  const charts: LibraryChart[] = [];
  // Build the chart-path lists in one pass per source so we don't sort + filter the full path table twice (once for the
  // count, once for the parse loop). Sort the chart paths only — the non-chart paths don't need ordering since they're
  // just asset lookups.
  const chartPathsBySource = sources.map((source) => {
    const paths: string[] = [];
    for (const path of source.files.keys()) {
      if (isChartFilePath(path)) paths.push(path);
    }
    paths.sort(JAPANESE_COLLATOR.compare);
    return paths;
  });
  const chartCount = chartPathsBySource.reduce((acc, list) => acc + list.length, 0);
  let parsedSoFar = 0;
  if (chartCount > 0) {
    onProgress?.({ phase: 'parsing', current: 0, total: chartCount });
  }
  const throttledParseProgress = createThrottledProgress(onProgress);
  // Keep cooperative progress yielding for hosts using the local fallback; workers already run outside the UI thread.
  const PARSE_YIELD_INTERVAL = 32;
  const items = sources.flatMap((source, index) => chartPathsBySource[index]!.map((path) => ({ source, path })));
  const loadedCharts: Array<LibraryChart | undefined> = Array.from({ length: items.length });
  const parseErrors: Array<BrowserChartCollection['errors'][number] | undefined> = Array.from({ length: items.length });
  await runWithConcurrency(items, getBrowserWorkerCount(), async ({ source, path }, index) => {
    try {
      const chartBytes = await loadAssetBytes(source.files.get(path));
      if (!chartBytes) {
        throw new Error(`chart bytes missing for ${path}`);
      }
      const input = { path, bytes: chartBytes };
      const { chart, scored, packed, strings } = await runBrowserTask('parse-chart', input, () =>
        parseChartTask(input),
      );
      // The scored notes and the play variant they were read under, without timing every note: the list shows a count.

      const libraryChart: LibraryChart = {
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
        // The notes the engine scores: FREE ZONE tails are judged by nobody, and mines / invisible objects are not
        // notes at all. A long note counts once.
        totalNotes: scored.notes,
        chart,
      };
      loadedCharts[index] = libraryChart;
      // Every parsed chart stays resident for as long as the song is in the collection, so trim it before keeping
      // it. Keep the play variant first, while the events are still plain objects: select screens filter the whole
      // list by it, and a cached answer spares them from unpacking every chart's events. Counting the notes already
      // worked it out (`resolveChartPlayVariant` over the same chart and path).
      seedLibraryChartPlayVariant(libraryChart, scored.playVariant);
      restorePackedCollectionChart(chart, packed, strings);
    } catch (error) {
      parseErrors[index] = {
        sourceId: source.id,
        path,
        message: error instanceof Error ? error.message : 'failed to parse chart',
      };
    }
    parsedSoFar += 1;
    throttledParseProgress?.({ phase: 'parsing', current: parsedSoFar, total: chartCount, label: path });
    if (parsedSoFar % PARSE_YIELD_INTERVAL === 0) await yieldToEventLoop();
  });
  charts.push(...loadedCharts.filter((chart): chart is LibraryChart => chart !== undefined));
  errors.push(...parseErrors.filter((error): error is BrowserChartCollection['errors'][number] => error !== undefined));
  if (chartCount > 0) {
    onProgress?.({ phase: 'parsing', current: chartCount, total: chartCount });
  }

  return { sources, charts, errors };
}

/**
 * Yields to a browser task boundary so the host can paint a frame and dispatch pending progress events during large
 * chart drops. `queueMicrotask` is intentionally not used here: microtasks run before the browser gets a render
 * opportunity, so they still let a large parse loop monopolize the page.
 */
function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield !== undefined) {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function describeChartCollection(collection: BrowserChartCollection): string {
  return `${collection.charts.length} charts loaded${
    collection.errors.length > 0 ? `, ${collection.errors.length} errors` : ''
  }`;
}

async function createZipSource(name: string, bytes: Uint8Array): Promise<BrowserAssetSource> {
  const input = {
    bytes,
    limit: MAX_ZIP_UNCOMPRESSED_BYTES,
    limitMessage: `ZIP archive expands beyond ${formatBytes(MAX_ZIP_UNCOMPRESSED_BYTES)}; use a smaller archive or drop an extracted folder`,
  };
  const entries = await runBrowserTask('unzip', input, () => unzipTask(input));
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  const mib = bytes / (1024 * 1024);
  if (mib < 1024) return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}

/**
 * `localeCompare(…, 'ja')` as one collator: the same order, without setting up a collator for each of the thousands of
 * comparisons a large drop's path sort makes.
 */
const JAPANESE_COLLATOR = new Intl.Collator('ja');

function inferSourceKind(files: ReadonlyMap<string, BrowserAssetEntry>): ChartSourceKind {
  for (const path of files.keys()) {
    if (path.includes('/')) return 'directory';
  }
  return 'files';
}

export function resolveChartSource(
  collection: BrowserChartCollection,
  chartEntry: LibraryChart,
): BrowserAssetSource | undefined {
  return collection.sources.find((source) => source.id === chartEntry.sourceId);
}

/**
 * Resolves a chart-relative asset path (BMP, WAV, banner, …) to its decoded byte array within a song asset source.
 * Mirrors the BMS convention of looking next to the chart file first, then falling back to the source's root and the
 * basename, then — as LR2 does — the same one folder up from the chart. Used by both gameplay (BGA/audio) and select (banner / preview) loaders.
 *
 * Lookup is **case-insensitive** at every candidate step: real-world BMS archives routinely mix `KICK.WAV` / `kick.WAV`
 * / `Kick.wav`, and demanding the chart's casing match the file's would scuttle a large fraction of legitimate drops on
 * case-sensitive filesystems (and in `webkitRelativePath` directory drops). The `lookupBytesCaseInsensitive` helper
 * builds a lazy lower-key index the first time it's called per source and caches it via WeakMap.
 */
export function resolveChartAsset(
  source: BrowserAssetSource,
  chartPath: string,
  assetPath: string,
): BrowserAssetEntry | undefined {
  for (const folderChartPath of chartLookupFolders(chartPath)) {
    const entry = resolveChartAssetInFolder(source, folderChartPath, assetPath);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Where a chart's assets are looked for, as chart paths: the chart itself, then — as LR2 does — a stand-in one folder
 * up, so a 差分 (alternate difficulty) chart shipped in a sub-folder finds the keysounds and BGA beside its parent.
 * A chart directly under the dropped folder has no extra entry: its parent is the top, which the lookup always tries.
 * Every extension is tried in the chart's own folder before the parent's (see {@link resolveChartAudioAsset}).
 */
function chartLookupFolders(chartPath: string): string[] {
  const parent = dirname(dirname(chartPath));
  return parent === '' ? [chartPath] : [chartPath, `${parent}/${basename(chartPath)}`];
}

/** {@link resolveChartAsset} in one folder: next to `chartPath`, then the top of the source. */
function resolveChartAssetInFolder(
  source: BrowserAssetSource,
  chartPath: string,
  assetPath: string,
): BrowserAssetEntry | undefined {
  // bmson 1.0.0 spec MUST: reject malicious paths at the chart-asset entry point. `lookupBytesCaseInsensitive` also
  // vets each candidate as defense-in-depth, but short-circuiting here means we don't even synthesize the joined
  // `${base}/${assetPath}` candidate for a path the chart never had any business referencing.
  if (isMaliciousAssetPath(assetPath)) {
    return undefined;
  }
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
    const entry = lookupBytesCaseInsensitive(source.files, candidate);
    if (entry) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Audio-asset variant of `resolveChartAsset` that walks codec substitutions when the chart's declared file isn't
 * present.
 *
 * BMS charts almost always declare `#WAVxx test.wav`, but real-world archives ship the audio as `.opus` / `.ogg` /
 * `.mp3` to save space. Mirrors the `packages/player-engine` audio loader's "try the alternative codecs before giving up"
 * behavior, with the order tweaked for the browser case:
 *
 * - 1. `.opus` (highest compression-to-quality ratio) 2. `.ogg` (broadly supported, small) 3. `.mp3` (universal,
 *   slightly larger) 4. `.wav` (always-correct fallback) 5. the original path verbatim (covers `.flac` / `.oga` / etc.)
 *
 * Case is handled by `resolveChartAsset` itself (case-insensitive lookup), so this list no longer needs explicit
 * upper-case duplicates — `kick.OPUS` and `kick.opus` both resolve through the lower-cased extension variant.
 */
export interface ResolveChartAudioAssetOptions {
  /**
   * BMS spec — `#PATH_WAV <prefix>` declares a directory the chart's WAVs live under. The resolver tries each codec
   * fallback prefixed with this string before falling through to the bare path, so a chart authored as `wav/` + bare
   * `kick.wav` references resolves the file as `wav/kick.wav`.
   */
  pathPrefix?: string;
}

export function resolveChartAudioAsset(
  source: BrowserAssetSource,
  chartPath: string,
  assetPath: string,
  options: ResolveChartAudioAssetOptions = {},
): BrowserAssetEntry | undefined {
  // Every codec in the chart's folder before any in its parent, as LR2 does.
  for (const folderChartPath of chartLookupFolders(chartPath)) {
    for (const candidate of audioFallbackPaths(assetPath)) {
      // Try the `#PATH_WAV` prefixed form first when supplied; fall through to the bare name if the prefix-joined path
      // doesn't resolve. Charts that don't author `#PATH_WAV` pass `pathPrefix: undefined` and behave exactly as
      // before.
      const prefixed = joinPathWAVPrefix(options.pathPrefix, candidate);
      if (prefixed !== undefined) {
        const entry = resolveChartAssetInFolder(source, folderChartPath, prefixed);
        if (entry) return entry;
      }
      const entry = resolveChartAssetInFolder(source, folderChartPath, candidate);
      if (entry) {
        return entry;
      }
    }
  }
  return undefined;
}

function joinPathWAVPrefix(prefix: string | undefined, samplePath: string): string | undefined {
  if (typeof prefix !== 'string') return undefined;
  const trimmedPrefix = prefix.trim();
  if (trimmedPrefix.length === 0) return undefined;
  // Skip when the chart already includes the prefix in the sample path — common when `#WAV01` already references
  // `wav/kick.wav` AND `#PATH_WAV wav/` is also set. The bare-path candidate (returned without the second prefix
  // application) already resolves correctly.
  const normalizedPrefix = trimmedPrefix.replaceAll('\\', '/');
  const normalizedSample = samplePath.replaceAll('\\', '/');
  const prefixWithSep = normalizedPrefix.endsWith('/') ? normalizedPrefix : `${normalizedPrefix}/`;
  if (normalizedSample.startsWith(prefixWithSep)) {
    return undefined;
  }
  return `${prefixWithSep}${samplePath}`;
}

function audioFallbackPaths(path: string): string[] {
  const lastSlash = path.lastIndexOf('/');
  const dotIndex = path.lastIndexOf('.');
  // bmson 1.0.0 spec — "A file extension may be omitted. If file extension is omitted, then the implementation should
  // search for compatible sound file with that name." The previous shape returned just `[path]` for extensionless
  // inputs, which skipped the codec walk entirely and broke any bmson chart that authors `sound_channels[].name`
  // without a dot. We now walk the same fallback list for both cases — the only difference is whether `path` is the
  // bare base or the already-suffixed variant we strip back to one.
  const hasExtension = dotIndex >= 0 && dotIndex >= lastSlash;
  const base = hasExtension ? path.slice(0, dotIndex) : path;
  // Order is "most-likely-shipped first" so the case-insensitive file lookup short-circuits fast on the common archive
  // formats. `.m4a` (AAC) is included to match the spec example ("Try piano.wav, piano.ogg, piano.m4a, …").
  const candidates = [`${base}.opus`, `${base}.ogg`, `${base}.mp3`, `${base}.wav`, `${base}.m4a`];
  if (!candidates.includes(path)) {
    candidates.push(path);
  }
  return candidates;
}

/**
 * Image-asset variant of {@link resolveChartAsset} that walks the common BMS image-format extensions before giving up.
 * BMS charts historically declare `#BMPxx test.bmp`, but archives ship the actual graphic as `.png` / `.jpg` / `.gif`
 * more often than as a real Windows bitmap. Mirrors {@link resolveChartAudioAsset}'s codec-walking behavior, with the
 * order tuned for graphics:
 *
 * - 1. `.webp` (first, so a pack re-encoded to WebP to save space wins over any leftover originals) 2. `.png`
 *   (lossless, broadly supported, the modern default) 3. `.jpg` / `.jpeg` (lossy, smaller — common for photo BGA) 4.
 *   `.gif` (legacy but still seen in older charts) 5. `.bmp` (the literal `#BMPxx` extension) 6. the original path
 *   verbatim — keeps video BGA references (`.mpg` / `.mp4` / `.webm` / …) and any exotic format not in the list above
 *   resolving correctly.
 *
 * The bytes are decoded by content, not by the declared extension, so a `#BMPxx foo.bmp` resolved to `foo.webp` decodes
 * as WebP.
 *
 * Case is handled by `resolveChartAsset` itself (case-insensitive lookup), so this list doesn't need explicit
 * upper-case duplicates.
 */
export function resolveChartImageAsset(
  source: BrowserAssetSource,
  chartPath: string,
  assetPath: string,
): BrowserAssetEntry | undefined {
  return resolveChartBGAAsset(source, chartPath, assetPath)?.entry;
}

/**
 * {@link resolveChartImageAsset}, also naming the file it found (`path`, relative like `assetPath`): a video declared
 * as `_bga.mpg` may resolve to `_bga.mp4`, and the video loader should treat the bytes as what they are.
 */
export function resolveChartBGAAsset(
  source: BrowserAssetSource,
  chartPath: string,
  assetPath: string,
): { entry: BrowserAssetEntry; path: string } | undefined {
  // Every extension in the chart's folder before any in its parent, as LR2 does.
  for (const folderChartPath of chartLookupFolders(chartPath)) {
    for (const candidate of imageFallbackPaths(assetPath)) {
      const entry = resolveChartAssetInFolder(source, folderChartPath, candidate);
      if (entry) {
        return { entry, path: candidate };
      }
    }
  }
  return undefined;
}

/**
 * The video extensions tried, in order, when a chart's declared video BGA isn't there under its own name: packs often
 * re-encode `_bga.mpg` / `_bga.wmv` to `_bga.mp4` without touching the chart (beatoraja looks for the other
 * extensions too). Browser-native containers come first, so the re-encode wins over a legacy original left beside it.
 */
const VIDEO_FALLBACK_EXTENSIONS = ['mp4', 'webm', 'm4v', 'mov', 'mpg', 'mpeg', 'wmv', 'avi', 'mkv'] as const;

function imageFallbackPaths(path: string): string[] {
  const lastSlash = path.lastIndexOf('/');
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex < lastSlash) {
    return [path];
  }
  // A declared video falls back to the same name under the other video extensions (see VIDEO_FALLBACK_EXTENSIONS).
  // Don't walk image extensions when the chart explicitly declared a video BGA — `_scualee.mpg` paired with a same-
  // basename `_scualee.png` (cover art / static fallback frame shipped alongside the actual video) would otherwise have
  // the resolver pick the PNG. The BGA loader only checks the declared path's extension to decide between the image vs.
  // video pipeline, so feeding PNG bytes through the video path makes ffmpeg.wasm pick `png_pipe` and emit a 1-frame
  // MP4 — visually a frozen still during gameplay. Returning just the original path here keeps the video reference
  // resolving to its own file.
  if (isVideoExtensionPath(path)) {
    const videoBase = path.slice(0, dotIndex);
    const declared = path.slice(dotIndex + 1).toLowerCase();
    return [path, ...VIDEO_FALLBACK_EXTENSIONS.filter((ext) => ext !== declared).map((ext) => `${videoBase}.${ext}`)];
  }
  const base = path.slice(0, dotIndex);
  const candidates = [`${base}.webp`, `${base}.png`, `${base}.jpg`, `${base}.jpeg`, `${base}.gif`, `${base}.bmp`];
  if (!candidates.includes(path)) {
    candidates.push(path);
  }
  return candidates;
}

/**
 * Local copy of `isVideoExtension` from `chart/bga-timeline.ts`. Pulled inline rather than imported so
 * `collection.ts` (the data-layer entry point) doesn't take a dependency on the play's BGA helpers; the patterns are
 * tiny and trivially kept in sync.
 */
function isVideoExtensionPath(path: string): boolean {
  return /\.(mpg|mpeg|mp4|m4v|avi|mov|wmv|webm|mkv)$/iu.test(path);
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
