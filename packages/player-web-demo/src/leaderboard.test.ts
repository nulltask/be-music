import { describe, expect, test } from 'vite-plus/test';
import { computeChartFingerprint, computePlayFingerprint, drawRandomOutcomes } from '@be-music/chart';
import { parseBms, resolveBmsControlFlowWithDraws } from '@be-music/parser';
import type { BeMusicPlaylog } from '@be-music/player-web/runtime';
import {
  describeLeaderboardResult,
  describeSkippedSubmission,
  prepareLeaderboardSubmission,
  submitToLeaderboard,
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
    expect(describeSkippedSubmission('missing-fingerprint')).toMatch(/no chart fingerprint/);
    expect(describeSkippedSubmission('fingerprint-mismatch')).toMatch(/does not match/);
  });
});
