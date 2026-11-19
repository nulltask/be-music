import { describe, expect, test } from 'vite-plus/test';
import { parseN2XCourseFile } from './n2x.ts';

const LIST = `<?xml version="1.0" encoding="UTF-8"?>
<bmslist>
  <!-- #region 開発者用 -->
  <bms>
    <file>___dev\\foon_5.pms</file>
  </bms>
  <!-- #endregion -->
  <bms>
    <file>amanas\\00_esp_5btn.n2s</file>
    <condition target="amanas\\01_esp_n.n2s">
      <target_ex_score>1</target_ex_score>
    </condition>
  </bms>
  <bms>
    <file>classic_tm\\01_classic_tm_n.n2s</file>
    <condition>
      <package_flag flag_key="flag_tm1_unlock">8</package_flag>
    </condition>
  </bms>
  <bms><condition /></bms>
</bmslist>`;

/** An unencrypted ZEXA container holding `bytes` as `name`, its zlib stream one stored block. */
function zexa(name: string, bytes: Uint8Array): Uint8Array {
  const u32 = (value: number) => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value >>> 0, true);
    return [...out];
  };
  const tag = (text: string) => Array.from({ length: 8 }, (_, i) => (i < text.length ? text.charCodeAt(i) : 0xff));
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  const length = bytes.length;
  const payload = [
    0x78,
    0x01,
    0x01,
    length & 0xff,
    length >> 8,
    ~length & 0xff,
    (~length >> 8) & 0xff,
    ...bytes,
    adler >>> 24,
    (adler >>> 16) & 0xff,
    (adler >>> 8) & 0xff,
    adler & 0xff,
  ];
  const nameBytes = [...new TextEncoder().encode(name), 0];
  return Uint8Array.from([
    ...tag('ZEXA'),
    ...u32(1),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...tag('DATA'),
    ...payload,
    ...tag('INDEX'),
    ...u32(1),
    ...u32(0),
    ...u32(0),
    ...u32(payload.length),
    ...u32(nameBytes.length),
    ...nameBytes,
  ]);
}

describe('parseN2XCourseFile', () => {
  test('reads each listed chart as a stage by path, in order, ignoring the unlock conditions', () => {
    expect(parseN2XCourseFile(LIST, 'extra1')).toEqual({
      name: 'extra1',
      kind: 'expert',
      stages: [
        { path: '___dev/foon_5.pms', title: 'foon_5' },
        { path: 'amanas/00_esp_5btn.n2s', title: '00_esp_5btn' },
        { path: 'classic_tm/01_classic_tm_n.n2s', title: '01_classic_tm_n' },
      ],
      constraints: [],
      trophies: [],
      release: true,
      source: { format: 'n2x' },
    });
  });

  test('reads the list out of its ZEXA container, or as plain XML bytes', () => {
    const bytes = new TextEncoder().encode(LIST);
    expect(parseN2XCourseFile(zexa('extra1.xml', bytes), 'extra1')).toEqual(parseN2XCourseFile(LIST, 'extra1'));
    expect(parseN2XCourseFile(bytes, 'extra1')?.stages).toHaveLength(3);
  });

  test('gives no course for an n2x that is not a chart list or lists no chart', () => {
    expect(parseN2XCourseFile('<setting><comment>各種設定。</comment></setting>', 'setting')).toBeUndefined();
    expect(parseN2XCourseFile('<bmslist><bms><condition /></bms></bmslist>', 'empty')).toBeUndefined();
    expect(parseN2XCourseFile(zexa('skin.xml', new TextEncoder().encode('<skin />')), 'skin')).toBeUndefined();
  });
});
