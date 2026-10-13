import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createApp } from '../app.ts';
import { openDatabase } from '../db/client.ts';
import { chart } from '../db/schema.ts';
import type { Env } from '../env.ts';
import {
  makeChart,
  makePlaylog,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  submissionBody,
} from '../../test/support.ts';
import type { BmsSearchPattern } from './bms-search.ts';
import {
  RECHECK_LINKED_MS,
  RECHECK_UNLINKED_MS,
  refreshChartset,
  refreshStaleChartsets,
  type ChartsetLookup,
} from './refresh.ts';

let env: Env;
let dispose: () => Promise<void>;
const NOW = Date.UTC(2026, 9, 13, 12);
const app = createApp({ now: () => NOW });
const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

/** Submits one play of a fresh chart whose file has the given SHA-256, and returns the chart fingerprint. */
async function submitChart(cookie: string, lines: string[], sha256: string, title: string): Promise<string> {
  const testChart = makeChart(lines);
  const playlog = makePlaylog(testChart, { noteCount: 4, hits: 4 });
  playlog.chart.title = title;
  playlog.chart.sha256 = sha256;
  const response = await fetchApp('/api/v0/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie },
    body: submissionBody(playlog, testChart.playDocument, testChart.chartDocument),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { chartFingerprint: string }).chartFingerprint;
}

/** A lookup answering from a table of SHA-256 → pattern, counting its calls. */
function stubLookup(answers: Record<string, BmsSearchPattern>) {
  const calls: string[] = [];
  const lookup: ChartsetLookup = async (aliases) => {
    const hash = aliases.find((alias) => alias.kind === 'sha256')?.hash ?? '';
    calls.push(hash);
    return answers[hash];
  };
  return { lookup, calls };
}

describe('chartsets', () => {
  const original = '1'.repeat(64);
  const addOn = '2'.repeat(64);
  const unknown = '3'.repeat(64);
  let originalFp: string;
  let addOnFp: string;
  let unknownFp: string;

  test('files charts under the work BMS Search links them to, and leaves unknown charts alone', async () => {
    const cookie = await signInAnonymously(fetchApp);
    originalFp = await submitChart(cookie, ['#00111:01010101'], original, 'Work [NORMAL]');
    addOnFp = await submitChart(cookie, ['#00111:0101', '#00211:0101'], addOn, 'Work [Add-on]');
    unknownFp = await submitChart(cookie, ['#00111:01', '#00211:01', '#00311:0101'], unknown, 'Lonely');

    const work = { id: 'work1', title: 'Work', event: 'BOF:TT' };
    const { lookup, calls } = stubLookup({
      [original]: { chartset: work, packType: 'included' },
      [addOn]: { chartset: work, packType: 'additional' },
    });
    const db = openDatabase(env.DB);
    expect(await refreshStaleChartsets(db, lookup, NOW)).toBe(3);
    expect(calls.sort()).toEqual([original, addOn, unknown].sort());

    const rows = await db.select().from(chart);
    const byFp = new Map(rows.map((row) => [row.chartFingerprint, row]));
    expect(byFp.get(originalFp)).toMatchObject({ chartsetId: 'work1', packType: 'included' });
    expect(byFp.get(addOnFp)).toMatchObject({ chartsetId: 'work1', packType: 'additional' });
    expect(byFp.get(unknownFp)).toMatchObject({ chartsetId: null, packType: null });
    expect(byFp.get(unknownFp)?.chartsetCheckedAt?.getTime()).toBe(NOW);

    // Nothing is due right after a run.
    expect(await refreshStaleChartsets(db, lookup, NOW + 1000)).toBe(0);
  });

  test('asks again about unlinked charts after a week and linked ones after a month', async () => {
    const db = openDatabase(env.DB);
    const { lookup, calls } = stubLookup({});
    expect(await refreshStaleChartsets(db, lookup, NOW + RECHECK_UNLINKED_MS + 1)).toBe(1);
    expect(calls).toEqual([unknown]);
    // Three weeks on, nothing linked is due yet.
    calls.length = 0;
    expect(await refreshStaleChartsets(db, lookup, NOW + RECHECK_UNLINKED_MS + 2)).toBe(0);
    // A month on, the linked charts are due (and the unlinked one, a week past its last check, again too).
    expect(await refreshStaleChartsets(db, lookup, NOW + RECHECK_LINKED_MS + 1)).toBe(3);
    expect(calls.sort()).toEqual([original, addOn, unknown].sort());
    // BMS Search no longer links them: they leave the chartset.
    const [row] = await db.select().from(chart).where(eq(chart.chartFingerprint, originalFp));
    expect(row?.chartsetId).toBeNull();
  });

  test('keeps a chart unchecked when BMS Search cannot be reached', async () => {
    const db = openDatabase(env.DB);
    await db.update(chart).set({ chartsetCheckedAt: null }).where(eq(chart.chartFingerprint, unknownFp));
    const failing: ChartsetLookup = async () => {
      throw new Error('offline');
    };
    await refreshChartset(db, failing, unknownFp, NOW);
    const [row] = await db.select().from(chart).where(eq(chart.chartFingerprint, unknownFp));
    expect(row?.chartsetCheckedAt).toBeNull();
  });

  test('the chartset page lists the original charts before the add-ons, and the chart page links to it', async () => {
    const db = openDatabase(env.DB);
    const work = { id: 'work1', title: 'Work', event: 'BOF:TT' };
    const { lookup } = stubLookup({
      [original]: { chartset: work, packType: 'included' },
      [addOn]: { chartset: work, packType: 'additional' },
    });
    await refreshChartset(db, lookup, originalFp, NOW);
    await refreshChartset(db, lookup, addOnFp, NOW);

    const response = await fetchApp('/leaderboard/chartsets/work1');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('BOF:TT');
    expect(html).toContain('https://bmssearch.net/bmses/work1');
    expect(html.indexOf('Work [NORMAL]')).toBeGreaterThan(0);
    expect(html.indexOf('Work [NORMAL]')).toBeLessThan(html.indexOf('Work [Add-on]'));
    expect(html).not.toContain('Lonely');

    const chartPage = await (await fetchApp(`/leaderboard/charts/${encodeURIComponent(addOnFp)}`)).text();
    expect(chartPage).toContain('href="/leaderboard/chartsets/work1"');
    expect(chartPage).toContain('add-on (差分)');

    expect((await fetchApp('/leaderboard/chartsets/nothing')).status).toBe(404);
  });
});
