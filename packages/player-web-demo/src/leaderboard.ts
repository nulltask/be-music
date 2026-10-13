import {
  computeFingerprintOfDocument,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
  hasControlFlow,
  type BeMusicFingerprintDocument,
} from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlowWithDraws } from '@be-music/parser';
import { checkPlaylogEligibility, type BeMusicPlaylog } from '@be-music/player-web/runtime';

/** What the Leaderboard API needs for one play (docs/leaderboard.md section 5.1). */
export interface LeaderboardSubmission {
  playlog: BeMusicPlaylog;
  playDocument: BeMusicFingerprintDocument;
  chartDocument: BeMusicFingerprintDocument;
}

export type SubmissionPreparation =
  | { ok: true; submission: LeaderboardSubmission }
  | { ok: false; reason: 'not-rankable' | 'missing-fingerprint' | 'fingerprint-mismatch' };

/**
 * Builds the submission of a finished play from its play log and the song's chart as loaded. The play document is
 * rebuilt the way the recorder fingerprinted the play (the source chart resolved with the log's `#RANDOM` / `#SWITCH`
 * draws, the chart path as the lane-mode input), then checked against the log's play fingerprint, so a play the server would
 * reject as a mismatch is never sent. Auto plays, replays of aborted runs and other unrankable logs are skipped here.
 */
export function prepareLeaderboardSubmission(
  playlog: BeMusicPlaylog,
  sourceChart: BeMusicJson,
  chartPath: string | undefined,
): SubmissionPreparation {
  // The server applies the same check (`checkPlaylogEligibility`); assists are allowed and ranked apart there.
  const eligibility = checkPlaylogEligibility(playlog);
  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reason === 'missing-fingerprint' ? 'missing-fingerprint' : 'not-rankable' };
  }
  const { chartFingerprint, playFingerprint } = eligibility;
  const playedChart = hasControlFlow(sourceChart)
    ? resolveBmsControlFlowWithDraws(sourceChart, playlog.play.randomDraws ?? [])
    : sourceChart;
  const options = { chartPath };
  const playDocument = createPlayFingerprintDocument(playedChart, options);
  const chartDocument = createChartFingerprintDocument(sourceChart, options);
  if (
    computeFingerprintOfDocument(playDocument) !== playFingerprint ||
    computeFingerprintOfDocument(chartDocument) !== chartFingerprint
  ) {
    return { ok: false, reason: 'fingerprint-mismatch' };
  }
  return { ok: true, submission: { playlog, playDocument, chartDocument } };
}

/** The API's answer for one ruleset (`RulesetOutcome` in `@be-music/leaderboard-api`). */
export interface LeaderboardRulesetResult {
  ruleset: 'lr2' | 'beatoraja' | 'iidx';
  exScore: number;
  clearLamp: number;
  missCount: number;
  rank: number;
  players: number;
  improved: { exScore: boolean; lamp: boolean; missCount: boolean };
}

export type LeaderboardSubmitResult =
  | { status: 'accepted' | 'duplicate'; scoreId: string; results: LeaderboardRulesetResult[] }
  | { status: 'failed'; httpStatus: number; error: string };

export interface LeaderboardClientOptions {
  /** Defaults to the global `fetch`. Requests are same-origin, so the session cookie rides along. */
  fetch?: typeof fetch;
  /** Sent as `Be-Music-Client` (docs/leaderboard.md section 5.1). */
  client?: string;
}

/**
 * Sends one play to the Leaderboard: signs in anonymously when there is no session yet, posts the play log gzipped
 * with its play document, and resends with the chart document when the server does not know the chart (409).
 */
export async function submitToLeaderboard(
  submission: LeaderboardSubmission,
  options: LeaderboardClientOptions = {},
): Promise<LeaderboardSubmitResult> {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const session = await doFetch('/api/auth/get-session', { credentials: 'same-origin' });
  const signedIn = session.ok && (await session.json().catch(() => null)) !== null;
  if (!signedIn) {
    const signIn = await doFetch('/api/auth/sign-in/anonymous', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!signIn.ok) return { status: 'failed', httpStatus: signIn.status, error: 'sign-in-failed' };
  }

  const post = async (withChartDocument: boolean): Promise<Response> =>
    doFetch('/api/v0/scores', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        ...(options.client !== undefined ? { 'be-music-client': options.client } : {}),
      },
      body: await gzipJson({
        playlog: submission.playlog,
        playDocument: submission.playDocument,
        ...(withChartDocument ? { chartDocument: submission.chartDocument } : {}),
      }),
    });

  let response = await post(false);
  if (response.status === 409 && (await readError(response.clone())) === 'chart-document-required') {
    response = await post(true);
  }
  if (response.status === 201 || response.status === 200) {
    const body = (await response.json()) as { scoreId: string; results: LeaderboardRulesetResult[] };
    return { status: response.status === 201 ? 'accepted' : 'duplicate', ...body };
  }
  return { status: 'failed', httpStatus: response.status, error: (await readError(response)) ?? 'unknown' };
}

/**
 * One status-line summary of a submission, for the ruleset the play was judged under: rank, players, EX score, and
 * which personal bests it improved.
 */
export function describeLeaderboardResult(result: LeaderboardSubmitResult, playedRuleset: string): string {
  if (result.status === 'failed') {
    return `Leaderboard: not submitted (${result.error})`;
  }
  const mine = result.results.find((entry) => entry.ruleset === playedRuleset) ?? result.results[0];
  if (mine === undefined) return 'Leaderboard: submitted';
  const improved = [
    mine.improved.exScore ? 'EX' : undefined,
    mine.improved.lamp ? 'lamp' : undefined,
    mine.improved.missCount ? 'BP' : undefined,
  ].filter((part) => part !== undefined);
  const best = result.status === 'accepted' && improved.length > 0 ? ` · new best ${improved.join(' / ')}` : '';
  const again = result.status === 'duplicate' ? ' (already submitted)' : '';
  return `Leaderboard ${mine.ruleset}: #${mine.rank} / ${mine.players} · EX ${mine.exScore}${best}${again}`;
}

/** Why a play was not sent, for the status line (a skipped play must never pass silently). */
export function describeSkippedSubmission(reason: Exclude<SubmissionPreparation, { ok: true }>['reason']): string {
  switch (reason) {
    case 'not-rankable':
      return 'Leaderboard: not submitted (auto play and aborted runs are not ranked)';
    case 'missing-fingerprint':
      return 'Leaderboard: not submitted (this play log has no chart fingerprint)';
    case 'fingerprint-mismatch':
      return 'Leaderboard: not submitted (the chart does not match the recorded play)';
  }
}

async function gzipJson(value: unknown): Promise<Blob> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).blob();
}

async function readError(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
}
