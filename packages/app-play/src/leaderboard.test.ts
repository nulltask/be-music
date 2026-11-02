import { describe, expect, test } from 'vite-plus/test';
import { computeChartFingerprint, computePlayFingerprint, drawRandomOutcomes } from '@be-music/chart-model';
import { parseBMS, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import type { BeMusicCourseReplay, BeMusicReplay } from '@be-music/player-engine/replay';
import {
  courseStageChartFingerprint,
  describeCourseLeaderboardResult,
  describeLeaderboardResult,
  describeSkippedCourseSubmission,
  describeSkippedSubmission,
  prepareCourseLeaderboardSubmission,
  prepareLeaderboardSubmission,
  submitCourseToLeaderboard,
  submitToLeaderboard,
  type CourseLeaderboardSubmission,
  type LeaderboardSubmission,
} from './leaderboard.ts';

const SOURCE = parseBMS(
  ['#BPM 150', '#00111:01010101', '#RANDOM 2', '#IF 1', '#00113:01', '#ENDIF', '#IF 2', '#00114:01', '#ENDIF'].join(
    '\n',
  ),
);
const CHART_PATH = 'song/chart.bms';

/** A replay fingerprinted the way the recorder does it: source chart, its draws, and the chart path. */
function recordedReplay(play: Partial<BeMusicReplay['play']> = {}): BeMusicReplay {
  const randomDraws = [...drawRandomOutcomes(SOURCE, () => 0.9)];
  const played = resolveBMSControlFlowWithDraws(SOURCE, randomDraws);
  return {
    format: 'be-music-replay',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 0,
      notes: [],
      chartFingerprint: computeChartFingerprint(SOURCE, { chartPath: CHART_PATH }),
      playFingerprint: computePlayFingerprint(played, { chartPath: CHART_PATH }),
    },
    inputs: [],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', judgeRuleset: 'beatoraja', randomDraws, ...play },
  };
}

describe('prepareLeaderboardSubmission', () => {
  test('rebuilds both documents so they hash to the fingerprints the replay carries', () => {
    const prepared = prepareLeaderboardSubmission(recordedReplay(), SOURCE, CHART_PATH);
    expect(prepared.ok).toBe(true);
  });

  test('sends a play given up with ESC, which the server ranks as a failed play', () => {
    expect(prepareLeaderboardSubmission(recordedReplay({ aborted: true }), SOURCE, CHART_PATH).ok).toBe(true);
  });

  test('skips auto plays and logs without fingerprints, and sends a play the Leaderboard will not rank', () => {
    expect(prepareLeaderboardSubmission(recordedReplay({ mode: 'auto' }), SOURCE, CHART_PATH)).toEqual({
      ok: false,
      reason: 'auto-play',
    });
    // A play at another tempo is practice: sent all the same, and the Leaderboard stores it unranked.
    expect(prepareLeaderboardSubmission(recordedReplay({ tempo: 0.8 }), SOURCE, CHART_PATH).ok).toBe(true);
    const withoutFingerprint = recordedReplay();
    delete withoutFingerprint.chart.playFingerprint;
    expect(prepareLeaderboardSubmission(withoutFingerprint, SOURCE, CHART_PATH)).toEqual({
      ok: false,
      reason: 'missing-fingerprint',
    });
  });

  test('never sends documents that would not match (another lane-mode input here)', () => {
    expect(prepareLeaderboardSubmission(recordedReplay(), SOURCE, 'song/chart.pms')).toEqual({
      ok: false,
      reason: 'fingerprint-mismatch',
    });
  });
});

