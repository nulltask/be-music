import { executeBrowserTask, type ParseChartTaskResult } from '@be-music/player-browser/compute';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vite-plus/test';
import { createIndexedDBParsedChartCache, parsedChartBuildStamp } from './parsed-chart-database.ts';

describe('parsedChartBuildStamp', () => {
  test('joins the source revision and the build time', () => {
    expect(parsedChartBuildStamp({ revision: '0123abcd', builtAt: '2026-11-08T00:00:00.000Z' })).toBe(
      '0123abcd@2026-11-08T00:00:00.000Z',
    );
  });

  test('keeps the build time when the revision is unknown', () => {
    expect(parsedChartBuildStamp({ revision: 'unknown', builtAt: '2026-11-08T00:00:00.000Z' })).toBe(
      '@2026-11-08T00:00:00.000Z',
    );
  });

  test('is empty without build info', () => {
    expect(parsedChartBuildStamp(undefined)).toBe('');
    expect(parsedChartBuildStamp({ revision: 'unknown', builtAt: '' })).toBe('');
  });
});

describe('createIndexedDBParsedChartCache', () => {
  test('caches nothing without IndexedDB or a build stamp', () => {
    expect(createIndexedDBParsedChartCache('stamp', undefined)).toBeUndefined();
    expect(createIndexedDBParsedChartCache('', {} as IDBFactory)).toBeUndefined();
  });

  test('misses every lookup and keeps nothing when the database cannot be opened', async () => {
    const factory = {
      open: () => {
        throw new Error('blocked by the browser');
      },
    } as unknown as IDBFactory;
    const cache = createIndexedDBParsedChartCache('stamp', factory)!;
    expect(await cache.get('abc:bms')).toBeUndefined();
    expect(await cache.getMany!(['abc:bms', 'def:pms'])).toEqual([undefined, undefined]);
    await expect(cache.set('abc:bms', {} as never)).resolves.toBeUndefined();
  });
});

function parseFixture(title: string, objects: string): ParseChartTaskResult {
  return executeBrowserTask('parse-chart', {
    path: 'chart.bms',
    bytes: new TextEncoder().encode(`#TITLE ${title}\n#BPM 120\n#00111:${objects}\n`),
  }) as ParseChartTaskResult;
}

test('a new page can read the same build’s cached charts in query order, including repeated keys and misses', async () => {
  const factory = new IDBFactory();
  const firstPage = createIndexedDBParsedChartCache('build-a', factory)!;
  await firstPage.set('north:bms', parseFixture('North', '01'));
  await firstPage.set('south:bms', parseFixture('South', '0101'));

  const reopened = createIndexedDBParsedChartCache('build-a', factory)!;
  const charts = await reopened.getMany!(['south:bms', 'missing:bms', 'north:bms', 'south:bms']);
  expect(charts.map((cached) => cached && [cached.chart.metadata.title, cached.scored.notes])).toEqual([
    ['South', 2],
    undefined,
    ['North', 1],
    ['South', 2],
  ]);
});

test('a build change invalidates old parser output and retains the replacement across page loads', async () => {
  const factory = new IDBFactory();
  const old = createIndexedDBParsedChartCache('build-a', factory)!;
  await old.set('same-file:bms', parseFixture('Reparse me', '01'));
  expect((await old.get('same-file:bms'))?.scored.notes).toBe(1);

  const upgraded = createIndexedDBParsedChartCache('build-b', factory)!;
  expect(await upgraded.get('same-file:bms')).toBeUndefined();
  // A changed parser can return a different note count for the same file key.
  await upgraded.set('same-file:bms', parseFixture('Reparse me', '010101'));
  const reloaded = createIndexedDBParsedChartCache('build-b', factory)!;
  expect((await reloaded.get('same-file:bms'))?.scored.notes).toBe(3);
});
