import {
  computeChartFingerprint,
  computeFingerprintOfDocument,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
  hasControlFlow,
  type BeMusicFingerprintDocument,
} from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlowWithDraws } from '@be-music/parser';
import { checkCoursePlaylogEligibility, type BeMusicCoursePlaylog } from '@be-music/player/playlog';
import { checkPlaylogEligibility, type BeMusicPlaylog } from '@be-music/player-web/runtime';

/** What the Leaderboard API needs for one play (docs/leaderboard.md section 5.1). */
export interface LeaderboardSubmission {
  playlog: BeMusicPlaylog;
  playDocument: BeMusicFingerprintDocument;
  chartDocument: BeMusicFingerprintDocument;
}

export type SubmissionPreparation =
  | { ok: true; submission: LeaderboardSubmission }
  | { ok: false; reason: 'not-rankable' | 'tempo' | 'missing-fingerprint' | 'fingerprint-mismatch' };

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
    return { ok: false, reason: skippedReason(eligibility.reason) };
  }
  const documents = rebuildDocuments(playlog, sourceChart, chartPath, eligibility);
  if (documents === undefined) return { ok: false, reason: 'fingerprint-mismatch' };
  return { ok: true, submission: { playlog, ...documents } };
}

/**
 * Both fingerprint documents of a play, rebuilt from the source chart as the recorder fingerprinted it, or `undefined`
 * when they would not hash to the play log's fingerprints.
 */
function rebuildDocuments(
  playlog: BeMusicPlaylog,
  sourceChart: BeMusicJson,
  chartPath: string | undefined,
  fingerprints: { chartFingerprint: string; playFingerprint: string },
): { playDocument: BeMusicFingerprintDocument; chartDocument: BeMusicFingerprintDocument } | undefined {
  const playedChart = hasControlFlow(sourceChart)
    ? resolveBmsControlFlowWithDraws(sourceChart, playlog.play.randomDraws ?? [])
    : sourceChart;
  const options = { chartPath };
  const playDocument = createPlayFingerprintDocument(playedChart, options);
  const chartDocument = createChartFingerprintDocument(sourceChart, options);
  if (
    computeFingerprintOfDocument(playDocument) !== fingerprints.playFingerprint ||
    computeFingerprintOfDocument(chartDocument) !== fingerprints.chartFingerprint
  ) {
    return undefined;
  }
  return { playDocument, chartDocument };
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
  const response = await postWithChartDocuments('/api/v0/scores', options, (withChartDocument) => ({
    playlog: submission.playlog,
    playDocument: submission.playDocument,
    ...(withChartDocument ? { chartDocument: submission.chartDocument } : {}),
  }));
  if (!(response instanceof Response)) return response;
  if (response.status === 201 || response.status === 200) {
    const body = (await response.json()) as { scoreId: string; results: LeaderboardRulesetResult[] };
    return { status: response.status === 201 ? 'accepted' : 'duplicate', ...body };
  }
  return { status: 'failed', httpStatus: response.status, error: (await readError(response)) ?? 'unknown' };
}

/**
 * Signs in anonymously when there is no session yet, then posts `body(false)` gzipped, and resends `body(true)` (with
 * the chart documents) when the server does not know a chart (409 `chart-document-required`).
 */
async function postWithChartDocuments(
  path: string,
  options: LeaderboardClientOptions,
  body: (withChartDocuments: boolean) => unknown,
): Promise<Response | { status: 'failed'; httpStatus: number; error: string }> {
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

  const post = async (withChartDocuments: boolean): Promise<Response> =>
    doFetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        ...(options.client !== undefined ? { 'be-music-client': options.client } : {}),
      },
      body: await gzipJson(body(withChartDocuments)),
    });

  const response = await post(false);
  if (response.status === 409 && (await readError(response.clone())) === 'chart-document-required') {
    return await post(true);
  }
  return response;
}

/** What the Leaderboard API needs for one course run: the course play log and each played stage's documents. */
export interface CourseLeaderboardSubmission {
  coursePlaylog: BeMusicCoursePlaylog;
  stages: Array<{ playDocument: BeMusicFingerprintDocument; chartDocument: BeMusicFingerprintDocument }>;
}

export type CourseSubmissionPreparation =
  | { ok: true; submission: CourseLeaderboardSubmission }
  | { ok: false; reason: 'not-rankable' | 'tempo' | 'missing-fingerprint' | 'fingerprint-mismatch' };

/**
 * Builds the submission of a finished course run: the course play log, with the fingerprint documents of each played
 * stage rebuilt from the stage's chart as the course played it (`stageCharts`, one per course stage, in order) and
 * checked like a single play's. Runs the server would refuse outright (auto play, an aborted stage, a stage chart
 * without its fingerprint) are skipped here (`checkCoursePlaylogEligibility`).
 */
