import { playerText } from './player-copy.ts';
import {
  computeChartFingerprint,
  computeFingerprintOfDocument,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
  hasControlFlow,
  type BeMusicFingerprintDocument,
} from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import {
  checkCourseReplayEligibility,
  checkReplayEligibility,
  resolveCourseStageChartFingerprints,
  type BeMusicCourseReplay,
  type BeMusicReplay,
  type CourseReplayIneligibleReason,
  type RulesetId,
} from '@be-music/player-engine/replay';

/** What the Leaderboard API needs for one play (docs/leaderboard.md section 5.1). */
export interface LeaderboardSubmission {
  replay: BeMusicReplay;
  playDocument: BeMusicFingerprintDocument;
  chartDocument: BeMusicFingerprintDocument;
}

export type SubmissionPreparation =
  | { ok: true; submission: LeaderboardSubmission }
  | { ok: false; reason: 'auto-play' | 'two-player' | 'missing-fingerprint' | 'fingerprint-mismatch' };

/**
 * Builds the submission of a finished play from its replay and the song's chart as loaded. The play document is
 * rebuilt the way the recorder fingerprinted the play (the source chart resolved with the log's `#RANDOM` / `#SWITCH`
 * draws, the chart path as the lane-mode input), then checked against the log's play fingerprint, so a play the server would
 * reject as a mismatch is never sent. Only auto plays and logs without fingerprints are skipped here: a play the
 * Leaderboard does not rank (another tempo) is still sent, and the Leaderboard decides what it shows.
 */
export function prepareLeaderboardSubmission(
  replay: BeMusicReplay,
  sourceChart: BeMusicJSON,
  chartPath: string | undefined,
): SubmissionPreparation {
  // The server applies the same check (`checkReplayEligibility`); it ranks assists apart and stores unranked plays.
  const eligibility = checkReplayEligibility(replay);
  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reason };
  }
  const documents = rebuildDocuments(replay, sourceChart, chartPath, eligibility);
  if (documents === undefined) return { ok: false, reason: 'fingerprint-mismatch' };
  return { ok: true, submission: { replay, ...documents } };
}

/**
 * Both fingerprint documents of a play, rebuilt from the source chart as the recorder fingerprinted it, or `undefined`
 * when they would not hash to the replay's fingerprints.
 */
