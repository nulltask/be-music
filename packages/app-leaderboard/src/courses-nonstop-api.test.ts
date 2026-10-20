import { gzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { resolveChart } from '@be-music/chart-model';
import { parseBMS } from '@be-music/chart-parser';
import { manualPlay } from '@be-music/player-engine';
import {
  buildNonstopCourseReplay,
  normalizeCourseConstraints,
  prepareNonstopCourse,
} from '@be-music/player-engine/course';
import type { BeMusicCourseReplay, BeMusicReplay, ReplayInputEvent } from '@be-music/player-engine/replay';
import { ORIGIN, signInAnonymously, startTestBindings } from '../test/support.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db/client.ts';
import { course, courseScore } from './db/schema.ts';
import type { Env } from './env.ts';
import { clearLampRank } from '@be-music/player-engine/ruleset';

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 15);
let ids = 0;
const app = createApp({
  now: () => (clock += 1000),
  newId: () => `nonstop-run-${(ids += 1)}`,
  chartsetLookup: async () => undefined,
});

const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

const COURSE = { name: 'Test Nonstop', kind: 'nonstop' as const, constraints: ['gauge_lr2'], trophies: [] };

/**
 * Two stages at 240 BPM (1 s a measure). The first rolls a `#RANDOM` for its last note's lane; the second ends on a long
 * note.
 */
const SOURCES = [
  parseBMS(
    [
      '#PLAYER 1',
      '#BPM 240',
      '#WAV01 a.wav',
      '#00111:0101',
      '#RANDOM 2',
      '#IF 1',
      '#00212:01',
      '#ENDIF',
      '#IF 2',
      '#00213:01',
      '#ENDIF',
    ].join('\n'),
  ),
  parseBMS(['#PLAYER 1', '#BPM 240', '#WAV01 b.wav', '#LNOBJ ZZ', '#00211:00010001', '#00312:01ZZ'].join('\n')),
];
const OTHER_SOURCE = parseBMS(['#PLAYER 1', '#BPM 240', '#WAV01 c.wav', '#00211:01010101'].join('\n'));

/** Presses every note of `chart` dead on, up to `untilUs`. */
function presses(chart: Parameters<typeof resolveChart>[0], untilUs = Number.POSITIVE_INFINITY): ReplayInputEvent[] {
  const events: ReplayInputEvent[] = [];
  for (const note of resolveChart(chart).notes) {
    const timeUs = Math.round(note.seconds * 1_000_000);
    if (timeUs >= untilUs) continue;
    const upUs = note.endSeconds !== undefined ? Math.round(note.endSeconds * 1_000_000) : timeUs + 40_000;
    events.push({ seq: 0, timeUs, action: 'down', channels: [note.channel] });
    events.push({ seq: 0, timeUs: upUs, action: 'up', channels: [note.channel] });
  }
  return events.sort((left, right) => left.timeUs - right.timeUs).map((event, seq) => ({ ...event, seq }));
}

/**
 * A NONSTOP run of {@link SOURCES} as the web client records it, on the shared NONSTOP pipeline: each stage resolved
 * (`#RANDOM` drawn) with the course's long-note constraint applied, stitched, played as one chart, and cut into its
 * stages. `untilUs` gives up (ESC) there.
 */
async function nonstopRun(untilUs?: number): Promise<BeMusicCourseReplay> {
  const constraints = normalizeCourseConstraints(COURSE.constraints);
  const prepared = prepareNonstopCourse(
    SOURCES.map((chart) => ({ chart })),
    { constraints, connections: ['cut'], placement: 'intended', title: COURSE.name, random: () => 0 },
  );
  if (!prepared.ok) throw new Error(`stitch failed: ${prepared.reason}`);
  const stitched = prepared.course;
  let recorded: BeMusicReplay | undefined;
  await manualPlay(stitched.chart, {
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    replayInputs: presses(stitched.chart, untilUs),
    course: { kind: 'nonstop', gaugeSet: 'lr2' },
    recordReplay: {},
    onReplayRecorded: (replay) => {
      recorded = replay;
    },
  });
  const replay = recorded!;
  if (untilUs !== undefined) {
    replay.play.aborted = true;
    replay.play.abortedAtUs = untilUs;
  }
  return buildNonstopCourseReplay({ ...COURSE, constraints, release: true }, stitched, replay);
}

