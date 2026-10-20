import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import {
  makeChart,
  makePlaylog,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  submissionBody,
  type TestChart,
} from '../test/support.ts';
import { createApp } from './app.ts';
import { eq } from 'drizzle-orm';
import { openDatabase } from './db/client.ts';
import { bestScore, score } from './db/schema.ts';
import { loadChartFiles, loadPlayRanking } from './ranking-plays.ts';
import { backfillPlayedFiles } from './scores/backfill.ts';
import type { Env } from './env.ts';
import { clearLampRank } from '@be-music/player/ruleset';

// Tests never reach BMS Search: a submission's background chartset lookup finds nothing.
const noChartsets = async () => undefined;

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 13);
const app = createApp({ now: () => (clock += 1000), chartsetLookup: noChartsets });

const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

function submit(cookie: string | undefined, body: Uint8Array<ArrayBuffer>): Promise<Response> {
  return fetchApp('/api/v0/scores', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'be-music-client': 'be-music-web/0.5.0 (engine 0.8.0; build test)',
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body,
  });
}

async function submitPlay(cookie: string, chart: TestChart, hits: number, withChartDocument = true, skip = 0) {
  const playlog = makePlaylog(chart, { noteCount: 10, hits, skip });
  return submit(
    cookie,
    submissionBody(playlog, chart.playDocument, withChartDocument ? chart.chartDocument : undefined),
  );
}

async function userIdOf(cookie: string): Promise<string> {
  const session = await fetchApp('/api/auth/get-session', { headers: { cookie } });
  return ((await session.json()) as { user: { id: string } }).user.id;
}

/** `count` distinct charts, told apart by where their last two notes fall; `lane` keeps one set apart from another. */
function makeCharts(count: number, lane: string): TestChart[] {
  return Array.from({ length: count }, (_, index) =>
    makeChart(['#00111:01', `#${String(index + 2).padStart(3, '0')}${lane}:0101`]),
  );
}

