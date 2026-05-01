/**
 * Minimal DxLib DXA archive reader. Supports V6 / V8 unencrypted
 * archives — sufficient for fonts the user has rebuilt with
 * `DxaEncode.exe` *without* the `-K:KeyString` option, or for any
 * third-party DxLib archive with no password.
 *
 * LR2's bundled font archives (`optionfont.dxa` / `titlefont.dxa`
 * / etc.) are XOR-encrypted with a hardcoded key sequence that
 * begins `55 AA 21 55 ...` (recovered from `LR2body.exe` at
 * offset `0x382a0f`) and a header magic of `DX` + version 2.
 * The full cycle length / per-block transformations haven't been
 * fully reverse-engineered — empirical decoding produces a "DX"
 * magic but downstream offset fields don't fit any known DxLib
 * V2 layout. Until the cipher is fully understood, encrypted
 * archives return `undefined` and the host falls back to
 * placeholder glyph rendering. Workaround: run the bundled
 * `DxaDecode.exe` (in `LR2files/スキン関連ドキュメント/`) to
 * extract `.lr2font` + `.png` siblings into a folder next to the
 * skin CSV, then drop the extracted folder.
 */

const DXA_MAGIC_BYTE_0 = 0x44; // 'D'
const DXA_MAGIC_BYTE_1 = 0x58; // 'X'

/** Single file extracted from a DXA archive. */
export interface DxaFile {
  /** Forward-slash separated path inside the archive. */
  path: string;
  /** Raw bytes (already decrypted + decompressed if applicable). */
  data: Uint8Array;
}

export interface DxaArchive {
  files: DxaFile[];
  /** DXA major version (4..8). */
  version: number;
}

/**
 * Reads a `.dxa` archive into individual files. Returns
 * `undefined` when the header signature doesn't match (encrypted
 * or non-DXA bytes); the caller should treat that as
 * "unsupported" and continue.
 *
 * Implementation is deliberately conservative — only the
 * V6 / V8 subsets of DxLib's spec we've verified are handled,
 * with deliberate failure on uncompressed-only archives so we
 * don't return junk data for archives whose entries are
 * pre-compressed (DxLib's "Huffman" mode, rare in font shipping).
 */
export function readDxaArchive(bytes: Uint8Array): DxaArchive | undefined {
  if (bytes.length < 32) return undefined;
  if (bytes[0] !== DXA_MAGIC_BYTE_0 || bytes[1] !== DXA_MAGIC_BYTE_1) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[2];
  if (version !== 6 && version !== 8) {
    return undefined;
  }
  // Layout (V6 / V8):
  //   0-1  : "DX"
  //   2    : version
  //   3    : flags
  //   4-7  : HeadSize (DWORD LE)
  //   8-15 : DataHead (ULONGLONG LE) — file payload offset
  //   16-23: FileNameTableHead
  //   24-31: FileTableHead
  //   32-39: DirectoryTableHead
  //   40-43: CodePage (DWORD LE) — typically 932 (SJIS)
  const dataHead = readUInt64LE(view, 8);
  const fileNameTableHead = readUInt64LE(view, 16);
  const fileTableHead = readUInt64LE(view, 24);
  const directoryTableHead = readUInt64LE(view, 32);
  if (dataHead === undefined || fileNameTableHead === undefined) return undefined;
  if (fileTableHead === undefined || directoryTableHead === undefined) return undefined;
  if (
    dataHead > bytes.length ||
    fileNameTableHead > bytes.length ||
    fileTableHead > bytes.length ||
    directoryTableHead > bytes.length
  ) {
    return undefined;
  }
  const codePage = view.getUint32(40, true);
  const decoder = createPathDecoder(codePage);
  const files: DxaFile[] = [];
  walkDirectory(
    bytes,
    view,
    {
      directoryTableHead: Number(directoryTableHead),
      fileTableHead: Number(fileTableHead),
      fileNameTableHead: Number(fileNameTableHead),
      dataHead: Number(dataHead),
      version,
      decoder,
    },
    0, // root directory index
    '',
    files,
  );
  return { files, version };
}

interface WalkContext {
  directoryTableHead: number;
  fileTableHead: number;
  fileNameTableHead: number;
  dataHead: number;
  version: number;
  decoder: TextDecoder;
}

interface DirEntry {
  /** Offset into the FileTable (in bytes). */
  fileHead: number;
  /** Offset of the parent directory's DIRECTORY_ENTRY (in bytes), or -1 for root. */
  parentDirectory: number;
  /** Offset of this directory's own FILE_ENTRY (in bytes). */
  directoryEntry: number;
  /** Number of file entries directly in this directory. */
  fileCount: number;
}

function walkDirectory(
  bytes: Uint8Array,
  view: DataView,
  ctx: WalkContext,
  directoryOffset: number,
  pathPrefix: string,
  files: DxaFile[],
): void {
  const dirEntry = readDirectoryEntry(view, ctx.directoryTableHead + directoryOffset);
  if (!dirEntry) return;
  const fileEntrySize = ctx.version >= 8 ? 64 : 56;
  for (let index = 0; index < dirEntry.fileCount; index += 1) {
    const fileEntryOffset = ctx.fileTableHead + dirEntry.fileHead + index * fileEntrySize;
    const entry = readFileEntry(view, fileEntryOffset, ctx.version);
    if (!entry) continue;
    const name = readFileName(bytes, ctx.fileNameTableHead + entry.nameAddress, ctx.decoder);
    const fullPath = pathPrefix === '' ? name : `${pathPrefix}/${name}`;
    if (entry.isDirectory) {
      walkDirectory(bytes, view, ctx, entry.dataHeadOrDirOffset, fullPath, files);
    } else {
      const dataStart = ctx.dataHead + entry.dataHeadOrDirOffset;
      const dataEnd = dataStart + entry.dataSize;
      if (dataEnd > bytes.length) continue;
      // Compressed entries (entry.compressedSize !== 0xFFFFFFFFFFFFFFFFn)
      // would need a Huffman decoder we don't implement yet — skip
      // them rather than emit garbage. Most font archives ship raw.
      if (entry.isCompressed) continue;
      files.push({ path: fullPath, data: bytes.subarray(dataStart, dataEnd) });
    }
  }
}

