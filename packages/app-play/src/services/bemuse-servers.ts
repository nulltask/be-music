// Loading a Bemuse music server into the library. The server's songs become a dropped folder tree
// (`<server>/<song>/<file>`) of deferred files, which the library reads only when it needs them: a packed sound file is
// cut out of the `*.bemuse` chunk that holds it when a play opens it, and a file the song serves outside its package
// (Bemuse's `fallbackPattern`, or every file of a song with `bemusepack_url: null`) is fetched from the song folder.
// Listing a server fetches its index, each song's asset index and its chart files (kept between visits, checked against
// the index's MD5), so the sound data downloads song by song as songs are played.
import { DeferredDroppedFile, type BrowserDroppedFile } from '@be-music/player-browser/collection';
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
import { createBemuseFetcher, createCacheStorageChartCache, type BemuseFetcher, type Fetch } from './bemuse-fetch.ts';

/** A song of a server as the library lists it: its folder, its files and its extras. */
export interface BemuseServerSong {
  /** The song folder's path in the library, without a trailing `/`. */
  folder: string;
  /** The song's file paths, lower-cased and relative to {@link folder}. */
  files: ReadonlySet<string>;
  extras: BemuseSongExtras;
}

/** What reading a server gave: the folder tree, the songs and the songs it had to leave out. */
export interface BemuseServerFiles {
  /** The folder the server's songs sit in, as the select screen names it. */
  folder: string;
  files: BrowserDroppedFile[];
  songs: BemuseServerSong[];
  skipped: Array<{ track: string; reason: string }>;
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

/** Chunk payloads by URL, most recently used last; a failed fetch is forgotten so the next read tries again. */
class ChunkCache {
  private readonly payloads = new Map<string, Promise<Uint8Array>>();
  private readonly fetcher: BemuseFetcher;

  constructor(fetcher: BemuseFetcher) {
    this.fetcher = fetcher;
  }

  payload(url: string): Promise<Uint8Array> {
    const cached = this.payloads.get(url);
    if (cached !== undefined) {
      this.payloads.delete(url);
      this.payloads.set(url, cached);
      return cached;
    }
    const pending = this.fetcher.bytes(url).then(bemusePackPayload);
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

interface SongContext {
  track: BemuseServerTrack;
  folder: string;
  fetcher: BemuseFetcher;
  chunks: ChunkCache;
}

async function readSong({ track, folder, fetcher, chunks }: SongContext): Promise<{
  files: BrowserDroppedFile[];
  song: BemuseServerSong;
}> {
  const assets: BemuseAssetIndex | undefined =
    track.assetIndexURL === undefined
      ? undefined
      : parseBemuseAssetIndex(await fetcher.json(track.assetIndexURL), track.assetIndexURL);
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
      bytes: await fetcher.chart(new URL(chart.file, track.baseURL).href, chart.md5),
    })),
  );
  for (const { chart, bytes } of chartBytes) {
    list.add(songRelativePath(chart.file), (relativePath) => new RemoteFile(relativePath, async () => bytes));
  }
  for (const file of assets?.files ?? []) {
    const chunkURL = assets!.chunkURLs[file.chunk]!;
    list.add(
      songRelativePath(file.name),
      (relativePath) =>
        new RemoteFile(relativePath, async () => extractBemuseAssetFile(await chunks.payload(chunkURL), file)),
    );
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
  if (track.preview !== undefined && (!track.preview.isDefault || (await fetcher.exists(track.preview.url)))) {
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
export async function readBemuseServerFiles(
  indexURL: string,
  options: { fetch?: Fetch; pageHref?: string; useChartCache?: boolean } = {},
): Promise<BemuseServerFiles> {
  const fetcher = createBemuseFetcher({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.pageHref ? { pageHref: options.pageHref } : {}),
    ...(options.useChartCache === false ? {} : { chartCache: createCacheStorageChartCache() }),
  });
  const index = parseBemuseServerIndex(await fetcher.json(indexURL), indexURL);
  const root = `Bemuse ${pathSegment(bemuseServerLabel(indexURL))}`;
  const chunks = new ChunkCache(fetcher);
  const usedFolders = new Set<string>();
  const folders = index.tracks.map((track) => {
    let name = songFolderName(track);
    for (let suffix = 2; usedFolders.has(name.toLowerCase()); suffix++) name = `${songFolderName(track)} (${suffix})`;
    usedFolders.add(name.toLowerCase());
    return `${root}/${name}`;
  });
  const read: Array<{ files: BrowserDroppedFile[]; song: BemuseServerSong } | undefined> = [];
  const skipped: BemuseServerFiles['skipped'] = [];
  await runWithConcurrency(index.tracks, SONG_CONCURRENCY, async (track, trackIndex) => {
    try {
      read[trackIndex] = await readSong({ track, folder: folders[trackIndex]!, fetcher, chunks });
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
  };
}