/** A D1 binding that counts the statements it prepares: every one D1 runs, on its own or in a batch. */
function countingStatements(d1: D1Database): { d1: D1Database; statements: () => number } {
  let statements = 0;
  const counted = new Proxy(d1, {
    get(target, property) {
      if (property === 'prepare') {
        return (query: string) => {
          statements += 1;
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { d1: counted, statements: () => statements };
}

describe('API versions', () => {
  test('answers an unknown version or path under /api with a JSON 404', async () => {
    for (const path of ['/api/v2/me', '/api/v0/nothing-here', '/api/scores']) {
      const response = await fetchApp(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not-found' });
    }
  });
});

describe('POST /api/v0/scores', () => {
  const chart = makeChart(['#00111:01010101', '#00211:01010101', '#00311:0101']);

  test('requires a session, anonymous or not', async () => {
    const response = await submitPlay(undefined as unknown as string, chart, 10);
    expect(response.status).toBe(401);
  });

  test('asks for the chart document the first time it sees a chart, then ranks the play under every ruleset', async () => {
    const cookie = await signInAnonymously(fetchApp);

    const withoutDocument = await submitPlay(cookie, chart, 10, false);
    expect(withoutDocument.status).toBe(409);
    expect(await withoutDocument.json()).toEqual({ error: 'chart-document-required' });

    const accepted = await submitPlay(cookie, chart, 10);
    expect(accepted.status).toBe(201);
    const body = (await accepted.json()) as {
      scoreId: string;
      chartFingerprint: string;
      results: Array<{ ruleset: string; rulesetRevision: string; exScore: number; clearLamp: number; rank: number }>;
    };
    expect(body.chartFingerprint).toBe(chart.chartFingerprint);
    expect(body.results.map((result) => result.ruleset)).toEqual(['lr2', 'beatoraja', 'iidx']);
    for (const result of body.results) {
      expect(result.exScore).toBe(20); // ten PGREATs
      expect(result.rank).toBe(1);
      expect(result.rulesetRevision).toMatch(/\/0$/);
    }
    expect(body.results.find((result) => result.ruleset === 'beatoraja')?.clearLamp).toBe(clearLampRank('MAX'));
    expect(body.results.find((result) => result.ruleset === 'lr2')?.clearLamp).toBe(clearLampRank('FULL_COMBO'));

    // The play log and the chart document are stored in R2.
    const stored = await env.BLOBS.get(`playlogs/${body.scoreId}.bmplay.json.gz`);
    const playlog = JSON.parse(gunzipSync(Buffer.from(await stored!.arrayBuffer())).toString('utf8'));
    expect(playlog.chart.chartFingerprint).toBe(chart.chartFingerprint);
    expect(await env.BLOBS.head(`charts/${chart.chartFingerprint}.json`)).not.toBeNull();

    // The play's length is kept: to the last input, 50 ms after the tenth note at 5.5 s.
    const db = openDatabase(env.DB);
    const stored0 = await db.query.score.findFirst({ where: (row, { eq }) => eq(row.id, body.scoreId) });
    expect(stored0?.durationMs).toBe(5_550);
    // A play stored before lengths were kept gets it back from its play log.
    await db.update(score).set({ durationMs: null }).where(eq(score.id, body.scoreId));
    expect(await backfillPlayedFiles(db, env.BLOBS)).toBeGreaterThanOrEqual(1);
    const backfilled = await db.query.score.findFirst({ where: (row, { eq }) => eq(row.id, body.scoreId) });
    expect(backfilled?.durationMs).toBe(5_550);

    // Sending the same play log again returns the stored play instead of a second one.
    const again = await submitPlay(cookie, chart, 10);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { scoreId: string }).scoreId).toBe(body.scoreId);
  });

  test('refuses the same play from a second account (a copied replay)', async () => {
    const original = await signInAnonymously(fetchApp);
    const copier = await signInAnonymously(fetchApp);
    expect((await submitPlay(original, chart, 5, true, 1)).status).toBe(201);
    const copied = makePlaylog(chart, { noteCount: 10, hits: 5, skip: 1 });
    // Re-dating the log or claiming another recorder does not make it a different play.
    copied.createdAt = '2030-01-01T00:00:00.000Z';
    copied.recorder = { name: 'other-client', version: '9.9.9' };
    const response = await submit(copier, submissionBody(copied, chart.playDocument, chart.chartDocument));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'play-already-submitted' });
  });

  test('rejects a play document that does not hash to the play fingerprint', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const playlog = makePlaylog(chart, { noteCount: 10, hits: 3 });
    const tampered = { ...(chart.playDocument as object), bpm: '999' };
    const response = await submit(cookie, submissionBody(playlog, tampered, chart.chartDocument));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'play-document-fingerprint-mismatch' });
  });

  test('rejects auto plays and malformed play logs', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const auto = makePlaylog(chart, { noteCount: 10, hits: 10, play: { mode: 'auto' } });
    const autoResponse = await submit(cookie, submissionBody(auto, chart.playDocument, chart.chartDocument));
    expect(autoResponse.status).toBe(422);
    expect(await autoResponse.json()).toEqual({ error: 'auto-play' });

    // A play at another tempo is practice: refused, like beatoraja's frequency trainer leaves its scores unsaved.
    const slowed = makePlaylog(chart, { noteCount: 10, hits: 10, play: { tempo: 0.8 } });
    const slowedResponse = await submit(cookie, submissionBody(slowed, chart.playDocument, chart.chartDocument));
    expect(slowedResponse.status).toBe(422);
    expect(await slowedResponse.json()).toEqual({ error: 'tempo' });

    const malformed = await submit(cookie, submissionBody({ format: 'nope' }, chart.playDocument));
    expect(malformed.status).toBe(422);
    expect(((await malformed.json()) as { error: string }).error).toBe('invalid-playlog');
  });
});

