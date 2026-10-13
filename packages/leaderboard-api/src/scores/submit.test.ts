import { describe, expect, test } from 'vite-plus/test';
import { fileHashAliases } from './submit.ts';

describe('fileHashAliases', () => {
  test('keeps well-formed SHA-256 and MD5 hashes, lowercased', () => {
    expect(fileHashAliases({ sha256: 'A'.repeat(64), md5: 'B'.repeat(32) })).toEqual([
      { kind: 'sha256', hash: 'a'.repeat(64) },
      { kind: 'md5', hash: 'b'.repeat(32) },
    ]);
  });

  test('skips missing and malformed hashes', () => {
    expect(fileHashAliases({})).toEqual([]);
    expect(fileHashAliases({ sha256: 'a'.repeat(63), md5: `${'b'.repeat(32)}&x=1` })).toEqual([]);
    expect(fileHashAliases({ sha256: 'g'.repeat(64), md5: 'c'.repeat(32) })).toEqual([
      { kind: 'md5', hash: 'c'.repeat(32) },
    ]);
  });
});
