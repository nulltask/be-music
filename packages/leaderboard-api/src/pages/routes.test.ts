import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { claimAccount } from '../accounts.ts';
import { createApp } from '../app.ts';
import { openDatabase } from '../db/client.ts';
import type { Env } from '../env.ts';
import {
  makeChart,
  makePlaylog,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  submissionBody,
  type TestChart,
} from '../../test/support.ts';

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 13, 12);
const app = createApp({ now: () => (clock += 60_000) });
const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

async function submit(cookie: string, chart: TestChart, hits: number, title: string, skip = 0) {
  const playlog = makePlaylog(chart, { noteCount: 10, hits, skip });
  playlog.chart.title = title;
  playlog.chart.artist = 'Artist';
  const response = await fetchApp('/api/v1/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie },
    body: submissionBody(playlog, chart.playDocument, chart.chartDocument),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { scoreId: string }).scoreId;
}

async function userIdOf(cookie: string): Promise<string> {
  const session = await fetchApp('/api/auth/get-session', { headers: { cookie } });
  return ((await session.json()) as { user: { id: string } }).user.id;
}

const page = async (path: string) => {
  const response = await fetchApp(path);
  return { status: response.status, html: await response.text(), cacheControl: response.headers.get('cache-control') };
};

describe('Leaderboard pages', () => {
  const chart = makeChart(['#00111:0101', '#00211:010101', '#00311:01010101']);
  const evil = '<script>alert(1)</script>';
  let firstScore: string;
  let firstHandle: string;

  test('the top page lists only charts two non-anonymous players have played', async () => {
    const alice = await signInAnonymously(fetchApp);
    const bob = await signInAnonymously(fetchApp);
    firstScore = await submit(alice, chart, 9, evil);
    await submit(bob, chart, 4, evil, 3);

    // Two anonymous players do not list a chart.
    const before = await page('/leaderboard');
    expect(before.status).toBe(200);
    expect(before.html).toContain('No plays here yet');
    expect(before.cacheControl).toBe('public, max-age=0, s-maxage=30');

    // Both players keep their accounts (what registering a passkey does); the chart is now listed.
    const db = openDatabase(env.DB);
    await claimAccount(db, await userIdOf(alice));
    expect((await page('/leaderboard')).html).toContain('No plays here yet');
    await claimAccount(db, await userIdOf(bob));

    const listed = await page('/leaderboard/');
    expect(listed.html).not.toContain('No plays here yet');
    expect(listed.html.match(/\/leaderboard\/scores\//g)).toHaveLength(2);
    // Player-controlled text is escaped, never rendered as markup.
    expect(listed.html).not.toContain(evil);
    expect(listed.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const me = (await (await fetchApp('/api/v1/me', { headers: { cookie: alice } })).json()) as { handle: string };
    firstHandle = me.handle;
  });

  test('the filters bring in new charts and anonymous players', async () => {
    const other = makeChart(['#00111:01010101', '#00211:01']);
    const carol = await signInAnonymously(fetchApp);
    await submit(carol, other, 5, 'Only Carol');

    expect((await page('/leaderboard')).html).not.toContain('Only Carol');
    expect((await page('/leaderboard?charts=all')).html).not.toContain('Only Carol'); // still anonymous
    const both = await page('/leaderboard?charts=all&anonymous=1');
    expect(both.html).toContain('Only Carol');
    expect(both.html).toContain('new chart');
  });

  test('the score, chart and player pages render with their sharing tags', async () => {
    const score = await page(`/leaderboard/scores/${firstScore}`);
    expect(score.status).toBe(200);
    expect(score.html).toContain('property="og:title"');
    expect(score.html).toContain('LR2');
    expect(score.html).toContain('beatoraja');
    expect(score.html).toContain('IIDX');
    expect(score.html).toContain(`/api/v1/scores/${firstScore}/playlog`);

    const ranking = await page(`/leaderboard/charts/${encodeURIComponent(chart.chartFingerprint)}?ruleset=beatoraja`);
    expect(ranking.status).toBe(200);
    expect(ranking.html).toContain('2 players');
    // Ranked by EX score: 18 (nine PGREATs) above 8.
    expect(ranking.html.indexOf('>18<')).toBeLessThan(ranking.html.indexOf('>8<'));

    const player = await page(`/leaderboard/players/${firstHandle}`);
    expect(player.status).toBe(200);
    expect(player.html).toContain(`@${firstHandle}`);
  });

  test('unknown pages, scores, charts and players are 404 pages', async () => {
    for (const path of [
      '/leaderboard/scores/missing',
      '/leaderboard/charts/bmfp0%3Amissing',
      '/leaderboard/players/nobody',
      '/leaderboard/whatever',
    ]) {
      const response = await page(path);
      expect(response.status).toBe(404);
      expect(response.html).toContain('Not found');
    }
  });
});