describe('rankings', () => {
  const chart = makeChart(['#00111:01010101', '#00211:01010101', '#00311:01', '#00411:01']);

  test('rank players by best EX score, ties sharing a rank, anonymous players only on request', async () => {
    const players = [
      await signInAnonymously(fetchApp),
      await signInAnonymously(fetchApp),
      await signInAnonymously(fetchApp),
    ];
    expect((await submitPlay(players[0]!, chart, 10)).status).toBe(201);
    expect((await submitPlay(players[1]!, chart, 6)).status).toBe(201);
    expect((await submitPlay(players[2]!, chart, 6, true, 4)).status).toBe(201);
    // A worse play does not lower a personal best.
    expect((await submitPlay(players[0]!, chart, 2)).status).toBe(201);

    const query = `/api/v0/charts/${encodeURIComponent(chart.chartFingerprint)}/leaderboard?ruleset=lr2`;
    const publicOnly = (await (await fetchApp(query)).json()) as { players: number; entries: unknown[] };
    expect(publicOnly).toMatchObject({ players: 0, entries: [] });

    const everyone = (await (await fetchApp(`${query}&anonymous=1`)).json()) as {
      players: number;
      entries: Array<{ rank: number; exScore: number; playCount: number; anonymous: boolean; handle: string }>;
    };
    expect(everyone.players).toBe(3);
    expect(everyone.entries.map((entry) => [entry.rank, entry.exScore])).toEqual([
      [1, 20],
      [2, 12],
      [2, 12],
    ]);
    expect(everyone.entries[0]).toMatchObject({ playCount: 2, anonymous: true });
    expect(everyone.entries[0]!.handle).toMatch(/^player_[a-z0-9]{8}$/);

    // The second page starts inside the tie and keeps its rank.
    const secondPage = (await (await fetchApp(`${query}&anonymous=1&offset=2&limit=1`)).json()) as {
      entries: Array<{ rank: number }>;
    };
    expect(secondPage.entries.map((entry) => entry.rank)).toEqual([2]);

    const me = await fetchApp(
      `/api/v0/charts/${encodeURIComponent(chart.chartFingerprint)}/leaderboard/me?ruleset=lr2`,
      {
        headers: { cookie: players[1]! },
      },
    );
    expect(await me.json()).toMatchObject({ rank: 2, players: 3, exScore: 12, playCount: 1 });
  });

  test('ranks every play, or the plays of one chart file, from the plays themselves', async () => {
    const fileChart = makeChart(['#00111:01010101', '#00211:01010101', '#00611:01', '#00711:01']);
    const [first, second] = [await signInAnonymously(fetchApp), await signInAnonymously(fetchApp)];
    const fileA = 'a'.repeat(64);
    const fileB = 'b'.repeat(64);
    const play = (cookie: string, hits: number, sha256: string) =>
      submit(
        cookie,
        submissionBody(
          makePlaylog(fileChart, { noteCount: 10, hits, chart: { sha256, md5: sha256.slice(0, 32) } }),
          fileChart.playDocument,
          fileChart.chartDocument,
        ),
      );
    expect((await play(first, 10, fileA)).status).toBe(201);
    expect((await play(first, 8, fileB)).status).toBe(201);
    expect((await play(second, 9, fileA)).status).toBe(201);

    const db = openDatabase(env.DB);
    const filter = {
      chartFingerprint: fileChart.chartFingerprint,
      ruleset: 'lr2' as const,
      assisted: false,
      includeAnonymous: true,
      playedHereOnly: false,
    };
    const page = { offset: 0, limit: 10 };

    // Every play on its own row: the first player twice.
    const every = await loadPlayRanking(db, filter, { everyPlay: true }, page);
    expect(every.entries.map((entry) => [entry.rank, entry.exScore])).toEqual([
      [1, 20],
      [2, 18],
      [3, 16],
    ]);
    expect(every).toMatchObject({ players: 2, plays: 3 });
    expect(every.entries[0]!.playCount).toBe(2);

    // One file: each player's best play of it.
    const onlyB = await loadPlayRanking(db, filter, { everyPlay: false, fileSha256: fileB }, page);
    expect(onlyB.entries.map((entry) => entry.exScore)).toEqual([16]);
    expect(onlyB).toMatchObject({ players: 1, plays: 1 });

    expect(await loadChartFiles(db, fileChart.chartFingerprint)).toEqual([
      { sha256: fileA, md5: fileA.slice(0, 32), plays: 2, players: 2 },
      { sha256: fileB, md5: fileB.slice(0, 32), plays: 1, players: 1 },
    ]);
  });

  test('ranks assisted plays apart from unassisted ones', async () => {
    const assistedChart = makeChart(['#00111:0101', '#00211:0101', '#00311:0101', '#00411:0101', '#00511:0101']);
    const cookie = await signInAnonymously(fetchApp);
    const playlog = makePlaylog(assistedChart, { noteCount: 10, hits: 10, play: { autoScratch: true } });
    const response = await submit(
      cookie,
      submissionBody(playlog, assistedChart.playDocument, assistedChart.chartDocument),
    );
    expect(response.status).toBe(201);
    const base = `/api/v0/charts/${encodeURIComponent(assistedChart.chartFingerprint)}/leaderboard?ruleset=lr2&anonymous=1`;
    expect(((await (await fetchApp(base)).json()) as { players: number }).players).toBe(0);
    expect(((await (await fetchApp(`${base}&assisted=1`)).json()) as { players: number }).players).toBe(1);
  });
});

