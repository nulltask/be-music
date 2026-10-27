import { gunzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { ORIGIN, signInAnonymously, startTestBindings } from './test-support/support.ts';
import {
  courseBody,
  courseRun,
  submitCourse as postCourse,
  stageChart,
  type CourseOutcome,
} from './test-support/courses.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db/client.ts';
import { course, courseScore, score } from './db/schema.ts';
import type { Env } from './env.ts';
import { clearLampRank } from '@be-music/player-engine/ruleset';

const noChartsets = async () => undefined;

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 15);
let ids = 0;
const app = createApp({
  now: () => (clock += 1000),
  newId: () => `course-run-${(ids += 1)}`,
  chartsetLookup: noChartsets,
});

const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

const submitCourse = (cookie: string | undefined, body: Uint8Array<ArrayBuffer>) => postCourse(fetchApp, cookie, body);

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

describe('POST /api/v0/course-scores', () => {
  const charts = [stageChart('12'), stageChart('13'), stageChart('14')];

  test('requires a session', async () => {
    const response = await submitCourse(undefined, courseBody(courseRun(charts, [10, 10, 10]), charts));
    expect(response.status).toBe(401);
  });

  test('asks for the stage chart documents, then ranks a cleared run under every ruleset without chart scores', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const log = courseRun(charts, [10, 10, 10]);

    const withoutDocuments = await submitCourse(cookie, courseBody(log, charts, false));
    expect(withoutDocuments.status).toBe(409);
    expect(await withoutDocuments.json()).toEqual({ error: 'chart-document-required', detail: 'stage 1' });

    const accepted = await submitCourse(cookie, courseBody(log, charts));
    expect(accepted.status).toBe(201);
    const body = (await accepted.json()) as CourseOutcome;
    expect(body.courseFingerprint).toMatch(/^bmcourse0:[0-9a-f]{64}$/);
    expect(body.results.map((result) => result.ruleset)).toEqual(['lr2', 'beatoraja', '____']);
    for (const result of body.results) {
      expect(result).toMatchObject({ exScore: 60, noteCount: 30, missCount: 0, stagesPlayed: 3, rank: 1, players: 1 });
      expect(result.clearLamp).toBeGreaterThanOrEqual(clearLampRank('FULL_COMBO'));
    }

    const db = openDatabase(env.DB);
    // A course run creates no chart scores, and the course is stored with its stage charts.
    expect(await db.select().from(score)).toEqual([]);
    const stored = await db.query.course.findFirst({ where: eq(course.courseFingerprint, body.courseFingerprint) });
    expect(stored).toMatchObject({
      name: 'Test Dan',
      kind: 'grade',
      constraints: ['gauge_lr2', 'grade_mirror'],
      stageChartFingerprints: charts.map((chart) => chart.chartFingerprint),
    });
    const run = await db.query.courseScore.findFirst({ where: eq(courseScore.id, body.courseScoreId) });
    expect(run).toMatchObject({ playedRuleset: 'lr2', stagesPlayed: 3, verification: 'L4' });
    expect(await env.BLOBS.head(run!.replayKey)).not.toBeNull();

    // The same run again answers the stored result; from another account it is a copied replay.
    const again = await submitCourse(cookie, courseBody(log, charts));
    expect(again.status).toBe(200);
    expect(((await again.json()) as CourseOutcome).courseScoreId).toBe(body.courseScoreId);
    const other = await signInAnonymously(fetchApp);
    expect((await submitCourse(other, courseBody(log, charts))).status).toBe(409);
  });

  test('stores a failed run, counting the unreached stage as misses, on the same course', async () => {
    const cookie = await signInAnonymously(fetchApp);
    // GRADE-DEATH: the first POOR of stage 2 ends the run, and stage 3 is never reached.
    const failed = courseRun(charts, [10, 0], { gauge: 'DEATH' });
    const response = await submitCourse(cookie, courseBody(failed, charts));
    expect(response.status).toBe(201);
    const body = (await response.json()) as CourseOutcome;
    const lr2 = body.results.find((result) => result.ruleset === 'lr2')!;
    expect(lr2).toMatchObject({ clearLamp: clearLampRank('FAILED'), stagesPlayed: 2, exScore: 20, noteCount: 30 });
    // Stage 2's first POOR, its nine notes never judged, and all ten of stage 3.
    expect(lr2.missCount).toBe(20);
    // A failed run is keyed like a cleared one (by the stage charts, reached or not): one ranking for both.
    const ranking = await fetchApp(
      `/api/v0/courses/${encodeURIComponent(body.courseFingerprint)}/leaderboard?ruleset=lr2&anonymous=1`,
    );
    const entries = ((await ranking.json()) as { entries: Array<{ exScore: number; rank: number }> }).entries;
    expect(entries.map((entry) => [entry.rank, entry.exScore])).toEqual([
      [1, 60],
      [2, 20],
    ]);
  });

  test('refuses a run given up before the last stage without failing', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const response = await submitCourse(cookie, courseBody(courseRun(charts, [10]), charts));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'aborted', detail: 'stage 1' });
  });

  test('refuses a carry-in that is not what the previous stage left', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const log = courseRun(charts, [5, 10, 10], {
      tamper: (stage, index) => {
        if (index === 1) stage.play.course!.carryIn!.gauge = 100;
      },
    });
    const response = await submitCourse(cookie, courseBody(log, charts));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'course-carry-in-mismatch', detail: 'stage 2' });
  });

  test('refuses stages played outside the course constraints, auto play and aborted stages', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const random = courseRun(charts, [10, 10, 10], { play: { randomLane: { p1: 'RANDOM' } } });
    const randomResponse = await submitCourse(cookie, courseBody(random, charts));
    expect(randomResponse.status).toBe(422);
    expect(await randomResponse.json()).toEqual({ error: 'course-constraint-mismatch', detail: 'stage 1' });

    const auto = courseRun(charts, [10, 10, 10], { play: { mode: 'auto' } });
    expect(await (await submitCourse(cookie, courseBody(auto, charts))).json()).toEqual({
      error: 'auto-play',
      detail: 'stage 1',
    });
    // A stage given up before another one was played is not one run.
    const abortedEarly = courseRun(charts, [10, 10, 10], {
      tamper: (stage, index) => {
        if (index === 0) stage.play.aborted = true;
      },
    });
    expect(await (await submitCourse(cookie, courseBody(abortedEarly, charts))).json()).toEqual({
      error: 'aborted',
      detail: 'stage 1',
    });
  });

  test('stores a course given up with ESC as a failed run', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const givenUp = courseRun(charts, [10, 10], {
      tamper: (stage, index) => {
        if (index === 1) stage.play.aborted = true;
      },
    });
    const response = await submitCourse(cookie, courseBody(givenUp, charts));
    expect(response.status).toBe(201);
    const lr2 = ((await response.json()) as CourseOutcome).results.find((result) => result.ruleset === 'lr2')!;
    expect(lr2).toMatchObject({ clearLamp: clearLampRank('FAILED'), stagesPlayed: 2 });
    // The ten notes of the stage never reached count as misses.
    expect(lr2.missCount).toBe(10);
  });

  test('stores a run of an unreleased course, or with a stage at another tempo, without ranking it (#788)', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const own = [stageChart('15'), stageChart('16'), stageChart('17')];
    const unreleased = courseRun(own, [10, 10, 10]);
    unreleased.course.release = false;
    const slowed = courseRun(own, [10, 5, 10], {
      tamper: (stage, index) => {
        if (index === 1) stage.play.tempo = 0.9;
      },
    });
    for (const [log, reason] of [
      [unreleased, 'unreleased'],
      [slowed, 'tempo'],
    ] as const) {
      const response = await submitCourse(cookie, courseBody(log, own));
      expect(response.status).toBe(201);
      const body = (await response.json()) as CourseOutcome & { unranked?: string };
      expect(body.unranked).toBe(reason);
      for (const result of body.results) expect(result).toMatchObject({ rank: 0, players: 0 });
    }
    const [{ courseFingerprint }] = await openDatabase(env.DB)
      .select({ courseFingerprint: courseScore.courseFingerprint })
      .from(courseScore)
      .where(eq(courseScore.unranked, 'tempo'));
    const ranking = await fetchApp(
      `/api/v0/courses/${encodeURIComponent(courseFingerprint!)}/leaderboard?ruleset=lr2&anonymous=1`,
    );
    expect(await ranking.json()).toMatchObject({ players: 0, entries: [] });
  });

  test('refuses a course log without every stage chart fingerprint', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const log = courseRun(charts, [10, 0], { gauge: 'DEATH' });
    const last = log.stages[2]!;
    if (!last.played) delete last.chartFingerprint;
    const response = await submitCourse(cookie, courseBody(log, charts));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'missing-fingerprint', detail: 'stage 3' });
  });

  test('checks an unreached stage against its chart, so a failed run cannot understate its notes', async () => {
    const cookie = await signInAnonymously(fetchApp);
    // Assisted, so it is not the failed run another test submitted.
    const failed = () => courseRun(charts, [10, 0], { gauge: 'DEATH', play: { autoScratch: true } });

    const withoutChart = await submitCourse(cookie, courseBody(failed(), charts, true, []));
    expect(withoutChart.status).toBe(422);
    expect(await withoutChart.json()).toEqual({ error: 'stage-chart-required', detail: 'stage 3' });

    const otherChart = await submitCourse(
      cookie,
      courseBody(failed(), charts, true, [{ stage: 2, chart: charts[0]!.json }]),
    );
    expect(await otherChart.json()).toEqual({ error: 'stage-chart-fingerprint-mismatch', detail: 'stage 3' });

    const notAChart = await submitCourse(
      cookie,
      courseBody(failed(), charts, true, [{ stage: 2, chart: { notes: [] } }]),
    );
    expect(await notAChart.json()).toEqual({ error: 'stage-chart-invalid', detail: 'stage 3' });

    // Two notes fewer would have taken two misses off the run.
    const understated = failed();
    const last = understated.stages[2]!;
    if (!last.played) last.facts = { ...last.facts, notes: { ...last.facts.notes, normal: 8 } };
    const response = await submitCourse(cookie, courseBody(understated, charts));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'course-stage-facts-mismatch', detail: 'stage 3' });
  });
});

