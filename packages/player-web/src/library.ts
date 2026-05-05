import { unzipSync } from 'fflate';
import { isPlayableChannel, resolveChartPlayVariant as resolveChartPlayVariantForChart } from '@be-music/chart';
import { extractDeclaredBmsCharset, parseBms, parseBmson } from '@be-music/parser';
import { extractPlayableNotes } from '@be-music/player/playable-notes';
import { basename, dirname, normalizePath, runWithConcurrency } from '@be-music/utils/core';
import type {
  BrowserFolderNode,
  BrowserSongAssetEntry,
  BrowserSongAssetSource,
  BrowserSongCollection,
  BrowserSongEntry,
  BrowserSongSourceKind,
  LoadProgressCallback,
} from './types.ts';
import { isChartFilePath } from './drop.ts';
import { isMaliciousAssetPath, loadAssetBytes, lookupBytesCaseInsensitive } from './file-lookup.ts';
import { logger } from './logger.ts';

export { loadAssetBytes, asLoadedBytes } from './file-lookup.ts';

export { basename, dirname, normalizePath } from '@be-music/utils/core';

const log = logger('drop');

/**
 * Optional progress hook for the dropped-folder loaders. When supplied, the loader fires the callback as it walks
 * through the `enumerating` / `reading` / `parsing` phases. UIs can use this to render a determinate progress bar so a
 * multi-thousand-file drop doesn't look like a frozen page.
 */
export interface LoadProgressOptions {
  onProgress?: LoadProgressCallback;
}

export class BrowserSongLibrary {
  public collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  /**
   * Monotonic counter that prefixes every appended drop's source ids so subsequent drops don't collide with the
   * previous one's `files:0` / `bundle:0` ids. The counter is incremented every time a drop produces at least one new
   * source.
   */
  private dropSeq = 0;

  /**
   * Replace the library's collection with the chart pack parsed from `files`. Used for the explicit "load these and
   * ONLY these" entry point — the file-input picker, the initial drop before any songs have been added, etc.
   */
  public async loadFromFiles(files: Iterable<File>, options: LoadProgressOptions = {}): Promise<BrowserSongCollection> {
    this.collection = await loadSongCollectionFromFiles(files, options);
    this.dropSeq = 0;
    return this.collection;
  }

  /**
   * Append the chart pack parsed from `files` onto the existing collection. This is the "drop another folder onto an
   * already- loaded library" entry point — the user's previous songs stay, and the new drop's sources / songs are
   * merged in.
   *
   * Source ids and song ids are re-prefixed with a per-drop tag (`drop1-files:0`, `drop2-bundle:0`, …) so the new
   * entries don't collide with previously-loaded ones (each `loadSong*` call internally numbers sources from `0`, so
   * without a prefix a second drop would overwrite the first's lookup keys).
   */
  public async appendFromFiles(
    files: Iterable<File>,
    options: LoadProgressOptions = {},
  ): Promise<BrowserSongCollection> {
    const incoming = await loadSongCollectionFromFiles(files, options);
    if (incoming.sources.length === 0 && incoming.songs.length === 0 && incoming.errors.length === 0) {
      return this.collection;
    }
    this.dropSeq += 1;
    const prefix = `drop${this.dropSeq}-`;
    const remappedSources: BrowserSongAssetSource[] = incoming.sources.map((source) => ({
      ...source,
      id: prefix + source.id,
    }));
    const remappedSongs: BrowserSongEntry[] = incoming.songs.map((song) => ({
      ...song,
      sourceId: prefix + song.sourceId,
      id: prefix + song.id,
    }));
    const remappedErrors = incoming.errors.map((error) => ({
      ...error,
      sourceId: prefix + error.sourceId,
    }));
    this.collection = {
      sources: [...this.collection.sources, ...remappedSources],
      songs: [...this.collection.songs, ...remappedSongs],
      errors: [...this.collection.errors, ...remappedErrors],
    };
    return this.collection;
  }

