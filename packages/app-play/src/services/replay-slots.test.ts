import type { BeMusicCourseReplay, BeMusicReplay } from '@be-music/player-engine/replay';
import type { RecordPlay } from '@be-music/player-engine/records';
import { describe, expect, test } from 'vite-plus/test';
import {
  chartReplaySlotTarget,
  compressReplayText,
  createMemoryReplaySlotBackend,
  decompressReplayText,
  normalizeReplayAutoSaveRules,
  parseReplaySlotRecord,
  planReplaySlotEviction,
  qualifiesReplayAutoSave,
  replaySlotKey,
  ReplaySlotStore,
  resolveReplayAutoSaveSlots,
  type ReplaySlotBackend,
  type ReplaySlotRecord,
  type ReplaySlotTarget,
} from './replay-slots.ts';

const CHART: ReplaySlotTarget = { kind: 'chart', id: 'bmfp0:aaaa' };
const OTHER: ReplaySlotTarget = { kind: 'chart', id: 'bmfp0:bbbb' };

function replay(title = 'Fixture A', chartFingerprint = 'bmfp0:aaaa'): BeMusicReplay {
  return {
    format: 'be-music-replay',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    createdAt: '2026-10-26T03:00:00.000Z',
    chart: {
      title,
      chartFingerprint,
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 0,
      notes: [],
    },
    inputs: [{ seq: 0, timeUs: 1000, action: 'down', channels: ['11'] }],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', judgeRuleset: 'lr2' },
  };
}

function courseLog(): BeMusicCourseReplay {
  return {
    format: 'be-music-course-replay',
    version: 0,
    createdAt: '2026-10-26T03:00:00.000Z',
    course: { name: 'FIX GRADE', kind: 'grade', constraints: [], trophies: [] },
    stages: [{ played: true, replay: replay() }],
  };
}

function score(exScore: number, noteCount = 100): RecordPlay & { noteCount: number } {
  return { lamp: 'NORMAL', exScore, maxCombo: 10, missCount: 3, noteCount };
}

function record(key: string, size: number, exRate: number, savedAt = '2026-10-26T00:00:00.000Z'): ReplaySlotRecord {
  return {
    version: 1,
    key,
    target: CHART,
    slot: 0,
    savedAt,
    size,
    title: key,
    exScore: 0,
    exRate,
    lamp: 'NORMAL',
  };
}

describe('replay slot keys and targets', () => {
  test('keys a slot by its kind, its target and its number', () => {
    expect(replaySlotKey(CHART, 2)).toBe('chart:bmfp0:aaaa#2');
    expect(replaySlotKey({ kind: 'course', id: 'bmcourse0:cc' }, 0)).toBe('course:bmcourse0:cc#0');
  });

  test('takes a chart by its fingerprint, else by its file hash', () => {
    expect(chartReplaySlotTarget({ chartFingerprint: 'bmfp0:x', sha256: 'ab' })).toEqual({
      kind: 'chart',
      id: 'bmfp0:x',
    });
    expect(chartReplaySlotTarget({ sha256: 'ab' })).toEqual({ kind: 'chart', id: 'sha256:ab' });
    expect(chartReplaySlotTarget({})).toBeUndefined();
  });
});