describe('GET /api/v0/scores/:id', () => {
  test('returns the play and its public play log', async () => {
    const chart = makeChart(['#00111:01', '#00211:01', '#00311:01', '#00411:01', '#00511:01', '#00611:01']);
    const cookie = await signInAnonymously(fetchApp);
    const accepted = (await (await submitPlay(cookie, chart, 7)).json()) as { scoreId: string };

    const detail = (await (await fetchApp(`/api/v0/scores/${accepted.scoreId}`)).json()) as {
      chartFingerprint: string;
      playedRuleset: string;
      verification: string;
      results: unknown[];
    };
    expect(detail).toMatchObject({
      chartFingerprint: chart.chartFingerprint,
      playedRuleset: 'lr2',
      verification: 'L4',
    });
    expect(detail.results).toHaveLength(3);
    // The final gauge is stored per ruleset, as a percentage.
    for (const result of detail.results as Array<{ gaugeFinal: number | null }>) {
      expect(typeof result.gaugeFinal).toBe('number');
      expect(result.gaugeFinal).toBeGreaterThanOrEqual(0);
      expect(result.gaugeFinal).toBeLessThanOrEqual(100);
    }

    const playlog = await fetchApp(`/api/v0/scores/${accepted.scoreId}/playlog`);
    expect(playlog.status).toBe(200);
    expect(playlog.headers.get('content-encoding')).toBe('gzip');

    expect((await fetchApp('/api/v0/scores/missing')).status).toBe(404);
  });
});

describe('reassignScores', () => {
  test('moves plays to the linked account and rebuilds its personal bests', async () => {
    const { reassignScores } = await import('./scores/reassign.ts');
    const chart = makeChart(['#00111:0101', '#00211:0101', '#00311:01']);
    const anonymous = await signInAnonymously(fetchApp);
    const linked = await signInAnonymously(fetchApp);
    await submitPlay(anonymous, chart, 9);
    await submitPlay(linked, chart, 4);

    const db = openDatabase(env.DB);
    await reassignScores(db, await userIdOf(anonymous), await userIdOf(linked));

    const me = await fetchApp(
      `/api/v0/charts/${encodeURIComponent(chart.chartFingerprint)}/leaderboard/me?ruleset=lr2`,
      {
        headers: { cookie: linked },
      },
    );
    expect(await me.json()).toMatchObject({ exScore: 18, playCount: 2 });
  });

  test('moves a player with many charts, played under two rulesets, past what one statement can carry', async () => {
    const { reassignScores } = await import('./scores/reassign.ts');
    const { rebuildBestScores } = await import('./scores/bests.ts');
    const charts = makeCharts(30, '14');
    const anonymous = await signInAnonymously(fetchApp);
    const linked = await signInAnonymously(fetchApp);
    for (const chart of charts) {
      for (const [judgeRuleset, hits] of [
        ['lr2', 6],
        ['beatoraja', 8],
      ] as const) {
        const playlog = makePlaylog(chart, { noteCount: 10, hits, play: { judgeRuleset } });
        const response = await submit(anonymous, submissionBody(playlog, chart.playDocument, chart.chartDocument));
        expect(response.status).toBe(201);
      }
    }

    const db = openDatabase(env.DB);
    const linkedId = await userIdOf(linked);
    await reassignScores(db, await userIdOf(anonymous), linkedId);
    // Every play is ranked under all three rulesets: 90 best rows, where one insert carries 7.
    const expectBests = async () => {
      const rows = await db.select().from(bestScore).where(eq(bestScore.userId, linkedId));
      expect(rows).toHaveLength(charts.length * 3);
      for (const row of rows) {
        expect(row).toMatchObject({ bestEx: 16, playCount: 2, playedHere: row.ruleset !== 'iidx' });
      }
    };
    await expectBests();

    // More charts than one statement can list (most never played, the played ones split across two statements)
    // rebuild to the same bests.
    const unplayed = Array.from({ length: 100 }, (_, index) => `unplayed-${index}`);
    const played = charts.map((chart) => chart.chartFingerprint);
    await rebuildBestScores(db, linkedId, [...unplayed.slice(0, 80), ...played, ...unplayed.slice(80)], Date.now());
    await expectBests();
  });

  test('the linked account counts towards listing the charts it takes over', async () => {
    const { reassignScores } = await import('./scores/reassign.ts');
    const { claimAccount } = await import('./accounts.ts');
    const db = openDatabase(env.DB);
    const [shared, onlyAnonymous] = makeCharts(2, '17') as [TestChart, TestChart];
    const bob = await signInAnonymously(fetchApp);
    // The account the anonymous player links stands in for a Discord or Google one: not anonymous.
    const linked = await signInAnonymously(fetchApp);
    await claimAccount(db, await userIdOf(bob));
    await claimAccount(db, await userIdOf(linked));
    const anonymous = await signInAnonymously(fetchApp);
    expect((await submitPlay(bob, shared, 5)).status).toBe(201);
    expect((await submitPlay(anonymous, shared, 7)).status).toBe(201);
    expect((await submitPlay(anonymous, onlyAnonymous, 7)).status).toBe(201);
    const status = async (chart: TestChart) =>
      (
        await db.query.chart.findFirst({
          where: (row, { eq }) => eq(row.chartFingerprint, chart.chartFingerprint),
          columns: { status: true },
        })
      )?.status;
    expect(await status(shared)).toBe('provisional');

    await reassignScores(db, await userIdOf(anonymous), await userIdOf(linked));
    // Bob and the linked account have both played the shared chart now; the other one still has a single player.
    expect(await status(shared)).toBe('listed');
    expect(await status(onlyAnonymous)).toBe('provisional');
  });
});

