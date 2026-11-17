// Reading a Bemuse music server: its index (`index.json`, or a single-song `bemuse-song.json`), each song's asset index
// (`assets/metadata.json`) and the `*.bemuse` chunks the asset index points into. The formats and the rules below follow
// Bemuse's own loader (docs/bemuse-spec.md). Everything here is pure; the fetching lives in `services/bemuse-servers.ts`.
import { decodeBMSText } from '@be-music/chart-parser';
import { PLAYER_STORAGE_PREFIX } from './player-storage.ts';

/** `localStorage` key of the registered Bemuse music server URLs, loaded again each time the player opens. */
export const BEMUSE_SERVER_URLS_STORAGE_KEY = `${PLAYER_STORAGE_PREFIX}bemuse-server-urls`;

/** A chart of a song, with the MD5 the index lists for its file (when it lists one). */
export interface BemuseServerChart {
  /** The chart file (`charts[].file`), relative to the song folder. */
  file: string;
  md5: string | undefined;
}

/** The video Bemuse plays behind a song: the URLs it tries in order, and when in the song it starts. */
export interface BemuseServerVideo {
  urls: string[];
  /** `video_offset`: the chart second the video starts at. */
  offsetSeconds: number;
}

/** One song a Bemuse music server lists, with the URLs Be-Music reads it from. */
export interface BemuseServerTrack {
  /** The song's `id`, or its folder name when the index has none. */
  id: string;
  title: string;
  artist: string;
  /** The song folder, ending in `/`: chart files resolve against it. */
  baseURL: string;
  charts: BemuseServerChart[];
  /**
   * The song's asset index (`bemusepack_url`, `assets/metadata.json` when the song names none), or `undefined` when the
   * song sets `bemusepack_url: null` and serves its sound files directly.
   */
  assetIndexURL: string | undefined;
  /** The preview audio (`preview_url`), and whether it is Bemuse's default `_bemuse_preview.mp3` the song may lack. */
  preview: { url: string; isDefault: boolean } | undefined;
  video: BemuseServerVideo | undefined;
  /** `eyecatch_image_url`: shown while the song loads. */
  eyecatchImageURL: string | undefined;
  /** `back_image_url`: shown behind the play. */
  backImageURL: string | undefined;
  /** `replaygain` in dB, when it is in Bemuse's `"<number> dB"` form. */
  replayGainDb: number | undefined;
}

/** A Bemuse music server's index, as Be-Music reads it. */
export interface BemuseServerIndex {
  indexURL: string;
  tracks: BemuseServerTrack[];
}

/** An entry of `assets/metadata.json`: the file `name` lives in `refs[chunk]` between payload bytes `start` and `end`. */
export interface BemuseAssetFile {
  name: string;
  chunk: number;
  start: number;
  end: number;
}

/** `assets/metadata.json`: the packed files, and the chunk files (`*.bemuse`) as URLs. */
export interface BemuseAssetIndex {
  files: BemuseAssetFile[];
  chunkURLs: string[];
  /** Each chunk's `refs[].hash` (the MD5 of its payload, lower-cased), where the index gives one. */
  chunkHashes: (string | undefined)[];
}

const BEMUSEPACK_MAGIC = 'BEMUSEPACK';
const BEMUSEPACK_HEADER_BYTES = 14;

/**
 * The URL of a server's index file, as Bemuse resolves a `?server=` value: a URL ending in `/bemuse-song.json` is a
 * single-song server and is read as it is; any other names the server folder, whose `index.json` is read (a trailing
 * `/` or `/index.json` is accepted). `undefined` for a value that is not an absolute http(s) URL.
 */
export function bemuseServerIndexURL(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  url.hash = '';
  if (url.pathname.endsWith('/bemuse-song.json')) return url.href;
  url.pathname = `${url.pathname.replace(/\/(?:index\.json)?$/, '')}/index.json`;
  return url.href;
}

