import {
  asLoadedFileEntryBytes,
  findCaseInsensitiveMapPath,
  loadFileEntryBytes,
  lookupCaseInsensitiveMapEntry,
  readFilesIntoEntryMap,
  type AssetFileEntry,
  type ReadFilesIntoEntryMapOptions,
} from '@be-music/shared-utils/core';

export interface LR2SkinInputFile {
  readonly name: string;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type LR2SkinFileEntry = AssetFileEntry<LR2SkinInputFile>;

export function findCaseInsensitivePath(
  files: ReadonlyMap<string, LR2SkinFileEntry>,
  candidate: string,
): string | undefined {
  return findCaseInsensitiveMapPath(files, candidate);
}

export function lookupBytesCaseInsensitive(
  files: ReadonlyMap<string, LR2SkinFileEntry>,
  candidate: string,
): LR2SkinFileEntry | undefined {
  return lookupCaseInsensitiveMapEntry(files, candidate);
}

export async function loadAssetBytes(entry: LR2SkinFileEntry | undefined): Promise<Uint8Array | undefined> {
  return loadFileEntryBytes(entry);
}

export function asLoadedBytes(entry: LR2SkinFileEntry | undefined): Uint8Array | undefined {
  return asLoadedFileEntryBytes(entry);
}

export async function readFilesIntoBytesMap(
  files: ReadonlyArray<LR2SkinInputFile>,
  options: ReadFilesIntoEntryMapOptions = {},
): Promise<Map<string, LR2SkinFileEntry>> {
  return readFilesIntoEntryMap(files, options);
}
