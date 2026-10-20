import { describe, expect, test } from 'vite-plus/test';
import { canonicalizeBMSCharset, extractDeclaredBMSCharset } from './bms-charset.ts';

describe('canonicalizeBMSCharset', () => {
  test('maps every common UTF-8 spelling onto utf-8', () => {
    expect(canonicalizeBMSCharset('UTF-8')).toBe('utf-8');
    expect(canonicalizeBMSCharset('utf8')).toBe('utf-8');
    expect(canonicalizeBMSCharset(' utf8 ')).toBe('utf-8');
    expect(canonicalizeBMSCharset('utf_8')).toBe('utf-8');
  });

  test('maps every common Shift_JIS spelling onto shift_jis', () => {
    expect(canonicalizeBMSCharset('Shift_JIS')).toBe('shift_jis');
    expect(canonicalizeBMSCharset('Shift-JIS')).toBe('shift_jis');
    expect(canonicalizeBMSCharset('shiftjis')).toBe('shift_jis');
    expect(canonicalizeBMSCharset('sjis')).toBe('shift_jis');
    expect(canonicalizeBMSCharset('cp932')).toBe('shift_jis');
    expect(canonicalizeBMSCharset('CP932')).toBe('shift_jis');
    expect(canonicalizeBMSCharset('MS932')).toBe('shift_jis');
    expect(canonicalizeBMSCharset('windows-31j')).toBe('shift_jis');
  });

  test('maps EUC-JP variants', () => {
    expect(canonicalizeBMSCharset('EUC-JP')).toBe('euc-jp');
    expect(canonicalizeBMSCharset('eucjp')).toBe('euc-jp');
    expect(canonicalizeBMSCharset('EUC-KR')).toBe('euc-kr');
    expect(canonicalizeBMSCharset('CP949')).toBe('euc-kr');
    expect(canonicalizeBMSCharset('ks_c_5601-1987')).toBe('euc-kr');
  });

  test('maps Latin1 / Windows-1252 variants', () => {
    expect(canonicalizeBMSCharset('iso-8859-1')).toBe('iso-8859-1');
    expect(canonicalizeBMSCharset('latin1')).toBe('iso-8859-1');
    expect(canonicalizeBMSCharset('Latin-1')).toBe('iso-8859-1');
    expect(canonicalizeBMSCharset('cp1252')).toBe('iso-8859-1');
    expect(canonicalizeBMSCharset('windows-1252')).toBe('iso-8859-1');
  });

  test('maps UTF-16 variants', () => {
    expect(canonicalizeBMSCharset('UTF-16LE')).toBe('utf-16le');
    expect(canonicalizeBMSCharset('UTF-16BE')).toBe('utf-16be');
    expect(canonicalizeBMSCharset('utf-16')).toBe('utf-16le');
  });

  test('returns undefined for unknown / empty / non-string inputs', () => {
    expect(canonicalizeBMSCharset('Klingon')).toBeUndefined();
    expect(canonicalizeBMSCharset('')).toBeUndefined();
    expect(canonicalizeBMSCharset('   ')).toBeUndefined();
    expect(canonicalizeBMSCharset(undefined)).toBeUndefined();
  });
});

describe('extractDeclaredBMSCharset', () => {
  test('extracts a #CHARSET directive from the head of the chart', () => {
    const chart = '#CHARSET UTF-8\n#TITLE example\n';
    expect(extractDeclaredBMSCharset(chart)).toBe('utf-8');
  });

  test('matches case-insensitively and strips surrounding whitespace', () => {
    expect(extractDeclaredBMSCharset('  #charset shift_jis\n')).toBe('shift_jis');
    expect(extractDeclaredBMSCharset('#Charset Shift-JIS\n')).toBe('shift_jis');
  });

  test('only scans the first 4 KB for cheapness', () => {
    const padding = '#PADDING ' + 'x'.repeat(4096);
    const chart = padding + '\n#CHARSET UTF-8\n';
    // The directive is past the 4 KB cap, so the scan should miss it.
    expect(extractDeclaredBMSCharset(chart)).toBeUndefined();
  });

  test('skips non-#-prefixed lines without false-matching #CHARSET inside text', () => {
    const chart = '// note: #CHARSET utf-8 is a comment\n#TITLE test\n';
    // Comment lines are not directives. Expect undefined.
    expect(extractDeclaredBMSCharset(chart)).toBeUndefined();
  });

  test('returns undefined for charts without a #CHARSET directive', () => {
    expect(extractDeclaredBMSCharset('#TITLE test\n#ARTIST foo\n')).toBeUndefined();
  });

  test('returns undefined when the directive value does not canonicalize', () => {
    expect(extractDeclaredBMSCharset('#CHARSET Klingon\n')).toBeUndefined();
  });
});