/** A short name for a server: its host and folder, without the index file name. */
export function bemuseServerLabel(indexURL: string): string {
  try {
    const url = new URL(indexURL);
    const folder = url.pathname.replace(/\/(?:index|bemuse-song)\.json$/, '').replace(/\/$/, '');
    return `${url.host}${folder}`;
  } catch {
    return indexURL;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function folderURL(path: string, base: string): string {
  return new URL(path.replace(/\/?$/, '/'), base).href;
}

function lastPathSegment(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  const last = segments.at(-1) ?? 'song';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function optionalURL(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    return new URL(value, base).href;
  } catch {
    return undefined;
  }
}

/** Bemuse plays `preview_url`, or `_bemuse_preview.mp3` in the song folder; a tutorial has no preview. */
function songPreview(song: Record<string, unknown>, baseURL: string): BemuseServerTrack['preview'] {
  if (song['tutorial']) return undefined;
  const explicit = optionalURL(song['preview_url'], baseURL);
  if (explicit !== undefined) return { url: explicit, isDefault: false };
  return { url: new URL('_bemuse_preview.mp3', baseURL).href, isDefault: true };
}

/**
 * The video Bemuse plays behind a song (`findVideoUrl`): `video_url` as it is, else `video_file` from the song folder,
 * a `.webm` before the same name as `.mp4`, any other extension as `.mp4` and then `.webm`.
 */
function songVideo(song: Record<string, unknown>, baseURL: string): BemuseServerVideo | undefined {
  const offset = Number(song['video_offset'] ?? 0);
  const offsetSeconds = Number.isFinite(offset) ? offset : 0;
  const url = optionalURL(song['video_url'], baseURL);
  if (url !== undefined) return { urls: [url], offsetSeconds };
  const file = song['video_file'];
  if (typeof file !== 'string' || file.length === 0) return undefined;
  const extension = /\.\w+$/;
  let names: string[];
  if (/\.webm$/i.test(file)) names = [file, file.replace(extension, '.mp4')];
  else if (extension.test(file)) names = [file.replace(extension, '.mp4'), file.replace(extension, '.webm')];
  else return undefined;
  const urls = names.map((name) => optionalURL(name, baseURL)).filter((value): value is string => value !== undefined);
  return urls.length > 0 ? { urls, offsetSeconds } : undefined;
}

/** `replaygain` in dB, read as Bemuse reads it: only the `"<number> dB"` form counts. */
export function parseBemuseReplayGain(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\S+\s+dB$/.test(value)) return undefined;
  const gain = Number.parseFloat(value);
  return Number.isFinite(gain) ? gain : undefined;
}

/** The ReplayGain Bemuse assumes for a song without one (`DEFAULT_REPLAYGAIN` in its game launcher), in dB. */
export const BEMUSE_DEFAULT_REPLAYGAIN_DB = -12.2;

/**
 * The linear gain Bemuse plays a song's sounds at for its ReplayGain, before the player's own volume:
 * `10 ^ ((gain + 4) / 20)`, with {@link BEMUSE_DEFAULT_REPLAYGAIN_DB} for a song without one.
 */
export function bemuseReplayGainLinear(gainDb: number | undefined): number {
  return 10 ** (((gainDb ?? BEMUSE_DEFAULT_REPLAYGAIN_DB) + 4) / 20);
}

/**
 * The names Bemuse tries for a sound a chart names, when the song serves real files (`SamplesLoader`): the name as
 * `.ogg`, `.m4a`, `.flac` and `.mp3`, then as written.
 */
export function bemuseSoundFileCandidates(name: string): string[] {
  const path = name.replaceAll('\\', '/');
  const extension = /\.\w+$/;
  const candidates = ['.ogg', '.m4a', '.flac', '.mp3'].map((ext) => path.replace(extension, ext));
  return [...new Set([...candidates, path])];
}

/**
 * Bemuse's `fallbackPattern`: a file a packaged song does not pack is read from the song folder only when its name
 * matches this (images and videos). Unanchored and case-sensitive, as in Bemuse.
 */
export const BEMUSE_UNPACKED_FILE_PATTERN = /\.(?:png|jpg|webm|mp4|m4v)/;

/**
 * Reads a server index. An object with a `songs` array is a music server; one with a `charts` array is a single song
 * (`bemuse-song.json`) whose folder is the index's own folder. A song's `path` resolves against the server folder, as
 * Bemuse resolves it; songs without a usable `path` or chart file are skipped. Throws when `json` is neither.
 */
export function parseBemuseServerIndex(json: unknown, indexURL: string): BemuseServerIndex {
  const root = asRecord(json);
  const serverFolder = new URL('./', indexURL).href;
  let songs: unknown[];
  if (Array.isArray(root?.['songs'])) {
    songs = root['songs'];
  } else if (root !== undefined && Array.isArray(root['charts'])) {
    songs = [{ ...root, id: 'song', path: serverFolder }];
  } else {
    throw new Error(`${indexURL} is not a Bemuse music server: it has no "songs" array`);
  }
  const tracks: BemuseServerTrack[] = [];
  for (const value of songs) {
    const song = asRecord(value);
    if (song === undefined || typeof song['path'] !== 'string' || song['path'].length === 0) continue;
    let baseURL: string;
    try {
      baseURL = folderURL(song['path'], serverFolder);
    } catch {
      continue;
    }
    const charts: BemuseServerChart[] = [];
    for (const entry of Array.isArray(song['charts']) ? song['charts'] : []) {
      const chart = asRecord(entry);
      const file = chart?.['file'];
      if (typeof file !== 'string' || file.length === 0 || charts.some((known) => known.file === file)) continue;
      const md5 = chart?.['md5'];
      charts.push({
        file,
        md5: typeof md5 === 'string' && /^[0-9a-f]{32}$/i.test(md5) ? md5.toLowerCase() : undefined,
      });
    }
    if (charts.length === 0) continue;
    const pack = song['bemusepack_url'];
    let assetIndexURL: string | undefined;
    try {
      assetIndexURL =
        pack === null ? undefined : new URL(typeof pack === 'string' ? pack : 'assets/metadata.json', baseURL).href;
    } catch {
      continue;
    }
    tracks.push({
      id: typeof song['id'] === 'string' && song['id'].length > 0 ? song['id'] : lastPathSegment(baseURL),
      title: typeof song['title'] === 'string' ? song['title'] : '',
      artist: typeof song['artist'] === 'string' ? song['artist'] : '',
      baseURL,
      charts,
      assetIndexURL,
      preview: songPreview(song, baseURL),
      video: songVideo(song, baseURL),
      eyecatchImageURL: optionalURL(song['eyecatch_image_url'], baseURL),
      backImageURL: optionalURL(song['back_image_url'], baseURL),
      replayGainDb: parseBemuseReplayGain(song['replaygain']),
    });
  }
  return { indexURL, tracks };
}

/**
 * Reads `assets/metadata.json`. `refs[].path` resolves against the asset index's own folder; an entry whose `ref` is not
 * three non-negative integers with `start <= end` and a chunk that exists is an error, as a broken package.
 */
export function parseBemuseAssetIndex(json: unknown, assetIndexURL: string): BemuseAssetIndex {
  const root = asRecord(json);
  if (root === undefined || !Array.isArray(root['files']) || !Array.isArray(root['refs'])) {
    throw new Error(`${assetIndexURL} is not a Bemuse asset index: it needs "files" and "refs" arrays`);
  }
  const chunkURLs = root['refs'].map((value, index) => {
    const path = asRecord(value)?.['path'];
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error(`${assetIndexURL}: refs[${index}] has no path`);
    }
    return new URL(path, assetIndexURL).href;
  });
  const chunkHashes = root['refs'].map((value) => {
    const hash = asRecord(value)?.['hash'];
    return typeof hash === 'string' && /^[0-9a-f]{32}$/i.test(hash) ? hash.toLowerCase() : undefined;
  });
  const files = root['files'].map((value, index): BemuseAssetFile => {
    const file = asRecord(value);
    const name = file?.['name'];
    const ref = file?.['ref'];
    if (typeof name !== 'string' || name.length === 0 || !Array.isArray(ref) || ref.length !== 3) {
      throw new Error(`${assetIndexURL}: files[${index}] needs a name and a [chunk, start, end] ref`);
    }
    const [chunk, start, end] = ref as unknown[];
    const valid = [chunk, start, end].every((part) => Number.isSafeInteger(part) && (part as number) >= 0);
    if (!valid || (start as number) > (end as number) || (chunk as number) >= chunkURLs.length) {
      throw new Error(`${assetIndexURL}: files[${index}] (${name}) has an invalid ref`);
    }
    return { name, chunk: chunk as number, start: start as number, end: end as number };
  });
  return { files, chunkURLs, chunkHashes };
}