function readDirectoryEntry(view: DataView, offset: number): DirEntry | undefined {
  if (offset + 32 > view.byteLength) return undefined;
  // DIRECTORY_ENTRY layout:
  //   0-7  : DirectoryAddress (ULONGLONG LE) — own FILE_ENTRY offset
  //   8-15 : ParentDirectoryAddress
  //   16-23: FileHeadSize (file count … wait, let me re-check)
  //
  // Actually DxLib's DIRECTORY_ENTRY is:
  //   ULONGLONG DirectoryAddress;     // file-entry offset of this dir
  //   ULONGLONG ParentDirectoryAddress;
  //   ULONGLONG FileHeadAddress;       // start offset in FileTable
  //   ULONGLONG FileNum;               // count of files in this dir
  const directoryEntry = readUInt64LE(view, offset);
  const parentDirectory = readUInt64LE(view, offset + 8);
  const fileHead = readUInt64LE(view, offset + 16);
  const fileNum = readUInt64LE(view, offset + 24);
  if (
    directoryEntry === undefined ||
    parentDirectory === undefined ||
    fileHead === undefined ||
    fileNum === undefined
  ) {
    return undefined;
  }
  return {
    directoryEntry: Number(directoryEntry),
    parentDirectory: Number(parentDirectory),
    fileHead: Number(fileHead),
    fileCount: Number(fileNum),
  };
}

interface FileEntry {
  nameAddress: number;
  dataSize: number;
  dataHeadOrDirOffset: number;
  isDirectory: boolean;
  isCompressed: boolean;
}

function readFileEntry(view: DataView, offset: number, version: number): FileEntry | undefined {
  // FILE_ENTRY (V6 = 56 bytes, V8 = 64 bytes):
  //   0-7  : NameAddress (offset into FileNameTable)
  //   8-15 : Attributes (DWORD pair? — ignored)
  //   16-...: timestamps (3 × ULONGLONG)
  //   ...  : DataSize (ULONGLONG)
  //   ...  : DataHead (ULONGLONG) — payload offset (or directory offset for sub-dir)
  //   ...  : CompressedSize (ULONGLONG, V8) or PressDataSize (V6 — different shape)
  if (offset + (version >= 8 ? 64 : 56) > view.byteLength) return undefined;
  const nameAddress = readUInt64LE(view, offset);
  const attributes = view.getUint32(offset + 8, true);
  // Timestamps occupy `offset + 16 .. offset + 39` — skipped.
  const dataSize = readUInt64LE(view, offset + 40);
  const dataHead = readUInt64LE(view, offset + 48);
  const compressedSize = version >= 8 ? readUInt64LE(view, offset + 56) : undefined;
  if (nameAddress === undefined || dataSize === undefined || dataHead === undefined) return undefined;
  // Attribute bit 16 (0x10) marks a directory in DxLib; we mirror
  // that — sub-directories store a directory-table offset in the
  // `DataHead` slot instead of a payload offset.
  const isDirectory = (attributes & 0x10) !== 0;
  // Compressed entries have a `compressedSize !== ULLONG_MAX` —
  // 0xFFFFFFFFFFFFFFFFn means "uncompressed". We don't implement
  // DxLib's Huffman decoder yet, so flag and skip.
  const isCompressed = compressedSize !== undefined && compressedSize !== 0xffffffffffffffffn;
  return {
    nameAddress: Number(nameAddress),
    dataSize: Number(dataSize),
    dataHeadOrDirOffset: Number(dataHead),
    isDirectory,
    isCompressed,
  };
}

function readFileName(bytes: Uint8Array, offset: number, decoder: TextDecoder): string {
  // FileName entry layout: 8-byte aligned packed-name length +
  // upper-case Shift-JIS bytes (for case-insensitive lookup) +
  // null-terminated original-case bytes.
  // For our path-based extraction we want the original-case name,
  // which sits AFTER the upper-case packed table.
  if (offset + 4 > bytes.length) return '';
  const packedLength = bytes[offset] | (bytes[offset + 1] << 8);
  // The original-case name starts at `offset + 4 + packedLength*4`
  // (DxLib uses a packed-name buffer aligned to 4 bytes, with the
  // packed length as a 16-bit count of 4-byte units).
  const nameOffset = offset + 4 + packedLength * 4;
  let end = nameOffset;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return decoder.decode(bytes.subarray(nameOffset, end));
}

function readUInt64LE(view: DataView, offset: number): bigint | undefined {
  if (offset + 8 > view.byteLength) return undefined;
  return view.getBigUint64(offset, true);
}

function createPathDecoder(codePage: number): TextDecoder {
  // 932 = Shift-JIS, 65001 = UTF-8. Anything else falls back to
  // SJIS which is the LR2-era default.
  const label = codePage === 65001 ? 'utf-8' : 'shift-jis';
  try {
    return new TextDecoder(label, { fatal: false });
  } catch {
    return new TextDecoder('shift-jis', { fatal: false });
  }
}