  public async loadFromDrop(
    dataTransfer: DataTransfer,
    options: LoadProgressOptions = {},
  ): Promise<BrowserSongCollection> {
    this.collection = await loadSongCollectionFromDrop(dataTransfer, options);
    this.dropSeq = 0;
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
      // Total is unknown while we're still walking the FileSystem tree (the FileSystemEntry API doesn't expose a
      // directory's file count up-front), so we report `total: -1` and let the host UI show an indeterminate
      // "Collecting…" indicator.
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

/**
 * Cap on how many `entry.file()` / sub-directory `readEntries` calls can be in flight at once during the
 * FileSystemEntry walk. Chrome's FileSystem API silently rejects (or drops) some calls when the in-flight set grows
 * large, manifesting as a mid-load abort on multi-thousand-file drops. 16 is enough to keep disk I/O saturated without
 * bumping that limit.
 */
const ENTRY_WALK_CONCURRENCY = 16;

async function collectFilesFromEntry(
  entry: FileSystemEntry,
  prefix: string,
  files: File[],
  onProgress?: LoadProgressCallback,
): Promise<void> {
  if (entry.isFile) {
    let file: File;
    try {
      file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
    } catch (error) {
      // A single file failing to materialise (permission denied, stale entry, network drive disconnect, …) shouldn't
      // kill the entire drop. Log and skip — the resulting collection simply omits that file, matching what real LR2
      // does when an asset is missing.
      log.warn(`skipped (entry.file failed): ${prefix}${entry.name}`, error);
      return;
    }
    const relativePath = prefix ? `${prefix}${file.name}` : file.name;
    files.push(withRelativePath(file, relativePath));
    // Throttle the per-file progress emit: a 4000-file walk doesn't need 4000 React-style updates. Keep one in every 32
    // entries plus the very first, which is enough for a visibly-moving counter without thrashing the host UI.
    if (onProgress && (files.length & 0x1f) === 1) {
      onProgress({ phase: 'enumerating', current: files.length, total: -1, label: relativePath });
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
          await collectFilesFromEntry(child, nextPrefix, files, onProgress);
        } catch (error) {
          log.warn(`skipped (child walk failed): ${nextPrefix}${child.name}`, error);
        }
      });
    }
  }
}

/**
 * Default concurrency cap for parallel file reads. Tuned high enough that 4000 small files saturate disk I/O without
 * the browser starting to thrash on micro-task scheduling. Tweakable per-call via {@link readFilesIntoBytesMap}'s
 * options.
 */
const FILE_READ_CONCURRENCY = 32;

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
  files: ReadonlyArray<File>,
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
): Promise<Map<string, BrowserSongAssetEntry>> {
  const concurrency = options.concurrency ?? FILE_READ_CONCURRENCY;
  const deferAudio = options.deferAudio ?? true;
  const decideDefer = options.shouldDefer ?? (deferAudio ? isAudioPath : neverDefer);
  const result = new Map<string, BrowserSongAssetEntry>();
  let completed = 0;
  const total = files.length;
  await runWithConcurrency(files, concurrency, async (file) => {
    const path = normalizePath(file.webkitRelativePath || file.name);
    if (decideDefer(path)) {
      result.set(path, file);
    } else {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        result.set(path, bytes);
      } catch (error) {
        // A single file failing to read shouldn't kill the entire drop. The map simply omits that path; the caller's
        // chart parser / asset resolver will treat it as missing, which matches what happens for genuinely-missing
        // files.
        log.warn(`skipped (arrayBuffer failed): ${path}`, error);
      }
    }
    completed += 1;
    options.onRead?.(path, completed, total);
  });
  return result;
}

function neverDefer(): boolean {
  return false;
}

/**
 * Audio extensions for which we defer the byte-load by default. Mirrors the codec fallback chain in {@link
 * audioFallbackPaths} so a chart's `#WAV xx.wav` declaration finds the deferred `xx.opus` / `.ogg` / `.mp3` file as
 * transparently as it found the eager bytes before.
 */
