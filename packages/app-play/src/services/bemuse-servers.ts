// Loading a Bemuse music server into the library. The server's songs become a dropped folder tree
// (`<server>/<song>/<file>`) of deferred files, which the library reads only when it needs them: a packed sound file is
// cut out of the `*.bemuse` chunk that holds it when a play opens it, and a file the song serves outside its package
// (Bemuse's `fallbackPattern`, or every file of a song with `bemusepack_url: null`) is fetched from the song folder.
// Listing a server fetches its index, each song's asset index and its chart files, so the sound data downloads song by
// song as songs are played.
//
// Everything is kept between visits so that a server is asked for as little as can be (docs/player-web.md, "Bemuse
// music servers"): the index for a day, or until the player reloads the folders; a song's asset index, its charts and
// whether its default preview exists for as long as the index lists the song the same way (a chart's `md5` is part of
// that, and a chart whose bytes do not have it is still kept); and the chunks for good, since a chunk's name carries
// its payload's hash, until they pass their share of the disk.
import { DeferredDroppedFile, md5HexOfBytes, type BrowserDroppedFile } from '@be-music/player-browser/collection';
import { runWithConcurrency } from '@be-music/shared-utils/core';
import {
  BEMUSE_UNPACKED_FILE_PATTERN,
  bemusePackPayload,
  bemuseReplayGainLinear,
  bemuseServerLabel,
  bemuseSoundFileCandidates,
  extractBemuseAssetFile,
  parseBemuseAssetIndex,
  parseBemuseServerIndex,
  scanChartFileReferences,
  type BemuseAssetIndex,
  type BemuseServerTrack,
} from '../bemuse-server.ts';
import { BEMUSE_EXTRAS_FOLDER, type BemuseSongExtras } from '../bemuse-song-extras.ts';
import { createBemuseFetcher, type BemuseFetcher, type Fetch } from './bemuse-fetch.ts';
import { pageBemuseChunkStore, type BemuseChunkStore } from './bemuse-chunk-store.ts';
import {
  BEMUSE_INDEX_MAX_AGE_MS,
  BEMUSE_MISSING_PREVIEW_MAX_AGE_MS,
  isRemoteCacheEntryFresh,
  pageRemoteCacheStore,
  readThroughRemoteCache,
  type RemoteCachePolicy,
  type RemoteCacheSource,
  type RemoteCacheStore,
} from './remote-cache.ts';

/** A song of a server as the library lists it: its folder, its files and its extras. */
export interface BemuseServerSong {
  /** The song folder's path in the library, without a trailing `/`. */
  folder: string;
  /** The song's file paths, lower-cased and relative to {@link folder}. */
  files: ReadonlySet<string>;
  extras: BemuseSongExtras;
}

interface IndexedBemuseSong {
  track: BemuseServerTrack;
  folder: string;
  paths: string[];
  extras: BemuseSongExtras;
}

export interface BemuseLibraryIndex {
  songs: IndexedBemuseSong[];
  chartKeys: Array<[string, string]>;
}

/** What reading a server gave: the folder tree, the songs and the songs it had to leave out. */
export interface BemuseServerFiles {
  /** The folder the server's songs sit in, as the select screen names it. */
  folder: string;
  files: BrowserDroppedFile[];
  songs: BemuseServerSong[];
  skipped: Array<{ track: string; reason: string }>;
  /** Where the index came from: kept, fetched, or kept because the fetch failed. */
  indexSource: RemoteCacheSource;
  indexedSongs: IndexedBemuseSong[];
  unchanged?: true;
}

/** How {@link readBemuseServerFiles} reads. */
export interface BemuseServerReadOptions {
  fetch?: Fetch;
  pageHref?: string;
  /** Off, nothing is kept between visits (tests); on by default. Explicit stores below win over it. */
  useCaches?: boolean;
  /** Where the index, the asset indexes and the charts without an MD5 are kept. */
  remoteStore?: RemoteCacheStore;
  /** Where the chunks are kept. */
  chunkStore?: BemuseChunkStore;
  /** An index fetched before this time is asked for again: the player reloaded the folders then. */
  refreshedSince?: number;
  /** An already displayed server listing. Skip re-reading song files when its tracks still match. */
  displayedIndex?: BemuseLibraryIndex;
  now?: () => number;
}

/**
 * Chunks held at once (each about 1.4 MB). A play reads all of a song's sound files as it starts, so the chunks of the
 * song last played stay at hand, and only those of songs played before it are fetched again.
 */
