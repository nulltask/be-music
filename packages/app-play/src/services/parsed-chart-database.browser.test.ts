import { executeBrowserTask, type ParseChartTaskResult } from '@be-music/player-browser/compute';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import { createIndexedDBParsedChartCache, PARSED_CHART_DB_NAME } from './parsed-chart-database.ts';

function resetDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PARSED_CHART_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

beforeEach(resetDatabase);
afterEach(resetDatabase);

function parseFixture(title: string, objects: string): ParseChartTaskResult {
  return executeBrowserTask('parse-chart', {
    path: 'chart.bms',
    bytes: new TextEncoder().encode(`#TITLE ${title}\n#BPM 120\n#00111:${objects}\n`),
  }) as ParseChartTaskResult;
}

test('a reopened cache reads the same build’s parsed charts in query order, including repeated keys and misses', async () => {
  const firstPage = createIndexedDBParsedChartCache('build-a')!;
  const north = parseFixture('North', '01');
  const south = parseFixture('South', '0101');
  await firstPage.set('north:bms', north);
  await firstPage.set('south:bms', south);

  const reopened = createIndexedDBParsedChartCache('build-a')!;
  const charts = await reopened.getMany!(['south:bms', 'missing:bms', 'north:bms', 'south:bms']);
  expect(charts).toEqual([south, undefined, north, south]);
  expect(charts[0]).not.toBe(south);
  expect(charts[0]).not.toBe(charts[3]);
});

test('a build change invalidates old parser output and retains the replacement after reopening', async () => {
  const old = createIndexedDBParsedChartCache('build-a')!;
  await old.set('same-file:bms', parseFixture('Reparse me', '01'));
  expect((await old.get('same-file:bms'))?.scored.notes).toBe(1);

  const upgraded = createIndexedDBParsedChartCache('build-b')!;
  expect(await upgraded.get('same-file:bms')).toBeUndefined();
  // A changed parser can return a different note count for the same file key.
  await upgraded.set('same-file:bms', parseFixture('Reparse me', '010101'));
  const reloaded = createIndexedDBParsedChartCache('build-b')!;
  expect((await reloaded.get('same-file:bms'))?.scored.notes).toBe(3);
});
