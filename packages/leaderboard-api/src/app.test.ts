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
import { openDatabase } from './db/client.ts';
import type { Env } from './env.ts';
import { ClearLamp } from './scoring/lamp.ts';

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 13);
const app = createApp({ now: () => (clock += 1000) });

const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

function submit(cookie: string | undefined, body: Uint8Array<ArrayBuffer>): Promise<Response> {
  return fetchApp('/api/v1/scores', {
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

describe('POST /api/v1/scores', () => {
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
    expect(body.results.find((result) => result.ruleset === 'beatoraja')?.clearLamp).toBe(ClearLamp.MAX);
    expect(body.results.find((result) => result.ruleset === 'lr2')?.clearLamp).toBe(ClearLamp.FULL_COMBO);

    // The play log and the chart document are stored in R2.
    const stored = await env.BLOBS.get(`playlogs/${body.scoreId}.bmplay.json.gz`);
    const playlog = JSON.parse(gunzipSync(Buffer.from(await stored!.arrayBuffer())).toString('utf8'));
    expect(playlog.chart.chartFingerprint).toBe(chart.chartFingerprint);
    expect(await env.BLOBS.head(`charts/${chart.chartFingerprint}.json`)).not.toBeNull();

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

    const query = `/api/v1/charts/${encodeURIComponent(chart.chartFingerprint)}/leaderboard?ruleset=lr2`;
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
    expect(everyone.entries[0]!.handle).toMatch(/^player-[a-z0-9]{8}$/);

    // The second page starts inside the tie and keeps its rank.
    const secondPage = (await (await fetchApp(`${query}&anonymous=1&offset=2&limit=1`)).json()) as {
      entries: Array<{ rank: number }>;
    };
    expect(secondPage.entries.map((entry) => entry.rank)).toEqual([2]);

    const me = await fetchApp(
      `/api/v1/charts/${encodeURIComponent(chart.chartFingerprint)}/leaderboard/me?ruleset=lr2`,
      {
        headers: { cookie: players[1]! },
      },
    );
    expect(await me.json()).toMatchObject({ rank: 2, players: 3, exScore: 12, playCount: 1 });
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
    const base = `/api/v1/charts/${encodeURIComponent(assistedChart.chartFingerprint)}/leaderboard?ruleset=lr2&anonymous=1`;
    expect(((await (await fetchApp(base)).json()) as { players: number }).players).toBe(0);
    expect(((await (await fetchApp(`${base}&assisted=1`)).json()) as { players: number }).players).toBe(1);
  });
});

describe('GET /api/v1/scores/:id', () => {
  test('returns the play and its public play log', async () => {
    const chart = makeChart(['#00111:01', '#00211:01', '#00311:01', '#00411:01', '#00511:01', '#00611:01']);
    const cookie = await signInAnonymously(fetchApp);
    const accepted = (await (await submitPlay(cookie, chart, 7)).json()) as { scoreId: string };

    const detail = (await (await fetchApp(`/api/v1/scores/${accepted.scoreId}`)).json()) as {
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

    const playlog = await fetchApp(`/api/v1/scores/${accepted.scoreId}/playlog`);
    expect(playlog.status).toBe(200);
    expect(playlog.headers.get('content-encoding')).toBe('gzip');

    expect((await fetchApp('/api/v1/scores/missing')).status).toBe(404);
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
    const userIdOf = async (cookie: string) => {
      const session = await fetchApp('/api/auth/get-session', { headers: { cookie } });
      return ((await session.json()) as { user: { id: string } }).user.id;
    };
    await reassignScores(db, await userIdOf(anonymous), await userIdOf(linked));

    const me = await fetchApp(
      `/api/v1/charts/${encodeURIComponent(chart.chartFingerprint)}/leaderboard/me?ruleset=lr2`,
      {
        headers: { cookie: linked },
      },
    );
    expect(await me.json()).toMatchObject({ exScore: 18, playCount: 2 });
  });
});

describe('accounts', () => {
  test('GET /api/v1/me shows the account, and a claimed account leaves the anonymous filter', async () => {
    const { claimAccount } = await import('./accounts.ts');
    expect((await fetchApp('/api/v1/me')).status).toBe(401);

    const cookie = await signInAnonymously(fetchApp);
    const before = (await (await fetchApp('/api/v1/me', { headers: { cookie } })).json()) as {
      handle: string;
      displayName: string;
      anonymous: boolean;
      passkeys: number;
    };
    expect(before).toMatchObject({ displayName: 'Anonymous', anonymous: true, passkeys: 0 });

    const chart = makeChart(['#00111:01', '#00211:0101', '#00311:010101']);
    expect((await submitPlay(cookie, chart, 8)).status).toBe(201);
    const ranking = `/api/v1/charts/${encodeURIComponent(chart.chartFingerprint)}/leaderboard?ruleset=lr2`;
    expect(((await (await fetchApp(ranking)).json()) as { players: number }).players).toBe(0);

    // What registering a passkey does to the account (the WebAuthn ceremony itself needs a browser).
    const session = (await (await fetchApp('/api/auth/get-session', { headers: { cookie } })).json()) as {
      user: { id: string };
    };
    await claimAccount(openDatabase(env.DB), session.user.id);

    const after = await (await fetchApp('/api/v1/me', { headers: { cookie } })).json();
    expect(after).toEqual({ ...before, displayName: 'Player', anonymous: false });
    const listed = (await (await fetchApp(ranking)).json()) as { players: number; entries: Array<{ handle: string }> };
    expect(listed.players).toBe(1);
    expect(listed.entries[0]!.handle).toBe(before.handle);
  });
});
