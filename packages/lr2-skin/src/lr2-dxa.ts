/**
 * DxLib DXA archive reader (V3 layout) — used by the LR2 default theme to ship `*.lr2font` + `*.tga` font assets.
 *
 * Reverse-engineered from `DxaDecode.exe` (LR2 bundled tool):
 *
 * - **Cipher** — XOR with a 12-byte rolling key. The key is derived from the password by `KeyCreate` at RVA `0x401010`;
 *   when the password is NULL (LR2's default) the source bytes are all `0xAA`, then twelve byte-mangling transforms
 *   produce {@link DXA_DEFAULT_KEY}.
 * - **Header** (24 bytes, V3) — `DX` magic + version 3 + flags + five DWORDs pointing at the file/name/dir tables.
 * - **File-entry size** is 44 bytes: name address, attributes, 3 × FILETIME, data head, data size, compressed size.
 * - **Compression** — DxLib's marker-byte LZSS variant. Decoder ported from RVA `0x4015b0..0x4016fc`. See {@link
 *   decompress}.
 *
 * Browser-side path: 1. {@link readDxaArchive} XOR-decrypts the bytes. 2. Walks the directory + file tables to
 * enumerate entries. 3. Decompresses each entry's payload (entries with `pressDataSize === 0xFFFFFFFF` ship raw and
 * skip step 3).
 *
 * Limitation: only V3 / default-key archives are supported. LR2 encodes its theme bundles without a `-K` password so
 * this covers the common case.
 */

/** Single file extracted from a DXA archive. */
export interface DxaFile {
  /** Forward-slash separated path inside the archive. */
  path: string;
  /** Raw bytes (already decrypted + decompressed). */
  data: Uint8Array;
}

export interface DxaArchive {
  files: DxaFile[];
  /** DXA major version (3). */
  version: number;
}

/**
 * 12-byte XOR key for `Key = DxLib_KeyCreate(NULL)`. Source bytes are all `0xAA` (the V3 default), then each key byte
 * is mangled per the routine at DxaDecode.exe RVA `0x4010C5..0x401158`.
 *
 * Reference transforms: - key[0] = ~0xAA = 0x55 - key[1] = swap_nibbles(0xAA) = 0xAA - key[2] = 0xAA ^ 0x8A = 0x20 -
 * key[3] = ~swap_nibbles(0xAA) = 0x55 - key[4] = ~0xAA = 0x55 - key[5] = 0xAA ^ 0xAC = 0x06 - key[6] = ~0xAA = 0x55 -
 * key[7] = ~rot_r3(0xAA) = ~0x55 = 0xAA - key[8] = rot_l3(0xAA) = 0x55 - key[9] = 0xAA ^ 0x7F = 0xD5 - key[10] =
 * swap_nibbles(0xAA) ^ 0xD6 = 0x7C - key[11] = 0xAA ^ 0xCC = 0x66
 */
const DXA_DEFAULT_KEY: ReadonlyArray<number> = [0x55, 0xaa, 0x20, 0x55, 0x55, 0x06, 0x55, 0xaa, 0x55, 0xd5, 0x7c, 0x66];

const DXA_KEY_LENGTH = 12;
const DXA_HEADER_SIZE = 24;
const DXA_FILE_ENTRY_SIZE = 44;
const DXA_DIR_ENTRY_SIZE = 16;
const DXA_ATTR_DIRECTORY = 0x10;
const DXA_PRESS_UNCOMPRESSED = 0xffffffff;
const DXA_MAGIC_BYTE_0 = 0x44; // 'D'
const DXA_MAGIC_BYTE_1 = 0x58; // 'X'

/**
 * Reads a DXA archive (LR2 default-key encrypted, V3 layout) into individual files. Returns `undefined` when the header
 * magic is wrong (unsupported password / version) or when one of the tables is malformed.
 *
 * Compressed entries are decompressed here so callers receive ready-to-use payloads.
 */
export function readDxaArchive(
  bytes: Uint8Array,
  key: ReadonlyArray<number> = DXA_DEFAULT_KEY,
): DxaArchive | undefined {
  if (bytes.length < DXA_HEADER_SIZE) return undefined;
  if (key.length !== DXA_KEY_LENGTH) return undefined;
  // XOR decrypt the entire archive in one pass — the cipher is symmetric and self-inverting.
  const decrypted = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    decrypted[i] = bytes[i]! ^ key[i % DXA_KEY_LENGTH]!;
  }
  if (decrypted[0] !== DXA_MAGIC_BYTE_0 || decrypted[1] !== DXA_MAGIC_BYTE_1) {
    return undefined;
  }
  const version = decrypted[2]!;
  if (version !== 3) return undefined;
  const view = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
  const headSize = view.getUint32(4, true);
  const dataHead = view.getUint32(8, true);
  const fileNameTableHead = view.getUint32(12, true);
  const fileTableRel = view.getUint32(16, true);
  const directoryTableRel = view.getUint32(20, true);
  if (headSize === 0 || fileNameTableHead + headSize > decrypted.length || dataHead > decrypted.length) {
    return undefined;
  }
  const ctx: WalkContext = {
    bytes: decrypted,
    view,
    fileNameTableHead,
    fileTableAbs: fileNameTableHead + fileTableRel,
    directoryTableAbs: fileNameTableHead + directoryTableRel,
    dataHead,
  };
  const files: DxaFile[] = [];
  walkDirectory(ctx, 0, '', files);
  return { files, version };
}

