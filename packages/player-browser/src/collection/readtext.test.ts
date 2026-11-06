import { describe, expect, it } from 'vite-plus/test';
import { decodeReadtextBytes } from './readtext.ts';

/** `こんにちは、世界` and a URL in Shift_JIS, as an LR2-era README is saved. */
const SHIFT_JIS_README = Uint8Array.from([
  0x82,
  0xb1,
  0x82,
  0xf1,
  0x82,
  0xc9,
  0x82,
  0xbf,
  0x82,
  0xcd,
  0x81,
  0x41,
  0x90,
  0xa2,
  0x8a,
  0x45,
  0x0d,
  0x0a,
  ...new TextEncoder().encode('https://example.com/'),
]);

describe('decodeReadtextBytes', () => {
  it('reads a Shift_JIS README', () => {
    expect(decodeReadtextBytes(SHIFT_JIS_README)).toBe('こんにちは、世界\r\nhttps://example.com/');
  });

  it('reads Shift_JIS half-width katakana among other Japanese text', () => {
    // `ﾃｷｽﾄです`
    expect(decodeReadtextBytes(Uint8Array.from([0xc3, 0xb7, 0xbd, 0xc4, 0x82, 0xc5, 0x82, 0xb7]))).toBe('ﾃｷｽﾄです');
  });

  it('reads UTF-8 without a BOM', () => {
    expect(decodeReadtextBytes(new TextEncoder().encode('作曲: テスト\n'))).toBe('作曲: テスト\n');
  });

  it('reads UTF-8 with a BOM, without the BOM', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('README')]);
    expect(decodeReadtextBytes(bytes)).toBe('README');
  });

  it('reads UTF-16LE with a BOM, as Notepad saves "Unicode"', () => {
    const text = 'BMS テスト';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      bytes[2 + index * 2] = code & 0xff;
      bytes[3 + index * 2] = code >> 8;
    }
    expect(decodeReadtextBytes(bytes)).toBe(text);
  });

  it('reads ASCII as it is', () => {
    expect(decodeReadtextBytes(new TextEncoder().encode('plain text'))).toBe('plain text');
  });

  it('reads an empty file as an empty string', () => {
    expect(decodeReadtextBytes(new Uint8Array())).toBe('');
  });
});
