import type { BeMusicCourseReplay, BeMusicReplay } from '@be-music/player-engine/replay';
import type { RecordPlay } from '@be-music/player-engine/records';
import { describe, expect, test } from 'vite-plus/test';
import {
  chartReplaySlotTarget,
  compressReplayText,
  createMemoryReplaySlotBackend,
  DEFAULT_REPLAY_AUTO_SAVE_RULES,
  decompressReplayText,
  normalizeReplayAutoSaveRules,
  parseReplaySlotRecord,
  planReplayHistoryEviction,
  parseReplayHistoryRecord,
  qualifiesReplayAutoSave,
  replaySlotKey,
  ReplaySlotStore,
  resolveReplayAutoSaveSlots,
  type ReplayHistoryRecord,
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
    inputs: [{ seq: 0, timeUs: 1000, action: 'down', channels: ['11'], source: 0 }],
    play: {
      inputSources: [{ id: 0, kind: 'key', device: 'keyboard', label: 'z' }],
      mode: 'manual',
      autoScratch: false,
      gauge: 'GROOVE',
      judgeRuleset: 'lr2',
    },
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
    version: 0,
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

  test("reads stored rules back as four, an unknown one as the slot's default", () => {
    expect(normalizeReplayAutoSaveRules(['always', 'bogus'])).toEqual([
      'always',
      'clear-update',
      'miss-count-update',
      'always',
    ]);
    expect(normalizeReplayAutoSaveRules(undefined)).toEqual(DEFAULT_REPLAY_AUTO_SAVE_RULES);
  });
});

describe('planReplayHistoryEviction', () => {
  const entry = (key: string, size: number, age: number, slots: number[] = []): ReplayHistoryRecord => ({
    ...record(key, size, 0.5, `2026-10-26T00:00:0${age}.000Z`),
    slots,
  });

  test('removes oldest unselected entries first, preserving slots', () => {
    const selected = entry('selected', 40, 0, [0]);
    const oldest = entry('oldest', 20, 1);
    const latest = entry('latest', 30, 2);
    expect(planReplayHistoryEviction([latest, selected, oldest], 30, 100)).toEqual([oldest]);
    expect(planReplayHistoryEviction([latest, selected, oldest], 10, 100)).toEqual([]);
    expect(planReplayHistoryEviction([latest, selected, oldest], 70, 100)).toBeUndefined();
  });
});

