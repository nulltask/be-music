import { describe, expect, test } from 'vite-plus/test';
import { zlibSync } from 'fflate';
import { encryptAES128CBC, expandAES128Key } from './aes128.ts';
import { isN2SArchive, parseN2SBytes, readN2SArchive } from './n2s.ts';
import { parseBMSBytes } from './bms-bytes.ts';

// The key and IV `nanasi2.exe` uses (see n2s.ts); spelled out here so a change to either fails this test.
const KEY = expandAES128Key(new TextEncoder().encode('x_button_wo_naze'));
const IV = Uint8Array.from([
  0x13, 0x0d, 0xd1, 0xbf, 0x0a, 0xd0, 0x5c, 0x99, 0x73, 0x09, 0x1a, 0x18, 0x0e, 0x9b, 0x87, 0x33,
]);

interface BuildEntry {
  name: string;
  bytes?: Uint8Array;
  directory?: boolean;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function tag(name: string): Uint8Array {
  return Uint8Array.from({ length: 8 }, (_, index) => (index < name.length ? name.charCodeAt(index) : 0xff));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const shiftJIS = (text: string): Uint8Array => {
  // Only the names below are used, so a tiny table is enough: ASCII plus "譜面" (0x95 0x88 0x96 0xca).
  const bytes: number[] = [];
  for (const character of text) {
    if (character === '譜') bytes.push(0x95, 0x88);
    else if (character === '面') bytes.push(0x96, 0xca);
    else bytes.push(character.charCodeAt(0));
  }
  return Uint8Array.from(bytes);
};

/** A ZEXA container laid out the way `nanasi2.exe` writes one. */
function buildArchive(entries: readonly BuildEntry[], encrypted = true): Uint8Array {
  const seal = (data: Uint8Array) => (encrypted ? encryptAES128CBC(data, KEY, IV) : data);
  const id = seal(new TextEncoder().encode('nanasigroove2'));
  const format = seal(new TextEncoder().encode('n2data_ver_1000'));
  const payloads: Uint8Array[] = [];
  const index: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = seal(concat([shiftJIS(entry.name), Uint8Array.of(0)]));
    if (entry.directory) {
      index.push(u32(0x10000000), u32(0xffffffff), u32(0));
    } else {
      const plain = entry.bytes!;
      const body = encrypted ? concat([u32(Math.ceil(plain.length / 16) * 16), u32(plain.length), seal(plain)]) : plain;
      const payload = zlibSync(body);
      payloads.push(payload);
      index.push(u32(0), u32(offset), u32(payload.length));
      offset += payload.length;
    }
    if (encrypted) index.push(u32(0xcccccccc));
    index.push(u32(name.length), name);
  }
  return concat([
    tag('ZEXA'),
    u32(1),
    u32(encrypted ? 0x40000000 : 0),
    u32(id.length),
    id,
    u32(format.length),
    ...(encrypted ? [u32(1)] : []),
    format,
    tag('DATA'),
    ...payloads,
    tag('INDEX'),
    u32(entries.length),
    ...index,
  ]);
}

const PMS = new TextEncoder().encode('#PLAYER 3\r\n#TITLE N2S\r\n#BPM 150\r\n#00113:01\r\n#00122:01\r\n');

describe('readN2SArchive', () => {
  test('decrypts and inflates every file entry and skips directories', () => {
    const list = new TextEncoder().encode('<?xml version="1.0"?><bmslist/>');
    const archive = buildArchive([
      { name: 'dir', directory: true },
      { name: '譜面.pms', bytes: PMS },
      { name: 'a.xml', bytes: list },
    ]);
    expect(isN2SArchive(archive)).toBe(true);
    expect(readN2SArchive(archive)).toEqual([
      { name: '譜面.pms', bytes: PMS },
      { name: 'a.xml', bytes: list },
    ]);
  });

  test('reads an unencrypted container', () => {
    expect(readN2SArchive(buildArchive([{ name: 'x.pms', bytes: PMS }], false))).toEqual([
      { name: 'x.pms', bytes: PMS },
    ]);
  });

  test('rejects data that is not a ZEXA container or is cut short', () => {
    expect(isN2SArchive(PMS)).toBe(false);
    expect(() => readN2SArchive(PMS)).toThrow('missing ZEXA tag');
    const archive = buildArchive([{ name: 'x.pms', bytes: PMS }]);
    expect(() => readN2SArchive(archive.subarray(0, archive.length - 4))).toThrow('truncated');
    // The header ends after 68 bytes (with the DATA tag); cutting inside the payloads loses the index.
    expect(() => readN2SArchive(archive.subarray(0, 80))).toThrow('missing INDEX tag');
  });
});

describe('parseN2SBytes', () => {
  test('parses the PMS chart inside exactly as the plain file parses', () => {
    const chart = parseN2SBytes(buildArchive([{ name: 'chart.pms', bytes: PMS }]));
    expect(chart).toEqual(parseBMSBytes(PMS));
    expect(chart.metadata.title).toBe('N2S');
  });

  test('looks into a nested container and past non-chart entries', () => {
    const inner = buildArchive([
      { name: 'notes.txt', bytes: Uint8Array.of(65) },
      { name: 'chart.pms', bytes: PMS },
    ]);
    const outer = buildArchive([{ name: 'inner.n2x', bytes: inner }]);
    expect(parseN2SBytes(outer).metadata.title).toBe('N2S');
  });

  test('throws when the container holds no chart', () => {
    expect(() => parseN2SBytes(buildArchive([{ name: 'list.xml', bytes: Uint8Array.of(60) }]))).toThrow('no chart');
  });
});
