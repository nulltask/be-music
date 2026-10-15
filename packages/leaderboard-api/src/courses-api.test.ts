import { gzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import {
  createCoursePlaylog,
  simulatePlaylog,
  type BeMusicCoursePlaylog,
  type BeMusicPlaylog,
  type PlaylogCourseStageEntry,
  type RulesetChartFacts,
} from '@be-music/player/playlog';
import {
  makeChart,
  makePlaylog,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  type TestChart,
} from '../test/support.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db/client.ts';
import { course, courseScore, score } from './db/schema.ts';
import type { Env } from './env.ts';
import { ClearLamp } from './scoring/lamp.ts';

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

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

const COURSE = { name: 'Test Dan', kind: 'grade' as const, constraints: ['grade_mirror', 'gauge_lr2'], trophies: [] };
const STAGE_COURSE = { kind: 'grade' as const, gaugeSet: 'lr2' as const };

/** Ten notes on lane 11, told apart by `lane` (where the last two fall). */
function stageChart(lane: string): TestChart {
  return makeChart(['#00111:01010101', '#00211:01010101', `#003${lane}:0101`]);
}

const FACTS: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7keys',
  lnMode: 1,
  judgeRank: { percent: 75 },
  notes: { normal: 10, long: { 1: 0, 2: 0, 3: 0 } },
};

interface RunOptions {
  gauge?: BeMusicPlaylog['play']['gauge'];
  play?: Partial<BeMusicPlaylog['play']>;
  /** Changes a stage log after its carry-in is set. */
  tamper?: (stage: BeMusicPlaylog, index: number) => void;
}

/**
 * A course run over `charts`: stage `i` hits `hits[i]` of its ten notes, carrying in what the previous stage left as the
 * LR2 simulation sees it (as the engine would have); the charts past `hits` are unreached.
 */
function courseRun(charts: readonly TestChart[], hits: readonly number[], options: RunOptions = {}) {
  const stages: PlaylogCourseStageEntry[] = [];
  let previous: ReturnType<typeof simulatePlaylog> | undefined;
  for (const [index, chart] of charts.entries()) {
    if (index >= hits.length) {
      stages.push({ played: false, facts: FACTS, chartFingerprint: chart.chartFingerprint });
      continue;
    }
    const carryIn =
      previous === undefined
        ? undefined
        : { gauge: previous.gauge.final, combo: previous.course!.combo, maxCombo: previous.course!.maxCombo };
    const playlog = makePlaylog(chart, {
      noteCount: 10,
      hits: hits[index]!,
      play: {
        gauge: options.gauge ?? 'GROOVE',
        course: { ...STAGE_COURSE, ...(carryIn !== undefined ? { carryIn } : {}) },
        ...options.play,
      },
    });
    previous = simulatePlaylog(playlog, { ruleset: 'lr2' });
    options.tamper?.(playlog, index);
    stages.push({ played: true, playlog });
  }
  return createCoursePlaylog({ course: COURSE, stages, createdAt: '2026-10-15T00:00:00.000Z' });
}

function courseBody(log: BeMusicCoursePlaylog, charts: readonly TestChart[], withChartDocuments = true) {
  const played = log.stages.filter((entry) => entry.played).length;
  return Uint8Array.from(
    gzipSync(
      JSON.stringify({
        coursePlaylog: log,
        stages: charts.slice(0, played).map((chart) => ({
          playDocument: chart.playDocument,
          ...(withChartDocuments ? { chartDocument: chart.chartDocument } : {}),
        })),
      }),
    ),
  );
}

function submitCourse(cookie: string | undefined, body: Uint8Array<ArrayBuffer>): Promise<Response> {
  return fetchApp('/api/v0/course-scores', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body,
  });
}

interface CourseOutcome {
  courseScoreId: string;
  courseFingerprint: string;
  results: Array<{
    ruleset: string;
    exScore: number;
    noteCount: number;
    clearLamp: number;
    missCount: number;
    stagesPlayed: number;
    rank: number;
    players: number;
    improved: { exScore: boolean; lamp: boolean; missCount: boolean };
  }>;
}

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
    expect(body.results.map((result) => result.ruleset)).toEqual(['lr2', 'beatoraja', 'iidx']);
    for (const result of body.results) {
      expect(result).toMatchObject({ exScore: 60, noteCount: 30, missCount: 0, stagesPlayed: 3, rank: 1, players: 1 });
      expect(result.clearLamp).toBeGreaterThanOrEqual(ClearLamp.FULL_COMBO);
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
    expect(await env.BLOBS.head(run!.playlogKey)).not.toBeNull();

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
    expect(lr2).toMatchObject({ clearLamp: ClearLamp.FAILED, stagesPlayed: 2, exScore: 20, noteCount: 30 });
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
    expect(lr2).toMatchObject({ clearLamp: ClearLamp.FAILED, stagesPlayed: 2 });
    // The ten notes of the stage never reached count as misses.
    expect(lr2.missCount).toBe(10);
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
      results: [{ ruleset: 'lr2', exScore: 36 }, { ruleset: 'beatoraja' }, { ruleset: 'iidx' }],
    });
    expect((await fetchApp('/api/v0/course-scores/nothing')).status).toBe(404);
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
