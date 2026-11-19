import type { BeMusicJSON } from '@be-music/chart-source';
import { unzlibSync } from 'fflate';
import { decryptAES128CBC, expandAES128Key } from './aes128.ts';
import { parseBMSBytes } from './bms-bytes.ts';

/**
 * Nanasi Groove 2 (the player of Toy Musical 3) ships its charts (`.n2s`) and lists (`.n2x`) in a "ZEXA" container
 * (`zexa::ZipExtendArchiver` in `nanasi2.exe`). See docs/format-compat.md, "Nanasi Groove 2 `.n2s`".
 *
 * Layout (little-endian u32; a tag is 8 bytes, an ASCII name padded with `0xFF`):
 *
 * - `ZEXA` tag, version (1), flags (bit 30: encrypted)
 * - u32 length + archive id, u32 length (+ u32 when encrypted) + format string — both encrypted when flagged
 * - `DATA` tag, then one zlib stream per entry at `DATA end + offset`
 * - `INDEX` tag after the last payload, u32 count, then per entry: u32 flags (`0x10000000` = directory), u32 offset,
 *   u32 size (+ u32 opaque when encrypted), u32 name length + name (Shift_JIS, NUL-terminated, encrypted when flagged)
 *
 * An encrypted payload inflates to u32 cipher length, u32 plain length, ciphertext. Every encrypted field is
 * AES-128-CBC on its own (CBC restarts from the same IV), zero-padded to the block size.
 */

/** One file of a ZEXA container. */
export interface N2SArchiveEntry {
  /** The stored name (Shift_JIS decoded), e.g. `01_michiko_n.pms`. */
  name: string;
  bytes: Uint8Array;
}

const ZEXA_MAGIC = [0x5a, 0x45, 0x58, 0x41]; // "ZEXA"
const INDEX_TAG = [0x49, 0x4e, 0x44, 0x45, 0x58, 0xff, 0xff, 0xff]; // "INDEX" + 0xFF padding
const TAG_BYTES = 8;
const ENCRYPTED_FLAG = 0x40000000;
const DIRECTORY_FLAG = 0x10000000;
/** The longest nesting {@link parseN2SBytes} follows (one container wrapping another). */
const MAX_NESTING = 4;

// `nanasi2.exe` passes the key string `x_button_wo_naze_oshi_kurui_masu`, of which AES-128 takes the first 16 bytes,
// and derives the IV as the first 16 bytes of SHA-1("nanasigroove2").
const KEY = new TextEncoder().encode('x_button_wo_naze');
const IV = Uint8Array.from([
  0x13, 0x0d, 0xd1, 0xbf, 0x0a, 0xd0, 0x5c, 0x99, 0x73, 0x09, 0x1a, 0x18, 0x0e, 0x9b, 0x87, 0x33,
]);
let roundKeys: Uint8Array | undefined;

function decrypt(data: Uint8Array): Uint8Array {
  roundKeys ??= expandAES128Key(KEY);
  return decryptAES128CBC(data, roundKeys, IV);
}

/** Whether `bytes` starts like a ZEXA container (`.n2s` / `.n2x`). */
export function isN2SArchive(bytes: Uint8Array): boolean {
  return ZEXA_MAGIC.every((byte, index) => bytes[index] === byte);
}

class Reader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  offset: number;
  constructor(bytes: Uint8Array, offset: number) {
    this.bytes = bytes;
    this.offset = offset;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u32(): number {
    if (this.offset + 4 > this.bytes.length) throw new Error('n2s: truncated container');
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error('n2s: truncated container');
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
  tag(name: string): void {
    const tag = this.take(TAG_BYTES);
    for (let index = 0; index < TAG_BYTES; index++) {
      const expected = index < name.length ? name.charCodeAt(index) : 0xff;
      if (tag[index] !== expected) throw new Error(`n2s: missing ${name} tag`);
    }
  }
}

function findIndexTag(bytes: Uint8Array, from: number): number {
  // The index follows the last payload, so search from the end: payload bytes cannot then be mistaken for it.
  for (let offset = bytes.length - INDEX_TAG.length; offset >= from; offset--) {
    if (INDEX_TAG.every((byte, index) => bytes[offset + index] === byte)) return offset;
  }
  throw new Error('n2s: missing INDEX tag');
}

function decodeName(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder('shift_jis').decode(end < 0 ? bytes : bytes.subarray(0, end));
}

/** The files of a ZEXA container (directories omitted), decrypted and inflated. Throws on a malformed container. */
export function readN2SArchive(bytes: Uint8Array): N2SArchiveEntry[] {
  const reader = new Reader(bytes, 0);
  reader.tag('ZEXA');
  const version = reader.u32();
  if (version !== 1) throw new Error(`n2s: unsupported container version ${version}`);
  const encrypted = (reader.u32() & ENCRYPTED_FLAG) !== 0;
  reader.take(reader.u32()); // archive id
  const formatLength = reader.u32();
  if (formatLength > 0 && encrypted) reader.u32();
  reader.take(formatLength); // format string
  reader.tag('DATA');
  const dataBase = reader.offset;

  const index = new Reader(bytes, findIndexTag(bytes, dataBase));
  index.tag('INDEX');
  const count = index.u32();
  const entries: N2SArchiveEntry[] = [];
  for (let entry = 0; entry < count; entry++) {
    const flags = index.u32();
    const offset = index.u32();
    const size = index.u32();
    if (encrypted) index.u32();
    const storedName = index.take(index.u32());
    if ((flags & DIRECTORY_FLAG) !== 0) continue;
    const name = decodeName(encrypted ? decrypt(storedName) : storedName);
    const start = dataBase + offset;
    if (start + size > bytes.length) throw new Error(`n2s: entry ${name} runs past the end of the container`);
    const inflated = unzlibSync(bytes.subarray(start, start + size));
    if (!encrypted) {
      entries.push({ name, bytes: inflated });
      continue;
    }
    const payload = new Reader(inflated, 0);
    const cipherLength = payload.u32();
    const plainLength = payload.u32();
    const plain = decrypt(payload.take(cipherLength));
    if (plainLength > plain.length) throw new Error(`n2s: entry ${name} is shorter than its stated length`);
    entries.push({ name, bytes: plain.subarray(0, plainLength) });
  }
  return entries;
}

const CHART_ENTRY = /\.(pms|bms|bme|bml)$/i;

/** The chart text inside an `.n2s` container: the first BMS-family entry, looking into nested containers. */
function findChartBytes(bytes: Uint8Array, depth: number): Uint8Array | undefined {
  for (const entry of readN2SArchive(bytes)) {
    if (CHART_ENTRY.test(entry.name)) return entry.bytes;
    if (depth < MAX_NESTING && isN2SArchive(entry.bytes)) {
      const nested = findChartBytes(entry.bytes, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Parses a Nanasi Groove 2 `.n2s` chart: the PMS text inside the ZEXA container, read as {@link parseBMSBytes} reads
 * a `.pms` file. Throws when the container is malformed or holds no chart.
 */
export function parseN2SBytes(bytes: Uint8Array): BeMusicJSON {
  const chart = findChartBytes(bytes, 0);
  if (!chart) throw new Error('n2s: the container holds no chart');
  return parseBMSBytes(chart);
}
