import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { fileHashAliases, laneOptionOf, playedFileOf } from './played-file.ts';

function log(chart: Partial<BeMusicReplay['chart']>, inputs: Array<{ timeUs: number }> = []) {
  return {
    chart: { notes: [], ...chart } as unknown as BeMusicReplay['chart'],
    inputs: inputs.map((input, seq) => ({
      seq,
      action: 'down',
      channels: ['11'],
      ...input,
    })) as BeMusicReplay['inputs'],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' } as BeMusicReplay['play'],
  };
}

describe('playedFileOf', () => {
  test('reads the file hashes, lowercased, and skips malformed ones', () => {
    const sha256 = 'A'.repeat(64);
    expect(playedFileOf(log({ sha256, md5: 'not-a-hash' }))).toMatchObject({
      fileSha256: 'a'.repeat(64),
      fileMd5: null,
    });
    expect(playedFileOf(log({}))).toMatchObject({ fileSha256: null, fileMd5: null });
  });

  test('runs to the last note end or the last input, whichever is later', () => {
    const notes = [
      { id: 0, channel: '11', type: 'normal', timeUs: 1_000_000 },
      { id: 1, channel: '12', type: 'long', timeUs: 2_000_000, endTimeUs: 95_400_000 },
    ] as BeMusicReplay['chart']['notes'];
    expect(playedFileOf(log({ notes })).durationMs).toBe(95_400);
    expect(playedFileOf(log({ notes }, [{ timeUs: 97_000_400 }])).durationMs).toBe(97_000);
    expect(playedFileOf(log({})).durationMs).toBe(0);
  });
});

describe('laneOptionOf', () => {
  test('names the arrangement of one side, OFF when none was applied', () => {
    expect(laneOptionOf({})).toBe('OFF');
    expect(laneOptionOf({ randomLane: { p1: 'random' } })).toBe('RANDOM');
    expect(laneOptionOf(log({}).play)).toBe('OFF');
  });

  test('names both sides of a double play when they differ, and a swap', () => {
    expect(laneOptionOf({ randomLane: { p1: 'MIRROR', p2: 'RANDOM' } })).toBe('MIRROR / RANDOM');
    expect(laneOptionOf({ randomLane: { p1: 'RANDOM', p2: 'RANDOM' } })).toBe('RANDOM');
    expect(laneOptionOf({ randomLane: { p1: 'OFF', p2: 'OFF' }, dpFlip: true })).toBe('OFF FLIP');
  });
});

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