function submit(cookie: string, log: BeMusicCourseReplay, charts: readonly unknown[] = SOURCES): Promise<Response> {
  return fetchApp('/api/v0/course-scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie },
    body: Uint8Array.from(
      gzipSync(
        JSON.stringify({
          courseReplay: log,
          stages: [],
          stageCharts: charts.map((chart, stage) => ({ stage, chart })),
        }),
      ),
    ),
  });
}

interface Outcome {
  courseScoreId: string;
  courseFingerprint: string;
  results: Array<{
    ruleset: string;
    exScore: number;
    noteCount: number;
    missCount: number;
    clearLamp: number;
    stagesPlayed: number;
  }>;
}

describe('POST /api/v0/course-scores with a NONSTOP run', () => {
  test('stitches the stage charts again and ranks the stitched play', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const log = await nonstopRun();
    expect(log.nonstop!.stages[0]!.randomDraws).toEqual([{ command: 'RANDOM', range: 2, value: 1 }]);
    const response = await submit(cookie, log);
    expect(response.status).toBe(201);
    const body = (await response.json()) as Outcome;
    const lr2 = body.results.find((result) => result.ruleset === 'lr2')!;
    // Three notes, then two notes and a long note.
    expect(lr2).toMatchObject({ noteCount: 6, exScore: 12, stagesPlayed: 2 });
    expect(lr2.clearLamp).toBeGreaterThanOrEqual(clearLampRank('FULL_COMBO'));

    const db = openDatabase(env.DB);
    const stored = await db.query.course.findFirst({ where: eq(course.courseFingerprint, body.courseFingerprint) });
    expect(stored).toMatchObject({ kind: 'nonstop', constraints: ['gauge_lr2'] });
    const run = await db.query.courseScore.findFirst({ where: eq(courseScore.id, body.courseScoreId) });
    expect(run).toMatchObject({ stagesPlayed: 2, verification: 'L4' });

    const again = await submit(cookie, log);
    expect(again.status).toBe(200);
  });

  test('ranks a stitched play given up with ESC as a failed run', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const response = await submit(cookie, await nonstopRun(1_500_000));
    expect(response.status).toBe(201);
    const lr2 = ((await response.json()) as Outcome).results.find((result) => result.ruleset === 'lr2')!;
    // Given up after the first note: the five notes it never played count, and the second stage was never reached.
    expect(lr2).toMatchObject({ clearLamp: clearLampRank('FAILED'), noteCount: 6, missCount: 5, stagesPlayed: 1 });
  });

  test('refuses stage charts or a stage map that do not rebuild the stitched play', async () => {
    const cookie = await signInAnonymously(fetchApp);
    // Given up late in the second stage, so it is no run another test submitted.
    const log = await nonstopRun(3_200_000);
    const missing = await submit(cookie, log, SOURCES.slice(0, 1));
    expect(await missing.json()).toEqual({ error: 'stage-chart-required', detail: 'stage 2' });
    const other = await submit(cookie, log, [SOURCES[0], OTHER_SOURCE]);
    expect(await other.json()).toEqual({ error: 'stage-chart-fingerprint-mismatch', detail: 'stage 2' });

    // The other branch of stage 1's `#RANDOM` is another chart than the one played.
    const redrawn = structuredClone(log);
    redrawn.nonstop!.stages[0]!.randomDraws = [{ command: 'RANDOM', range: 2, value: 2 }];
    expect(await (await submit(cookie, redrawn)).json()).toEqual({ error: 'nonstop-chart-mismatch' });
    // So are the stages placed apart by another connection.
    const blank = structuredClone(log);
    blank.nonstop!.connections = ['blank2'];
    expect(await (await submit(cookie, blank)).json()).toEqual({ error: 'nonstop-chart-mismatch' });

    // A run stitched by rules this server does not know cannot be rebuilt.
    const future = structuredClone(log);
    future.nonstop!.stitch = 99;
    expect(await (await submit(cookie, future)).json()).toEqual({ error: 'nonstop-stitch-unsupported' });

    const reassigned = structuredClone(log);
    reassigned.nonstop!.noteStages = reassigned.nonstop!.noteStages.map(() => 0);
    expect(await (await submit(cookie, reassigned)).json()).toEqual({ error: 'nonstop-stage-mismatch' });
  });
});