const CHUNK_CACHE_LIMIT = 32;
const SONG_CONCURRENCY = 8;

/** A path segment without the characters the loader reads as separators. */
function pathSegment(name: string): string {
  const cleaned = name
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned : '_';
}

function songFolderName(track: BemuseServerTrack): string {
  const last = new URL(track.baseURL).pathname.split('/').filter(Boolean).at(-1);
  if (last === undefined) return pathSegment(track.id);
  try {
    return pathSegment(decodeURIComponent(last));
  } catch {
    return pathSegment(last);
  }
}

/** A relative path inside the song folder, with `\` read as `/` and `.` / `..` / empty segments dropped. */
function songRelativePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
}

function extensionOf(url: string, fallback: string): string {
  const match = /\.[A-Za-z0-9]{1,5}$/.exec(new URL(url).pathname);
  return match ? match[0].toLowerCase() : fallback;
}

/**
 * A file read when the library opens it. Unlike a dropped file's handle it keeps nothing: for a song on disk the kept
 * object is a reference to the file, here it would be the data itself, kept for every song played.
 */
class RemoteFile extends DeferredDroppedFile {
  private readonly read: () => Promise<Uint8Array>;

  constructor(relativePath: string, read: () => Promise<Uint8Array>) {
    const name = relativePath.split('/').at(-1) ?? relativePath;
    super({ name, file: () => undefined }, relativePath);
    this.read = read;
  }

  override async getFile(): Promise<File> {
    return new File([new Uint8Array(await this.read())], this.name);
  }
}

