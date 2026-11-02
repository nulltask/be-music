// Dropped ZIP archives: a chart archive goes to the song collection whole (it expands it itself, as `?music=` and the
// Open files picker do), any other archive (a skin, replays, course files) is expanded and joins the drop as files.
import { isChartFilePath } from '@be-music/player-browser/collection';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const END_RECORD_SIZE = 22;
/** The end record sits in the last 22 bytes plus a comment of at most 65,535. */
const END_RECORD_SEARCH = END_RECORD_SIZE + 0xffff;

/** Whether a dropped file is a ZIP archive, by its name. */
export function isZipArchiveName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

interface CentralDirectory {
  readonly entryCount: number;
  readonly offset: number;
  readonly size: number;
}

/**
 * Where a ZIP's central directory is, from the end record in `tail` (the archive's last bytes). `undefined` when `tail`
 * holds no end record, or the archive is ZIP64 (its directory past 4 GiB), which this reader does not follow.
 */
export function locateZipCentralDirectory(tail: Uint8Array): CentralDirectory | undefined {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let at = tail.byteLength - END_RECORD_SIZE; at >= 0; at--) {
    if (view.getUint32(at, true) !== END_OF_CENTRAL_DIRECTORY) continue;
    const entryCount = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 12, true);
    const offset = view.getUint32(at + 16, true);
    if (entryCount === 0xffff || size === 0xffffffff || offset === 0xffffffff) return undefined;
    return { entryCount, offset, size };
  }
  return undefined;
}

/** The entry paths a ZIP's central directory lists, or `undefined` when it is malformed. */
export function readCentralDirectoryNames(directory: Uint8Array, entryCount: number): string[] | undefined {
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const utf8 = new TextDecoder();
  const latin1 = new TextDecoder('latin1');
  const names: string[] = [];
  let at = 0;
  for (let index = 0; index < entryCount; index++) {
    if (at + 46 > directory.byteLength || view.getUint32(at, true) !== CENTRAL_DIRECTORY_ENTRY) return undefined;
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const raw = directory.subarray(at + 46, at + 46 + nameLength);
    // Bit 11 marks a UTF-8 name; others (Shift_JIS in many BMS packs) still keep an ASCII extension readable.
    names.push(((flags & 0x0800) !== 0 ? utf8 : latin1).decode(raw));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/**
 * The entry paths of a ZIP `file`, read from its central directory without inflating anything (a chart archive may be
 * hundreds of MB of audio). `undefined` when they cannot be read.
 */
export async function readZipEntryNames(file: Blob): Promise<string[] | undefined> {
  const tailOffset = Math.max(0, file.size - END_RECORD_SEARCH);
  const tail = new Uint8Array(await file.slice(tailOffset).arrayBuffer());
  const directory = locateZipCentralDirectory(tail);
  if (directory === undefined || directory.offset + directory.size > file.size) return undefined;
  const bytes =
    directory.offset >= tailOffset
      ? tail.subarray(directory.offset - tailOffset, directory.offset - tailOffset + directory.size)
      : new Uint8Array(await file.slice(directory.offset, directory.offset + directory.size).arrayBuffer());
  return readCentralDirectoryNames(bytes, directory.entryCount);
}

/**
 * Whether an archive with these entries is a chart archive: one that holds a chart. An archive whose entries cannot be
 * read counts as one, as the Open files picker treats every archive.
 */
export function isChartArchive(entryNames: readonly string[] | undefined): boolean {
  return entryNames === undefined || entryNames.some((name) => isChartFilePath(name));
}

export interface SortedDropArchives {
  /** Chart archives, as `.zip` files with no `webkitRelativePath`, so the collection expands them as archives. */
  readonly chartArchives: File[];
  /** The entries of every other archive, each carrying its in-archive path. */
  readonly expandedFiles: File[];
}

/** Splits dropped ZIP archives into chart archives and the expanded entries of the rest. */
export async function sortDroppedArchives(
  archives: readonly File[],
  expand: (bytes: Uint8Array, label: string) => Promise<File[]>,
): Promise<SortedDropArchives> {
  const chartArchives: File[] = [];
  const expandedFiles: File[] = [];
  for (const archive of archives) {
    if (isChartArchive(await readZipEntryNames(archive))) {
      // A file dropped from a folder carries its path; the collection takes a path-less `.zip` as an archive.
      chartArchives.push(archive.webkitRelativePath ? new File([archive], archive.name) : archive);
    } else {
      expandedFiles.push(...(await expand(new Uint8Array(await archive.arrayBuffer()), archive.name)));
    }
  }
  return { chartArchives, expandedFiles };
}
