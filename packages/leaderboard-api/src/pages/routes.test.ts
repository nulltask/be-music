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

// Tests never reach BMS Search: a submission's background chartset lookup finds nothing.
const noChartsets = async () => undefined;

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 13, 12);
const app = createApp({ now: () => (clock += 60_000), chartsetLookup: noChartsets });
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
  const response = await fetchApp('/api/v0/scores', {
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

const page = async (path: string, cookie?: string) => {
  const response = await fetchApp(path, cookie !== undefined ? { headers: { cookie } } : undefined);
  return { status: response.status, html: await response.text(), cacheControl: response.headers.get('cache-control') };
};

describe('site icons', () => {
  test('every page links the icons, which are served with their types, and the manifest lists them', async () => {
    const top = await page('/leaderboard');
    const favicon = /<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/.exec(top.html)?.[1];
    const appleTouch = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(top.html)?.[1];
    expect(favicon).toMatch(/^\/leaderboard\/assets\/icon\.[0-9a-f]{12}\.svg$/);
    expect(appleTouch).toMatch(/^\/leaderboard\/assets\/apple-touch-icon\.[0-9a-f]{12}\.png$/);
    expect(top.html).toContain('<link rel="manifest" href="/leaderboard/manifest.webmanifest"');

    const svg = await fetchApp(favicon!);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(svg.headers.get('cache-control')).toContain('immutable');
    expect(await svg.text()).toContain('<svg');
    const png = new Uint8Array(await (await fetchApp(appleTouch!)).arrayBuffer());
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const manifest = (await (await fetchApp('/leaderboard/manifest.webmanifest')).json()) as {
      start_url: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest.start_url).toBe('/leaderboard');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
    expect((await fetchApp(manifest.icons[1]!.src)).status).toBe(200);
  });
});

describe('API reference', () => {
  test('serves the OpenAPI document and the reference page that reads it', async () => {
    const document = await fetchApp('/api/v0/openapi.json');
    expect(document.status).toBe(200);
    const spec = (await document.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths).toHaveProperty('/scores');
    expect(spec.paths).not.toHaveProperty('/openapi.json');

    const reference = await page('/leaderboard/api');
    expect(reference.status).toBe(200);
    expect(reference.html).toContain('/api/v0/openapi.json');
    expect(reference.html).toContain('@scalar/api-reference@1.72.4');
  });
});

describe('Leaderboard pages', () => {
  const chart = makeChart(['#00111:0101', '#00211:010101', '#00311:01010101']);
  const evil = '<script>alert(1)</script>';
  let firstScore: string;
  let firstHandle: string;

  test('the top page shows every play by a player who is not anonymous, new charts included', async () => {
    const alice = await signInAnonymously(fetchApp);
    const bob = await signInAnonymously(fetchApp);
    firstScore = await submit(alice, chart, 9, evil);
    await submit(bob, chart, 4, evil, 3);

    // Anonymous plays stay off the default view.
    const before = await page('/leaderboard');
    expect(before.status).toBe(200);
    expect(before.html).toContain('No plays here yet');
    expect(before.cacheControl).toBe('private, max-age=0');

    // Once a player keeps their account (what registering a passkey does), their play shows, on a chart that is not
    // listed yet (one player so far) and so is tagged as new.
    const db = openDatabase(env.DB);
    await claimAccount(db, await userIdOf(alice));
    const one = await page('/leaderboard');
    expect(one.html.match(/\/leaderboard\/scores\//g)).toHaveLength(1);
    expect(one.html).toContain('new chart');

    // A second such player lists the chart, so the tag goes.
    await claimAccount(db, await userIdOf(bob));
    const listed = await page('/leaderboard/');
    expect(listed.html.match(/\/leaderboard\/scores\//g)).toHaveLength(2);
    expect(listed.html).not.toContain('new chart');
    // Player-controlled text is escaped, never rendered as markup.
    expect(listed.html).not.toContain(evil);
    expect(listed.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const me = (await (await fetchApp('/api/v0/me', { headers: { cookie: alice } })).json()) as { handle: string };
    firstHandle = me.handle;
  });

  test('the anonymous filter brings in anonymous players', async () => {
    const other = makeChart(['#00111:01010101', '#00211:01']);
    const carol = await signInAnonymously(fetchApp);
    await submit(carol, other, 5, 'Only Carol');

    expect((await page('/leaderboard')).html).not.toContain('Only Carol');
    const withAnonymous = await page('/leaderboard?anonymous=1');
    expect(withAnonymous.html).toContain('Only Carol');
    expect(withAnonymous.html).toContain('new chart');
  });

  test('the score, chart and player pages render with their sharing tags', async () => {
    const score = await page(`/leaderboard/scores/${firstScore}`);
    expect(score.status).toBe(200);
    expect(score.html).toContain('property="og:title"');
    expect(score.html).toContain('LR2 rules');
    expect(score.html).toContain('Scored with');
    expect(score.html).toContain('beatoraja');
    expect(score.html).toContain('IIDX');
    expect(score.html).toContain(`/api/v0/scores/${firstScore}/playlog`);

    const ranking = await page(`/leaderboard/charts/${encodeURIComponent(chart.chartFingerprint)}`);
    expect(ranking.status).toBe(200);
    expect(ranking.html).toContain('2 players');
    // Ranked by EX score: 18 (nine PGREATs) above 8.
    // EX-Score with its maximum and rate: ten notes make a maximum of 20.
    expect(ranking.html.indexOf('>18 / 20 (90.00%)<')).toBeGreaterThan(0);
    expect(ranking.html.indexOf('>18 / 20 (90.00%)<')).toBeLessThan(ranking.html.indexOf('>8 / 20 (40.00%)<'));
    // A row opens the player's best play, and its info icon opens the play's details.
    expect(ranking.html).toContain('aria-label="Best play of');
    expect(ranking.html).toContain('popovertarget="info-');
    expect(ranking.html).toContain('popover="auto"');
    // The card is a tooltip anchored to its icon.
    expect(ranking.html).toMatch(/data-tooltip-for="(info-[^"]+)"[^>]*style="anchor-name:--\1"/);
    expect(ranking.html).toContain('position-area:block-end span-inline-start');
    expect(ranking.html).toContain('Recorded with');
    // The breadcrumb trail starts at the Leaderboard.
    expect(ranking.html).toContain('aria-label="Breadcrumb"');
    // Elsewhere: no file hash was recorded for this chart, so only the title search on BMS Search, encoded.
    expect(ranking.html).toContain('https://bmssearch.net/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(ranking.html).not.toContain('mocha-repository.info');
    // Chart details and figures: the play log's metadata, the play counts and the lamp spread.
    expect(ranking.html).toContain('>Judge rank<');
    expect(ranking.html).toContain('>First played<');
    expect(ranking.html).toContain('>Clear lamps<');

    const player = await page(`/leaderboard/players/${firstHandle}`);
    expect(player.status).toBe(200);
    expect(player.html).toContain(`@${firstHandle}`);
    // Player figures: plays, charts, the lamp and DJ Rank spreads of their bests, and the rulesets they played under.
    expect(player.html).toContain('>Average rate (LR2 rules)<');
    expect(player.html).toContain('>DJ Ranks<');
    expect(player.html).toContain('>Played under<');
  });

  test('the display ruleset is one setting for every page, switched without changing page URLs', async () => {
    const back = `/leaderboard/charts/${encodeURIComponent(chart.chartFingerprint)}?assisted=0`;
    const switched = await fetchApp(`/leaderboard/ruleset/beatoraja?next=${encodeURIComponent(back)}`);
    expect(switched.status).toBe(303);
    expect(switched.headers.get('location')).toBe(back);
    const setCookie = switched.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^lb-ruleset=beatoraja;/);
    expect(setCookie).toContain('Path=/leaderboard');
    const cookie = setCookie.split(';')[0]!;

    // Every page now reads beatoraja: the header switch marks it, the score page marks it as shown.
    const top = await page('/leaderboard', cookie);
    expect(top.html).toContain('scored under beatoraja');
    expect(top.html).toMatch(/data-variant="primary" aria-current="true"[^>]*>beatoraja</);
    const score = await page(`/leaderboard/scores/${firstScore}`, cookie);
    expect(score.html).toMatch(/<tr data-state="selected">.*?beatoraja.*?>shown<\/span>/);
    // Without the cookie, LR2.
    expect((await page('/leaderboard')).html).toContain('scored under LR2');

    // An unknown ruleset changes nothing, and the switch never redirects off the Leaderboard.
    const unknown = await fetchApp('/leaderboard/ruleset/popn?next=https://evil.example/');
    expect(unknown.status).toBe(303);
    expect(unknown.headers.get('location')).toBe('/leaderboard');
    expect(unknown.headers.get('set-cookie')).toBeNull();
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
