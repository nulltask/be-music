import {
  asLoadedFileEntryBytes,
  findCaseInsensitiveMapPath,
  loadFileEntryBytes,
  lookupCaseInsensitiveMapEntry,
  readFilesIntoEntryMap,
  type AssetFileEntry,
  type ReadFilesIntoEntryMapOptions,
} from '@be-music/utils/core';

export interface Lr2SkinInputFile {
  readonly name: string;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Lr2SkinFileEntry = AssetFileEntry<Lr2SkinInputFile>;

export function findCaseInsensitivePath(
  files: ReadonlyMap<string, Lr2SkinFileEntry>,
  candidate: string,
): string | undefined {
  return findCaseInsensitiveMapPath(files, candidate);
}

export function lookupBytesCaseInsensitive(
  files: ReadonlyMap<string, Lr2SkinFileEntry>,
  candidate: string,
): Lr2SkinFileEntry | undefined {
  return lookupCaseInsensitiveMapEntry(files, candidate);
}

export async function loadAssetBytes(entry: Lr2SkinFileEntry | undefined): Promise<Uint8Array | undefined> {
  return loadFileEntryBytes(entry);
}

export function asLoadedBytes(entry: Lr2SkinFileEntry | undefined): Uint8Array | undefined {
  return asLoadedFileEntryBytes(entry);
}

export async function readFilesIntoBytesMap(
  files: ReadonlyArray<Lr2SkinInputFile>,
  options: ReadFilesIntoEntryMapOptions = {},
): Promise<Map<string, Lr2SkinFileEntry>> {
  return readFilesIntoEntryMap(files, options);
}