const AUDIO_EXTENSIONS = new Set(['.wav', '.ogg', '.mp3', '.opus', '.flac', '.oga']);

function isAudioPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  const slash = path.lastIndexOf('/');
  if (slash > dot) return false;
  return AUDIO_EXTENSIONS.has(path.slice(dot).toLowerCase());
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
  const looseFiles = new Map<string, BrowserSongAssetEntry>();
  const looseLabels = new Set<string>();

  // Materialise the iterable so we can report "X / N" totals up front. The callers always pass an array today, so this
  // is a no-op spread; it just lets the typing accept any iterable.
  const fileList = [...files];
  onProgress?.({ phase: 'reading', current: 0, total: fileList.length });
  // Split ZIPs out before the parallel-read pool so we can keep each archive's expansion tied to its own source label.
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
  // Defer EVERY song-bundle file. Charts get read on demand by the parse loop below (each chart's bytes are released as
  // soon as the parser produces its `BeMusicJson`), and asset files (BGA images, audio, video, banner, …) stay as lazy
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
  // ZIPs read after the loose pool — there's typically zero or one of them per drop, so serialising here costs nothing.
  for (const file of zipFiles) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    sources.push(createZipSource(file.name, bytes));
  }
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

  const songs: BrowserSongEntry[] = [];
  const errors: BrowserSongCollection['errors'] = [];
  // Build the chart-path lists in one pass per source so we don't sort + filter the full path table twice (once for the
  // count, once for the parse loop). Sort the chart paths only — the non-chart paths don't need ordering since they're
  // just asset lookups.
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
  // Yield to the event loop every few charts so the host can paint a frame and run the throttled progress emit. Chart
  // parsing is CPU-bound and otherwise blocks the main thread for the entire parse phase on a multi-hundred-chart drop.
  const PARSE_YIELD_INTERVAL = 32;
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex]!;
    const paths = chartPathsBySource[sourceIndex]!;
    for (const path of paths) {
      try {
        // Charts are stored as lazy `File` references in the song-bundle map (everything is deferred). Read the bytes
        // on demand — the `chartBytes` local goes out of scope at the end of this iteration, so the GC can reclaim them
        // as soon as the parser is done with them. Net effect: parse-phase memory is one chart at a time rather than
        // the whole bundle's worth.
        const chartBytes = await loadAssetBytes(source.files.get(path));
        if (!chartBytes) {
          throw new Error(`chart bytes missing for ${path}`);
        }
        const chart = parseChart(path, chartBytes);
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
      // Cooperative yield — gives the browser a slot to paint and flush the throttled progress callback.
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
 * Schedules a microtask that resolves on the next browser macrotask, giving the event loop a chance to paint a frame
 * and dispatch any pending progress events. Cheaper than `setTimeout(0)` (no minimum-delay clamp) and works in
 * Node-environment tests too (the Promise resolves on the next tick).
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
  // BOM detection \u2014 UTF-8 BOM unambiguously identifies the chart as UTF-8 encoded.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeUtf8(bytes);
  }
  // BMS spec \u2014 honour `#CHARSET <name>` at the top of the file before falling back to the shift_jis default. The
  // first-pass latin1 decode preserves every byte 1:1 so we can scan for the directive without decoding
  // misinterpretation. Mirrors the parser's `decodeBmsText` flow so a chart's declared encoding is honoured by every
  // runtime (CLI / TUI / web).
  const declaredCharset = extractDeclaredBmsCharset(new TextDecoder('iso-8859-1').decode(bytes));
  if (declaredCharset) {
    const decoded = decodeBmsWithCharset(bytes, declaredCharset);
    if (decoded !== undefined) return decoded;
  }
  try {
    return new TextDecoder('shift_jis').decode(bytes).replace(/^\ufeff/u, '');
  } catch {
    return decodeUtf8(bytes);
  }
}