export function prepareCourseLeaderboardSubmission(
  coursePlaylog: BeMusicCoursePlaylog,
  stageCharts: ReadonlyArray<{ chart: BeMusicJson; chartPath: string | undefined }>,
): CourseSubmissionPreparation {
  const eligibility = checkCoursePlaylogEligibility(coursePlaylog);
  if (!eligibility.eligible) {
    return { ok: false, reason: skippedReason(eligibility.reason) };
  }
  const stages: CourseLeaderboardSubmission['stages'] = [];
  for (const [index, entry] of coursePlaylog.stages.entries()) {
    if (!entry.played) break;
    const stageChart = stageCharts[index];
    const documents =
      stageChart === undefined
        ? undefined
        : rebuildDocuments(entry.playlog, stageChart.chart, stageChart.chartPath, eligibility.stages[index]!);
    if (documents === undefined) return { ok: false, reason: 'fingerprint-mismatch' };
    stages.push(documents);
  }
  return { ok: true, submission: { coursePlaylog, stages } };
}

/**
 * The chart fingerprint of a course stage's chart, as the recorder would record it had the stage been played (the
 * chart as the course plays it, the chart path as the lane-mode input). It keys an unreached stage of a course play
 * log; `undefined` when the chart cannot be fingerprinted.
 */
export function courseStageChartFingerprint(stage: {
  chart: BeMusicJson;
  chartPath: string | undefined;
}): string | undefined {
  try {
    return computeChartFingerprint(stage.chart, { chartPath: stage.chartPath });
  } catch {
    return undefined;
  }
}

/** The API's answer for one ruleset of a course run (`CourseRulesetOutcome` in `@be-music/leaderboard-api`). */
export interface CourseLeaderboardRulesetResult extends LeaderboardRulesetResult {
  stagesPlayed: number;
  trophy: string | null;
}

export type CourseLeaderboardSubmitResult =
  | { status: 'accepted' | 'duplicate'; courseScoreId: string; results: CourseLeaderboardRulesetResult[] }
  | { status: 'failed'; httpStatus: number; error: string };

/**
 * Sends one course run to the Leaderboard (`POST /api/v0/course-scores`), signing in anonymously when needed and
 * resending with every stage's chart document when the server does not know a stage chart.
 */
export async function submitCourseToLeaderboard(
  submission: CourseLeaderboardSubmission,
  options: LeaderboardClientOptions = {},
): Promise<CourseLeaderboardSubmitResult> {
  const response = await postWithChartDocuments('/api/v0/course-scores', options, (withChartDocuments) => ({
    coursePlaylog: submission.coursePlaylog,
    stages: submission.stages.map((stage) => ({
      playDocument: stage.playDocument,
      ...(withChartDocuments ? { chartDocument: stage.chartDocument } : {}),
    })),
  }));
  if (!(response instanceof Response)) return response;
  if (response.status === 201 || response.status === 200) {
    const body = (await response.json()) as { courseScoreId: string; results: CourseLeaderboardRulesetResult[] };
    return { status: response.status === 201 ? 'accepted' : 'duplicate', ...body };
  }
  return { status: 'failed', httpStatus: response.status, error: (await readError(response)) ?? 'unknown' };
}

/** {@link describeLeaderboardResult} for a course run: the course rank under the ruleset the run was played with. */
export function describeCourseLeaderboardResult(result: CourseLeaderboardSubmitResult, playedRuleset: string): string {
  if (result.status === 'failed') return `Leaderboard: course not submitted (${result.error})`;
  const summary = describeLeaderboardResult(
    { status: result.status, scoreId: result.courseScoreId, results: result.results },
    playedRuleset,
  );
  return summary.replace(/^Leaderboard /, 'Leaderboard course ');
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

/** The skip reason of a play or course run the server would refuse with `reason`. */
function skippedReason(reason: string): 'not-rankable' | 'tempo' | 'missing-fingerprint' {
  return reason === 'missing-fingerprint' || reason === 'tempo' ? reason : 'not-rankable';
}

/** Why a play was not sent, for the status line (a skipped play must never pass silently). */
export function describeSkippedSubmission(reason: Exclude<SubmissionPreparation, { ok: true }>['reason']): string {
  switch (reason) {
    case 'not-rankable':
      return 'Leaderboard: not submitted (auto play, aborted runs and course stages are not ranked)';
    case 'tempo':
      return 'Leaderboard: not submitted (a play at another tempo is practice and is not ranked)';
    case 'missing-fingerprint':
      return 'Leaderboard: not submitted (this play log has no chart fingerprint)';
    case 'fingerprint-mismatch':
      return 'Leaderboard: not submitted (the chart does not match the recorded play)';
  }
}

/** Why a course run was not sent, for the status line. */
export function describeSkippedCourseSubmission(
  reason: Exclude<CourseSubmissionPreparation, { ok: true }>['reason'],
): string {
  switch (reason) {
    case 'not-rankable':
      return 'Leaderboard: course not submitted (auto play and aborted stages are not ranked)';
    case 'tempo':
      return 'Leaderboard: course not submitted (a run at another tempo is practice and is not ranked)';
    case 'missing-fingerprint':
      return 'Leaderboard: course not submitted (a stage chart has no fingerprint)';
    case 'fingerprint-mismatch':
      return 'Leaderboard: course not submitted (a stage chart does not match the recorded play)';
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