describe('auto-save rules', () => {
  const previous = { lamp: 'NORMAL' as const, exScore: 100, maxCombo: 50, missCount: 5 };
  const same: RecordPlay = { lamp: 'NORMAL', exScore: 100, maxCombo: 50, missCount: 5 };
  const better: RecordPlay = { lamp: 'HARD', exScore: 101, maxCombo: 51, missCount: 4 };

  test.each([
    ['never', false, false],
    ['score-update', false, true],
    ['score-update-or-equal', true, true],
    ['miss-count-update', false, true],
    ['miss-count-update-or-equal', true, true],
    ['max-combo-update', false, true],
    ['max-combo-update-or-equal', true, true],
    ['clear-update', false, true],
    ['clear-update-or-equal', true, true],
    ['any-update', false, true],
    ['always', true, true],
  ] as const)('%s: an equal play %s, a better one %s', (rule, onEqual, onBetter) => {
    expect(qualifiesReplayAutoSave(rule, previous, same)).toBe(onEqual);
    expect(qualifiesReplayAutoSave(rule, previous, better)).toBe(onBetter);
  });

  test('counts a first play as an update of every kind, as beatoraja reads an empty score', () => {
    const first: RecordPlay = { lamp: 'FAILED', exScore: 0, maxCombo: 0, missCount: 99 };
    expect(qualifiesReplayAutoSave('miss-count-update', undefined, first)).toBe(true);
    expect(qualifiesReplayAutoSave('clear-update', undefined, first)).toBe(true);
    expect(qualifiesReplayAutoSave('score-update', undefined, first)).toBe(false);
    expect(qualifiesReplayAutoSave('score-update-or-equal', undefined, first)).toBe(true);
  });

  test('picks the slots whose rule the play meets', () => {
    expect(resolveReplayAutoSaveSlots(['always', 'never', 'score-update', 'clear-update'], previous, better)).toEqual([
      0, 2, 3,
    ]);
  });

  test('reads stored rules back as four, an unknown one as never', () => {
    expect(normalizeReplayAutoSaveRules(['always', 'bogus'])).toEqual(['always', 'never', 'never', 'never']);
    expect(normalizeReplayAutoSaveRules(undefined)).toEqual(['never', 'never', 'never', 'never']);
  });
});

describe('planReplaySlotEviction', () => {
  test('removes nothing while the budget holds', () => {
    expect(planReplaySlotEviction([record('a', 40, 0.5)], record('b', 60, 0.1), 100)).toEqual([]);
  });

  test('removes the lowest EX rates first, the older save first on a tie', () => {
    const records = [
      record('a', 40, 0.9),
      record('b', 40, 0.2, '2026-10-02T00:00:00.000Z'),
      record('c', 40, 0.2, '2026-10-01T00:00:00.000Z'),
    ];
    expect(planReplaySlotEviction(records, record('d', 40, 0.8), 100)?.map((entry) => entry.key)).toEqual(['c', 'b']);
  });

  test('does not count the replay a slot replaces', () => {
    expect(planReplaySlotEviction([record('a', 90, 0.1)], record('a', 90, 0.5), 100)).toEqual([]);
  });

  test('refuses a replay that would be the worst left over the budget, or that is larger than it', () => {
    expect(planReplaySlotEviction([record('a', 60, 0.9)], record('b', 60, 0.1), 100)).toBeUndefined();
    expect(planReplaySlotEviction([], record('b', 101, 1), 100)).toBeUndefined();
  });
});