function rebuildDocuments(
  replay: BeMusicReplay,
  sourceChart: BeMusicJSON,
  chartPath: string | undefined,
  fingerprints: { chartFingerprint: string; playFingerprint: string },
): { playDocument: BeMusicFingerprintDocument; chartDocument: BeMusicFingerprintDocument } | undefined {
  const playedChart = hasControlFlow(sourceChart)
    ? resolveBMSControlFlowWithDraws(sourceChart, replay.play.randomDraws ?? [])
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

/** The API's answer for one ruleset (`RulesetOutcome` in `@be-music/app-leaderboard`). */
export interface LeaderboardRulesetResult {
  ruleset: RulesetId;
  exScore: number;
  clearLamp: number;
  missCount: number;
  /** 0 for a play the Leaderboard stores but does not rank. */
  rank: number;
  players: number;
  improved: { exScore: boolean; lamp: boolean; missCount: boolean };
  /** `truncated`: judged only up to where the play stopped on failure, unranked (ADR 0019). */
  outcome?: 'truncated';
}

/** A ruleset the Leaderboard cannot judge the play under (`NotSimulatedOutcome` in `@be-music/app-leaderboard`). */
export interface LeaderboardNotSimulated {
  ruleset: RulesetId;
  reason: string;
}

export type LeaderboardSubmitResult =
  | {
      status: 'accepted' | 'duplicate';
      scoreId: string;
      results: LeaderboardRulesetResult[];
      /** The rulesets the Leaderboard cannot judge the play under. */
      notSimulated?: LeaderboardNotSimulated[];
      /** Why the Leaderboard stored the play without ranking it (`tempo`, `course-stage`, ...). */
      unranked?: string;
    }
  | { status: 'failed'; httpStatus: number; error: string };

export interface LeaderboardClientOptions {
  /** Defaults to the global `fetch`. Requests are same-origin, so the session cookie rides along. */
  fetch?: typeof fetch;
  /** Sent as `Be-Music-Client` (docs/leaderboard.md section 5.1). */
  client?: string;
}

/**
 * Sends one play to the Leaderboard: requires an Accounts session, posts the replay gzipped
 * with its play document, and resends with the chart document when the server does not know the chart (409).
 */
export async function submitToLeaderboard(
  submission: LeaderboardSubmission,
  options: LeaderboardClientOptions = {},
): Promise<LeaderboardSubmitResult> {
  const response = await postWithChartDocuments('/api/v0/scores', options, (withChartDocument) => ({
    replay: submission.replay,
    playDocument: submission.playDocument,
    ...(withChartDocument ? { chartDocument: submission.chartDocument } : {}),
  }));
  if (!(response instanceof Response)) return response;
  if (response.status === 201 || response.status === 200) {
    const body = (await response.json()) as {
      scoreId: string;
      results: LeaderboardRulesetResult[];
      notSimulated?: LeaderboardNotSimulated[];
      unranked?: string;
    };
    return { status: response.status === 201 ? 'accepted' : 'duplicate', ...body };
  }
  return { status: 'failed', httpStatus: response.status, error: (await readError(response)) ?? 'unknown' };
}

/**
 * Requires a session, posts `body(false)` gzipped, and resends `body(true)` (with
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
  if (!signedIn) return { status: 'failed', httpStatus: 401, error: 'sign-in-required' };

  const post = async (withChartDocuments: boolean): Promise<Response> =>
    doFetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        ...(options.client !== undefined ? { 'be-music-client': options.client } : {}),
      },
      body: await gzipJSON(body(withChartDocuments)),
    });

  const response = await post(false);
  if (response.status === 409 && (await readError(response.clone())) === 'chart-document-required') {
    return await post(true);
  }
  return response;
}

/**
 * What the Leaderboard API needs for one course run: the course replay, each played stage's documents, and the charts
 * of the stages the server rebuilds (every unreached stage, and every stage of a NONSTOP run).
 */
export interface CourseLeaderboardSubmission {
  courseReplay: BeMusicCourseReplay;
  /** One entry per played stage; none for a NONSTOP run. */
  stages: Array<{ playDocument: BeMusicFingerprintDocument; chartDocument: BeMusicFingerprintDocument }>;
  stageCharts: Array<{ stage: number; chart: BeMusicJSON; pms?: boolean }>;
}

export type CourseSubmissionPreparation =
  | { ok: true; submission: CourseLeaderboardSubmission }
  | { ok: false; reason: CourseReplayIneligibleReason | 'fingerprint-mismatch' };

/**
 * Builds the submission of a finished course run: the course replay, with the fingerprint documents of each played
 * stage rebuilt from the stage's chart as the course played it (`stageCharts`, one per course stage, in order) and
 * checked like a single play's, and the chart of each stage the server rebuilds itself: every stage the run never
 * reached (the server checks the notes they count as BP), and every stage of a NONSTOP run (the server stitches them
 * again; a NONSTOP run sends no documents). Each such chart must hash to the chart fingerprint the log names for its
 * stage. Runs the server would refuse outright (auto play, an aborted stage, a stage chart without its fingerprint) are
 * skipped here (`checkCourseReplayEligibility`); a run the Leaderboard stores without ranking (another tempo, an
 * unreleased course) is sent.
 */
export function prepareCourseLeaderboardSubmission(
  courseReplay: BeMusicCourseReplay,
  stageCharts: ReadonlyArray<{ chart: BeMusicJSON; chartPath: string | undefined }>,
): CourseSubmissionPreparation {
  const eligibility = checkCourseReplayEligibility(courseReplay);
  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reason };
  }
  const nonstop = eligibility.nonstop !== undefined;
  const stages: CourseLeaderboardSubmission['stages'] = [];
  const rebuilt: CourseLeaderboardSubmission['stageCharts'] = [];
  const chartFingerprints = resolveCourseStageChartFingerprints(courseReplay);
  for (const [index, entry] of courseReplay.stages.entries()) {
    const stageChart = stageCharts[index];
    if (stageChart === undefined) return { ok: false, reason: 'fingerprint-mismatch' };
    if (entry.played && !nonstop) {
      const documents = rebuildDocuments(
        entry.replay,
        stageChart.chart,
        stageChart.chartPath,
        eligibility.stages[index]!,
      );
      if (documents === undefined) return { ok: false, reason: 'fingerprint-mismatch' };
      stages.push(documents);
      continue;
    }
    if (courseStageChartFingerprint(stageChart) !== chartFingerprints[index]) {
      return { ok: false, reason: 'fingerprint-mismatch' };
    }
    const pms = stageChart.chartPath?.toLowerCase().endsWith('.pms') === true;
    rebuilt.push({ stage: index, chart: stageChart.chart, ...(pms ? { pms } : {}) });
  }
  return { ok: true, submission: { courseReplay, stages, stageCharts: rebuilt } };
}

/**
 * The chart fingerprint of a course stage's chart, as the recorder would record it had the stage been played (the
 * chart as the course plays it, the chart path as the lane-mode input). It keys an unreached stage of a course play
 * log; `undefined` when the chart cannot be fingerprinted.
 */
export function courseStageChartFingerprint(stage: {
  chart: BeMusicJSON;
  chartPath: string | undefined;
}): string | undefined {
  try {
    return computeChartFingerprint(stage.chart, { chartPath: stage.chartPath });
  } catch {
    return undefined;
  }
}

/** The API's answer for one ruleset of a course run (`CourseRulesetOutcome` in `@be-music/app-leaderboard`). */
export interface CourseLeaderboardRulesetResult extends LeaderboardRulesetResult {
  stagesPlayed: number;
  trophy: string | null;
}