describe('course read endpoints', () => {
  const charts = [stageChart('15'), stageChart('16')];

  test('answer the course, its ranking, my rank and a run', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const submitted = (await (
      await submitCourse(cookie, courseBody(courseRun(charts, [10, 8]), charts))
    ).json()) as CourseOutcome;
    const path = `/api/v0/courses/${encodeURIComponent(submitted.courseFingerprint)}`;

    const detail = await fetchApp(path);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      courseFingerprint: submitted.courseFingerprint,
      name: 'Test Dan',
      kind: 'grade',
      stages: charts.map((chart) => ({ chartFingerprint: chart.chartFingerprint, title: 'Test Song' })),
    });
    expect((await fetchApp('/api/v0/courses/bmcourse0:unknown')).status).toBe(404);

    // Anonymous players are left out unless asked for.
    const hidden = (await (await fetchApp(`${path}/leaderboard?ruleset=beatoraja`)).json()) as { players: number };
    expect(hidden.players).toBe(0);
    const ranking = (await (await fetchApp(`${path}/leaderboard?ruleset=beatoraja&anonymous=1`)).json()) as {
      entries: Array<{ rank: number; exScore: number; exScoreId: string; playedHere: boolean }>;
      players: number;
    };
    expect(ranking.players).toBe(1);
    expect(ranking.entries[0]).toMatchObject({
      rank: 1,
      exScore: 36,
      exScoreId: submitted.courseScoreId,
      playedHere: false,
    });

    const mine = await fetchApp(`${path}/leaderboard/me?ruleset=lr2`, { headers: { cookie } });
    expect(await mine.json()).toMatchObject({ rank: 1, players: 1, exScore: 36, playCount: 1 });
    expect((await fetchApp(`${path}/leaderboard/me?ruleset=lr2`)).status).toBe(401);

    const run = await fetchApp(`/api/v0/course-scores/${submitted.courseScoreId}`);
    expect(await run.json()).toMatchObject({
      id: submitted.courseScoreId,
      courseFingerprint: submitted.courseFingerprint,
      playedRuleset: 'lr2',
      stagesPlayed: 2,
      results: [{ ruleset: 'lr2', exScore: 36 }, { ruleset: 'beatoraja' }, { ruleset: '____' }],
    });
    expect((await fetchApp('/api/v0/course-scores/nothing')).status).toBe(404);
  });
});