describe('submitToLeaderboard', () => {
  const prepared = prepareLeaderboardSubmission(recordedReplay(), SOURCE, CHART_PATH);
  const submission = (prepared as { ok: true; submission: LeaderboardSubmission }).submission;
  const accepted = {
    scoreId: 's1',
    results: [
      {
        ruleset: 'beatoraja',
        exScore: 10,
        clearLamp: 4,
        missCount: 0,
        rank: 2,
        players: 5,
        improved: { exScore: true, lamp: false, missCount: true },
      },
    ],
  };

  function fakeFetch(responses: Array<(url: string, init?: RequestInit) => Response>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const next = responses.shift();
      if (next === undefined) throw new Error(`unexpected request ${url}`);
      return next(url, init);
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  test('resends with the chart document when the server asks for it', async () => {
    const { calls, fetchImpl } = fakeFetch([
      () => json({ user: { id: 'u' } }),
      () => json({ error: 'chart-document-required' }, 409),
      () => json(accepted, 201),
    ]);
    const result = await submitToLeaderboard(submission, { fetch: fetchImpl, client: 'be-music-web/test' });
    expect(result).toEqual({ status: 'accepted', ...accepted });
    expect(calls.map((call) => call.url)).toEqual(['/api/auth/get-session', '/api/v0/scores', '/api/v0/scores']);
    const headers = calls[1]!.init!.headers as Record<string, string>;
    expect(headers['content-encoding']).toBe('gzip');
    expect(headers['be-music-client']).toBe('be-music-web/test');

    const bodies = await Promise.all(
      [calls[1]!, calls[2]!].map(async (call) => {
        const stream = (call.init!.body as Blob).stream().pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text()) as Record<string, unknown>;
      }),
    );
    expect(bodies[0]).not.toHaveProperty('chartDocument');
    expect(bodies[1]).toHaveProperty('chartDocument');
  });

  test('requires explicit Accounts sign-in instead of creating another anonymous identity', async () => {
    const { calls, fetchImpl } = fakeFetch([() => json(null)]);
    expect(await submitToLeaderboard(submission, { fetch: fetchImpl })).toEqual({
      status: 'failed',
      httpStatus: 401,
      error: 'sign-in-required',
    });
    expect(calls.map((call) => call.url)).toEqual(['/api/auth/get-session']);
  });

  test('reuses an existing session and reports failures', async () => {
    const { calls, fetchImpl } = fakeFetch([
      () => json({ user: { id: 'u' } }),
      () => json({ error: 'play-already-submitted' }, 409),
    ]);
    expect(await submitToLeaderboard(submission, { fetch: fetchImpl })).toEqual({
      status: 'failed',
      httpStatus: 409,
      error: 'play-already-submitted',
    });
    expect(calls.map((call) => call.url)).toEqual(['/api/auth/get-session', '/api/v0/scores']);
  });
});

describe('describeLeaderboardResult', () => {
  const result = {
    ruleset: 'lr2' as const,
    exScore: 1234,
    clearLamp: 5,
    missCount: 3,
    rank: 4,
    players: 20,
    improved: { exScore: true, lamp: true, missCount: false },
  };

  test('summarizes the played ruleset with the bests it improved', () => {
    expect(describeLeaderboardResult({ status: 'accepted', scoreId: 's', results: [result] }, 'lr2')).toBe(
      'Leaderboard lr2: #4 / 20 · EX 1234 · new best EX / lamp',
    );
    expect(describeLeaderboardResult({ status: 'duplicate', scoreId: 's', results: [result] }, 'lr2')).toBe(
      'Leaderboard lr2: #4 / 20 · EX 1234 (already submitted)',
    );
    // A play the Leaderboard stores without ranking says so instead of a rank.
    expect(
      describeLeaderboardResult({ status: 'accepted', scoreId: 's', results: [result], unranked: 'tempo' }, 'lr2'),
    ).toBe('Leaderboard: stored, not ranked (a play at another tempo is practice)');
    expect(describeLeaderboardResult({ status: 'failed', httpStatus: 429, error: 'rate-limited' }, 'lr2')).toBe(
      'Leaderboard: not submitted (rate-limited)',
    );
  });
  test('names the rulesets that judged the play only in part or not at all (ADR 0019)', () => {
    const truncated = { ...result, ruleset: 'beatoraja' as const, rank: 0, players: 0, outcome: 'truncated' as const };
    expect(
      describeLeaderboardResult(
        {
          status: 'accepted',
          scoreId: 's',
          results: [result, truncated],
          notSimulated: [{ ruleset: '____', reason: 'gauge' }],
        },
        'lr2',
      ),
    ).toBe(
      'Leaderboard lr2: #4 / 20 · EX 1234 · new best EX / lamp · judged only up to the failure under beatoraja · not simulated under ____',
    );
  });
});

describe('describeSkippedSubmission', () => {
  test('names why a play was not sent', () => {
    expect(describeSkippedSubmission('auto-play')).toBe('Leaderboard: not submitted (an auto play is not sent)');
    expect(describeSkippedSubmission('two-player')).toMatch(/two-player/);
    expect(describeSkippedSubmission('missing-fingerprint')).toMatch(/no chart fingerprint/);
    expect(describeSkippedSubmission('fingerprint-mismatch')).toMatch(/does not match/);
  });
});