describe('parseReplaySlotRecord', () => {
  test('reads a record of this version back, and nothing else', () => {
    const stored = { ...record(replaySlotKey(CHART, 0), 10, 0.5) };
    expect(parseReplaySlotRecord(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(parseReplaySlotRecord({ ...stored, version: 2 })).toBeUndefined();
    expect(parseReplaySlotRecord({ ...stored, slot: 4 })).toBeUndefined();
    expect(parseReplaySlotRecord({ ...stored, key: 'chart:other#0' })).toBeUndefined();
    expect(parseReplaySlotRecord(null)).toBeUndefined();
  });
});

describe('ReplaySlotStore', () => {
  test('compresses a replay and reads it back', async () => {
    const text = JSON.stringify(replay());
    const data = await compressReplayText(text);
    expect(data.type).toBe('application/gzip');
    expect(await decompressReplayText(data)).toBe(text);
  });

  test('saves a play into a slot, lists it and plays it back', async () => {
    const backend = createMemoryReplaySlotBackend();
    const store = new ReplaySlotStore({ backend, now: () => new Date('2026-10-26T04:00:00.000Z') });
    await store.load();
    expect(store.exists(CHART)).toEqual([false, false, false, false]);
    const outcome = await store.save(CHART, 1, { kind: 'chart', replay: replay() }, score(150), 'Fixture A');
    expect(outcome).toMatchObject({ saved: true, evicted: [] });
    expect(store.exists(CHART)).toEqual([false, true, false, false]);
    expect(store.slots(CHART)[1]).toMatchObject({
      title: 'Fixture A',
      exScore: 150,
      exRate: 0.75,
      savedAt: '2026-10-26T04:00:00.000Z',
    });
    expect(store.exists(OTHER)).toEqual([false, false, false, false]);
    expect(await store.read(CHART, 1)).toEqual({ kind: 'chart', replay: replay() });
    expect(await store.read(CHART, 0)).toBeUndefined();
    // A store made again reads the slots back from the backend.
    const reloaded = new ReplaySlotStore({ backend });
    await reloaded.load();
    expect(reloaded.exists(CHART)).toEqual([false, true, false, false]);
  });

  test('keeps a course run in a slot of its course', async () => {
    const store = new ReplaySlotStore({ backend: createMemoryReplaySlotBackend() });
    const course: ReplaySlotTarget = { kind: 'course', id: 'bmcourse0:cc' };
    await store.save(course, 3, { kind: 'course', replay: courseLog() }, score(10), 'FIX GRADE');
    expect(store.exists(course)).toEqual([false, false, false, true]);
    expect(await store.read(course, 3)).toEqual({ kind: 'course', replay: courseLog() });
  });

  test('makes room by removing the worst-scoring replays, and refuses one that would be the worst', async () => {
    const backend = createMemoryReplaySlotBackend();
    const probe = (await compressReplayText(JSON.stringify(replay()))).size;
    const store = new ReplaySlotStore({ backend, budgetBytes: probe * 2 });
    await store.save(CHART, 0, { kind: 'chart', replay: replay() }, score(100), 'A');
    await store.save(CHART, 1, { kind: 'chart', replay: replay() }, score(50), 'A');
    const changes: number[] = [];
    store.subscribe(() => changes.push(store.totalBytes));
    const kept = await store.save(OTHER, 0, { kind: 'chart', replay: replay() }, score(180), 'B');
    expect(kept.saved && kept.evicted.map((entry) => entry.key)).toEqual([replaySlotKey(CHART, 1)]);
    expect(store.exists(CHART)).toEqual([true, false, false, false]);
    expect(backend.data.has(replaySlotKey(CHART, 1))).toBe(false);
    expect(changes).toHaveLength(1);
    expect(await store.save(OTHER, 1, { kind: 'chart', replay: replay() }, score(10), 'B')).toEqual({
      saved: false,
      reason: 'budget',
    });
    expect(store.exists(OTHER)).toEqual([true, false, false, false]);
  });

  test('leaves every slot as it was when the browser refuses the write', async () => {
    const backend = createMemoryReplaySlotBackend();
    const store = new ReplaySlotStore({ backend });
    await store.save(CHART, 0, { kind: 'chart', replay: replay('Old') }, score(10), 'Old');
    const quota = new DOMException('full', 'QuotaExceededError');
    const failing: ReplaySlotBackend = { ...backend, write: () => Promise.reject(quota) };
    const refused = new ReplaySlotStore({ backend: failing });
    const outcome = await refused.save(CHART, 0, { kind: 'chart', replay: replay('New') }, score(90), 'New');
    expect(outcome).toEqual({ saved: false, reason: 'storage', error: quota });
    expect(refused.slots(CHART)[0]?.title).toBe('Old');
  });

  test('empties a slot', async () => {
    const store = new ReplaySlotStore({ backend: createMemoryReplaySlotBackend() });
    await store.save(CHART, 2, { kind: 'chart', replay: replay() }, score(10), 'A');
    await store.remove(CHART, 2);
    expect(store.exists(CHART)).toEqual([false, false, false, false]);
  });

  test('has no slot when the backend cannot list them', async () => {
    const backend: ReplaySlotBackend = {
      ...createMemoryReplaySlotBackend(),
      listRecords: () => Promise.reject(new Error('blocked')),
    };
    const store = new ReplaySlotStore({ backend });
    await store.load();
    expect(store.exists(CHART)).toEqual([false, false, false, false]);
  });
});
