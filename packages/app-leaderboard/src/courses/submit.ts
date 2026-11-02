import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  checkCourseReplayEligibility,
  REPLAY_ENGINE_VERSION,
  resolveCoursePlayedRuleset,
  simulateCourseReplay,
  type BeMusicCourseReplay,
  type BeMusicReplay,
  type CourseReplayUnrankedReason,
  type ReplayCourseResult,
  type RulesetId,
} from '@be-music/player-engine/replay';
import { normalizeCourseConstraints } from '@be-music/player-engine/course';
import type { Database } from '../db/client.ts';
import { course, courseBestScore, courseScore, courseScoreResult } from '../db/schema.ts';
import { sha256HexAsync as sha256Hex } from '@be-music/shared-utils/hash';
import { byRulesetOrder, RULESET_IDS } from '../rulesets.ts';
import {
  checkPlayedChart,
  gzipText,
  playedChartStatements,
  putChartDocument,
  type PlayedChart,
} from '../scores/played-chart.ts';
import { checkChartPlayOptions } from '../scores/chart-play-options.ts';
import { identifyPlay, type SubmissionDeps } from '../scores/submit.ts';
import { mergeBestScores } from '../scoring/best.ts';
import { clearLampRank } from '@be-music/player-engine/ruleset';
import { loadCourseBestScores, toCourseBestScoreRow } from './bests.ts';
import { courseTrophyRank, mergeCourseTrophy, toCourseStageFigures } from './figures.ts';
import { countCoursePlayers, rankOfCourseExScore } from './ranking.ts';
import { checkNonstopStageCharts, checkUnreachedStageCharts, type StageChartInput } from './stage-charts.ts';
import { checkCourseRun } from './verify.ts';

/** The fingerprint documents of one played stage, in the order the stages were played. */
export interface CourseStageDocuments {
  playDocument: unknown;
  chartDocument?: unknown;
}

export interface CourseSubmissionInput {
  userId: string;
  courseLog: BeMusicCourseReplay;
  /** The course replay as stored (canonical JSON text). */
  courseLogText: string;
  /** One entry per played stage; none for a NONSTOP run, whose stages are rebuilt from {@link stageCharts}. */
  stages: readonly CourseStageDocuments[];
  /** The charts of the stages the server rebuilds: every unreached stage, and every stage of a NONSTOP run. */
  stageCharts?: readonly StageChartInput[];
  submittedBy?: string;
}

export interface CourseRulesetOutcome {
  ruleset: RulesetId;
  rulesetRevision: string;
  exScore: number;
  noteCount: number;
  /** The course lamp, by its rank (`clearLampRank`). */
  clearLamp: number;
  missCount: number;
  maxCombo: number;
  stagesPlayed: number;
  trophy: string | null;
  rank: number;
  players: number;
  improved: { exScore: boolean; lamp: boolean; missCount: boolean; trophy: boolean };
}

export type CourseSubmissionOutcome =
  | {
      status: 'accepted' | 'duplicate';
      courseScoreId: string;
      courseFingerprint: string;
      results: CourseRulesetOutcome[];
      /** Why the run was stored without ranking it; its results then carry rank and players 0. */
      unranked?: CourseReplayUnrankedReason;
    }
  | { status: 'rejected'; httpStatus: 400 | 409 | 422; reason: string; stage?: number };

/**
 * Accepts one course run (docs/leaderboard.md section 6.1). Each played stage passes the checks a single play does
 * (eligibility, fingerprint documents, chart registration), each unreached stage's chart backs up its facts
 * (`checkUnreachedStageCharts`), the run is re-simulated under every ruleset with `simulateCourseReplay`, and
 * `checkCourseRun` refuses runs whose stages do not follow from each other or that were given up. A NONSTOP run is
 * verified on its stitched play instead: the server stitches the stage charts again (`checkNonstopStageCharts`) and the
 * play must have been recorded on that chart. A course run creates no chart scores. Rejections never write anything;
 * the course replay goes to R2 before the D1 batch, as for single plays. A run that does not rank (a stage at another
 * tempo, an unreleased course: `checkCourseReplayEligibility`'s `unranked`) is stored and simulated all the same, but
 * moves no course best and takes no place in the course ranking.
 */
