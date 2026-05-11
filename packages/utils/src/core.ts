import { throwIfAborted } from './abort.ts';

/**
 * Browser-safe equivalent of `node:path.extname`. Returns the trailing-dot suffix of `path` (including the dot
 * itself) or an empty string when the path has no extension. Matches Node's behavior for the cases the
 * audio-renderer / chart loader feed in:
 *
 * - `'foo.wav'` → `'.wav'`
 * - `'foo/bar.ogg'` → `'.ogg'`
 * - `'foo'` → `''`
 * - `'foo.tar.gz'` → `'.gz'` (only the last segment)
 * - `'.bashrc'` → `''` (a leading dot on the basename isn't an extension, per Node)
 *
 * Lives in `core.ts` rather than `path.ts` so it stays browser-safe — `path.ts` re-exports `node:fs/promises`
 * helpers that aren't reachable from the web bundle.
 */
export function extname(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const basenameStart = lastSlash + 1;
  const lastDot = path.lastIndexOf('.');
  // `lastDot <= basenameStart` covers both "no dot at all in the basename" and "dot is the FIRST char of the
  // basename" (the dotfile case Node treats as no-extension).
  if (lastDot <= basenameStart) return '';
  return path.slice(lastDot);
}

export function clamp(value: number, min: number, max: number): number {
  return value <= min ? min : value >= max ? max : value;
}

export function clampSignedUnit(value: number): number {
  return value <= -1 ? -1 : value >= 1 ? 1 : value;
}

export function floatToInt16(value: number): number {
  const clamped = value <= -1 ? -1 : value >= 1 ? 1 : value;
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
}

export function normalizeNonNegativeInt(value: number, fallback = 0): number {
  if (value !== value || value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : 0;
}

export function normalizePositiveInt(value: number, fallback = 1): number {
  if (value <= 0 || value !== value || value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 1 ? normalized : 1;
}

export function normalizeFractionNumerator(value: number, denominator: number, fallback = 0): number {
  if (value !== value || value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized <= 0) {
    return 0;
  }

  let safeDenominator = 1;
  if (denominator > 0 && denominator === denominator && denominator !== Number.POSITIVE_INFINITY) {
    safeDenominator = Math.trunc(denominator);
    if (safeDenominator < 1) {
      safeDenominator = 1;
    }
  }

  const maxNumerator = safeDenominator - 1;
  if (normalized > maxNumerator) {
    return maxNumerator;
  }
  return normalized;
}

export function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

export function lcm(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return Math.abs((left * right) / gcd(left, right));
}

export function compareFractions(
  leftNumerator: number,
  leftDenominator: number,
  rightNumerator: number,
  rightDenominator: number,
): number {
  if (leftDenominator === rightDenominator) {
    return leftNumerator - rightNumerator;
  }

  const leftScaled = leftNumerator * rightDenominator;
  const rightScaled = rightNumerator * leftDenominator;
  if (leftScaled === rightScaled) {
    return 0;
  }
  if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
    return leftScaled < rightScaled ? -1 : 1;
  }

  const leftScaledBigInt = BigInt(leftNumerator) * BigInt(rightDenominator);
  const rightScaledBigInt = BigInt(rightNumerator) * BigInt(leftDenominator);
  if (leftScaledBigInt < rightScaledBigInt) {
    return -1;
  }
  if (leftScaledBigInt > rightScaledBigInt) {
    return 1;
  }
  return 0;
}

export function normalizeSortedUniqueNonNegativeIntegers(values: ReadonlyArray<number>): number[] {
  const normalized: number[] = [];
  normalized.length = values.length;
  let normalizedLength = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY || value !== value) {
      continue;
    }
    if (value <= 0) {
      normalized[normalizedLength] = 0;
    } else if (value < 0x8000_0000) {
      normalized[normalizedLength] = value | 0;
    } else {
      normalized[normalizedLength] = Math.floor(value);
    }
    normalizedLength += 1;
  }
  normalized.length = normalizedLength;
  if (normalizedLength <= 1) {
    return normalized;
  }

  if (normalizedLength <= 16) {
    for (let index = 1; index < normalizedLength; index += 1) {
      const current = normalized[index]!;
      let insertIndex = index - 1;
      while (insertIndex >= 0 && normalized[insertIndex]! > current) {
        normalized[insertIndex + 1] = normalized[insertIndex]!;
        insertIndex -= 1;
      }
      normalized[insertIndex + 1] = current;
    }
  } else {
    normalized.sort((left, right) => left - right);
  }

  let writeIndex = 1;
  let previous = normalized[0]!;
  for (let readIndex = 1; readIndex < normalized.length; readIndex += 1) {
    const current = normalized[readIndex]!;
    if (current === previous) {
      continue;
    }
    normalized[writeIndex] = current;
    writeIndex += 1;
    previous = current;
  }
  normalized.length = writeIndex;
  return normalized;
}

