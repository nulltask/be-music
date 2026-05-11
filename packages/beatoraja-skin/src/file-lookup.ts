import { normalizePath, runWithConcurrency } from '@be-music/utils/core';

/**
 * Single file dropped by the user when loading a beatoraja skin theme. Mirrors the shape exposed by
 * `<input type="file" webkitdirectory>` and `DataTransferItem.getAsFileSystemEntry()` so the host UI can hand the
 * theme directory straight to {@link readFilesIntoBytesMap}.
 */
export interface BeatorajaSkinInputFile {
  readonly name: string;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Either a fully-resolved byte buffer or a deferred file handle. The skin parser returns deferred entries for large
 * binary assets (audio, big PNGs) so the consumer can load them lazily on a worker thread without blocking the
 * initial parse.
 */
export type BeatorajaSkinFileEntry = Uint8Array | BeatorajaSkinInputFile;

const indexCache: WeakMap<ReadonlyMap<string, BeatorajaSkinFileEntry>, ReadonlyMap<string, string>> = new WeakMap();
const FILE_READ_CONCURRENCY = 32;
const AUDIO_EXTENSIONS = new Set(['.wav', '.ogg', '.mp3', '.opus', '.flac', '.oga']);

export function findCaseInsensitivePath(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  candidate: string,
): string | undefined {
  if (files.has(candidate)) {
    return candidate;
  }
  const index = getCaseInsensitiveIndex(files);
  return index.get(candidate.toLowerCase());
}

export function lookupBytesCaseInsensitive(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  candidate: string,
): BeatorajaSkinFileEntry | undefined {
  const key = findCaseInsensitivePath(files, candidate);
  return key === undefined ? undefined : files.get(key);
}

export async function loadAssetBytes(entry: BeatorajaSkinFileEntry | undefined): Promise<Uint8Array | undefined> {
  if (entry === undefined) return undefined;
  if (entry instanceof Uint8Array) return entry;
  return new Uint8Array(await entry.arrayBuffer());
}

export function asLoadedBytes(entry: BeatorajaSkinFileEntry | undefined): Uint8Array | undefined {
  if (entry === undefined) return undefined;
  return entry instanceof Uint8Array ? entry : undefined;
}

export async function readFilesIntoBytesMap(
  files: ReadonlyArray<BeatorajaSkinInputFile>,
  options: {
    concurrency?: number;
    onRead?: (path: string, current: number, total: number) => void;
    deferAudio?: boolean;
    shouldDefer?: (path: string) => boolean;
  } = {},
): Promise<Map<string, BeatorajaSkinFileEntry>> {
  const concurrency = options.concurrency ?? FILE_READ_CONCURRENCY;
  const deferAudio = options.deferAudio ?? true;
  const decideDefer = options.shouldDefer ?? (deferAudio ? isAudioPath : neverDefer);
  const result = new Map<string, BeatorajaSkinFileEntry>();
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
      } catch {
        // A single unreadable theme file should behave like a missing file.
      }
    }
    completed += 1;
    options.onRead?.(path, completed, total);
  });
  return result;
}

function getCaseInsensitiveIndex(files: ReadonlyMap<string, BeatorajaSkinFileEntry>): ReadonlyMap<string, string> {
  const cached = indexCache.get(files);
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
  indexCache.set(files, index);
  return index;
}

function neverDefer(): boolean {
  return false;
}

function isAudioPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  const slash = path.lastIndexOf('/');
  if (slash > dot) return false;
  return AUDIO_EXTENSIONS.has(path.slice(dot).toLowerCase());
}
