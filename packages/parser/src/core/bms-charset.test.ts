import { describe, expect, test } from 'vitest';
import { canonicaliseBmsCharset, extractDeclaredBmsCharset } from './bms-charset.ts';

describe('canonicaliseBmsCharset', () => {
  test('maps every common UTF-8 spelling onto utf-8', () => {
    expect(canonicaliseBmsCharset('UTF-8')).toBe('utf-8');
    expect(canonicaliseBmsCharset('utf8')).toBe('utf-8');
    expect(canonicaliseBmsCharset(' utf8 ')).toBe('utf-8');
    expect(canonicaliseBmsCharset('utf_8')).toBe('utf-8');
  });

  test('maps every common Shift_JIS spelling onto shift_jis', () => {
    expect(canonicaliseBmsCharset('Shift_JIS')).toBe('shift_jis');
    expect(canonicaliseBmsCharset('Shift-JIS')).toBe('shift_jis');
    expect(canonicaliseBmsCharset('shiftjis')).toBe('shift_jis');
    expect(canonicaliseBmsCharset('sjis')).toBe('shift_jis');
    expect(canonicaliseBmsCharset('cp932')).toBe('shift_jis');
    expect(canonicaliseBmsCharset('CP932')).toBe('shift_jis');
    expect(canonicaliseBmsCharset('MS932')).toBe('shift_jis');
    expect(canonicaliseBmsCharset('windows-31j')).toBe('shift_jis');
  });

  test('maps EUC-JP variants', () => {
    expect(canonicaliseBmsCharset('EUC-JP')).toBe('euc-jp');
    expect(canonicaliseBmsCharset('eucjp')).toBe('euc-jp');
  });

  test('maps Latin1 / Windows-1252 variants', () => {
    expect(canonicaliseBmsCharset('iso-8859-1')).toBe('iso-8859-1');
    expect(canonicaliseBmsCharset('latin1')).toBe('iso-8859-1');
    expect(canonicaliseBmsCharset('Latin-1')).toBe('iso-8859-1');
    expect(canonicaliseBmsCharset('cp1252')).toBe('iso-8859-1');
    expect(canonicaliseBmsCharset('windows-1252')).toBe('iso-8859-1');
  });

  test('maps UTF-16 variants', () => {
    expect(canonicaliseBmsCharset('UTF-16LE')).toBe('utf-16le');
    expect(canonicaliseBmsCharset('UTF-16BE')).toBe('utf-16be');
    expect(canonicaliseBmsCharset('utf-16')).toBe('utf-16le');
  });

  test('returns undefined for unknown / empty / non-string inputs', () => {
    expect(canonicaliseBmsCharset('Klingon')).toBeUndefined();
    expect(canonicaliseBmsCharset('')).toBeUndefined();
    expect(canonicaliseBmsCharset('   ')).toBeUndefined();
    expect(canonicaliseBmsCharset(undefined)).toBeUndefined();
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
    // The directive is past the 4 KB cap, so the scan should
    // miss it.
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

  test('returns undefined when the directive value does not canonicalise', () => {
    expect(extractDeclaredBmsCharset('#CHARSET Klingon\n')).toBeUndefined();
  });
});