interface WalkContext {
  bytes: Uint8Array;
  view: DataView;
  fileNameTableHead: number;
  fileTableAbs: number;
  directoryTableAbs: number;
  dataHead: number;
}

function walkDirectory(ctx: WalkContext, directoryEntryOffset: number, pathPrefix: string, files: DxaFile[]): void {
  const dir = readDirectoryEntry(ctx.view, ctx.directoryTableAbs + directoryEntryOffset);
  if (!dir) return;
  for (let index = 0; index < dir.fileCount; index += 1) {
    const entryOffset = ctx.fileTableAbs + dir.fileHead + index * DXA_FILE_ENTRY_SIZE;
    const entry = readFileEntry(ctx.view, entryOffset);
    if (!entry) continue;
    // Skip the implicit "self" entry (the root directory's own file-table slot). It has `nameAddress=0` and the
    // directory attribute set; recursing into it would loop forever.
    if (entry.isDirectory && entry.nameAddress === 0 && pathPrefix === '') {
      continue;
    }
    const name = readFileName(ctx.bytes, ctx.fileNameTableHead + entry.nameAddress);
    if (name === '') continue;
    const fullPath = pathPrefix === '' ? name : `${pathPrefix}/${name}`;
    if (entry.isDirectory) {
      walkDirectory(ctx, entry.dataHead, fullPath, files);
      continue;
    }
    const dataStart = ctx.dataHead + entry.dataHead;
    if (entry.pressDataSize === DXA_PRESS_UNCOMPRESSED) {
      // Raw payload — copy out as-is.
      const dataEnd = dataStart + entry.dataSize;
      if (dataEnd > ctx.bytes.length) continue;
      files.push({ path: fullPath, data: ctx.bytes.subarray(dataStart, dataEnd) });
    } else {
      // Compressed payload — `entry.dataSize` is the uncompressed length, `entry.pressDataSize` the on-disk length.
      const compressed = ctx.bytes.subarray(dataStart, dataStart + entry.pressDataSize);
      if (compressed.length !== entry.pressDataSize) continue;
      const decompressed = decompress(compressed, entry.dataSize);
      if (!decompressed) continue;
      files.push({ path: fullPath, data: decompressed });
    }
  }
}

interface DirEntry {
  fileHead: number;
  fileCount: number;
}

function readDirectoryEntry(view: DataView, offset: number): DirEntry | undefined {
  if (offset + DXA_DIR_ENTRY_SIZE > view.byteLength) return undefined;
  // V3 DirEntry: [0..3] DirectoryAddress, [4..7] ParentDirectoryAddress, [8..11] FileNum, [12..15] FileHead.
  const fileNum = view.getUint32(offset + 8, true);
  const fileHead = view.getUint32(offset + 12, true);
  return { fileHead, fileCount: fileNum };
}

interface FileEntry {
  nameAddress: number;
  attributes: number;
  dataSize: number;
  dataHead: number;
  pressDataSize: number;
  isDirectory: boolean;
}

function readFileEntry(view: DataView, offset: number): FileEntry | undefined {
  if (offset + DXA_FILE_ENTRY_SIZE > view.byteLength) return undefined;
  // V3 FileEntry layout (44 bytes): [0..3] NameAddress (offset into FileNameTable) [4..7] Attributes (DWORD; bit 4 =
  // directory, 0x20 = archive) [8..15] CreationTime (FILETIME) — ignored [16..23] LastAccessTime (FILETIME) — ignored
  // [24..31] LastWriteTime (FILETIME) — ignored [32..35] DataHead (offset within data area, or directory index)
  // [36..39] DataSize (uncompressed bytes) [40..43] PressDataSize (compressed bytes; 0xFFFFFFFF = uncompressed)
  const nameAddress = view.getUint32(offset, true);
  const attributes = view.getUint32(offset + 4, true);
  const dataHead = view.getUint32(offset + 32, true);
  const dataSize = view.getUint32(offset + 36, true);
  const pressDataSize = view.getUint32(offset + 40, true);
  return {
    nameAddress,
    attributes,
    dataSize,
    dataHead,
    pressDataSize,
    isDirectory: (attributes & DXA_ATTR_DIRECTORY) !== 0,
  };
}

const sjisDecoder = (() => {
  try {
    return new TextDecoder('shift-jis', { fatal: false });
  } catch {
    return new TextDecoder('utf-8', { fatal: false });
  }
})();

