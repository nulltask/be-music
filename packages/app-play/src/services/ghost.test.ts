import { describe, expect, test } from 'vite-plus/test';
import {
  createOwnBestGhostSource,
  resolveGhostUnavailableReason,
  selectOwnBestReplaySlot,
  type GhostAvailabilityInput,
} from './ghost.ts';
import { replaySlotKey, type ReplaySlotRecord, type ReplaySlotTarget } from './replay-slots.ts';

const TARGET: ReplaySlotTarget = { kind: 'chart', id: 'bmfp0:chart' };

function record(slot: number, exScore: number, savedAt = '2026-01-01T00:00:00.000Z'): ReplaySlotRecord {
  return {
    version: 0,
    key: replaySlotKey(TARGET, slot),
    target: TARGET,
    slot,
    savedAt,
    size: 100,
    title: 'Chart',
    exScore,
    exRate: exScore / 200,
    lamp: 'NORMAL',
  };
}

describe('resolveGhostUnavailableReason', () => {
  const able: GhostAvailabilityInput = { family: 'built-in', playVariant: '7', hasBestReplay: true };

  test('lets a built-in single-play 5 / 7 KEY play with a best replay show one', () => {
    expect(resolveGhostUnavailableReason(able)).toBeUndefined();
    expect(resolveGhostUnavailableReason({ ...able, playVariant: '5' })).toBeUndefined();
  });

  test('says why every other play cannot', () => {
    expect(resolveGhostUnavailableReason({ ...able, family: 'lr2' })).toBe('family');
    expect(resolveGhostUnavailableReason({ ...able, family: 'beatoraja' })).toBe('family');
    expect(resolveGhostUnavailableReason({ ...able, replay: true })).toBe('replay');
    expect(resolveGhostUnavailableReason({ ...able, course: true })).toBe('course');
    expect(resolveGhostUnavailableReason({ ...able, playVariant: '14' })).toBe('chart');
    expect(resolveGhostUnavailableReason({ ...able, playVariant: '9' })).toBe('chart');
    expect(resolveGhostUnavailableReason({ ...able, playVariant: undefined })).toBe('chart');
    expect(resolveGhostUnavailableReason({ ...able, battle: true })).toBe('chart');
    expect(resolveGhostUnavailableReason({ ...able, hasBestReplay: false })).toBe('no-replay');
  });
});

describe('selectOwnBestReplaySlot', () => {
  test('picks the highest EX score, the latest among equals', () => {
    expect(selectOwnBestReplaySlot([record(0, 100), record(1, 150), undefined, record(3, 120)])?.slot).toBe(1);
    expect(
      selectOwnBestReplaySlot([record(0, 150, '2026-01-01T00:00:00.000Z'), record(2, 150, '2026-02-01T00:00:00.000Z')])
        ?.slot,
    ).toBe(2);
    expect(selectOwnBestReplaySlot([undefined, undefined, undefined, undefined])).toBeUndefined();
  });
});

describe('createOwnBestGhostSource', () => {
  test('reads the best slot’s replay when the play loads', async () => {
    const replay = { chart: {}, play: {} } as never;
    const reads: number[] = [];
    const source = createOwnBestGhostSource(
      {
        slots: () => [record(0, 100), record(1, 150), undefined, undefined],
        read: (_target, slot) => {
          reads.push(slot);
          return Promise.resolve({ kind: 'chart', replay });
        },
      },
      TARGET,
    );
    expect(source.kind).toBe('own-best');
    await expect(source.load()).resolves.toBe(replay);
    expect(reads).toEqual([1]);
  });

  test('has no replay for a chart without a kept one', async () => {
    const source = createOwnBestGhostSource({ slots: () => [], read: () => Promise.resolve(undefined) }, TARGET);
    await expect(source.load()).resolves.toBeUndefined();
  });
});