export interface RunWithConcurrencyOptions {
  signal?: AbortSignal;
}

/**
 * Runs `task` against each item with a bounded number of workers.
 *
 * This is intentionally small and dependency-free because browser drop loaders, theme readers, and terminal BGA
 * preloaders all need the same "saturate I/O without fanning out unbounded Promises" primitive.
 */
export async function runWithConcurrency<T>(
  items: ReadonlyArray<T>,
  limit: number,
  task: (item: T, index: number) => Promise<void>,
  options: RunWithConcurrencyOptions = {},
): Promise<void> {
  const total = items.length;
  if (total === 0) return;
  let nextIndex = 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 1;
  const workerCount = Math.min(safeLimit, total);
  const worker = async (): Promise<void> => {
    while (true) {
      throwIfAborted(options.signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;
      await task(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
}

export interface AssetInputFile {
  readonly name: string;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type AssetFileEntry<TFile extends AssetInputFile = AssetInputFile> = Uint8Array | TFile;

export interface FindCaseInsensitiveMapPathOptions {
  rejectCandidate?: (candidate: string) => boolean;
}

const caseInsensitivePathIndexCache: WeakMap<ReadonlyMap<string, unknown>, ReadonlyMap<string, string>> = new WeakMap();

export function findCaseInsensitiveMapPath<T>(
  files: ReadonlyMap<string, T>,
  candidate: string,
  options: FindCaseInsensitiveMapPathOptions = {},
): string | undefined {
  if (options.rejectCandidate?.(candidate)) {
    return undefined;
  }
  if (files.has(candidate)) {
    return candidate;
  }
  const index = getCaseInsensitivePathIndex(files);
  return index.get(candidate.toLowerCase());
}

export function lookupCaseInsensitiveMapEntry<T>(
  files: ReadonlyMap<string, T>,
  candidate: string,
  options: FindCaseInsensitiveMapPathOptions = {},
): T | undefined {
  const key = findCaseInsensitiveMapPath(files, candidate, options);
  return key === undefined ? undefined : files.get(key);
}

export async function loadFileEntryBytes<TFile extends Pick<AssetInputFile, 'arrayBuffer'>>(
  entry: Uint8Array | TFile | undefined,
): Promise<Uint8Array | undefined> {
  if (entry === undefined) return undefined;
  if (entry instanceof Uint8Array) return entry;
  return new Uint8Array(await entry.arrayBuffer());
}

export function asLoadedFileEntryBytes(entry: Uint8Array | unknown | undefined): Uint8Array | undefined {
  if (entry === undefined) return undefined;
  return entry instanceof Uint8Array ? entry : undefined;
}

export interface ReadFilesIntoEntryMapOptions {
  concurrency?: number;
  onRead?: (path: string, current: number, total: number) => void;
  deferAudio?: boolean;
  shouldDefer?: (path: string) => boolean;
  onReadError?: (path: string, error: unknown) => void;
}

export async function readFilesIntoEntryMap<TFile extends AssetInputFile>(
  files: ReadonlyArray<TFile>,
  options: ReadFilesIntoEntryMapOptions = {},
): Promise<Map<string, AssetFileEntry<TFile>>> {
  const concurrency = options.concurrency ?? 32;
  const deferAudio = options.deferAudio ?? true;
  const decideDefer = options.shouldDefer ?? (deferAudio ? isAudioAssetPath : neverDefer);
  const result = new Map<string, AssetFileEntry<TFile>>();
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
        options.onReadError?.(path, error);
      }
    }
    completed += 1;
    options.onRead?.(path, completed, total);
  });
  return result;
}

export function isAudioAssetPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  const slash = path.lastIndexOf('/');
  if (slash > dot) return false;
  return AUDIO_ASSET_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function getCaseInsensitivePathIndex<T>(files: ReadonlyMap<string, T>): ReadonlyMap<string, string> {
  const cacheKey = files as ReadonlyMap<string, unknown>;
  const cached = caseInsensitivePathIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const index = new Map<string, string>();
  for (const key of files.keys()) {
    const lower = key.toLowerCase();
    if (!index.has(lower)) {
      index.set(lower, key);
    }
  }
  caseInsensitivePathIndexCache.set(cacheKey, index);
  return index;
}

function neverDefer(): boolean {
  return false;
}

const AUDIO_ASSET_EXTENSIONS = new Set(['.wav', '.ogg', '.mp3', '.opus', '.flac', '.oga']);

export function findLastIndexAtOrBefore<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = resolveValue(items[mid]!);
    if (value <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}

export function findLastIndexBefore<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = resolveValue(items[mid]!);
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}

