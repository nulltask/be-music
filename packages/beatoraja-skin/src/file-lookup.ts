import {
  asLoadedFileEntryBytes,
  findCaseInsensitiveMapPath,
  loadFileEntryBytes,
  lookupCaseInsensitiveMapEntry,
  readFilesIntoEntryMap,
  type AssetFileEntry,
  type ReadFilesIntoEntryMapOptions,
} from '@be-music/utils/core';

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
export type BeatorajaSkinFileEntry = AssetFileEntry<BeatorajaSkinInputFile>;

export function findCaseInsensitivePath(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  candidate: string,
): string | undefined {
  return findCaseInsensitiveMapPath(files, candidate);
}

export function lookupBytesCaseInsensitive(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  candidate: string,
): BeatorajaSkinFileEntry | undefined {
  return lookupCaseInsensitiveMapEntry(files, candidate);
}

export async function loadAssetBytes(entry: BeatorajaSkinFileEntry | undefined): Promise<Uint8Array | undefined> {
  return loadFileEntryBytes(entry);
}

export function asLoadedBytes(entry: BeatorajaSkinFileEntry | undefined): Uint8Array | undefined {
  return asLoadedFileEntryBytes(entry);
}

export async function readFilesIntoBytesMap(
  files: ReadonlyArray<BeatorajaSkinInputFile>,
  options: ReadFilesIntoEntryMapOptions = {},
): Promise<Map<string, BeatorajaSkinFileEntry>> {
  return readFilesIntoEntryMap(files, options);
}
