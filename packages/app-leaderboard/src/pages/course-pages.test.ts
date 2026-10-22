import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { claimAccount } from '../accounts.ts';
import { createApp } from '../app.ts';
import { openDatabase } from '../db/client.ts';
import type { Env } from '../env.ts';
import { ORIGIN, signInAnonymously, startTestBindings } from '../test-support/support.ts';
import { courseBody, courseRun, stageChart, submitCourse, type CourseOutcome } from '../test-support/courses.ts';

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 15, 12);
let ids = 0;
const app = createApp({
  now: () => (clock += 60_000),
  newId: () => `page-run-${(ids += 1)}`,
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

const page = async (path: string, cookie?: string, headers: Record<string, string> = {}) => {
  const response = await fetchApp(path, { headers: { ...headers, ...(cookie !== undefined ? { cookie } : {}) } });
  return { status: response.status, html: await response.text() };
};

async function userIdOf(cookie: string): Promise<string> {
  const session = await fetchApp('/api/auth/get-session', { headers: { cookie } });
  return ((await session.json()) as { user: { id: string } }).user.id;
}

async function handleOf(cookie: string): Promise<string> {
  return ((await (await fetchApp('/api/v0/me', { headers: { cookie } })).json()) as { handle: string }).handle;
}

const charts = [stageChart('12'), stageChart('13'), stageChart('14')];
const trophies = [
  { name: 'silvermedal', missRate: 20, scoreRate: 80 },
  { name: 'goldmedal', missRate: 0, scoreRate: 100 },
];

async function run(cookie: string, hits: number[], gauge?: 'DEATH'): Promise<CourseOutcome> {
  const log = courseRun(charts, hits, { course: { name: 'Page Dan', trophies }, ...(gauge ? { gauge } : {}) });
  const response = await submitCourse(fetchApp, cookie, courseBody(log, charts));
  expect(response.status).toBe(201);
  return (await response.json()) as CourseOutcome;
}

describe('course pages', () => {
  test('the course page ranks the players, lists the stages and links each run', async () => {
    const db = openDatabase(env.DB);
    const alice = await signInAnonymously(fetchApp);
    const bob = await signInAnonymously(fetchApp);
    await claimAccount(db, await userIdOf(alice));
    const best = await run(alice, [10, 10, 10]);
    const failed = await run(bob, [10, 5], 'DEATH');
    const path = `/courses/${encodeURIComponent(best.courseFingerprint)}`;

    const course = await page(path);
    expect(course.status).toBe(200);
    expect(course.html).toContain('Page Dan');
    expect(course.html).toContain('Grade course');
    expect(course.html).toContain('3 stages');
    // Alice's run is ranked, with her trophy; Bob is anonymous and comes in only with the switch.
    expect(course.html).toContain(`href="/course-scores/${best.courseScoreId}"`);
    expect(course.html).toContain('goldmedal');
    expect(course.html).not.toContain(`/course-scores/${failed.courseScoreId}`);
    expect((await page(`${path}?anonymous=1`)).html).toContain(`/course-scores/${failed.courseScoreId}`);
    // Every stage links to its chart page.
    for (const chart of charts) {
      expect(course.html).toContain(`href="/charts/${encodeURIComponent(chart.chartFingerprint)}"`);
    }
    expect(course.html).toContain('gauge_lr2');
    expect(course.html).not.toContain('<meta name="robots" content="noindex"/>');

    const ja = await page(path, undefined, { 'accept-language': 'ja' });
    expect(ja.html).toContain('段位認定');
    expect(ja.html).toContain('3 ステージ');

    expect((await page('/courses/bmcourse0:unknown')).status).toBe(404);
  });

  test('a course nobody with an account ran stays out of search engines', async () => {
    const carol = await signInAnonymously(fetchApp);
    const only = (await (
      await submitCourse(
        fetchApp,
        carol,
        courseBody(courseRun(charts.slice(0, 2), [10, 10], { course: { name: 'Lonely Dan' } }), charts.slice(0, 2)),
      )
    ).json()) as CourseOutcome;
    const course = await page(`/courses/${encodeURIComponent(only.courseFingerprint)}`);
    expect(course.html).toContain('<meta name="robots" content="noindex"/>');
  });

  test('a run page breaks the run down by stage and offers its replay', async () => {
    const db = openDatabase(env.DB);
    const dave = await signInAnonymously(fetchApp);
    await claimAccount(db, await userIdOf(dave));
    const failed = await run(dave, [10, 0], 'DEATH');
    const runPage = await page(`/course-scores/${failed.courseScoreId}`);
    expect(runPage.status).toBe(200);
    expect(runPage.html).toContain('Page Dan');
    expect(runPage.html).toContain(`href="/courses/${encodeURIComponent(failed.courseFingerprint)}"`);
    // Stage 1 cleared, stage 2 failed on its first POOR, stage 3 never reached.
    expect(runPage.html).toContain('not reached');
    expect(runPage.html).toContain('2 / 3');
    expect(runPage.html).toContain(`/api/v0/course-scores/${failed.courseScoreId}/replay`);
    // The stage list links the stage charts.
    expect(runPage.html).toContain(`href="/charts/${encodeURIComponent(charts[2]!.chartFingerprint)}"`);
    // Only its player gets the visibility switch.
    expect(runPage.html).not.toContain('data-course-score-id');
    const own = await page(`/course-scores/${failed.courseScoreId}`, dave);
    expect(own.html).toContain(`data-course-score-id="${failed.courseScoreId}"`);
    expect(own.html).toContain('data-account-action="hide-score"');

    expect(
      (await page(`/course-scores/${failed.courseScoreId}`, undefined, { 'accept-language': 'ja' })).html,
    ).toContain('未到達');
    expect((await page('/course-scores/nothing')).status).toBe(404);
  });

  test('a hidden run is its player’s alone, on its page and in the lists', async () => {
    const db = openDatabase(env.DB);
    const erin = await signInAnonymously(fetchApp);
    await claimAccount(db, await userIdOf(erin));
    const handle = await handleOf(erin);
    const shown = await run(erin, [10, 8, 10]);
    const hidden = await run(erin, [10, 9, 10]);
    const response = await fetchApp(`/api/v0/course-scores/${hidden.courseScoreId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: erin },
      body: JSON.stringify({ hidden: true }),
    });
    expect(response.status).toBe(200);

    expect((await page(`/course-scores/${hidden.courseScoreId}`)).status).toBe(404);
    const own = await page(`/course-scores/${hidden.courseScoreId}`, erin);
    expect(own.html).toContain('This run is hidden');
    expect(own.html).toContain('data-account-action="show-score"');
    expect(own.html).toContain('<meta name="robots" content="noindex"/>');

    // The player page and the top page list the shown run to everyone, the hidden one only to its player.
    const player = await page(`/players/${handle}`);
    expect(player.html).toContain('Latest course runs');
    expect(player.html).toContain(`/course-scores/${shown.courseScoreId}`);
    expect(player.html).not.toContain(`/course-scores/${hidden.courseScoreId}`);
    const ownPlayer = await page(`/players/${handle}`, erin);
    expect(ownPlayer.html).toContain(`/course-scores/${hidden.courseScoreId}`);
    expect(ownPlayer.html).toContain('>hidden<');
    const top = await page('/');
    expect(top.html).toContain(`/course-scores/${shown.courseScoreId}`);
    expect(top.html).not.toContain(`/course-scores/${hidden.courseScoreId}`);
    // The course ranking leaves it out too.
    const course = await page(`/courses/${encodeURIComponent(shown.courseFingerprint)}`);
    expect(course.html).not.toContain(`/course-scores/${hidden.courseScoreId}`);
  });
});