function readFileName(bytes: Uint8Array, offset: number): string {
  // V3 FileName entry: WORD packNum + WORD reserved + packNum*4 bytes upper-case packed name + null-terminated
  // original-case name. The upper-case packed table is for case-insensitive lookup; we ignore it and read the original
  // name only.
  if (offset + 4 > bytes.length) return '';
  const packNum = bytes[offset]! | (bytes[offset + 1]! << 8);
  const nameStart = offset + 4 + packNum * 4;
  let end = nameStart;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  if (end === nameStart) return '';
  return sjisDecoder.decode(bytes.subarray(nameStart, end));
}

/**
 * Decompresses a DxLib V3 payload. Reverse-engineered from DxaDecode.exe RVA `0x4015b0..0x4016fc`.
 *
 * Payload layout: - `[0..3]` — uncompressed size (DWORD LE) - `[4..7]` — `unused` slot (matches `pressDataSize` in the
 * file entry; the decoder ignores it) - `[8]` — keycode (the marker byte chosen by the encoder to be rare in input) -
 * `[9..]` — body
 *
 * Body codec — each input byte is either: - **Literal** (`byte != keycode`): output byte verbatim. - **Marker** (`byte
 * == keycode`): the next byte is a code byte. If `code == keycode` the marker is escaped (output `keycode` literally).
 * Otherwise it's a back-reference: - If `code > keycode`, decrement `code` (so `code` skips over the keycode value). -
 * Length is encoded as a 5-bit low part (`code >> 3`) plus an optional 8-bit high part (1 extra byte when `code &
 * 0x04`). Combine the parts FIRST, then add the +4 base offset: - `lengthBits = code >> 3` - If `code & 0x04`: read 1
 * more byte; `lengthBits |= ext << 5`. - `length = lengthBits + 4` The "combine then +4" order is critical — applying
 * `+4` to the low 5 bits before OR'ing the extension would overflow into bit 5 whenever `code >> 3 >= 28`, corrupting
 * the extension byte's lowest bit and silently truncating the decoded output. (We hit this bug on the LR2 default
 * theme's `barfnt.dxa` font textures: the .lr2font itself decoded fine but every `font_NN.tga` came out 1500-2000 bytes
 * short.) - Offset format from `code & 0x03`: - `0` — read 1 byte - `1` — read 2 bytes (WORD LE) - `2` — read 3 bytes
 * (24-bit LE) - `3` — reuse the previous offset - Bump `offset += 1` (so min offset = 1). - Copy `length` bytes from
 * `out[len - offset]` (handling overlap so a length > offset replicates the head bytes).
 */
function decompress(src: Uint8Array, expectedSize: number): Uint8Array | undefined {
  if (src.length < 9) return undefined;
  const keycode = src[8]!;
  const out = new Uint8Array(expectedSize);
  let outIdx = 0;
  let p = 9;
  let lastOffset = 0;
  while (outIdx < expectedSize && p < src.length) {
    const b = src[p]!;
    p += 1;
    if (b !== keycode) {
      out[outIdx] = b;
      outIdx += 1;
      continue;
    }
    if (p >= src.length) break;
    let code = src[p]!;
    p += 1;
    if (code === keycode) {
      // Escaped literal of the keycode byte itself.
      out[outIdx] = keycode;
      outIdx += 1;
      continue;
    }
    if (code > keycode) code -= 1;
    // Combine low 5 bits + optional 8-bit extension BEFORE adding the +4 base offset. See the file-header doc comment
    // for why the order matters.
    let length = code >>> 3;
    if ((code & 0x04) !== 0) {
      if (p >= src.length) break;
      length |= src[p]! << 5;
      p += 1;
    }
    length += 4;
    let offset: number;
    const offsetFormat = code & 0x03;
    if (offsetFormat === 0) {
      if (p >= src.length) break;
      offset = src[p]!;
      p += 1;
    } else if (offsetFormat === 1) {
      if (p + 1 >= src.length) break;
      offset = src[p]! | (src[p + 1]! << 8);
      p += 2;
    } else if (offsetFormat === 2) {
      if (p + 2 >= src.length) break;
      offset = src[p]! | (src[p + 1]! << 8) | (src[p + 2]! << 16);
      p += 3;
    } else {
      // Format 3 — reuse the previous offset (no new bytes consumed). Encoder's value-skipping optimization for streaks
      // of same-offset back-references.
      offset = lastOffset;
    }
    offset += 1;
    lastOffset = offset - 1;
    const refStart = outIdx - offset;
    for (let i = 0; i < length && outIdx < expectedSize; i += 1) {
      out[outIdx] = refStart + i < 0 ? 0 : (out[refStart + i] ?? 0);
      outIdx += 1;
    }
  }
  if (outIdx !== expectedSize) return undefined;
  return out;
}