describe('course submissions', () => {
  const OTHER = parseBMS(['#BPM 150', '#00112:01010101'].join('\n'));
  const stageCharts = [
    { chart: SOURCE, chartPath: CHART_PATH },
    { chart: OTHER, chartPath: 'song/other.bms' },
  ];

  function courseLog(play: Partial<BeMusicReplay['play']> = {}, withUnreachedFingerprint = true): BeMusicCourseReplay {
    const unreachedFingerprint = courseStageChartFingerprint(stageCharts[1]!);
    return {
      format: 'be-music-course-replay',
      version: 0,
      course: { name: 'Dan', kind: 'grade', constraints: [], trophies: [] },
      stages: [
        { played: true, replay: recordedReplay({ course: { kind: 'grade' }, ...play }) },
        {
          played: false,
          facts: {
            sourceFormat: 'bms',
            laneMode: '7keys',
            lnMode: 1,
            judgeRank: { percent: 75 },
            notes: { normal: 4, long: { 1: 0, 2: 0, 3: 0 } },
          },
          ...(withUnreachedFingerprint && unreachedFingerprint !== undefined
            ? { chartFingerprint: unreachedFingerprint }
            : {}),
        },
      ],
    };
  }

  test('courseStageChartFingerprint fingerprints a stage chart as the recorder would', () => {
    expect(courseStageChartFingerprint(stageCharts[0]!)).toBe(recordedReplay().chart.chartFingerprint);
  });

  test('prepareCourseLeaderboardSubmission rebuilds each played stage’s documents and sends each unreached chart', () => {
    const prepared = prepareCourseLeaderboardSubmission(courseLog(), stageCharts);
    expect(prepared.ok).toBe(true);
    const { submission } = prepared as { ok: true; submission: CourseLeaderboardSubmission };
    expect(submission.stages).toHaveLength(1);
    // The server counts the unreached stage's notes from its chart.
    expect(submission.stageCharts).toEqual([{ stage: 1, chart: OTHER }]);
    expect(prepareCourseLeaderboardSubmission(courseLog(), [stageCharts[0]!, stageCharts[0]!])).toEqual({
      ok: false,
      reason: 'fingerprint-mismatch',
    });
    expect(prepareCourseLeaderboardSubmission(courseLog({ mode: 'auto' }), stageCharts)).toEqual({
      ok: false,
      reason: 'auto-play',
    });
    expect(prepareCourseLeaderboardSubmission(courseLog({}, false), stageCharts)).toEqual({
      ok: false,
      reason: 'missing-fingerprint',
    });
    expect(prepareCourseLeaderboardSubmission(courseLog(), [{ chart: SOURCE, chartPath: 'song/chart.pms' }])).toEqual({
      ok: false,
      reason: 'fingerprint-mismatch',
    });
    // A made or random course is unranked (`release: false`): sent all the same, and the Leaderboard stores it.
    const unranked = courseLog();
    unranked.course.release = false;
    expect(prepareCourseLeaderboardSubmission(unranked, stageCharts).ok).toBe(true);
  });

  test('submitCourseToLeaderboard resends with every stage’s chart document when asked', async () => {
    const prepared = prepareCourseLeaderboardSubmission(courseLog(), stageCharts) as {
      ok: true;
      submission: CourseLeaderboardSubmission;
    };
    const accepted = {
      courseScoreId: 'c1',
      results: [
        {
          ruleset: 'beatoraja',
          exScore: 8,
          clearLamp: 1,
          missCount: 4,
          stagesPlayed: 1,
          trophy: null,
          rank: 3,
          players: 7,
          improved: { exScore: true, lamp: false, missCount: false },
        },
      ],
    };
    const responses = [
      () => new Response(JSON.stringify({ user: { id: 'u' } })),
      () => new Response(JSON.stringify({ error: 'chart-document-required' }), { status: 409 }),
      () => new Response(JSON.stringify(accepted), { status: 201 }),
    ];
    const bodies: unknown[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v0/course-scores') {
        const stream = (init!.body as Blob).stream().pipeThrough(new DecompressionStream('gzip'));
        bodies.push(JSON.parse(await new Response(stream).text()));
      }
      return responses.shift()!();
    }) as typeof fetch;
    const result = await submitCourseToLeaderboard(prepared.submission, { fetch: fetchImpl });
    expect(result).toEqual({ status: 'accepted', ...accepted });
    expect(bodies).toMatchObject([
      { stages: [{}], stageCharts: [{ stage: 1 }] },
      { stages: [{ chartDocument: {} }], stageCharts: [{ stage: 1 }] },
    ]);
    expect((bodies[0] as { stages: object[] }).stages[0]).not.toHaveProperty('chartDocument');
    expect(describeCourseLeaderboardResult(result, 'beatoraja')).toBe(
      'Leaderboard course beatoraja: #3 / 7 · EX 8 · new best EX',
    );
    expect(describeCourseLeaderboardResult({ ...result, unranked: 'unreleased' } as typeof result, 'lr2')).toBe(
      'Leaderboard: stored, not ranked (a made course is ranked only once flagged for IR, and a random course never is)',
    );
    expect(describeCourseLeaderboardResult({ status: 'failed', httpStatus: 422, error: 'aborted' }, 'lr2')).toBe(
      'Leaderboard: course not submitted (aborted)',
    );
  });

  test('describeSkippedCourseSubmission names why a run was not sent', () => {
    expect(describeSkippedCourseSubmission('auto-play')).toMatch(/auto play is not sent/);
    expect(describeSkippedCourseSubmission('aborted')).toMatch(/given up/);
    expect(describeSkippedCourseSubmission('not-a-course-run')).toMatch(/one run/);
    expect(describeSkippedCourseSubmission('missing-fingerprint')).toMatch(/no fingerprint/);
    expect(describeSkippedCourseSubmission('fingerprint-mismatch')).toMatch(/does not match/);
  });
});
