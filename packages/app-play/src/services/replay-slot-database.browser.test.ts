import { serializeReplay, type BeMusicReplay } from '@be-music/player-engine/replay';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { createIndexedDBReplaySlotBackend, REPLAY_SLOT_DB_NAME } from './replay-slot-database.ts';
import { compressReplayText, ReplaySlotStore, type ReplaySlotTarget } from './replay-slots.ts';

const CHART: ReplaySlotTarget = { kind: 'chart', id: 'bmfp0:aaaa' };

function resetDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(REPLAY_SLOT_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function replay(title: string): BeMusicReplay {
  return {
    format: 'be-music-replay',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      title,
      chartFingerprint: CHART.id,
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 0,
      notes: [],
    },
    inputs: [],
    play: { inputSources: [], mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
  };
}

function score(exScore: number) {
  return { lamp: 'NORMAL' as const, exScore, maxCombo: 10, missCount: 3, noteCount: 100 };
}

describe('replay history across IndexedDB sessions', () => {
  beforeEach(resetDatabase);
  afterAll(resetDatabase);

  function openStore(): ReplaySlotStore {
    return new ReplaySlotStore({ backend: createIndexedDBReplaySlotBackend() });
  }

  test('replaces one slot without losing the old replay, then deletes that replay after reopening the database', async () => {
    const initial = openStore();
    const first = replay('First take');
    const second = replay('Second take');
    expect(await initial.save(CHART, [0, 1], { kind: 'chart', replay: first }, score(100), 'First take')).toMatchObject(
      {
        saved: true,
      },
    );
    expect(await initial.save(CHART, [0], { kind: 'chart', replay: second }, score(120), 'Second take')).toMatchObject({
      saved: true,
    });

    const reloaded = openStore();
    await reloaded.load();
    expect(reloaded.slots(CHART).map((slot) => slot?.title)).toEqual([
      'Second take',
      'First take',
      undefined,
      undefined,
    ]);
    await expect(reloaded.read(CHART, 0)).resolves.toEqual({ kind: 'chart', replay: second });
    await expect(reloaded.read(CHART, 1)).resolves.toEqual({ kind: 'chart', replay: first });
    const oldKey = reloaded.slots(CHART)[1]!.key;
    await reloaded.removeHistory(oldKey);

    const afterDeletion = openStore();
    await afterDeletion.load();
    expect(afterDeletion.history(CHART).map(({ title, slots }) => [title, slots])).toEqual([['Second take', [0]]]);
    expect(afterDeletion.exists(CHART)).toEqual([true, false, false, false]);
    await expect(afterDeletion.read(CHART, 0)).resolves.toEqual({ kind: 'chart', replay: second });
    await expect(createIndexedDBReplaySlotBackend().readData(oldKey)).resolves.toBeUndefined();
  });

  test('rolls back a failed replay write and lets the old slot play after reopening the database', async () => {
    const store = openStore();
    const old = { kind: 'chart' as const, replay: replay('Before failure') };
    const next = { kind: 'chart' as const, replay: replay('After retry') };
    expect(await store.save(CHART, [0], old, score(100), 'Before failure')).toMatchObject({ saved: true });

    // Abort after both the metadata and compressed payload writes have been applied inside the transaction.
    const put = IDBObjectStore.prototype.put;
    const failPayload = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = put.call(this, value, key);
      if (this.name === 'replaySlotData') {
        request.addEventListener('success', () => this.transaction.abort(), { once: true });
      }
      return request;
    });
    try {
      expect(await store.save(CHART, [0], next, score(110), 'After retry')).toMatchObject({
        saved: false,
        reason: 'storage',
      });
    } finally {
      failPayload.mockRestore();
    }
    expect(store.slots(CHART)[0]?.title).toBe('Before failure');

    const reloaded = openStore();
    await reloaded.load();
    expect(reloaded.history(CHART).map(({ title, slots }) => [title, slots])).toEqual([['Before failure', [0]]]);
    await expect(reloaded.read(CHART, 0)).resolves.toEqual(old);
    expect(await reloaded.save(CHART, [0], next, score(110), 'After retry')).toMatchObject({ saved: true });
    await expect(reloaded.read(CHART, 0)).resolves.toEqual(next);
  });

  test('serializes same-slot writes from two independently loaded stores', async () => {
    expect(navigator.locks.request).toBeTypeOf('function');
    const left = openStore();
    const right = openStore();
    await Promise.all([left.load(), right.load()]);
    const titles = ['First take', 'Second take'] as const;

    const results = await Promise.all(
      [left, right].map((store, index) => {
        const title = titles[index]!;
        return store.save(CHART, [0], { kind: 'chart', replay: replay(title) }, score(100), title);
      }),
    );
    expect(results.map((result) => result.saved)).toEqual([true, true]);

    const reopened = openStore();
    await reopened.load();
    const history = reopened.history(CHART);
    expect(history.map(({ title }) => title).sort()).toEqual(titles);
    for (const entry of history) {
      await expect(reopened.readHistoryText(entry.key)).resolves.toBe(serializeReplay(replay(entry.title)));
    }
    const selected = history.filter(({ slots }) => slots.includes(0));
    expect(selected).toHaveLength(1);
    const currentTitle = selected[0]!.title;
    expect(reopened.slots(CHART)[0]?.title).toBe(currentTitle);
    await expect(reopened.read(CHART, 0)).resolves.toEqual({ kind: 'chart', replay: replay(currentTitle) });
  });

  test('opens a legacy database, retains a playable replay, and removes unrecognized and orphaned data', async () => {
    const key = 'chart:bmfp0:aaaa#0';
    const source = replay('Legacy take');
    const compressed = await compressReplayText(serializeReplay(source));
    // Version 1 held one slot per record and had no storage revision or meta store.
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(REPLAY_SLOT_DB_NAME, 1);
      open.onupgradeneeded = () => {
        const records = open.result.createObjectStore('replaySlots');
        records.put(
          {
            version: 0,
            key,
            target: CHART,
            slot: 0,
            savedAt: '2026-10-26T00:00:00.000Z',
            size: compressed.size,
            title: 'Legacy take',
            exScore: 100,
            exRate: 0.5,
            lamp: 'NORMAL',
          },
          key,
        );
        records.put({ version: 0, title: 'Broken' }, 'broken');
        const data = open.result.createObjectStore('replaySlotData');
        for (const storedKey of [key, 'broken', 'orphan']) data.put(compressed, storedKey);
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });

    const backend = createIndexedDBReplaySlotBackend();
    const migrated = new ReplaySlotStore({ backend });
    await migrated.load();
    expect(migrated.history(CHART).map(({ title, slots }) => [title, slots])).toEqual([['Legacy take', [0]]]);
    await expect(migrated.read(CHART, 0)).resolves.toEqual({ kind: 'chart', replay: source });
    await expect(backend.listRecords()).resolves.toEqual([
      expect.objectContaining({ key, slots: [0], title: 'Legacy take' }),
    ]);
    await expect(backend.readData('broken')).resolves.toBeUndefined();
    await expect(backend.readData('orphan')).resolves.toBeUndefined();
  });
});