export function findFirstIndexAtOrAfter<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = resolveValue(items[mid]!);
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function findFirstIndexNumberAtOrAfter(items: ReadonlyArray<number>, target: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid]! < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function normalizeAsciiBase36Code(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  const uppercase = code & 0xdf;
  if (uppercase >= 0x41 && uppercase <= 0x5a) {
    return uppercase;
  }
  return -1;
}

/**
 * Base-62 counterpart of {@link normalizeAsciiBase36Code}: validates an ASCII char code as a member of `[0-9A-Za-z]`
 * and returns it unchanged. Returns `-1` for any other input.
 *
 * Unlike the base-36 variant, lowercase letters are NOT folded to uppercase — `#BASE 62` charts use lowercase as a
 * separate ID space (so `#WAV0a` and `#WAV0A` reference different sounds). Used for both indexed-header keys (`#WAVxx`,
 * `#BMPxx`, …) and object-stream tokens when the chart opted into base-62.
 */
export function normalizeAsciiBase62Code(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  if (code >= 0x41 && code <= 0x5a) {
    return code;
  }
  if (code >= 0x61 && code <= 0x7a) {
    return code;
  }
  return -1;
}

/**
 * bmson 1.0.0 spec MUST — "The implementation must protect from malicious paths. Absolute path: `C:\password.txt` or
 * `/etc/passwd`. Reference to parent directory: `../../../var/www/html/config.php`. Null characters (`\0`)."
 *
 * Pure-string predicate so CLI / TUI filesystem callers and the browser's case-insensitive file map can share one
 * canonical guard. Returns `true` for paths the implementation should refuse to resolve. Does NOT consult any
 * filesystem.
 *
 * - **Null byte** — many native APIs interpret `\0` as a C string terminator, so `safe.wav\0/etc/passwd` could resolve
 *   to the second half on a non-defensive backend.
 * - **POSIX absolute** — leading `/` (or `\`) escapes the chart bundle on Unix-style backends.
 * - **Windows absolute** — `C:\...` / `D:/...` drive-letter prefixes.
 * - **UNC / network share** — `\\server\share`, `//server/share`.
 * - **Parent traversal** — any path *segment* that is exactly `..` would walk out of the chart bundle. Per-segment
 *   matching (rather than substring) so a legitimate filename like `Lab..rinth.wav` still resolves.
 */
export function isMaliciousAssetPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  if (path.includes('\0')) {
    return true;
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return true;
  }
  if (path.startsWith('//') || path.startsWith('\\\\')) {
    return true;
  }
  for (const segment of path.split(/[/\\]/)) {
    if (segment === '..') {
      return true;
    }
  }
  return false;
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

export * from './abort.ts';
