import { describe, expect, test } from 'vitest';
import { canonicalizeBmsCharset, extractDeclaredBmsCharset } from './bms-charset.ts';

describe('canonicalizeBmsCharset', () => {
  test('maps every common UTF-8 spelling onto utf-8', () => {
    expect(canonicalizeBmsCharset('UTF-8')).toBe('utf-8');
    expect(canonicalizeBmsCharset('utf8')).toBe('utf-8');
    expect(canonicalizeBmsCharset(' utf8 ')).toBe('utf-8');
    expect(canonicalizeBmsCharset('utf_8')).toBe('utf-8');
  });

  test('maps every common Shift_JIS spelling onto shift_jis', () => {
    expect(canonicalizeBmsCharset('Shift_JIS')).toBe('shift_jis');
    expect(canonicalizeBmsCharset('Shift-JIS')).toBe('shift_jis');
    expect(canonicalizeBmsCharset('shiftjis')).toBe('shift_jis');
    expect(canonicalizeBmsCharset('sjis')).toBe('shift_jis');
    expect(canonicalizeBmsCharset('cp932')).toBe('shift_jis');
    expect(canonicalizeBmsCharset('CP932')).toBe('shift_jis');
    expect(canonicalizeBmsCharset('MS932')).toBe('shift_jis');
    expect(canonicalizeBmsCharset('windows-31j')).toBe('shift_jis');
  });

  test('maps EUC-JP variants', () => {
    expect(canonicalizeBmsCharset('EUC-JP')).toBe('euc-jp');
    expect(canonicalizeBmsCharset('eucjp')).toBe('euc-jp');
  });

  test('maps Latin1 / Windows-1252 variants', () => {
    expect(canonicalizeBmsCharset('iso-8859-1')).toBe('iso-8859-1');
    expect(canonicalizeBmsCharset('latin1')).toBe('iso-8859-1');
    expect(canonicalizeBmsCharset('Latin-1')).toBe('iso-8859-1');
    expect(canonicalizeBmsCharset('cp1252')).toBe('iso-8859-1');
    expect(canonicalizeBmsCharset('windows-1252')).toBe('iso-8859-1');
  });

  test('maps UTF-16 variants', () => {
    expect(canonicalizeBmsCharset('UTF-16LE')).toBe('utf-16le');
    expect(canonicalizeBmsCharset('UTF-16BE')).toBe('utf-16be');
    expect(canonicalizeBmsCharset('utf-16')).toBe('utf-16le');
  });

  test('returns undefined for unknown / empty / non-string inputs', () => {
    expect(canonicalizeBmsCharset('Klingon')).toBeUndefined();
    expect(canonicalizeBmsCharset('')).toBeUndefined();
    expect(canonicalizeBmsCharset('   ')).toBeUndefined();
    expect(canonicalizeBmsCharset(undefined)).toBeUndefined();
  });
});

describe('extractDeclaredBmsCharset', () => {
  test('extracts a #CHARSET directive from the head of the chart', () => {
    const chart = '#CHARSET UTF-8\n#TITLE example\n';
    expect(extractDeclaredBmsCharset(chart)).toBe('utf-8');
  });

  test('matches case-insensitively and strips surrounding whitespace', () => {
    expect(extractDeclaredBmsCharset('  #charset shift_jis\n')).toBe('shift_jis');
    expect(extractDeclaredBmsCharset('#Charset Shift-JIS\n')).toBe('shift_jis');
  });

  test('only scans the first 4 KB for cheapness', () => {
    const padding = '#PADDING ' + 'x'.repeat(4096);
    const chart = padding + '\n#CHARSET UTF-8\n';
    // The directive is past the 4 KB cap, so the scan should miss it.
    expect(extractDeclaredBmsCharset(chart)).toBeUndefined();
  });

  test('skips non-#-prefixed lines without false-matching #CHARSET inside text', () => {
    const chart = '// note: #CHARSET utf-8 is a comment\n#TITLE test\n';
    // Comment lines are not directives. Expect undefined.
    expect(extractDeclaredBmsCharset(chart)).toBeUndefined();
  });

  test('returns undefined for charts without a #CHARSET directive', () => {
    expect(extractDeclaredBmsCharset('#TITLE test\n#ARTIST foo\n')).toBeUndefined();
  });

  test('returns undefined when the directive value does not canonicalize', () => {
    expect(extractDeclaredBmsCharset('#CHARSET Klingon\n')).toBeUndefined();
  });
});