describe('parseReplaySlotRecord', () => {
  test('reads a record of this version back, and nothing else', () => {
    const stored = { ...record(replaySlotKey(CHART, 0), 10, 0.5) };
    expect(parseReplaySlotRecord(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(parseReplaySlotRecord({ ...stored, version: 1 })).toBeUndefined();
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
    const outcome = await store.save(CHART, [1], { kind: 'chart', replay: replay() }, score(150), 'Fixture A');
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
    await store.save(course, [3], { kind: 'course', replay: courseLog() }, score(10), 'FIX GRADE');
    expect(store.exists(course)).toEqual([false, false, false, true]);
    expect(await store.read(course, 3)).toEqual({ kind: 'course', replay: courseLog() });
  });

  test('retains replaced replays until the history budget needs room and keeps selected entries', async () => {
    const backend = createMemoryReplaySlotBackend();
    const payload = { kind: 'chart' as const, replay: replay() };
    const probe = new ReplaySlotStore({ backend });
    await probe.save(CHART, [0], payload, score(100), 'First');
    const store = new ReplaySlotStore({ backend, budgetBytes: probe.totalBytes * 2 });
    const first = probe.history()[0]!;
    await store.save(CHART, [0, 1], payload, score(50), 'Second');
    expect(
      store
        .history(CHART)
        .map((entry) => entry.title)
        .sort(),
    ).toEqual(['First', 'Second']);
    expect(await store.readHistoryText(first.key)).toBeDefined();
    expect(store.slots(CHART)[0]?.key).toBe(store.slots(CHART)[1]?.key);
    expect(backend.data.size).toBe(2);
    const kept = await store.save(OTHER, [], payload, score(10), 'Third');
    expect(kept.saved && kept.evicted.map((entry) => entry.key)).toEqual([first.key]);
    expect(store.exists(CHART)).toEqual([true, true, false, false]);
    expect(store.exists(OTHER)).toEqual([false, false, false, false]);
    expect(backend.data.has(first.key)).toBe(false);
  });

  test('reads legacy slot metadata using its original data key', async () => {
    const backend = createMemoryReplaySlotBackend();
    const stored = record(replaySlotKey(CHART, 0), 10, 0.5);
    const parsed = parseReplayHistoryRecord(stored);
    expect(parsed).toMatchObject({ key: stored.key, slots: [0] });
    expect(parseReplayHistoryRecord({ ...parsed, slots: [4] })).toBeUndefined();
    const store = new ReplaySlotStore({ backend: { ...backend, listRecords: async () => [stored] } });
    backend.data.set(stored.key, await compressReplayText(JSON.stringify(replay())));
    await store.load();
    expect(store.history(CHART)).toEqual([parsed]);
    expect(await store.read(CHART, 0)).toEqual({ kind: 'chart', replay: replay() });
  });

  test('refreshes selections before writing when two open stores share the backend', async () => {
    const memory = createMemoryReplaySlotBackend();
    let queue: Promise<unknown> = Promise.resolve();
    const backend: ReplaySlotBackend = {
      ...memory,
      exclusive: (action) => {
        const pending = queue.then(action);
        queue = pending.catch(() => undefined);
        return pending;
      },
    };
    const first = new ReplaySlotStore({ backend });
    const second = new ReplaySlotStore({ backend });
    await Promise.all([first.load(), second.load()]);
    const payload = { kind: 'chart' as const, replay: replay() };
    await Promise.all([
      first.save(CHART, [0, 1], payload, score(100), 'First'),
      second.save(CHART, [0], payload, score(110), 'Second'),
    ]);
    const reloaded = new ReplaySlotStore({ backend });
    await reloaded.load();
    expect(
      reloaded
        .slots(CHART)
        .slice(0, 2)
        .map((entry) => entry?.title),
    ).toEqual(['Second', 'First']);
    expect(reloaded.history(CHART)).toHaveLength(2);
  });

  test('leaves every slot as it was when the browser refuses the write', async () => {
    const backend = createMemoryReplaySlotBackend();
    const store = new ReplaySlotStore({ backend });
    await store.save(CHART, [0], { kind: 'chart', replay: replay('Old') }, score(10), 'Old');
    const quota = new DOMException('full', 'QuotaExceededError');
    const failing: ReplaySlotBackend = { ...backend, write: () => Promise.reject(quota) };
    const refused = new ReplaySlotStore({ backend: failing });
    const outcome = await refused.save(CHART, [0], { kind: 'chart', replay: replay('New') }, score(90), 'New');
    expect(outcome).toEqual({ saved: false, reason: 'storage', error: quota });
    expect(refused.slots(CHART)[0]?.title).toBe('Old');
  });

  test('says when the slots have been read, even when the backend fails', async () => {
    const store = new ReplaySlotStore({ backend: createMemoryReplaySlotBackend() });
    expect(store.loaded).toBe(false);
    await store.load();
    expect(store.loaded).toBe(true);
    const failing: ReplaySlotBackend = {
      ...createMemoryReplaySlotBackend(),
      listRecords: () => Promise.reject(new Error('blocked')),
    };
    const refused = new ReplaySlotStore({ backend: failing });
    const changes: boolean[] = [];
    refused.subscribe(() => changes.push(refused.loaded));
    await refused.load();
    expect(changes).toEqual([true]);
    expect(refused.exists(CHART)).toEqual([false, false, false, false]);
  });

  test('empties a slot while retaining history, then deletes the replay and clears its remaining slot', async () => {
    const store = new ReplaySlotStore({ backend: createMemoryReplaySlotBackend() });
    await store.save(CHART, [1, 2], { kind: 'chart', replay: replay() }, score(10), 'A');
    await store.remove(CHART, 2);
    expect(store.exists(CHART)).toEqual([false, true, false, false]);
    const entry = store.history(CHART)[0]!;
    expect(entry.slots).toEqual([1]);
    await store.removeHistory(entry.key);
    expect(store.exists(CHART)).toEqual([false, false, false, false]);
    expect(store.history(CHART)).toEqual([]);
    expect(await store.readHistoryText(entry.key)).toBeUndefined();
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