/**
 * The payload of a `*.bemuse` chunk: the bytes after the `BEMUSEPACK` magic, the `UInt32LE` metadata length and the
 * metadata block. Throws on a chunk without the magic or one too short for its header.
 */
export function bemusePackPayload(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < BEMUSEPACK_HEADER_BYTES) {
    throw new Error('Bemuse chunk is too short for its header');
  }
  const magic = String.fromCharCode(...bytes.subarray(0, BEMUSEPACK_MAGIC.length));
  if (magic !== BEMUSEPACK_MAGIC) {
    throw new Error('Bemuse chunk does not start with BEMUSEPACK');
  }
  const metadataLength = new DataView(bytes.buffer, bytes.byteOffset + 10, 4).getUint32(0, true);
  const payloadOffset = BEMUSEPACK_HEADER_BYTES + metadataLength;
  if (payloadOffset > bytes.byteLength) {
    throw new Error('Bemuse chunk metadata runs past its end');
  }
  return bytes.subarray(payloadOffset);
}

/** The bytes of `file` out of its chunk's payload; throws when the range runs past the payload. */
export function extractBemuseAssetFile(payload: Uint8Array, file: BemuseAssetFile): Uint8Array {
  if (file.end > payload.byteLength) {
    throw new Error(`${file.name} runs past the end of its Bemuse chunk`);
  }
  return payload.subarray(file.start, file.end);
}

