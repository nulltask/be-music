import { describe, expect, test } from 'vitest';
import type { BrowserSongAssetSource } from './types.ts';
import { computeChartFileSha256, computeSha256Hex } from './chart-hash.ts';

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
  test('computeSha256Hex matches the SHA-256 test vector for "abc"', async () => {
    expect(await computeSha256Hex(encoder.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('computeChartFileSha256 hashes the chart file bytes (case-insensitive path lookup)', async () => {
    const bytes = encoder.encode('#TITLE test\n#BPM 120\n');
    const source = makeSource({ 'songs/test.bms': bytes });
    expect(await computeChartFileSha256(source, 'songs/TEST.BMS')).toBe(await computeSha256Hex(bytes));
  });

  test('computeChartFileSha256 returns undefined for a missing chart or source', async () => {
    expect(await computeChartFileSha256(makeSource({}), 'songs/missing.bms')).toBeUndefined();
    expect(await computeChartFileSha256(undefined, 'songs/missing.bms')).toBeUndefined();
  });
});
