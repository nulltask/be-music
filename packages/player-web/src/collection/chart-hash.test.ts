import { describe, expect, test } from 'vite-plus/test';
import type { BrowserSongAssetSource } from './types.ts';
import { computeChartFileHashes, computeChartFileSHA256, computeSHA256Hex } from './chart-hash.ts';
import { md5HexOfBytes } from './md5.ts';

const encoder = new TextEncoder();

function makeSource(files: Record<string, Uint8Array>): BrowserSongAssetSource {
  return {
    id: 'src',
    kind: 'directory',
    label: 'src',
    files: new Map(Object.entries(files)),
  };
}

describe('chart-hash', () => {
  test('computeSHA256Hex matches the SHA-256 test vector for "abc"', async () => {
    expect(await computeSHA256Hex(encoder.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('computeChartFileSHA256 hashes the chart file bytes (case-insensitive path lookup)', async () => {
    const bytes = encoder.encode('#TITLE test\n#BPM 120\n');
    const source = makeSource({ 'songs/test.bms': bytes });
    expect(await computeChartFileSHA256(source, 'songs/TEST.BMS')).toBe(await computeSHA256Hex(bytes));
  });

  test('computeChartFileSHA256 returns undefined for a missing chart or source', async () => {
    expect(await computeChartFileSHA256(makeSource({}), 'songs/missing.bms')).toBeUndefined();
    expect(await computeChartFileSHA256(undefined, 'songs/missing.bms')).toBeUndefined();
  });

  test('computeChartFileHashes returns the SHA-256 and MD5 of the chart file bytes', async () => {
    const bytes = encoder.encode('#TITLE test\n#BPM 120\n');
    const source = makeSource({ 'songs/test.bms': bytes });
    expect(await computeChartFileHashes(source, 'songs/TEST.BMS')).toEqual({
      sha256: await computeSHA256Hex(bytes),
      md5: md5HexOfBytes(bytes),
    });
    expect(await computeChartFileHashes(makeSource({}), 'songs/missing.bms')).toBeUndefined();
    expect(await computeChartFileHashes(undefined, 'songs/missing.bms')).toBeUndefined();
  });
});