describe('course trophies and stage figures', () => {
  const charts = [stageChart('19'), stageChart('1A')];
  const trophies = [
    { name: 'silvermedal', missRate: 20, scoreRate: 80 },
    { name: 'goldmedal', missRate: 0, scoreRate: 100 },
  ];
  const run = (hits: number[]) => courseBody(courseRun(charts, hits, { course: { trophies } }), charts);

  test('keep each run’s stages and the best trophy, a tie keeping the earlier run', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const silver = (await (await submitCourse(cookie, run([10, 8]))).json()) as CourseOutcome;
    const lr2 = silver.results.find((result) => result.ruleset === 'lr2')!;
    expect(lr2).toMatchObject({ trophy: 'silvermedal', improved: { trophy: true } });

    const detail = (await (await fetchApp(`/api/v0/course-scores/${silver.courseScoreId}`)).json()) as {
      results: Array<{ ruleset: string; trophyRank: number; stages: Array<Record<string, unknown>> }>;
    };
    const stored = detail.results.find((result) => result.ruleset === 'lr2')!;
    expect(stored.trophyRank).toBe(1);
    expect(stored.stages).toHaveLength(2);
    expect(stored.stages[0]).toMatchObject({ exScore: 20, noteCount: 10, missCount: 0, cleared: true });
    expect(stored.stages[1]).toMatchObject({ exScore: 16, noteCount: 10, missCount: 2 });

    const gold = (await (await submitCourse(cookie, run([10, 10]))).json()) as CourseOutcome;
    expect(gold.results.find((result) => result.ruleset === 'lr2')).toMatchObject({
      trophy: 'goldmedal',
      improved: { trophy: true },
    });
    const again = (await (await submitCourse(cookie, run([10, 9]))).json()) as CourseOutcome;
    expect(again.results.find((result) => result.ruleset === 'lr2')).toMatchObject({
      trophy: 'silvermedal',
      improved: { trophy: false },
    });

    const path = `/api/v0/courses/${encodeURIComponent(gold.courseFingerprint)}/leaderboard`;
    const mine = await fetchApp(`${path}/me?ruleset=lr2`, { headers: { cookie } });
    expect(await mine.json()).toMatchObject({
      exScore: 40,
      playCount: 3,
      trophy: 'goldmedal',
      trophyScoreId: gold.courseScoreId,
    });
    const ranking = (await (await fetchApp(`${path}?ruleset=lr2&anonymous=1`)).json()) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(ranking.entries[0]).toMatchObject({ noteCount: 20, trophy: 'goldmedal', trophyScoreId: gold.courseScoreId });
  });
});

