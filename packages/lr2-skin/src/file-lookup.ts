import { normalizePath } from '@be-music/utils/core';

export interface Lr2SkinInputFile {
  readonly name: string;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Lr2SkinFileEntry = Uint8Array | Lr2SkinInputFile;

const indexCache: WeakMap<ReadonlyMap<string, Lr2SkinFileEntry>, ReadonlyMap<string, string>> = new WeakMap();
const FILE_READ_CONCURRENCY = 32;
const AUDIO_EXTENSIONS = new Set(['.wav', '.ogg', '.mp3', '.opus', '.flac', '.oga']);

export function findCaseInsensitivePath(
  files: ReadonlyMap<string, Lr2SkinFileEntry>,
  candidate: string,
): string | undefined {
  if (files.has(candidate)) {
    return candidate;
  }
  const index = getCaseInsensitiveIndex(files);
  return index.get(candidate.toLowerCase());
}

export function lookupBytesCaseInsensitive(
  files: ReadonlyMap<string, Lr2SkinFileEntry>,
  candidate: string,
): Lr2SkinFileEntry | undefined {
  const key = findCaseInsensitivePath(files, candidate);
  return key === undefined ? undefined : files.get(key);
}

export async function loadAssetBytes(entry: Lr2SkinFileEntry | undefined): Promise<Uint8Array | undefined> {
  if (entry === undefined) return undefined;
  if (entry instanceof Uint8Array) return entry;
  return new Uint8Array(await entry.arrayBuffer());
}

export function asLoadedBytes(entry: Lr2SkinFileEntry | undefined): Uint8Array | undefined {
  if (entry === undefined) return undefined;
  return entry instanceof Uint8Array ? entry : undefined;
}

export async function readFilesIntoBytesMap(
  files: ReadonlyArray<Lr2SkinInputFile>,
  options: {
    concurrency?: number;
    onRead?: (path: string, current: number, total: number) => void;
    deferAudio?: boolean;
    shouldDefer?: (path: string) => boolean;
  } = {},
): Promise<Map<string, Lr2SkinFileEntry>> {
  const concurrency = options.concurrency ?? FILE_READ_CONCURRENCY;
  const deferAudio = options.deferAudio ?? true;
  const decideDefer = options.shouldDefer ?? (deferAudio ? isAudioPath : neverDefer);
  const result = new Map<string, Lr2SkinFileEntry>();
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

function getCaseInsensitiveIndex(files: ReadonlyMap<string, Lr2SkinFileEntry>): ReadonlyMap<string, string> {
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

async function runWithConcurrency<T>(
  items: ReadonlyArray<T>,
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const total = items.length;
  if (total === 0) return;
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;
      await task(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
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