function decodeBmsWithCharset(bytes: Uint8Array, charset: string): string | undefined {
  // `TextDecoder` accepts the same canonical encoding names `canonicaliseBmsCharset` produces, so the declared charset
  // can route directly through it. Any unrecognised label throws synchronously; the caller treats that as "fall back to
  // autodetection".
  try {
    switch (charset) {
      case 'utf-8':
        return new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/u, '');
      case 'shift_jis':
      case 'euc-jp':
      case 'iso-8859-1':
        return new TextDecoder(charset).decode(bytes);
      case 'utf-16le':
      case 'utf-16be':
        return new TextDecoder(charset).decode(bytes).replace(/^\ufeff/u, '');
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function isScoreTargetChannel(channel: string): boolean {
  return isPlayableChannel(channel);
}

/**
 * Inspects a chart entry's playable note channels and reports which `play_<variant>.lr2skin` should be loaded for it.
 * Mapping:
 *
 * - - PMS / 9 KEY (Pop'n) - `.pms` extension OR `#PLAYER=3` paired with channel `17` → `'9'` - any `2X` channel → DP -
 *   any 6/7 key (18 / 19 / 28 / 29) → `'14'` - otherwise → `'10'` - SP only - any 6/7 key → `'7'` - otherwise → `'5'`
 *
 * Mirrors the CLI's `resolveLaneMode` decision (see `packages/player/src/manual-input.ts`) so the web player picks the
 * same `play_9.lr2skin` variant the CLI would for a Pop'n chart. The `22..25` PMS-STD channel signature is NOT used
 * here because real DP charts also drop notes there — the CLI treats that signature only as a layout disambiguator
 * (standard vs. compat) AFTER the 9KEY mode has been decided by extension or `#PLAYER=3 + 17`.
 */
export function resolveChartPlayVariant(song: BrowserSongEntry): '5' | '7' | '9' | '10' | '14' {
  return resolveChartPlayVariantForChart({
    chartPath: song.chartPath,
    events: song.chart.events,
    bms: song.chart.bms,
  });
}

function inferSourceKind(files: ReadonlyMap<string, BrowserSongAssetEntry>): BrowserSongSourceKind {
  for (const path of files.keys()) {
    if (path.includes('/')) return 'directory';
  }
  return 'files';
}

export function resolveSongSource(
  collection: BrowserSongCollection,
  song: BrowserSongEntry,
): BrowserSongAssetSource | undefined {
  return collection.sources.find((source) => source.id === song.sourceId);
}

/**
 * Resolves a chart-relative asset path (BMP, WAV, banner, …) to its decoded byte array within a song asset source.
 * Mirrors the BMS convention of looking next to the chart file first, then falling back to the source's root and the
 * basename. Used by both gameplay (BGA/audio) and select (banner / preview) loaders.
 *
 * Lookup is **case-insensitive** at every candidate step: real-world BMS archives routinely mix `KICK.WAV` / `kick.WAV`
 * / `Kick.wav`, and demanding the chart's casing match the file's would scuttle a large fraction of legitimate drops on
 * case-sensitive filesystems (and in `webkitRelativePath` directory drops). The `lookupBytesCaseInsensitive` helper
 * builds a lazy lower-key index the first time it's called per source and caches it via WeakMap.
 */
export function resolveChartAsset(
  source: BrowserSongAssetSource,
  chartPath: string,
  assetPath: string,
): BrowserSongAssetEntry | undefined {
  // bmson 1.0.0 spec MUST: reject malicious paths at the chart-asset entry point. `lookupBytesCaseInsensitive` also
  // vets each candidate as defence-in-depth, but short-circuiting here means we don't even synthesise the joined
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
 * `.mp3` to save space. Mirrors the `packages/player` audio loader's "try the alternative codecs before giving up"
 * behaviour, with the order tweaked for the browser case:
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
  source: BrowserSongAssetSource,
  chartPath: string,
  assetPath: string,
  options: ResolveChartAudioAssetOptions = {},
): BrowserSongAssetEntry | undefined {
  for (const candidate of audioFallbackPaths(assetPath)) {
    // Try the `#PATH_WAV` prefixed form first when supplied; fall through to the bare name if the prefix-joined path
    // doesn't resolve. Charts that don't author `#PATH_WAV` pass `pathPrefix: undefined` and behave exactly as before.
    const prefixed = joinPathWavPrefix(options.pathPrefix, candidate);
    if (prefixed !== undefined) {
      const entry = resolveChartAsset(source, chartPath, prefixed);
      if (entry) return entry;
    }
    const entry = resolveChartAsset(source, chartPath, candidate);
    if (entry) {
      return entry;
    }
  }
  return undefined;
}

function joinPathWavPrefix(prefix: string | undefined, samplePath: string): string | undefined {
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
 * more often than as a real Windows bitmap. Mirrors {@link resolveChartAudioAsset}'s codec-walking behaviour, with the
 * order tuned for graphics:
 *
 * - 1. `.png` (lossless, broadly supported, the modern default) 2. `.jpg` / `.jpeg` (lossy, smaller — common for photo
 *   BGA) 3. `.gif` (legacy but still seen in older charts) 4. `.bmp` (the literal `#BMPxx` extension) 5. the original
 *   path verbatim — keeps video BGA references (`.mpg` / `.mp4` / `.webm` / …) and any exotic format not in the list
 *   above resolving correctly.
 *
 * Case is handled by `resolveChartAsset` itself (case-insensitive lookup), so this list doesn't need explicit
 * upper-case duplicates.
 */
export function resolveChartImageAsset(
  source: BrowserSongAssetSource,
  chartPath: string,
  assetPath: string,
): BrowserSongAssetEntry | undefined {
  for (const candidate of imageFallbackPaths(assetPath)) {
    const entry = resolveChartAsset(source, chartPath, candidate);
    if (entry) {
      return entry;
    }
  }
  return undefined;
}

function imageFallbackPaths(path: string): string[] {
  const lastSlash = path.lastIndexOf('/');
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex < lastSlash) {
    return [path];
  }
  // Don't walk image extensions when the chart explicitly declared a video BGA — `_scualee.mpg` paired with a same-
  // basename `_scualee.png` (cover art / static fallback frame shipped alongside the actual video) would otherwise have
  // the resolver pick the PNG. The BGA loader only checks the declared path's extension to decide between the image vs.
  // video pipeline, so feeding PNG bytes through the video path makes ffmpeg.wasm pick `png_pipe` and emit a 1-frame
  // MP4 — visually a frozen still during gameplay. Returning just the original path here keeps the video reference
  // resolving to its own file.
  if (isVideoExtensionPath(path)) {
    return [path];
  }
  const base = path.slice(0, dotIndex);
  const candidates = [`${base}.png`, `${base}.jpg`, `${base}.jpeg`, `${base}.gif`, `${base}.bmp`];
  if (!candidates.includes(path)) {
    candidates.push(path);
  }
  return candidates;
}

/**
 * Local copy of `isVideoExtension` from `pixi-gameplay-bga`. Pulled inline rather than imported so `library.ts` (the
 * data-layer entry point) doesn't take a dependency on the Pixi-side BGA helpers; the patterns are tiny and trivially
 * kept in sync.
 */
function isVideoExtensionPath(path: string): boolean {
  return /\.(mpg|mpeg|mp4|m4v|avi|mov|wmv|webm|mkv)$/iu.test(path);
}

/**
 * Groups a flat song list into top-level folders for the select-screen bar list. The grouping key is the **first
 * segment** of each song's `directoryLabel` (relative to its source) — so a song at `LunaticCrave/SongA/song.bms` lands
 * in the `LunaticCrave` folder. Songs without a directory (e.g. dropped a single file) fall back to their source label
 * so they still appear under a sensible group.
 *
 * The result is sorted by label using Japanese-aware locale ordering, matching how LR2 sorts folders alphabetically.
 * Each folder's songs preserve their original order, which keeps the chart-difficulty sequence stable when iterating
 * inside a folder.
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