/** The files a chart names: sounds (and its preview audio) and images or videos. */
export interface ChartFileReferences {
  sounds: string[];
  images: string[];
}

const BMS_SOUND_HEADER = /^\s*#(?:WAV[0-9A-Za-z]{2}|PREVIEW)[ \t]+(.+?)\s*$/i;
const BMS_IMAGE_HEADER = /^\s*#(?:BMP[0-9A-Za-z]{2}|STAGEFILE|BANNER|BACKBMP)[ \t]+(.+?)\s*$/i;

/**
 * The files a chart file names, read from its text without parsing it: a BMS chart's `#WAVxx` / `#PREVIEW` and `#BMPxx`
 * / `#STAGEFILE` / `#BANNER` / `#BACKBMP` lines (in every `#RANDOM` branch), a bmson chart's sound channels, preview
 * music and images. Used to list the files a song serves outside its package, which the server cannot list.
 */
export function scanChartFileReferences(path: string, bytes: Uint8Array): ChartFileReferences {
  const sounds = new Set<string>();
  const images = new Set<string>();
  if (/\.bmson$/i.test(path)) {
    let json: Record<string, unknown> | undefined;
    try {
      json = asRecord(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      json = undefined;
    }
    const addName = (target: Set<string>, value: unknown) => {
      if (typeof value === 'string' && value.length > 0) target.add(value);
    };
    for (const channel of Array.isArray(json?.['sound_channels']) ? json['sound_channels'] : []) {
      addName(sounds, asRecord(channel)?.['name']);
    }
    const info = asRecord(json?.['info']);
    addName(sounds, info?.['preview_music']);
    for (const key of ['eyecatch_image', 'back_image', 'banner_image', 'title_image']) addName(images, info?.[key]);
    const bga = asRecord(json?.['bga']);
    for (const entry of Array.isArray(bga?.['bga_header']) ? bga['bga_header'] : []) {
      addName(images, asRecord(entry)?.['name']);
    }
  } else {
    for (const line of decodeBMSText(bytes).text.split(/\r\n|\r|\n/)) {
      const sound = BMS_SOUND_HEADER.exec(line);
      if (sound) sounds.add(sound[1]!);
      const image = BMS_IMAGE_HEADER.exec(line);
      if (image) images.add(image[1]!);
    }
  }
  return { sounds: [...sounds], images: [...images] };
}

/** Stored server index URLs, keeping only valid, distinct URLs in their stored order. */
export function parseStoredBemuseServerURLs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const urls: string[] = [];
    for (const value of parsed) {
      const url = typeof value === 'string' ? bemuseServerIndexURL(value) : undefined;
      if (url !== undefined && !urls.includes(url)) urls.push(url);
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * The public Bemuse music servers a player starts with, as index URLs: Bemuse's official server, and the servers its
 * documentation and server list (bemusic/bemuse-meta `servers.yml`) link that still serve songs. The two nekokan servers
 * send no CORS header and are read through the player's proxy.
 */
export const DEFAULT_BEMUSE_SERVER_URLS: readonly string[] = [
  'https://music4.bemuse.ninja/server/index.json',
  'https://flicknote.bemuse.ninja/index.json',
  'https://bmson.nekokan.dyndns.info/mettatunes/index.json',
  'https://bmson.nekokan.dyndns.info/forgetalia/index.json',
  'https://yuinore.net/bms/index.json',
];

/**
 * The registered server index URLs. Until the player changes the list (nothing stored), the
 * {@link DEFAULT_BEMUSE_SERVER_URLS}; a stored list, even an empty one, is the player's own. Blocked storage reads as
 * the defaults.
 */
export function readStoredBemuseServerURLs(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): string[] {
  try {
    const raw = storage?.getItem(BEMUSE_SERVER_URLS_STORAGE_KEY);
    return raw == null ? [...DEFAULT_BEMUSE_SERVER_URLS] : parseStoredBemuseServerURLs(raw);
  } catch {
    return [...DEFAULT_BEMUSE_SERVER_URLS];
  }
}

/** Stores `urls` as the registered servers and returns what was stored; blocked storage keeps nothing. */
export function storeBemuseServerURLs(
  urls: readonly string[],
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): string[] {
  const stored = parseStoredBemuseServerURLs(JSON.stringify(urls));
  try {
    storage?.setItem(BEMUSE_SERVER_URLS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private windows / blocked storage: the server still loads for this session.
  }
  return stored;
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