/** Reads the first of `urls` that answers, in order; fails with the last failure. */
async function firstAvailable(fetcher: BemuseFetcher, urls: readonly string[]): Promise<Uint8Array> {
  let lastError: unknown = new Error('no URL to read');
  for (const url of urls) {
    try {
      return await fetcher.bytes(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Chunk payloads by URL, most recently used last; a failed fetch is forgotten so the next read tries again. Under the
 * payloads held in memory, the chunks are kept on disk: one is stored only when the asset index gives its hash and the
 * payload has it, since only then does its URL name those bytes for good.
 */
class ChunkCache {
  private readonly payloads = new Map<string, Promise<Uint8Array>>();
  private readonly fetcher: BemuseFetcher;
  private readonly store: BemuseChunkStore | undefined;

  constructor(fetcher: BemuseFetcher, store: BemuseChunkStore | undefined) {
    this.fetcher = fetcher;
    this.store = store;
  }

  private async load(url: string, hash: string | undefined): Promise<Uint8Array> {
    if (hash !== undefined) {
      const kept = await this.store?.get(url).catch(() => undefined);
      if (kept !== undefined) {
        try {
          return bemusePackPayload(kept);
        } catch {
          // A broken copy: fetched again below, and stored over it.
        }
      }
    }
    const bytes = await this.fetcher.bytes(url);
    const payload = bemusePackPayload(bytes);
    if (hash !== undefined && this.store !== undefined && md5HexOfBytes(payload) === hash) {
      await this.store.put(url, bytes).catch(() => undefined);
    }
    return payload;
  }

  payload(url: string, hash?: string): Promise<Uint8Array> {
    const cached = this.payloads.get(url);
    if (cached !== undefined) {
      this.payloads.delete(url);
      this.payloads.set(url, cached);
      return cached;
    }
    const pending = this.load(url, hash);
    pending.catch(() => {
      if (this.payloads.get(url) === pending) this.payloads.delete(url);
    });
    this.payloads.set(url, pending);
    while (this.payloads.size > CHUNK_CACHE_LIMIT) {
      const oldest = this.payloads.keys().next().value;
      if (oldest === undefined) break;
      this.payloads.delete(oldest);
    }
    return pending;
  }
}

/** Collects a song's files, each path once (compared without case, as the library looks files up). */
class SongFileList {
  readonly files: BrowserDroppedFile[] = [];
  readonly paths = new Set<string>();
  private readonly folder: string;

  constructor(folder: string) {
    this.folder = folder;
  }

  has(path: string): boolean {
    return this.paths.has(path.toLowerCase());
  }

  add(path: string, file: (relativePath: string) => BrowserDroppedFile): void {
    if (path.length === 0 || this.has(path)) return;
    this.paths.add(path.toLowerCase());
    this.files.push(file(`${this.folder}/${path}`));
  }
}

/** Reads a file through the kept copies: `key` names it, `policy` says when the kept copy serves. */
type CachedRead = (key: string, policy: RemoteCachePolicy) => Promise<{ bytes: Uint8Array; source: RemoteCacheSource }>;

interface SongContext {
  track: BemuseServerTrack;
  folder: string;
  fetcher: BemuseFetcher;
  chunks: ChunkCache;
  cached: CachedRead;
  remoteStore: RemoteCacheStore | undefined;
  now: () => number;
}

function decodeJSON(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * What the index says about a song, as one version: a song's kept asset index, charts and preview check serve while
 * the index lists the song the same way.
 */
function trackVersion(track: BemuseServerTrack): string {
  return md5HexOfBytes(new TextEncoder().encode(JSON.stringify(track)));
}

/**
 * Whether the song's default preview (`_bemuse_preview.mp3`, which a song may lack) exists. The answer is kept with the
 * song: a preview found stays found while the index lists the song the same way, and one missing is asked about again
 * after {@link BEMUSE_MISSING_PREVIEW_MAX_AGE_MS}.
 */
async function defaultPreviewExists(
  url: string,
  version: string,
  { fetcher, remoteStore, now }: Pick<SongContext, 'fetcher' | 'remoteStore' | 'now'>,
): Promise<boolean> {
  const key = `exists:${url}`;
  const kept = await remoteStore?.get(key).catch(() => undefined);
  if (kept !== undefined && kept.version === version) {
    const found = kept.bytes[0] === 1;
    if (found || isRemoteCacheEntryFresh(kept, { maxAgeMs: BEMUSE_MISSING_PREVIEW_MAX_AGE_MS, version }, now())) {
      return found;
    }
  }
  const exists = await fetcher.exists(url);
  await remoteStore
    ?.put(key, { bytes: Uint8Array.of(exists ? 1 : 0), fetchedAt: now(), version })
    .catch(() => undefined);
  return exists;
}

async function readSong({ track, folder, fetcher, chunks, cached, remoteStore, now }: SongContext): Promise<{
  files: BrowserDroppedFile[];
  song: BemuseServerSong;
}> {
  const version = trackVersion(track);
  const assetIndexURL = track.assetIndexURL;
  const readAssets = async (refreshedSince?: number) => {
    if (assetIndexURL === undefined) return undefined;
    const read = await cached(assetIndexURL, {
      maxAgeMs: Infinity,
      version,
      ...(refreshedSince !== undefined ? { refreshedSince } : {}),
    });
    return { index: parseBemuseAssetIndex(decodeJSON(read.bytes), assetIndexURL), source: read.source };
  };
  const firstAssets = await readAssets();
  const assets: BemuseAssetIndex | undefined = firstAssets?.index;
  // A song repacked while the index lists it the same way leaves the kept asset index naming chunks the server no
  // longer has. The first packed file that cannot be read then asks for the asset index again, once, and reads from it.
  let current = assets;
  let renewed: Promise<BemuseAssetIndex | undefined> | undefined;
  const readPacked = async (name: string): Promise<Uint8Array> => {
    const from = async (index: BemuseAssetIndex) => {
      const lower = name.toLowerCase();
      const file = index.files.find((entry) => songRelativePath(entry.name).toLowerCase() === lower);
      if (file === undefined) throw new Error(`${name} is not in the song's package`);
      return extractBemuseAssetFile(
        await chunks.payload(index.chunkURLs[file.chunk]!, index.chunkHashes[file.chunk]),
        file,
      );
    };
    try {
      return await from(current!);
    } catch (error) {
      if (firstAssets?.source === 'network') throw error;
      renewed ??= readAssets(now()).then(
        (read) => (read?.source === 'network' ? read.index : undefined),
        () => undefined,
      );
      const index = await renewed;
      if (index === undefined) throw error;
      current = index;
      return from(index);
    }
  };
  const list = new SongFileList(folder);
  const fromSongFolder = (path: string, candidates: readonly string[]) =>
    list.add(
      path,
      (relativePath) =>
        new RemoteFile(relativePath, () =>
          firstAvailable(
            fetcher,
            candidates.map((name) => new URL(name, track.baseURL).href),
          ),
        ),
    );

  const chartBytes = await Promise.all(
    track.charts.map(async (chart) => ({
      chart,
      bytes: (await cached(new URL(chart.file, track.baseURL).href, { maxAgeMs: Infinity, version })).bytes,
    })),
  );
  for (const { chart, bytes } of chartBytes) {
    list.add(songRelativePath(chart.file), (relativePath) => new RemoteFile(relativePath, async () => bytes));
  }
  for (const file of assets?.files ?? []) {
    const path = songRelativePath(file.name);
    list.add(path, (relativePath) => new RemoteFile(relativePath, () => readPacked(path)));
  }
  // What the charts name that the package does not hold. A packaged song serves images and videos beside it, as
  // Bemuse's `fallbackPattern` reads them; a song without a package serves every file, sounds under Bemuse's names.
  for (const { chart, bytes } of chartBytes) {
    const references = scanChartFileReferences(chart.file, bytes);
    const chartFolder = songRelativePath(chart.file).split('/').slice(0, -1).join('/');
    const inChartFolder = (name: string) => songRelativePath(chartFolder ? `${chartFolder}/${name}` : name);
    for (const name of references.images) {
      const path = inChartFolder(name);
      if (list.has(path)) continue;
      if (assets !== undefined && !BEMUSE_UNPACKED_FILE_PATTERN.test(name)) continue;
      fromSongFolder(path, [path]);
    }
    if (assets === undefined) {
      for (const name of references.sounds) {
        const path = inChartFolder(name);
        if (!list.has(path)) fromSongFolder(path, bemuseSoundFileCandidates(path));
      }
    }
  }

  const extras: BemuseSongExtras = { gain: bemuseReplayGainLinear(track.replayGainDb) };
  const addExtra = (kind: string, urls: readonly string[], fallbackExtension: string): string => {
    const path = `${BEMUSE_EXTRAS_FOLDER}/${kind}${extensionOf(urls[0]!, fallbackExtension)}`;
    list.add(path, (relativePath) => new RemoteFile(relativePath, () => firstAvailable(fetcher, urls)));
    return path;
  };
  if (
    track.preview !== undefined &&
    (!track.preview.isDefault ||
      (await defaultPreviewExists(track.preview.url, version, { fetcher, remoteStore, now })))
  ) {
    extras.previewPath = addExtra('preview', [track.preview.url], '.mp3');
  }
  if (track.video !== undefined) {
    extras.video = { path: addExtra('video', track.video.urls, '.webm'), offsetSeconds: track.video.offsetSeconds };
  }
  if (track.eyecatchImageURL !== undefined)
    extras.stageFilePath = addExtra('eyecatch', [track.eyecatchImageURL], '.png');
  if (track.backImageURL !== undefined) extras.backImagePath = addExtra('back', [track.backImageURL], '.png');
  return { files: list.files, song: { folder, files: list.paths, extras } };
}

/**
 * Reads the server at `indexURL` (an `index.json` or `bemuse-song.json` URL) into a folder tree the library loads as a
 * drop, with each song's extras to lay onto its charts once they are parsed (`applyBemuseSongExtras`). A song that
 * cannot be read is left out and reported in `skipped`.
 */
function bemuseReadContext(options: BemuseServerReadOptions): Omit<SongContext, 'folder' | 'track'> {
  const useCaches = options.useCaches !== false;
  const fetcher = createBemuseFetcher({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.pageHref ? { pageHref: options.pageHref } : {}),
  });
  const remoteStore = options.remoteStore ?? (useCaches ? pageRemoteCacheStore() : undefined);
  const chunkStore = options.chunkStore ?? (useCaches ? pageBemuseChunkStore() : undefined);
  const now = options.now ?? Date.now;
  // A file due for asking again goes to the server as a revalidation (`no-cache`): a server that sends validators
  // answers an unchanged file with a 304 and no body.
  const cached: CachedRead = (key, policy) =>
    readThroughRemoteCache(key, () => fetcher.bytes(key, { cache: 'no-cache' }), remoteStore, policy, now());
  return { fetcher, remoteStore, now, cached, chunks: new ChunkCache(fetcher, chunkStore) };
}

const libraryIndexKey = (url: string): string => `bemuse-library-v1:${url}`;

export async function readBemuseLibraryIndex(
  url: string,
  store = pageRemoteCacheStore(),
): Promise<BemuseLibraryIndex | undefined> {
  try {
    const entry = await store?.get(libraryIndexKey(url));
    if (entry === undefined) return undefined;
    const index = decodeJSON(entry.bytes) as Partial<BemuseLibraryIndex>;
    return Array.isArray(index.songs) && Array.isArray(index.chartKeys) ? (index as BemuseLibraryIndex) : undefined;
  } catch {
    return undefined;
  }
}

export async function keepBemuseLibraryIndex(
  url: string,
  index: BemuseLibraryIndex,
  store = pageRemoteCacheStore(),
): Promise<void> {
  await store?.put(libraryIndexKey(url), {
    bytes: new TextEncoder().encode(JSON.stringify(index)),
    fetchedAt: Date.now(),
  });
}

/** Rebuilds the last file inventory. The first read of a song connects its files to the usual Bemuse readers. */
export function openBemuseLibraryIndex(
  index: BemuseLibraryIndex,
  options: BemuseServerReadOptions = {},
): Pick<BemuseServerFiles, 'files' | 'songs'> {
  const context = bemuseReadContext(options);
  const files: BrowserDroppedFile[] = [];
  const songs: BemuseServerSong[] = [];
  for (const { track, folder, paths, extras } of index.songs) {
    let pending: Promise<Map<string, BrowserDroppedFile>> | undefined;
    const songFiles = async () => {
      pending ??= readSong({ ...context, track, folder }).then(
        (song) => new Map(song.files.map((file) => [file.webkitRelativePath, file])),
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      );
      return pending;
    };
    for (const path of paths) {
      const relativePath = `${folder}/${path}`;
      files.push(
        new RemoteFile(relativePath, async () => {
          const file = (await songFiles()).get(relativePath);
          if (file === undefined) throw new Error(`Missing Bemuse file ${relativePath}`);
          return new Uint8Array(await file.arrayBuffer());
        }),
      );
    }
    songs.push({ folder, files: new Set(paths.map((path) => path.toLowerCase())), extras });
  }
  return { files, songs };
}

export async function readBemuseServerFiles(
  indexURL: string,
  options: BemuseServerReadOptions = {},
): Promise<BemuseServerFiles> {
  const context = bemuseReadContext(options);
  const { cached } = context;
  const indexRead = await cached(indexURL, {
    maxAgeMs: BEMUSE_INDEX_MAX_AGE_MS,
    ...(options.refreshedSince !== undefined ? { refreshedSince: options.refreshedSince } : {}),
  });
  const index = parseBemuseServerIndex(decodeJSON(indexRead.bytes), indexURL);
  const root = `Bemuse ${pathSegment(bemuseServerLabel(indexURL))}`;
  const displayed = options.displayedIndex?.songs;
  if (
    displayed !== undefined &&
    (indexRead.source === 'stale' ||
      (displayed.length === index.tracks.length &&
        index.tracks.every((track, index) => JSON.stringify(track) === JSON.stringify(displayed[index]!.track))))
  ) {
    return {
      folder: root,
      files: [],
      songs: [],
      skipped: [],
      indexedSongs: [],
      indexSource: indexRead.source,
      unchanged: true,
    };
  }
  const usedFolders = new Set<string>();
  const folders = index.tracks.map((track) => {
    let name = songFolderName(track);
    for (let suffix = 2; usedFolders.has(name.toLowerCase()); suffix++) name = `${songFolderName(track)} (${suffix})`;
    usedFolders.add(name.toLowerCase());
    return `${root}/${name}`;
  });
  const read: Array<{ files: BrowserDroppedFile[]; song: BemuseServerSong; track: BemuseServerTrack } | undefined> = [];
  const skipped: BemuseServerFiles['skipped'] = [];
  await runWithConcurrency(index.tracks, SONG_CONCURRENCY, async (track, trackIndex) => {
    try {
      const listed = await readSong({ ...context, track, folder: folders[trackIndex]! });
      read[trackIndex] = { ...listed, track };
    } catch (error) {
      skipped.push({ track: track.title || track.id, reason: error instanceof Error ? error.message : String(error) });
    }
  });
  const songs = read.filter((entry) => entry !== undefined);
  return {
    folder: root,
    files: songs.flatMap((entry) => entry.files),
    songs: songs.map((entry) => entry.song),
    skipped,
    indexSource: indexRead.source,
    indexedSongs: songs.map(({ track, song, files }) => ({
      track,
      folder: song.folder,
      paths: files.map((file) => file.webkitRelativePath.slice(song.folder.length + 1)),
      extras: song.extras,
    })),
  };
}
