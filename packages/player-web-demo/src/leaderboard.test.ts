import { describe, expect, test } from 'vite-plus/test';
import { computeChartFingerprint, computePlayFingerprint, drawRandomOutcomes } from '@be-music/chart';
import { parseBms, resolveBmsControlFlowWithDraws } from '@be-music/parser';
import type { BeMusicCoursePlaylog, BeMusicPlaylog } from '@be-music/player/playlog';
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

const SOURCE = parseBms(
  ['#BPM 150', '#00111:01010101', '#RANDOM 2', '#IF 1', '#00113:01', '#ENDIF', '#IF 2', '#00114:01', '#ENDIF'].join(
    '\n',
  ),
);
const CHART_PATH = 'song/chart.bms';

/** A play log fingerprinted the way the recorder does it: source chart, its draws, and the chart path. */
function recordedPlaylog(play: Partial<BeMusicPlaylog['play']> = {}): BeMusicPlaylog {
  const randomDraws = [...drawRandomOutcomes(SOURCE, () => 0.9)];
  const played = resolveBmsControlFlowWithDraws(SOURCE, randomDraws);
  return {
    format: 'be-music-playlog',
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
  test('rebuilds both documents so they hash to the fingerprints the play log carries', () => {
    const prepared = prepareLeaderboardSubmission(recordedPlaylog(), SOURCE, CHART_PATH);
    expect(prepared.ok).toBe(true);
  });

  test('skips plays the server would not rank', () => {
    expect(prepareLeaderboardSubmission(recordedPlaylog({ mode: 'auto' }), SOURCE, CHART_PATH)).toEqual({
      ok: false,
      reason: 'not-rankable',
    });
    expect(prepareLeaderboardSubmission(recordedPlaylog({ aborted: true }), SOURCE, CHART_PATH)).toEqual({
      ok: false,
      reason: 'not-rankable',
    });
    // A play at another tempo is practice: skipped, with its own reason for the status line.
    expect(prepareLeaderboardSubmission(recordedPlaylog({ tempo: 0.8 }), SOURCE, CHART_PATH)).toEqual({
      ok: false,
      reason: 'tempo',
    });
    const withoutFingerprint = recordedPlaylog();
    delete withoutFingerprint.chart.playFingerprint;
    expect(prepareLeaderboardSubmission(withoutFingerprint, SOURCE, CHART_PATH)).toEqual({
      ok: false,
      reason: 'missing-fingerprint',
    });
  });

  test('never sends documents that would not match (another lane-mode input here)', () => {
    expect(prepareLeaderboardSubmission(recordedPlaylog(), SOURCE, 'song/chart.pms')).toEqual({
      ok: false,
      reason: 'fingerprint-mismatch',
    });
  });
});

describe('submitToLeaderboard', () => {
  const prepared = prepareLeaderboardSubmission(recordedPlaylog(), SOURCE, CHART_PATH);
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

  test('signs in anonymously, then resends with the chart document when the server asks for it', async () => {
    const { calls, fetchImpl } = fakeFetch([
      () => json(null),
      () => json({ user: { id: 'u' } }),
      () => json({ error: 'chart-document-required' }, 409),
      () => json(accepted, 201),
    ]);
    const result = await submitToLeaderboard(submission, { fetch: fetchImpl, client: 'be-music-web/test' });
    expect(result).toEqual({ status: 'accepted', ...accepted });
    expect(calls.map((call) => call.url)).toEqual([
      '/api/auth/get-session',
      '/api/auth/sign-in/anonymous',
      '/api/v0/scores',
      '/api/v0/scores',
    ]);
    const headers = calls[2]!.init!.headers as Record<string, string>;
    expect(headers['content-encoding']).toBe('gzip');
    expect(headers['be-music-client']).toBe('be-music-web/test');

    const bodies = await Promise.all(
      [calls[2]!, calls[3]!].map(async (call) => {
        const stream = (call.init!.body as Blob).stream().pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text()) as Record<string, unknown>;
      }),
    );
    expect(bodies[0]).not.toHaveProperty('chartDocument');
    expect(bodies[1]).toHaveProperty('chartDocument');
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
    expect(describeLeaderboardResult({ status: 'failed', httpStatus: 429, error: 'rate-limited' }, 'lr2')).toBe(
      'Leaderboard: not submitted (rate-limited)',
    );
  });
});

describe('describeSkippedSubmission', () => {
  test('names why a play was not sent', () => {
    expect(describeSkippedSubmission('not-rankable')).toBe(
      'Leaderboard: not submitted (auto play, aborted runs and course stages are not ranked)',
    );
    expect(describeSkippedSubmission('tempo')).toMatch(/another tempo is practice/);
    expect(describeSkippedSubmission('missing-fingerprint')).toMatch(/no chart fingerprint/);
    expect(describeSkippedSubmission('fingerprint-mismatch')).toMatch(/does not match/);
  });
});

describe('course submissions', () => {
  const OTHER = parseBms(['#BPM 150', '#00112:01010101'].join('\n'));
  const stageCharts = [
    { chart: SOURCE, chartPath: CHART_PATH },
    { chart: OTHER, chartPath: 'song/other.bms' },
  ];

  function courseLog(
    play: Partial<BeMusicPlaylog['play']> = {},
    withUnreachedFingerprint = true,
  ): BeMusicCoursePlaylog {
    const unreachedFingerprint = courseStageChartFingerprint(stageCharts[1]!);
    return {
      format: 'be-music-course-playlog',
      version: 0,
      course: { name: 'Dan', kind: 'grade', constraints: [], trophies: [] },
      stages: [
        { played: true, playlog: recordedPlaylog({ course: { kind: 'grade' }, ...play }) },
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
    expect(courseStageChartFingerprint(stageCharts[0]!)).toBe(recordedPlaylog().chart.chartFingerprint);
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
      reason: 'not-rankable',
    });
    expect(prepareCourseLeaderboardSubmission(courseLog({}, false), stageCharts)).toEqual({
      ok: false,
      reason: 'missing-fingerprint',
    });
    expect(prepareCourseLeaderboardSubmission(courseLog(), [{ chart: SOURCE, chartPath: 'song/chart.pms' }])).toEqual({
      ok: false,
      reason: 'fingerprint-mismatch',
    });
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
    expect(describeCourseLeaderboardResult({ status: 'failed', httpStatus: 422, error: 'aborted' }, 'lr2')).toBe(
      'Leaderboard: course not submitted (aborted)',
    );
  });

  test('describeSkippedCourseSubmission names why a run was not sent', () => {
    expect(describeSkippedCourseSubmission('not-rankable')).toMatch(/auto play and aborted stages/);
    expect(describeSkippedCourseSubmission('tempo')).toMatch(/another tempo is practice/);
    expect(describeSkippedCourseSubmission('missing-fingerprint')).toMatch(/no fingerprint/);
    expect(describeSkippedCourseSubmission('fingerprint-mismatch')).toMatch(/does not match/);
  });
});
