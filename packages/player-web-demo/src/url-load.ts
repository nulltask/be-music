import { unzipSync } from 'fflate';

/**
 * URL-driven auto-load: lets a link pre-load a song and/or skin archive via query parameters, e.g.
 *
 *   ?music=https://host/song.zip&skin=https://host/theme.zip
 *
 * Both archives are funneled into the exact same pipeline as a drag-drop (see `processIncomingFiles` in `main.ts`), so
 * the select screen lists the archive's charts and any skin is applied — no bespoke rendering path.
 *
 * Cross-origin URLs are fetched through the demo's same-origin proxy route so archive links still work when the remote
 * host does not send `Access-Control-Allow-Origin`.
 */

// Guard for skin archives we expand here in the demo (music archives go through the player-web loader's own guarded
// `unzipSync`). Skins are small in practice; this only exists to stop a hostile/oversized link from exhausting memory.
const MAX_SKIN_UNZIP_BYTES = 512 * 1024 * 1024;
export const URL_LOAD_PROXY_PATH = '/__url-load-proxy';

export interface UrlMediaParams {
  musicUrl: string | undefined;
  skinUrl: string | undefined;
}

/** Reads the `?music=` / `?skin=` query parameters out of a full page URL. Missing params come back as `undefined`. */
export function parseUrlMediaParams(href: string): UrlMediaParams {
  const params = new URL(href).searchParams;
  return {
    musicUrl: params.get('music') ?? undefined,
    skinUrl: params.get('skin') ?? undefined,
  };
}

export function resolveUrlLoadFetchUrl(url: string, baseHref = globalThis.location?.href): string {
  const baseUrl = new URL(baseHref ?? 'http://localhost/');
  const target = new URL(url, baseUrl);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error(`URL auto-load only supports http(s) URLs: ${url}`);
  }
  if (target.origin === baseUrl.origin) {
    return target.href;
  }
  if (target.protocol !== 'https:') {
    throw new Error(`cross-origin URL auto-load only supports https URLs: ${url}`);
  }
  const proxy = new URL(URL_LOAD_PROXY_PATH, baseUrl);
  proxy.searchParams.set('url', target.href);
  return proxy.href;
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const fetchUrl = resolveUrlLoadFetchUrl(url);
  let response: Response;
  try {
    response = await fetch(fetchUrl, { redirect: 'follow' });
  } catch (error) {
    throw new Error(`could not fetch ${url} — network error`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`could not fetch ${url} — HTTP ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function basenameFromUrl(url: string, fallback: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : fallback;
  } catch {
    return fallback;
  }
}

// Zip entries can carry backslashes (archives built on Windows) and `./` prefixes; normalize to the forward-slash,
// prefix-free form the rest of the loader expects on `webkitRelativePath`.
function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

// `File` can't take `webkitRelativePath` via its constructor, so define it after the fact — mirroring how the drop
// pipeline (`withRelativePath` in player-web) stamps the in-archive path onto each enumerated file.
function fileWithRelativePath(bytes: Uint8Array, name: string, relativePath: string): File {
  // Copy into a fresh `ArrayBuffer`-backed view: fflate types its entries as `Uint8Array<ArrayBufferLike>`, which the
  // `Blob`/`File` constructor rejects (a `SharedArrayBuffer` view isn't a valid `BlobPart`). Archive entries are small.
  const file = new File([new Uint8Array(bytes)], name);
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      enumerable: true,
      value: relativePath,
      writable: false,
    });
  } catch {
    // Some engines refuse to redefine the property; the loose-file loader then falls back to `name`, which still works
    // for a flat archive.
  }
  return file;
}

/**
 * Fetches a remote ZIP and returns its entries as `File`s, each carrying its in-archive path on `webkitRelativePath` —
 * the same shape the drop pipeline produces for an extracted folder, so the existing split / theme loaders consume them
 * unchanged. Used for skin archives.
 */
export async function fetchZipAsFiles(url: string): Promise<File[]> {
  const bytes = await fetchBytes(url);
  let uncompressed = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      const path = normalizeZipPath(entry.name);
      // Skip directory records and macOS resource-fork junk; only real files become `File`s.
      if (!path || entry.name.endsWith('/') || path.startsWith('__MACOSX/')) return false;
      uncompressed += entry.originalSize;
      if (uncompressed > MAX_SKIN_UNZIP_BYTES) {
        throw new Error(`archive at ${url} expands beyond ${Math.round(MAX_SKIN_UNZIP_BYTES / (1024 * 1024))} MiB`);
      }
      return true;
    },
  });
  const files: File[] = [];
  for (const [rawPath, content] of Object.entries(entries)) {
    const path = normalizeZipPath(rawPath);
    if (!path) continue;
    const name = path.split('/').pop() ?? path;
    files.push(fileWithRelativePath(content, name, path));
  }
  return files;
}

/**
 * Fetches a remote ZIP as a single `.zip` `File` with no `webkitRelativePath`, so the player-web song-collection loader
 * expands it through its own guarded `unzipSync` path (size limits, per-archive source labeling). Used for music
 * archives. The name is forced to end in `.zip` because the loader keys its zip handling off that extension.
 */
export async function fetchZipAsFile(url: string): Promise<File> {
  const bytes = await fetchBytes(url);
  const base = basenameFromUrl(url, 'music.zip');
  const name = base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`;
  return new File([bytes], name);
}