export type CourseLeaderboardSubmitResult =
  | {
      status: 'accepted' | 'duplicate';
      courseScoreId: string;
      results: CourseLeaderboardRulesetResult[];
      /** The rulesets the Leaderboard cannot judge the run under. */
      notSimulated?: LeaderboardNotSimulated[];
      /** Why the Leaderboard stored the run without ranking it (`tempo`, `unreleased`). */
      unranked?: string;
    }
  | { status: 'failed'; httpStatus: number; error: string };

/**
 * Sends one course run to the Leaderboard (`POST /api/v0/course-scores`), using the existing Accounts session and
 * resending with every stage's chart document when the server does not know a stage chart. The stage charts the server
 * rebuilds go with every request.
 */
export async function submitCourseToLeaderboard(
  submission: CourseLeaderboardSubmission,
  options: LeaderboardClientOptions = {},
): Promise<CourseLeaderboardSubmitResult> {
  const response = await postWithChartDocuments('/api/v0/course-scores', options, (withChartDocuments) => ({
    courseReplay: submission.courseReplay,
    stages: submission.stages.map((stage) => ({
      playDocument: stage.playDocument,
      ...(withChartDocuments ? { chartDocument: stage.chartDocument } : {}),
    })),
    stageCharts: submission.stageCharts,
  }));
  if (!(response instanceof Response)) return response;
  if (response.status === 201 || response.status === 200) {
    const body = (await response.json()) as {
      courseScoreId: string;
      results: CourseLeaderboardRulesetResult[];
      notSimulated?: LeaderboardNotSimulated[];
      unranked?: string;
    };
    return { status: response.status === 201 ? 'accepted' : 'duplicate', ...body };
  }
  return { status: 'failed', httpStatus: response.status, error: (await readError(response)) ?? 'unknown' };
}

/** {@link describeLeaderboardResult} for a course run: the course rank under the ruleset the run was played with. */
export function describeCourseLeaderboardResult(result: CourseLeaderboardSubmitResult, playedRuleset: string): string {
  if (result.status === 'failed') return playerText().lb.courseNotSubmitted(result.error);
  return describeRankedResult(result, playedRuleset, true);
}

/**
 * One status-line summary of a submission, for the ruleset the play was judged under: rank, players, EX score, and
 * which personal bests it improved.
 */
export function describeLeaderboardResult(result: LeaderboardSubmitResult, playedRuleset: string): string {
  if (result.status === 'failed') return playerText().lb.notSubmitted(result.error);
  return describeRankedResult(result, playedRuleset, false);
}

function describeRankedResult(
  result: {
    status: 'accepted' | 'duplicate';
    results: readonly LeaderboardRulesetResult[];
    notSimulated?: readonly LeaderboardNotSimulated[];
    unranked?: string;
  },
  playedRuleset: string,
  course: boolean,
): string {
  const copy = playerText().lb;
  const again = result.status === 'duplicate' ? copy.already : '';
  if (result.unranked !== undefined) return copy.stored(describeUnranked(result.unranked), again);
  const mine =
    result.results.find((entry) => entry.ruleset === playedRuleset) ??
    result.results.find((entry) => entry.outcome === undefined);
  if (mine === undefined) return copy.submitted;
  const improved = [
    mine.improved.exScore ? 'EX' : undefined,
    mine.improved.lamp ? copy.lamp : undefined,
    mine.improved.missCount ? 'BP' : undefined,
  ].filter((part) => part !== undefined);
  const best = result.status === 'accepted' && improved.length > 0 ? copy.newBest(improved.join(' / ')) : '';
  // The other rulesets that could not judge the play in full (ADR 0019): a skipped judgment must never pass silently.
  const truncated = result.results.filter((entry) => entry.outcome === 'truncated').map((entry) => entry.ruleset);
  const notSimulated = (result.notSimulated ?? []).map((entry) => entry.ruleset);
  const others =
    (truncated.length > 0 ? copy.truncated(truncated.join(', ')) : '') +
    (notSimulated.length > 0 ? copy.notSimulated(notSimulated.join(', ')) : '');
  const line = course ? copy.courseRanked : copy.ranked;
  return line(mine.ruleset, mine.rank, mine.players, mine.exScore, best + others, again);
}

/** Why the Leaderboard stored a play without ranking it, for the status line. */
function describeUnranked(reason: string): string {
  const reasons = playerText().lb.unranked;
  return reason in reasons ? reasons[reason as keyof typeof reasons] : reason;
}

/** Why a play was not sent, for the status line (a skipped play must never pass silently). */
export function describeSkippedSubmission(reason: Exclude<SubmissionPreparation, { ok: true }>['reason']): string {
  return playerText().lb.skipped[reason];
}

/** Why a course run was not sent, for the status line. */
export function describeSkippedCourseSubmission(
  reason: Exclude<CourseSubmissionPreparation, { ok: true }>['reason'],
): string {
  return playerText().lb.courseSkipped[reason];
}

async function gzipJSON(value: unknown): Promise<Blob> {
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
