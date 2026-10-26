import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { describe, expect, test, vi } from 'vite-plus/test';
import { describeReplaySlotSave, ResultReplaySlots, type ResultReplaySave } from './replay-slot-service.ts';
import { createMemoryReplaySlotBackend, ReplaySlotStore, type ReplaySlotTarget } from './replay-slots.ts';

const CHART: ReplaySlotTarget = { kind: 'chart', id: 'bmfp0:aaaa' };

function replay(): BeMusicReplay {
  return {
    format: 'be-music-replay',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    createdAt: '2026-10-26T03:00:00.000Z',
    chart: {
      title: 'Fixture A',
      chartFingerprint: CHART.id,
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 0,
      notes: [],
    },
    inputs: [],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', judgeRuleset: 'lr2' },
  };
}

const SAVE: ResultReplaySave = {
  payload: { kind: 'chart', replay: replay() },
  score: { lamp: 'HARD', exScore: 120, maxCombo: 40, missCount: 2, noteCount: 100 },
  title: 'Fixture A',
  previous: { lamp: 'NORMAL', exScore: 100, maxCombo: 40, missCount: 3 },
};

function slots(save: ResultReplaySave | null = SAVE) {
  const store = new ReplaySlotStore({ backend: createMemoryReplaySlotBackend() });
  const report = vi.fn<(text: string) => void>();
  return { store, report, slots: new ResultReplaySlots({ store, target: CHART, save: save ?? undefined, report }) };
}

describe('ResultReplaySlots', () => {
  test('saves into a slot once per result, showing it as saved by this result', async () => {
    const { slots: result, store, report } = slots();
    const changed = vi.fn();
    result.subscribe(changed);
    expect(result.states()).toEqual(['none', 'none', 'none', 'none']);
    expect(await result.save(2)).toMatchObject({ saved: true });
    expect(await result.save(2)).toBeUndefined();
    expect(result.states()).toEqual(['none', 'none', 'saved', 'none']);
    expect(store.exists(CHART)).toEqual([false, false, true, false]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('Saved the replay to replay slot 3');
    // Another result of the same chart sees the slot holding a replay.
    const next = new ResultReplaySlots({ store, target: CHART, save: SAVE, report });
    expect(next.states()).toEqual(['none', 'none', 'exists', 'none']);
  });

  test('auto-saves into the slots whose rule the play meets against the record before it', async () => {
    const { slots: result, report } = slots();
    await result.autoSave(['clear-update', 'never', 'miss-count-update-or-equal', 'max-combo-update']);
    expect(result.states()).toEqual(['saved', 'none', 'saved', 'none']);
    expect(report).toHaveBeenCalledWith('Auto-saved the replay to replay slot 1');
  });

  test('saves nothing from a result that cannot be saved, and says so when asked by hand', async () => {
    const { slots: result, store, report } = slots(null);
    expect(result.saveable).toBe(false);
    await result.autoSave(['always', 'always', 'always', 'always']);
    expect(report).not.toHaveBeenCalled();
    expect(await result.save(0)).toBeUndefined();
    expect(report).toHaveBeenCalledWith('This play cannot be saved to a replay slot');
    expect(store.exists(CHART)).toEqual([false, false, false, false]);
  });
});

describe('describeReplaySlotSave', () => {
  test('names the slot, the replays removed for room and why a save failed', () => {
    const record = { key: 'k', slot: 0 } as never;
    expect(describeReplaySlotSave(0, { saved: true, record, evicted: [record, record] }, false)).toBe(
      'Saved the replay to replay slot 1 (removed 2 lower-scoring replays to make room)',
    );
    expect(describeReplaySlotSave(1, { saved: false, reason: 'budget' }, false)).toContain('size limit');
    expect(describeReplaySlotSave(1, { saved: false, reason: 'storage' }, true)).toContain('storage is full');
  });
});