describe('PATCH /api/v0/course-scores/:id', () => {
  const charts = [stageChart('1B'), stageChart('1C')];
  const trophies = [
    { name: 'silvermedal', missRate: 20, scoreRate: 80 },
    { name: 'goldmedal', missRate: 0, scoreRate: 100 },
  ];
  const run = (hits: number[]) => courseBody(courseRun(charts, hits, { course: { trophies } }), charts);
  const setHidden = (id: string, hidden: boolean, cookie?: string) =>
    fetchApp(`/api/v0/course-scores/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(cookie !== undefined ? { cookie } : {}) },
      body: JSON.stringify({ hidden }),
    });

  test('a player hides a run and shows it again; hidden, it leaves the ranking and the bests', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const first = (await (await submitCourse(cookie, run([10, 8]))).json()) as CourseOutcome;
    const best = (await (await submitCourse(cookie, run([10, 10]))).json()) as CourseOutcome;
    const path = `/api/v0/courses/${encodeURIComponent(best.courseFingerprint)}/leaderboard`;
    const mine = async () => (await fetchApp(`${path}/me?ruleset=lr2`, { headers: { cookie } })).json();

    expect((await setHidden(best.courseScoreId, true)).status).toBe(401);
    const other = await signInAnonymously(fetchApp);
    const notYours = await setHidden(best.courseScoreId, true, other);
    expect(notYours.status).toBe(403);
    expect(await notYours.json()).toEqual({ error: 'not-your-score' });
    expect((await setHidden('nothing', true, cookie)).status).toBe(404);

    const hidden = await setHidden(best.courseScoreId, true, cookie);
    expect(await hidden.json()).toEqual({ id: best.courseScoreId, hidden: true });
    // The bests come back from the run still shown, the trophy best with them.
    expect(await mine()).toMatchObject({
      exScore: 36,
      exScoreId: first.courseScoreId,
      playCount: 1,
      trophy: 'silvermedal',
      trophyScoreId: first.courseScoreId,
    });
    const ranking = (await (await fetchApp(`${path}?ruleset=lr2&anonymous=1`)).json()) as {
      entries: Array<{ exScoreId: string }>;
    };
    expect(ranking.entries.map((entry) => entry.exScoreId)).toEqual([first.courseScoreId]);
    // Only its player can open a hidden run.
    expect((await fetchApp(`/api/v0/course-scores/${best.courseScoreId}`)).status).toBe(404);
    expect((await fetchApp(`/api/v0/course-scores/${best.courseScoreId}`, { headers: { cookie: other } })).status).toBe(
      404,
    );
    const own = await fetchApp(`/api/v0/course-scores/${best.courseScoreId}`, { headers: { cookie } });
    expect(await own.json()).toMatchObject({ hidden: true });
    // Its replay too: only its player reads it, and no shared cache keeps it.
    const replayPath = `/api/v0/course-scores/${best.courseScoreId}/replay`;
    expect((await fetchApp(replayPath)).status).toBe(404);
    const ownLog = await fetchApp(replayPath, { headers: { cookie } });
    expect(ownLog.status).toBe(200);
    expect(ownLog.headers.get('cache-control')).toBe('private');

    await setHidden(best.courseScoreId, false, cookie);
    const shownLog = await fetchApp(replayPath);
    expect(shownLog.status).toBe(200);
    expect(shownLog.headers.get('content-encoding')).toBe('gzip');
    expect(shownLog.headers.get('cache-control')).toContain('public');
    const log = JSON.parse(gunzipSync(new Uint8Array(await shownLog.arrayBuffer())).toString('utf8')) as {
      format: string;
      course: { name: string };
    };
    expect(log).toMatchObject({ format: 'be-music-course-replay', course: { name: 'Test Dan' } });
    expect((await fetchApp('/api/v0/course-scores/nothing/replay')).status).toBe(404);
    expect(await mine()).toMatchObject({ exScore: 40, playCount: 2, trophy: 'goldmedal' });
  });
});

describe('GET /api/v0/course-scores', () => {
  const charts = [stageChart('1D'), stageChart('1E')];

  test('lists the latest runs, anonymous ones on request and hidden ones only to their player', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const { handle } = (await (await fetchApp('/api/v0/me', { headers: { cookie } })).json()) as { handle: string };
    const shown = (await (
      await submitCourse(cookie, courseBody(courseRun(charts, [10, 8]), charts))
    ).json()) as CourseOutcome;
    const hidden = (await (
      await submitCourse(cookie, courseBody(courseRun(charts, [10, 6]), charts))
    ).json()) as CourseOutcome;
    await fetchApp(`/api/v0/course-scores/${hidden.courseScoreId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ hidden: true }),
    });
    type Runs = { runs: Array<{ id: string; hidden: boolean; courseName: string; stageCount: number; rank: number }> };
    const ids = async (query: string, viewer?: string) =>
      (
        (await (
          await fetchApp(
            `/api/v0/course-scores?ruleset=lr2&limit=100${query}`,
            viewer !== undefined ? { headers: { cookie: viewer } } : undefined,
          )
        ).json()) as Runs
      ).runs
        .filter((run) => run.id === shown.courseScoreId || run.id === hidden.courseScoreId)
        .map((run) => run.id);

    expect(await ids('')).toEqual([]);
    expect(await ids('&anonymous=1')).toEqual([shown.courseScoreId]);
    expect(await ids(`&player=${handle}`)).toEqual([shown.courseScoreId]);
    // Their own player sees both, the newest first, while their account is anonymous.
    expect(await ids('', cookie)).toEqual([hidden.courseScoreId, shown.courseScoreId]);

    const listed = ((await (await fetchApp(`/api/v0/course-scores?ruleset=lr2&player=${handle}`)).json()) as Runs).runs;
    expect(listed[0]).toMatchObject({
      id: shown.courseScoreId,
      courseName: 'Test Dan',
      stageCount: 2,
      hidden: false,
      exScore: 36,
      rank: 1,
      players: 1,
    });
  });
});

describe('reassignScores', () => {
  test('moves course runs to the linked account and rebuilds its course bests', async () => {
    const { reassignScores } = await import('./scores/reassign.ts');
    const charts = [stageChart('17'), stageChart('18')];
    const anonymous = await signInAnonymously(fetchApp);
    const linked = await signInAnonymously(fetchApp);
    const best = (await (
      await submitCourse(anonymous, courseBody(courseRun(charts, [10, 10]), charts))
    ).json()) as CourseOutcome;
    expect((await submitCourse(linked, courseBody(courseRun(charts, [10, 8]), charts))).status).toBe(201);

    const userIdOf = async (cookie: string) =>
      ((await (await fetchApp('/api/auth/get-session', { headers: { cookie } })).json()) as { user: { id: string } })
        .user.id;
    await reassignScores(openDatabase(env.DB), await userIdOf(anonymous), await userIdOf(linked));

    const mine = await fetchApp(
      `/api/v0/courses/${encodeURIComponent(best.courseFingerprint)}/leaderboard/me?ruleset=lr2`,
      { headers: { cookie: linked } },
    );
    expect(await mine.json()).toMatchObject({ exScore: 40, exScoreId: best.courseScoreId, playCount: 2 });
  });
});
