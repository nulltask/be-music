import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { claimAccount } from '../accounts.ts';
import { createApp } from '../app.ts';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../db/client.ts';
import { chart as chartTable } from '../db/schema.ts';
import type { Env } from '../env.ts';
import {
  makeChart,
  makeReplay,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  submissionBody,
  type TestChart,
} from '../test-support/support.ts';

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
  const replay = makeReplay(chart, { noteCount: 10, hits, skip });
  replay.chart.title = title;
  replay.chart.artist = 'Artist';
  const response = await fetchApp('/api/v0/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie },
    body: submissionBody(replay, chart.playDocument, chart.chartDocument),
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

describe('session cookies', () => {
  test('a page refreshes the session cookie cache it had to read from the database', async () => {
    const cookie = await signInAnonymously(fetchApp);
    // Only the session token, as when the five-minute cookie cache has expired: the session comes from D1, and the
    // response hands back a fresh cache so the next request need not ask D1 again.
    const token = cookie.split('; ').find((part) => part.includes('session_token='))!;
    const response = await fetchApp('/', { headers: { cookie: token } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('@player_');
    expect(response.headers.getSetCookie().some((set) => set.includes('session_data='))).toBe(true);
    // Signed out, nothing is set.
    expect((await fetchApp('/')).headers.getSetCookie()).toEqual([]);
  });
});

describe('page language', () => {
  const html = async (path: string, headers: Record<string, string> = {}) => (await fetchApp(path, { headers })).text();

  test('follows Accept-Language, a picked language, and ?lang=, in English otherwise', async () => {
    const english = await html('/');
    expect(english).toContain('<html lang="en"');
    expect(english).toContain('>Latest<');

    const japanese = await html('/', { 'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8' });
    expect(japanese).toContain('<html lang="ja"');
    expect(japanese).toContain('>最新<');

    expect(await html('/?lang=ja')).toContain('<html lang="ja"');
    expect(await html('/', { cookie: 'lb-lang=ja' })).toContain('<html lang="ja"');
    // ?lang= wins over the cookie, so a shared link shows its language.
    expect(await html('/?lang=en', { cookie: 'lb-lang=ja' })).toContain('<html lang="en"');
  });

  test('the language switch keeps the pick in a cookie and goes back to the page', async () => {
    const response = await fetchApp(`/lang/ja?next=${encodeURIComponent('/?anonymous=1')}`);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/?anonymous=1');
    expect(response.headers.get('set-cookie')).toContain('lb-lang=ja');

    const unknown = await fetchApp('/lang/xx?next=https://evil.example/');
    expect(unknown.headers.get('location')).toBe('/');
    expect(unknown.headers.get('set-cookie')).toBeNull();
  });

  test('every page without data reads in Japanese, the About and Help prose included', async () => {
    const ja = { 'accept-language': 'ja' };
    const about = await html('/about', ja);
    expect(about).toContain('<title>このサイトについて');
    expect(about).toContain('プレイの採点');
    expect(about).toContain('href="#replays"');
    expect(about).toContain('id="replays"');
    const help = await html('/help', ja);
    expect(help).toContain('>プレイの見方<');
    expect(help).toContain('クリアに届かなかった。');
    expect(help).toContain('id="lamps"');
    expect(await html('/settings', ja)).toContain('パスキーでログイン');
    const missing = await fetchApp('/players/nobody-here', { headers: ja });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('このプレイヤーは存在しないか、削除されました。');
  });
});

describe('about and help pages', () => {
  test('explains the scoring and is linked from the header of every page', async () => {
    const about = await page('/about');
    expect(about.status).toBe(200);
    expect(about.html).toContain('How a play is scored');
    expect(about.html).toContain('What sets it apart');
    expect(about.html).toContain('One play, three sets of rules');
    expect(about.html).toContain('id="replays"');
    expect(about.html).toContain('href="#replays"');
    expect(about.html).toContain('href="https://github.com/nulltask/be-music"');
    expect((await page('/')).html).toContain('href="/about"');
  });

  test('the help page gathers the lamp legend and the terms, and is linked from the header', async () => {
    const help = await page('/help');
    expect(help.status).toBe(200);
    for (const id of ['lamps', 'scores', 'judgments', 'rules', 'verification'])
      expect(help.html).toContain(`id="${id}"`);
    expect(help.html).toContain('EX HARD CLEAR');
    const top = await page('/');
    expect(top.html).toContain('href="/help"');
    expect(top.html).not.toContain('What the clear lamps mean');
  });
});

describe('site icons', () => {
  test('every page links the icons, which are served with their types, and the manifest lists them', async () => {
    const top = await page('/');
    const favicon = /<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/.exec(top.html)?.[1];
    const appleTouch = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(top.html)?.[1];
    expect(favicon).toMatch(/^\/assets\/icon\.[0-9a-f]{12}\.svg$/);
    expect(appleTouch).toMatch(/^\/assets\/apple-touch-icon\.[0-9a-f]{12}\.png$/);
    expect(top.html).toContain('<link rel="manifest" href="/manifest.webmanifest"');

    const svg = await fetchApp(favicon!);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(svg.headers.get('cache-control')).toContain('immutable');
    expect(await svg.text()).toContain('<svg');
    const png = new Uint8Array(await (await fetchApp(appleTouch!)).arrayBuffer());
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const manifest = (await (await fetchApp('/manifest.webmanifest')).json()) as {
      start_url: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest.start_url).toBe('/');
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

    const reference = await page('/api-reference');
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

  test('the top page shows plays of listed charts, and a player also their own plays of charts not listed yet', async () => {
    const alice = await signInAnonymously(fetchApp);
    const bob = await signInAnonymously(fetchApp);
    firstScore = await submit(alice, chart, 9, evil);
    await submit(bob, chart, 4, evil, 3);

    // Anonymous plays stay off the default view.
    const before = await page('/');
    expect(before.status).toBe(200);
    expect(before.html).toContain('No plays here yet');
    expect(before.cacheControl).toBe('private, max-age=0');

    // Once a player keeps their account (what registering a passkey does), the chart still is not listed (one player so
    // far): it stays off the public page, and only the player sees their own play, marked as not listed.
    const db = openDatabase(env.DB);
    await claimAccount(db, await userIdOf(alice));
    expect((await page('/')).html).toContain('No plays here yet');
    const own = await page('/', alice);
    // Links to plays only: the page's speculation rules name /scores/ paths too.
    expect(own.html.match(/href="\/scores\//g)).toHaveLength(1);
    expect(own.html).toContain('>not public<');
    expect(own.html).toContain('#1 / 1');
    // Its badge's help tip says why: the chart is not listed yet.
    expect(own.html).toMatch(/Only you see this play in the rankings and lists\.<br\/>• Its chart is not listed yet/);

    // A second such player lists the chart: both plays are public, ranked.
    await claimAccount(db, await userIdOf(bob));
    const listed = await page('/');
    expect(listed.html.match(/href="\/scores\//g)).toHaveLength(2);
    expect(listed.html).toContain('#1 / 2');
    expect(listed.html).toContain('#2 / 2');
    expect(listed.html).toContain('played with LR2 rules');
    expect(listed.html).not.toContain('>not public<');
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

    // Carol's chart is not listed (anonymous players do not list one): nobody else sees it, even with anonymous players
    // on; Carol does, marked as not listed.
    expect((await page('/?anonymous=1')).html).not.toContain('Only Carol');
    const own = await page('/', carol);
    expect(own.html).toContain('Only Carol');
    expect(own.html).toContain('>not public<');
    // Both reasons: the chart is not listed, and Carol's account is anonymous (with how to change that).
    expect(own.html).toContain('Its chart is not listed yet');
    expect(own.html).toContain('It was played anonymously, before an account was created');
    expect(own.html).toContain('Create an account and your earlier plays become public too.');

    // On a listed chart, Carol's play is left out by default and comes in with anonymous players on.
    const carolsPlay = `/scores/${await submit(carol, chart, 7, 'Carol on a listed chart', 2)}`;
    expect((await page('/')).html).not.toContain(carolsPlay);
    expect((await page('/?anonymous=1')).html).toContain(carolsPlay);
  });

  test('a play shows what it changed on the player’s best, and the chart’s mode and level', async () => {
    const levelled = makeChart(['#00111:0101', '#00211:01010101']);
    const dave = await signInAnonymously(fetchApp);
    await claimAccount(openDatabase(env.DB), await userIdOf(dave));
    const replay = makeReplay(levelled, { noteCount: 10, hits: 3 });
    replay.chart.title = 'Dave Song';
    replay.chart.playLevel = '12';
    replay.chart.difficulty = 4;
    replay.play.randomLane = { p1: 'RANDOM' };
    const first = await fetchApp('/api/v0/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie: dave },
      body: submissionBody(replay, levelled.playDocument, levelled.chartDocument),
    });
    expect(first.status).toBe(201);
    // Dave is the chart's only player, so it is not listed: he sees his plays on his own view.
    const firstView = await page('/', dave);
    // The row's text, up to the next row.
    const rowText = (html: string) => {
      const from = html.slice(html.indexOf('Dave Song'));
      return from.slice(0, from.indexOf('</li>')).replace(/<[^>]+>/g, ' ');
    };
    const firstRow = rowText(firstView.html);
    expect(firstRow).toContain('7K ☆12');
    expect(firstRow).toContain('RANDOM');
    expect(firstRow).not.toMatch(/\+\d+/);

    // A better play: its row carries the EX-Score gained over the earlier best.
    await submit(dave, levelled, 8, 'Dave Song');
    const better = await page('/', dave);
    expect(rowText(better.html)).toMatch(/\+\d+/);
  });

  test('the chart page shows the LN mode only for a chart with long notes', async () => {
    const heidi = await signInAnonymously(fetchApp);
    const lnMode = 'LN — the start is judged; hold to the end';
    const submitWith = async (target: TestChart, longNotes: boolean, hits = 5) => {
      const replay = makeReplay(target, { noteCount: 10, hits });
      if (longNotes) {
        const first = replay.chart.notes[0]!;
        first.type = 'long';
        first.endTimeUs = first.timeUs + 200_000;
        first.lnMode = 1;
      }
      const response = await fetchApp('/api/v0/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie: heidi },
        body: submissionBody(replay, target.playDocument, target.chartDocument),
      });
      expect(response.status).toBe(201);
    };
    const chartPage = (target: TestChart) => page(`/charts/${encodeURIComponent(target.chartFingerprint)}`, heidi);
    const db = openDatabase(env.DB);

    const plain = makeChart(['#00111:01', '#00211:0101', '#00311:010101']);
    await submitWith(plain, false);
    const plainPage = (await chartPage(plain)).html;
    expect(plainPage).toContain('>Notes<');
    expect(plainPage).not.toContain(lnMode);
    expect(plainPage).not.toContain('>LN mode');

    const held = makeChart(['#00111:01', '#00211:0101', '#00311:01010101']);
    await submitWith(held, true);
    expect((await chartPage(held)).html).toContain(lnMode);

    // A later play with long notes (another `#RANDOM` outcome) shows it on a chart that had none so far.
    await submitWith(plain, true, 6);
    expect((await chartPage(plain)).html).toContain(lnMode);

    // A chart registered before this was kept still shows it, until its next play tells.
    const older = makeChart(['#00111:0101', '#00211:01', '#00311:010101']);
    await submitWith(older, false);
    await db
      .update(chartTable)
      .set({ hasLongNotes: null })
      .where(eq(chartTable.chartFingerprint, older.chartFingerprint));
    expect((await chartPage(older)).html).toContain(lnMode);
    await submitWith(older, false, 6);
    expect((await chartPage(older)).html).not.toContain(lnMode);
  });

  test('a chart not listed yet keeps out of search engines and shows each player only their own record', async () => {
    const lonely = makeChart(['#00111:01', '#00211:0101', '#00311:01']);
    const erin = await signInAnonymously(fetchApp);
    const scoreId = await submit(erin, lonely, 4, 'Lonely chart');
    const chartPath = new URL(
      (await page(`/scores/${scoreId}`)).html.match(/href="(\/charts\/[^"]+)"/)![1]!,
      'http://x',
    ).pathname;

    const anyone = await page(chartPath);
    expect(anyone.html).toContain('<meta name="robots" content="noindex"/>');
    expect(anyone.html).toContain('Not listed yet');
    expect(anyone.html).toContain('Sign in to see your own record.');
    expect(anyone.html).not.toContain(`/scores/${scoreId}`);

    // The play's page says why it is not public; only Erin reads how to change the anonymous part.
    const playPage = await page(`/scores/${scoreId}`);
    expect(playPage.html).toContain('This play is not public');
    expect(playPage.html).toContain('Its chart is not listed yet');
    expect(playPage.html).toContain('It was played anonymously, before an account was created');
    expect(playPage.html).not.toContain('Create an account and your earlier plays become public too.');
    expect(playPage.html).toContain('href="/help#visibility"');
    expect((await page(`/scores/${scoreId}`, erin)).html).toContain(
      'Create an account and your earlier plays become public too.',
    );

    const own = await page(chartPath, erin);
    expect(own.html).toContain(`/scores/${scoreId}`);
    expect(own.html).not.toContain('Sign in to see your own record.');

    // Erin's own player page lists the play; anyone else's view of it does not.
    const me = (await (await fetchApp('/api/v0/me', { headers: { cookie: erin } })).json()) as { handle: string };
    expect((await page(`/players/${me.handle}`, erin)).html).toContain(`/scores/${scoreId}`);
    expect((await page(`/players/${me.handle}`)).html).not.toContain(`/scores/${scoreId}`);
  });

  test('a player hides a play and shows it again; hidden, only they see it, and it leaves the rankings', async () => {
    const hideable = makeChart(['#00111:0101', '#00211:0101', '#00311:0101']);
    const db = openDatabase(env.DB);
    const frank = await signInAnonymously(fetchApp);
    const grace = await signInAnonymously(fetchApp);
    await claimAccount(db, await userIdOf(frank));
    await claimAccount(db, await userIdOf(grace));
    const low = await submit(frank, hideable, 3, 'Hideable');
    const high = await submit(frank, hideable, 9, 'Hideable');
    await submit(grace, hideable, 5, 'Hideable');
    const { chartFingerprint, hidden: hiddenAtFirst } = (await (await fetchApp(`/api/v0/scores/${high}`)).json()) as {
      chartFingerprint: string;
      hidden: boolean;
    };
    expect(hiddenAtFirst).toBe(false);
    const frankBest = async () => {
      const response = await fetchApp(`/api/v0/charts/${encodeURIComponent(chartFingerprint)}/leaderboard?ruleset=lr2`);
      const { entries } = (await response.json()) as { entries: Array<{ exScoreId: string; playCount: number }> };
      return entries.find((entry) => entry.exScoreId === high || entry.exScoreId === low);
    };
    expect(await frankBest()).toMatchObject({ exScoreId: high, playCount: 2 });

    const setHidden = (hidden: boolean, cookie?: string) =>
      fetchApp(`/api/v0/scores/${high}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...(cookie !== undefined ? { cookie } : {}) },
        body: JSON.stringify({ hidden }),
      });
    // Only the play's player can hide it.
    expect((await setHidden(true)).status).toBe(401);
    expect((await setHidden(true, grace)).status).toBe(403);
    const hid = await setHidden(true, frank);
    expect(hid.status).toBe(200);
    expect(await hid.json()).toEqual({ id: high, hidden: true });

    // Hidden, the play leaves the ranking: Frank's best falls back to the play still shown.
    expect(await frankBest()).toMatchObject({ exScoreId: low, playCount: 1 });
    // Nobody else can open it, its log or its page; the lists leave it out.
    expect((await fetchApp(`/api/v0/scores/${high}`)).status).toBe(404);
    expect((await fetchApp(`/api/v0/scores/${high}`, { headers: { cookie: grace } })).status).toBe(404);
    expect((await fetchApp(`/api/v0/scores/${high}/replay`)).status).toBe(404);
    expect((await page(`/scores/${high}`)).status).toBe(404);
    expect((await page('/')).html).not.toContain(`/scores/${high}`);
    expect((await page('/')).html).toContain(`/scores/${low}`);
    expect((await page(`/charts/${encodeURIComponent(chartFingerprint)}?every=1`)).html).not.toContain(
      `/scores/${high}`,
    );

    // Frank still sees it: marked hidden on his lists, and on its page with the way back.
    const me = (await (await fetchApp('/api/v0/me', { headers: { cookie: frank } })).json()) as { handle: string };
    const ownList = await page(`/players/${me.handle}`, frank);
    expect(ownList.html).toContain(`/scores/${high}`);
    expect(ownList.html).toContain('>hidden<');
    expect(ownList.html).toContain('You hid it; open it to show it again.');
    // It moved no best and holds no place, so its row shows no rank.
    const hiddenRow = ownList.html.slice(ownList.html.indexOf(`/scores/${high}`));
    expect(hiddenRow.slice(0, hiddenRow.indexOf('</li>'))).not.toMatch(/#\d+ \/ \d+/);
    expect((await page(`/players/${me.handle}`)).html).not.toContain(`/scores/${high}`);
    const own = await page(`/scores/${high}`, frank);
    expect(own.status).toBe(200);
    expect(own.html).toContain('This play is hidden');
    expect(own.html).toContain('data-account-action="show-score"');
    expect(own.html).toContain('<meta name="robots" content="noindex"/>');
    expect(
      (
        (await (await fetchApp(`/api/v0/scores/${high}`, { headers: { cookie: frank } })).json()) as {
          hidden: boolean;
        }
      ).hidden,
    ).toBe(true);
    expect((await fetchApp(`/api/v0/scores/${high}/replay`, { headers: { cookie: frank } })).status).toBe(200);

    // Shown again, everything is back.
    expect((await setHidden(false, frank)).status).toBe(200);
    expect(await frankBest()).toMatchObject({ exScoreId: high, playCount: 2 });
    expect((await page(`/scores/${high}`)).status).toBe(200);
    expect((await page(`/scores/${high}`, frank)).html).toContain('data-account-action="hide-score"');
    expect((await page(`/scores/${high}`)).html).not.toContain('-score"');
  });

  test('the score, chart and player pages render with their sharing tags', async () => {
    const score = await page(`/scores/${firstScore}`);
    expect(score.status).toBe(200);
    expect(score.html).toContain('property="og:title"');
    expect(score.html).toContain('LR2 rules');
    expect(score.html).toContain('Scored with');
    expect(score.html).toContain('beatoraja');
    expect(score.html).toContain('IIDX');
    expect(score.html).toContain(`/api/v0/scores/${firstScore}/replay`);

    const ranking = await page(`/charts/${encodeURIComponent(chart.chartFingerprint)}`);
    expect(ranking.status).toBe(200);
    expect(ranking.html).toContain('2 players');
    // Ranked by EX score: 18 (nine PGREATs) above 8.
    // EX-Score over its rate: ten notes make a maximum of 20.
    // The EX-Score sits over its DJ LEVEL and rate.
    expect(ranking.html).toMatch(/>18<\/span><\/div><div class="[^"]*">.*?>AAA<\/span> 90\.00%</);
    expect(ranking.html.indexOf(' 90.00%<')).toBeLessThan(ranking.html.indexOf(' 40.00%<'));
    expect(ranking.html.indexOf(' 40.00%<')).toBeGreaterThan(0);
    // A row opens the play it shows, and its info icon opens the play's details.
    expect(ranking.html).toContain('aria-label="Play of');
    // The filters are switches, and say whether they are on.
    expect(ranking.html).toMatch(/role="switch" aria-checked="false"[^>]*>.*?Every play/);
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
    // Chart details and figures: the replay's metadata, the play counts and the lamp spread.
    expect(ranking.html).toContain('>Judgment rank<');
    expect(ranking.html).toContain('>First played<');
    expect(ranking.html).toContain('>Clear lamps<');

    const player = await page(`/players/${firstHandle}`);
    expect(player.status).toBe(200);
    expect(player.html).toContain(`@${firstHandle}`);
    // Player figures: plays, charts, the lamp and DJ Rank spreads of their bests, and the rulesets they played under.
    expect(player.html).toContain('>Average rate<');
    // Totals: the play time and the notes, with every judgment, and every lamp and rank in the legends.
    expect(player.html).toContain('>Play time<');
    expect(player.html).toContain('>Judgments<');
    expect(player.html).toContain('>EX HARD CLEAR<');
    expect(player.html).toContain('>DJ Ranks<');
    expect(player.html).toContain('>Played under<');

    // In Japanese, the player and score pages too.
    const playerJa = await page(`/players/${firstHandle}`, 'lb-lang=ja');
    expect(playerJa.html).toContain('>平均レート<');
    expect(playerJa.html).toContain('>判定<');
    expect(playerJa.html).toContain('>最新のプレイ<');
    const scoreJa = await page(`/scores/${firstScore}`, 'lb-lang=ja');
    expect(scoreJa.html).toContain('>選択中</span>');
    expect(scoreJa.html).toContain('>リンクをコピー<');
  });

  test('the display ruleset is one setting for every page, switched without changing page URLs', async () => {
    const back = `/charts/${encodeURIComponent(chart.chartFingerprint)}?assisted=0`;
    const switched = await fetchApp(`/ruleset/beatoraja?next=${encodeURIComponent(back)}`);
    expect(switched.status).toBe(303);
    expect(switched.headers.get('location')).toBe(back);
    const setCookie = switched.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^lb-ruleset=beatoraja;/);
    expect(setCookie).toContain('Path=/');
    const cookie = setCookie.split(';')[0]!;

    // Every page now reads beatoraja: the header's ruleset menu names and ticks it, the score page selects it.
    const top = await page('/', cookie);
    expect(top.html).toContain('scored under beatoraja');
    expect(top.html).toContain('aria-label="Scoring rules: beatoraja rules"');
    expect(top.html).toMatch(/href="\/ruleset\/beatoraja[^"]*" aria-current="true"/);
    const score = await page(`/scores/${firstScore}`, cookie);
    expect(score.html).toMatch(/aria-label="beatoraja rules" data-state="selected">.*?>selected<\/span>/);
    expect(score.html).toContain('>played with</span>');
    // Without the cookie, LR2.
    expect((await page('/')).html).toContain('scored under LR2');

    // An unknown ruleset changes nothing, and the switch never redirects off the Leaderboard.
    const unknown = await fetchApp('/ruleset/popn?next=https://evil.example/');
    expect(unknown.status).toBe(303);
    expect(unknown.headers.get('location')).toBe('/');
    expect(unknown.headers.get('set-cookie')).toBeNull();
  });

  test('unknown pages, scores, charts and players are 404 pages', async () => {
    for (const path of ['/scores/missing', '/charts/bmfp0%3Amissing', '/players/nobody', '/whatever']) {
      const response = await page(path);
      expect(response.status).toBe(404);
      expect(response.html).toContain('Not found');
    }
  });
});

test('renders deployment metadata in the shared page footer', async () => {
  const response = await app.request(ORIGIN + '/about', undefined, {
    ...env,
    BUILD_TIMESTAMP: '2026-10-20T08:00:00Z',
    BUILD_REVISION: '0123456789abcdef',
  });
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html.split('</main>')[1]).toContain('2026-10-20 08:00:00 UTC');
  expect(html).toContain('>01234567</code>');
});