export async function submitCourseScore(
  deps: SubmissionDeps,
  input: CourseSubmissionInput,
): Promise<CourseSubmissionOutcome> {
  const { db, blobs } = deps;
  const { courseLog } = input;
  const eligibility = checkCourseReplayEligibility(courseLog);
  if (!eligibility.eligible) {
    return { status: 'rejected', httpStatus: 422, reason: eligibility.reason, ...stageOf(eligibility.stage) };
  }
  const { courseFingerprint, assistFlags, assistClass, unranked } = eligibility;
  // A run with an assisted stage is stored unranked (`assist`, #602); `assisted` keeps which board it would be on.
  const assisted = assistClass !== 'none';
  const playedLogs = courseLog.stages.flatMap((entry) => (entry.played ? [entry.replay] : []));
  const nonstop =
    courseLog.nonstop !== undefined && eligibility.nonstop !== undefined ? eligibility.nonstop : undefined;
  if (input.stages.length !== (nonstop !== undefined ? 0 : playedLogs.length)) {
    return { status: 'rejected', httpStatus: 400, reason: 'invalid-submission' };
  }

  const submissionId = await sha256Hex(
    nonstop !== undefined
      ? identifyNonstopRun(courseFingerprint, courseLog.nonstop!.replay, nonstop.playFingerprint)
      : identifyCourseRun(courseFingerprint, playedLogs, eligibility.stages),
  );
  const existing = await db.query.courseScore.findFirst({ where: eq(courseScore.submissionId, submissionId) });
  if (existing !== undefined && existing.userId !== input.userId) {
    return { status: 'rejected', httpStatus: 409, reason: 'play-already-submitted' };
  }
  if (existing !== undefined) {
    return {
      status: 'duplicate',
      courseScoreId: existing.id,
      courseFingerprint: existing.courseFingerprint,
      results: await loadCourseOutcomes(
        db,
        existing.id,
        existing.courseFingerprint,
        existing.assisted,
        existing.unranked,
      ),
      ...(existing.unranked !== null ? { unranked: existing.unranked } : {}),
    };
  }

  // Each played stage's chart, as a single play's (L3, chart registration, L4).
  const playedCharts: PlayedChart[] = [];
  for (const [index, stage] of eligibility.stages.entries()) {
    const check = await checkPlayedChart(db, { ...stage, ...input.stages[index]! });
    if (!check.ok) return { status: 'rejected', httpStatus: check.httpStatus, reason: check.reason, stage: index };
    const chartOptions = checkChartPlayOptions(playedLogs[index]!, input.stages[index]!.playDocument);
    if (!chartOptions.ok) return { status: 'rejected', httpStatus: 422, reason: chartOptions.reason, stage: index };
    playedCharts.push(check);
  }

  // A NONSTOP run's stitched play runs no stage's gameplay options.
  if (nonstop !== undefined && !checkChartPlayOptions(courseLog.nonstop!.replay, undefined).ok) {
    return { status: 'rejected', httpStatus: 422, reason: 'chart-play-options-mismatch' };
  }
  const playedRuleset = resolveCoursePlayedRuleset(courseLog);
  if (playedRuleset === undefined) {
    return { status: 'rejected', httpStatus: 422, reason: 'course-ruleset-mismatch' };
  }
  const stageCharts = input.stageCharts ?? [];
  const charts =
    nonstop !== undefined
      ? checkNonstopStageCharts(courseLog, stageCharts, {
          playFingerprint: nonstop.playFingerprint,
          ruleset: playedRuleset,
        })
      : checkUnreachedStageCharts(courseLog, stageCharts);
  if (!charts.ok) return { status: 'rejected', httpStatus: 422, reason: charts.reason, ...stageOf(charts.stage) };
  const simulated = new Map<RulesetId, ReplayCourseResult>(
    RULESET_IDS.map((ruleset) => [ruleset, simulateCourseReplay(courseLog, { ruleset })]),
  );
  const run = checkCourseRun(courseLog, simulated.get(playedRuleset)!);
  if (!run.ok) return { status: 'rejected', httpStatus: 422, reason: run.reason, ...stageOf(run.stage) };

  const now = deps.now();
  const courseScoreId = deps.newId();
  const replayKey = `course-replays/${courseScoreId}.bmcourse.json.gz`;
  const [currentBests] = await Promise.all([
    unranked === undefined ? loadCourseBestScores(db, input.userId, courseFingerprint, assisted) : new Map(),
    gzipText(input.courseLogText).then((compressed) =>
      blobs.put(replayKey, compressed, {
        httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
      }),
    ),
    ...uniqueRegistrations(playedCharts).map((played) => putChartDocument(blobs, played)),
  ]);

  const figures = RULESET_IDS.map((ruleset) => {
    const result = simulated.get(ruleset)!;
    const lamp = clearLampRank(result.lamp);
    const current = currentBests.get(ruleset);
    const update = mergeBestScores(current, {
      scoreId: courseScoreId,
      playedAt: now,
      exScore: result.exScore,
      lamp,
      missCount: result.missCount,
    });
    const trophyRank = courseTrophyRank(courseLog.course.trophies, result.trophy);
    const trophy = mergeCourseTrophy(current?.trophy, {
      scoreId: courseScoreId,
      trophy: result.trophy ?? null,
      rank: trophyRank,
    });
    const playedHere = (current?.playedHere ?? false) || playedRuleset === ruleset;
    return { ruleset, result, lamp, update, trophyRank, trophy, playedHere };
  });

  // A NONSTOP run's gauge is its stitched play's.
  const lastPlayed = courseLog.nonstop?.replay ?? playedLogs.at(-1)!;
  const statements: BatchItem<'sqlite'>[] = [
    // A NONSTOP run registers no stage charts: its cut-out stages carry the stitched play's judge rank and TOTAL, not
    // their charts' own.
    ...(nonstop !== undefined
      ? []
      : playedLogs.flatMap((replay, index) => playedChartStatements(db, replay, playedCharts[index]!, now))),
    db
      .insert(course)
      .values({
        courseFingerprint,
        name: courseLog.course.name,
        kind: courseLog.course.kind,
        constraints: [...new Set(normalizeCourseConstraints(courseLog.course.constraints))].sort(),
        stageChartFingerprints: courseLog.stages.map((entry) =>
          entry.played ? entry.replay.chart.chartFingerprint! : entry.chartFingerprint!,
        ),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      // The first run names the course; a concurrent first run may have registered it already.
      .onConflictDoNothing(),
    db.insert(courseScore).values({
      id: courseScoreId,
      submissionId,
      userId: input.userId,
      courseFingerprint,
      playedRuleset,
      gauge: lastPlayed.play.gauge,
      assisted,
      assistFlags,
      // A NONSTOP run's charts were all rebuilt here from the stage charts, which hash to their chart fingerprints.
      verification: playedCharts.every((played) => played.verification === 'L4') ? 'L4' : 'L3',
      stagesPlayed: playedLogs.length,
      recordedBy: courseLog.recorder !== undefined ? { ...courseLog.recorder } : null,
      submittedBy: input.submittedBy ?? null,
      serverEngine: REPLAY_ENGINE_VERSION,
      replayKey,
      unranked: unranked ?? null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }),
    ...figures.map(({ ruleset, result, lamp, trophyRank }) =>
      db.insert(courseScoreResult).values({
        courseScoreId,
        ruleset,
        rulesetRevision: result.ruleset,
        exScore: result.exScore,
        noteCount: result.noteCount,
        clearLamp: lamp,
        missCount: result.missCount,
        maxCombo: result.maxCombo,
        stagesPlayed: result.stagesPlayed,
        trophy: result.trophy ?? null,
        trophyRank,
        stages: result.stages.map(toCourseStageFigures),
        gaugeType: result.gauge.type,
        gaugeFinal: result.gauge.final,
        judges: { ...result.judge, fast: result.fast, slow: result.slow },
      }),
    ),
    // An unranked run moves no course best.
    ...(unranked !== undefined ? [] : figures).map(({ ruleset, update, trophy, playedHere }) => {
      const row = toCourseBestScoreRow(
        { userId: input.userId, courseFingerprint, ruleset, assisted },
        update.next,
        trophy.next,
        playedHere,
        now,
      );
      return db
        .insert(courseBestScore)
        .values(row)
        .onConflictDoUpdate({
          target: [
            courseBestScore.userId,
            courseBestScore.courseFingerprint,
            courseBestScore.ruleset,
            courseBestScore.assisted,
          ],
          set: row,
        });
    }),
  ];
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  const results = await Promise.all(
    figures.map(async ({ ruleset, result, lamp, update, trophy }): Promise<CourseRulesetOutcome> => {
      if (unranked !== undefined) {
        return unrankedCourseOutcome({ ...result, ruleset, rulesetRevision: result.ruleset, clearLamp: lamp });
      }
      const filter = { courseFingerprint, ruleset, assisted, includeAnonymous: true, playedHereOnly: false };
      const [rank, players] = await Promise.all([
        rankOfCourseExScore(db, filter, update.next.bestEx),
        countCoursePlayers(db, filter),
      ]);
      return {
        ruleset,
        rulesetRevision: result.ruleset,
        exScore: result.exScore,
        noteCount: result.noteCount,
        clearLamp: lamp,
        missCount: result.missCount,
        maxCombo: result.maxCombo,
        stagesPlayed: result.stagesPlayed,
        trophy: result.trophy ?? null,
        rank,
        players,
        improved: { ...update.improved, trophy: trophy.improved },
      };
    }),
  );
  return {
    status: 'accepted',
    courseScoreId,
    courseFingerprint,
    results,
    ...(unranked !== undefined ? { unranked } : {}),
  };
}

/** The outcome of an unranked run under one ruleset: its figures, with no rank, players or best moved. */
function unrankedCourseOutcome(figures: {
  ruleset: RulesetId;
  rulesetRevision: string;
  exScore: number;
  noteCount: number;
  clearLamp: number;
  missCount: number;
  maxCombo: number;
  stagesPlayed: number;
  trophy?: string | null;
}): CourseRulesetOutcome {
  return {
    ruleset: figures.ruleset,
    rulesetRevision: figures.rulesetRevision,
    exScore: figures.exScore,
    noteCount: figures.noteCount,
    clearLamp: figures.clearLamp,
    missCount: figures.missCount,
    maxCombo: figures.maxCombo,
    stagesPlayed: figures.stagesPlayed,
    trophy: figures.trophy ?? null,
    rank: 0,
    players: 0,
    improved: { exScore: false, lamp: false, missCount: false, trophy: false },
  };
}

/**
 * What identifies a course run regardless of who recorded it or when: the course and each played stage as
 * `identifyPlay` identifies a single play. Its hash is the course submission id.
 */
export function identifyCourseRun(
  courseFingerprint: string,
  playedLogs: readonly BeMusicReplay[],
  stages: ReadonlyArray<{ playFingerprint: string }>,
): string {
  return JSON.stringify({
    courseFingerprint,
    stages: playedLogs.map((replay, index) => identifyPlay(replay, stages[index]!.playFingerprint)),
  });
}

/** {@link identifyCourseRun} for a NONSTOP run: the course and its stitched play, as `identifyPlay` identifies it. */
export function identifyNonstopRun(courseFingerprint: string, replay: BeMusicReplay, playFingerprint: string): string {
  return JSON.stringify({ courseFingerprint, nonstop: identifyPlay(replay, playFingerprint) });
}

function stageOf(stage: number | undefined): { stage?: number } {
  return stage === undefined ? {} : { stage };
}

/** The new charts among the stages, once each (a course can play one chart twice). */
function uniqueRegistrations(playedCharts: readonly PlayedChart[]): PlayedChart[] {
  const seen = new Set<string>();
  return playedCharts.filter((played) => {
    if (played.registration === undefined || seen.has(played.chartFingerprint)) return false;
    seen.add(played.chartFingerprint);
    return true;
  });
}

/** The outcome of an already stored run, for a resubmission. Ranks reflect the current standings. */
async function loadCourseOutcomes(
  db: Database,
  courseScoreId: string,
  courseFingerprint: string,
  assisted: boolean,
  unranked: string | null,
): Promise<CourseRulesetOutcome[]> {
  const rows = await db.select().from(courseScoreResult).where(eq(courseScoreResult.courseScoreId, courseScoreId));
  const outcomes = await Promise.all(
    rows.map(async (row): Promise<CourseRulesetOutcome> => {
      if (unranked !== null) return unrankedCourseOutcome(row);
      const filter = {
        courseFingerprint,
        ruleset: row.ruleset,
        assisted,
        includeAnonymous: true,
        playedHereOnly: false,
      };
      const [rank, players] = await Promise.all([
        rankOfCourseExScore(db, filter, row.exScore),
        countCoursePlayers(db, filter),
      ]);
      return {
        ruleset: row.ruleset,
        rulesetRevision: row.rulesetRevision,
        exScore: row.exScore,
        noteCount: row.noteCount,
        clearLamp: row.clearLamp,
        missCount: row.missCount,
        maxCombo: row.maxCombo,
        stagesPlayed: row.stagesPlayed,
        trophy: row.trophy,
        rank,
        players,
        improved: { exScore: false, lamp: false, missCount: false, trophy: false },
      };
    }),
  );
  return outcomes.sort(byRulesetOrder);
}