describe('accounts', () => {
  test('GET /api/v0/me shows the account, and a claimed account leaves the anonymous filter', async () => {
    const { claimAccount } = await import('./accounts.ts');
    expect((await fetchApp('/api/v0/me')).status).toBe(401);

    const cookie = await signInAnonymously(fetchApp);
    const before = (await (await fetchApp('/api/v0/me', { headers: { cookie } })).json()) as {
      handle: string;
      displayName: string;
      anonymous: boolean;
      passkeys: number;
    };
    expect(before).toMatchObject({ displayName: 'Anonymous', anonymous: true, passkeys: 0 });

    const chart = makeChart(['#00111:01', '#00211:0101', '#00311:010101']);
    expect((await submitPlay(cookie, chart, 8)).status).toBe(201);
    const ranking = `/api/v0/charts/${encodeURIComponent(chart.chartFingerprint)}/leaderboard?ruleset=lr2`;
    expect(((await (await fetchApp(ranking)).json()) as { players: number }).players).toBe(0);

    // What registering a passkey does to the account (the WebAuthn ceremony itself needs a browser).
    const session = (await (await fetchApp('/api/auth/get-session', { headers: { cookie } })).json()) as {
      user: { id: string };
    };
    await claimAccount(openDatabase(env.DB), session.user.id);

    const after = await (await fetchApp('/api/v0/me', { headers: { cookie } })).json();
    expect(after).toEqual({ ...before, displayName: 'Player', anonymous: false });
    const listed = (await (await fetchApp(ranking)).json()) as { players: number; entries: Array<{ handle: string }> };
    expect(listed.players).toBe(1);
    expect(listed.entries[0]!.handle).toBe(before.handle);
  });

  test('claiming an account lists every chart it played that now has two players with accounts, in one batch', async () => {
    const { claimAccount } = await import('./accounts.ts');
    const db = openDatabase(env.DB);
    const shared = makeCharts(30, '15');
    const [solo, withAnonymous] = makeCharts(2, '16') as [TestChart, TestChart];
    const bob = await signInAnonymously(fetchApp);
    await claimAccount(db, await userIdOf(bob));
    const alice = await signInAnonymously(fetchApp);
    const carol = await signInAnonymously(fetchApp);
    for (const chart of shared) {
      expect((await submitPlay(bob, chart, 5)).status).toBe(201);
      expect((await submitPlay(alice, chart, 7)).status).toBe(201);
    }
    expect((await submitPlay(alice, solo, 7)).status).toBe(201);
    expect((await submitPlay(alice, withAnonymous, 7)).status).toBe(201);
    expect((await submitPlay(carol, withAnonymous, 3)).status).toBe(201);

    const statuses = async () => {
      const rows = await db.query.chart.findMany({
        where: (row, { inArray }) =>
          inArray(
            row.chartFingerprint,
            [...shared, solo, withAnonymous].map((chart) => chart.chartFingerprint),
          ),
        columns: { chartFingerprint: true, status: true },
      });
      return new Map(rows.map((row) => [row.chartFingerprint, row.status]));
    };
    // Alice is still anonymous: Bob alone has an account on each chart.
    expect(new Set((await statuses()).values())).toEqual(new Set(['provisional']));

    const counted = countingStatements(env.DB);
    await claimAccount(openDatabase(counted.d1), await userIdOf(alice));
    // The same three statements however many charts Alice played.
    expect(counted.statements()).toBe(3);
    const after = await statuses();
    for (const chart of shared) expect(after.get(chart.chartFingerprint)).toBe('listed');
    // Alice alone, and Alice with Carol (still anonymous), are one player with an account each.
    expect(after.get(solo.chartFingerprint)).toBe('provisional');
    expect(after.get(withAnonymous.chartFingerprint)).toBe('provisional');
  });
});
