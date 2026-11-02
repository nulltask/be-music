import { describe, expect, test } from 'vite-plus/test';
import { planReplaySlotRevision, REPLAY_SLOT_STORAGE_REVISION } from './replay-slot-revision.ts';
import { replaySlotKey, type ReplaySlotRecord } from './replay-slots.ts';

function record(slot: number, overrides: Partial<ReplaySlotRecord> = {}): ReplaySlotRecord {
  const target = { kind: 'chart', id: 'bmfp0:abc' } as const;
  return {
    version: 0,
    key: replaySlotKey(target, slot),
    target,
    slot,
    savedAt: '2026-10-26T00:00:00.000Z',
    size: 100,
    title: 'Chart',
    exScore: 10,
    exRate: 0.5,
    lamp: 'NORMAL',
    ...overrides,
  };
}

const good = record(0);
const other = record(1);

describe('replay slot storage revision', () => {
  test('starts at revision 0', () => {
    expect(REPLAY_SLOT_STORAGE_REVISION).toBe(0);
  });

  test('at revision 0, clears what no longer reads as a slot record, with its replay, and stores the revision', () => {
    expect(
      planReplaySlotRevision({
        storedRevision: undefined,
        currentRevision: 0,
        records: [
          { key: good.key, value: good },
          { key: 'chart:old#0', value: { version: 0, key: 'chart:old#0' } },
          { key: 'chart:wrong#1', value: other },
        ],
        dataKeys: [good.key, 'chart:old#0', 'chart:wrong#1', 'chart:orphan#2'],
      }),
    ).toEqual({ remove: ['chart:old#0', 'chart:wrong#1', 'chart:orphan#2'], put: [], revision: 0 });
  });

  test('leaves compatible slots at the current revision untouched', () => {
    expect(
      planReplaySlotRevision({
        storedRevision: 0,
        currentRevision: 0,
        records: [{ key: good.key, value: good }],
        dataKeys: [good.key],
      }),
    ).toEqual({ remove: [], put: [] });
  });

  test('from revision 1 on, migrates step by step from the stored revision', () => {
    const migrations = {
      1: (value: unknown) => ({ ...(value as object), version: 0 }),
      2: (value: unknown) => ({ ...(value as object), title: `${(value as { title: string }).title} (2)` }),
    };
    const old = { ...good, version: 0 };
    expect(
      planReplaySlotRevision({
        storedRevision: 0,
        currentRevision: 2,
        records: [{ key: good.key, value: old }],
        dataKeys: [good.key],
        migrations,
      }),
    ).toEqual({ remove: [], put: [{ ...good, title: 'Chart (2)' }], revision: 2 });
    // From revision 1, only the step to 2 runs.
    expect(
      planReplaySlotRevision({
        storedRevision: 1,
        currentRevision: 2,
        records: [{ key: good.key, value: good }],
        dataKeys: [good.key],
        migrations,
      }).put,
    ).toEqual([{ ...good, title: 'Chart (2)' }]);
  });

  test('a migration that drops a record removes it with its replay', () => {
    expect(
      planReplaySlotRevision({
        storedRevision: 1,
        currentRevision: 2,
        records: [{ key: good.key, value: good }],
        dataKeys: [good.key],
        migrations: { 2: () => undefined },
      }),
    ).toEqual({ remove: [good.key], put: [], revision: 2 });
  });

  test('without a step for a revision, or from a newer revision, clears what does not read', () => {
    const unread = { ...good, version: 9 as ReplaySlotRecord['version'] };
    expect(
      planReplaySlotRevision({
        storedRevision: 0,
        currentRevision: 2,
        records: [
          { key: good.key, value: unread },
          { key: other.key, value: other },
        ],
        dataKeys: [good.key, other.key],
        migrations: { 2: (value: unknown) => value },
      }),
    ).toEqual({ remove: [good.key], put: [], revision: 2 });
    expect(
      planReplaySlotRevision({
        storedRevision: 3,
        currentRevision: 1,
        records: [
          { key: good.key, value: unread },
          { key: other.key, value: other },
        ],
        dataKeys: [good.key, other.key],
      }),
    ).toEqual({ remove: [good.key], put: [], revision: 1 });
  });
});
