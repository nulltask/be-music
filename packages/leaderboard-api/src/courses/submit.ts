import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  checkCoursePlaylogEligibility,
  PLAYLOG_ENGINE_VERSION,
  simulateCoursePlaylog,
  type BeMusicCoursePlaylog,
  type BeMusicPlaylog,
  type PlaylogCourseResult,
  type PlaylogRulesetId,
} from '@be-music/player/playlog';
import { normalizeCourseConstraints } from '@be-music/player/course';
import type { Database } from '../db/client.ts';
import { course, courseBestScore, courseScore, courseScoreResult } from '../db/schema.ts';
import { sha256Hex } from '../hash.ts';
import { byRulesetOrder, RULESET_IDS } from '../rulesets.ts';
import {
  checkPlayedChart,
  gzipText,
  playedChartStatements,
  putChartDocument,
  type PlayedChart,
} from '../scores/played-chart.ts';
import { identifyPlay, type SubmissionDeps } from '../scores/submit.ts';
import { mergeBestScores } from '../scoring/best.ts';
import { toCourseClearLamp, type ClearLamp } from '../scoring/lamp.ts';
import { loadCourseBestScores, toCourseBestScoreRow } from './bests.ts';
import { countCoursePlayers, rankOfCourseExScore } from './ranking.ts';
import { checkCourseRun, resolveCoursePlayedRuleset } from './verify.ts';

/** The fingerprint documents of one played stage, in the order the stages were played. */
export interface CourseStageDocuments {
  playDocument: unknown;
  chartDocument?: unknown;
}

export interface CourseSubmissionInput {
  userId: string;
  courseLog: BeMusicCoursePlaylog;
  /** The course play log as stored (canonical JSON text). */
  courseLogText: string;
  /** One entry per played stage. */
  stages: readonly CourseStageDocuments[];
  submittedBy?: string;
}

export interface CourseRulesetOutcome {
  ruleset: PlaylogRulesetId;
  rulesetRevision: string;
  exScore: number;
  noteCount: number;
  clearLamp: ClearLamp;
  missCount: number;
  maxCombo: number;
  stagesPlayed: number;
  trophy: string | null;
  rank: number;
  players: number;
  improved: { exScore: boolean; lamp: boolean; missCount: boolean };
}

export type CourseSubmissionOutcome =
  | {
      status: 'accepted' | 'duplicate';
      courseScoreId: string;
      courseFingerprint: string;
      results: CourseRulesetOutcome[];
    }
  | { status: 'rejected'; httpStatus: 400 | 409 | 422; reason: string; stage?: number };

/**
 * Accepts one course run (docs/leaderboard.md section 6.1). Each played stage passes the checks a single play does
 * (eligibility, fingerprint documents, chart registration), the run is re-simulated under every ruleset with
 * `simulateCoursePlaylog`, and `checkCourseRun` refuses runs whose stages do not follow from each other or that were
 * given up. A course run creates no chart scores. Rejections never write anything; the course play log goes to R2
 * before the D1 batch, as for single plays.
 */
export async function submitCourseScore(
  deps: SubmissionDeps,
  input: CourseSubmissionInput,
): Promise<CourseSubmissionOutcome> {
  const { db, blobs } = deps;
  const { courseLog } = input;
  const eligibility = checkCoursePlaylogEligibility(courseLog);
  if (!eligibility.eligible) {
    return { status: 'rejected', httpStatus: 422, reason: eligibility.reason, ...stageOf(eligibility.stage) };
  }
  const { courseFingerprint, assistFlags } = eligibility;
  const assisted = assistFlags.length > 0;
  const playedLogs = courseLog.stages.flatMap((entry) => (entry.played ? [entry.playlog] : []));
  if (input.stages.length !== playedLogs.length) {
    return { status: 'rejected', httpStatus: 400, reason: 'invalid-submission' };
  }

  const submissionId = await sha256Hex(identifyCourseRun(courseFingerprint, playedLogs, eligibility.stages));
  const existing = await db.query.courseScore.findFirst({ where: eq(courseScore.submissionId, submissionId) });
  if (existing !== undefined && existing.userId !== input.userId) {
    return { status: 'rejected', httpStatus: 409, reason: 'play-already-submitted' };
  }
  if (existing !== undefined) {
    return {
      status: 'duplicate',
      courseScoreId: existing.id,
      courseFingerprint: existing.courseFingerprint,
      results: await loadCourseOutcomes(db, existing.id, existing.courseFingerprint, existing.assisted),
    };
  }

  // Each played stage's chart, as a single play's (L3, chart registration, L4).
  const playedCharts: PlayedChart[] = [];
  for (const [index, stage] of eligibility.stages.entries()) {
    const check = await checkPlayedChart(db, { ...stage, ...input.stages[index]! });
    if (!check.ok) return { status: 'rejected', httpStatus: check.httpStatus, reason: check.reason, stage: index };
    playedCharts.push(check);
  }

  const playedRuleset = resolveCoursePlayedRuleset(courseLog);
  if (playedRuleset === undefined) {
    return { status: 'rejected', httpStatus: 422, reason: 'course-ruleset-mismatch' };
  }
  const simulated = new Map<PlaylogRulesetId, PlaylogCourseResult>(
    RULESET_IDS.map((ruleset) => [ruleset, simulateCoursePlaylog(courseLog, { ruleset })]),
  );
  const run = checkCourseRun(courseLog, simulated.get(playedRuleset)!);
  if (!run.ok) return { status: 'rejected', httpStatus: 422, reason: run.reason, ...stageOf(run.stage) };

  const now = deps.now();
  const courseScoreId = deps.newId();
  const playlogKey = `course-playlogs/${courseScoreId}.bmcourse.json.gz`;
  const [currentBests] = await Promise.all([
    loadCourseBestScores(db, input.userId, courseFingerprint, assisted),
    gzipText(input.courseLogText).then((compressed) =>
      blobs.put(playlogKey, compressed, {
        httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
      }),
    ),
    ...uniqueRegistrations(playedCharts).map((played) => putChartDocument(blobs, played)),
  ]);

  const figures = RULESET_IDS.map((ruleset) => {
    const result = simulated.get(ruleset)!;
    const lamp = toCourseClearLamp(result.lamp);
    const current = currentBests.get(ruleset);
    const update = mergeBestScores(current, {
      scoreId: courseScoreId,
      playedAt: now,
      exScore: result.exScore,
      lamp,
      missCount: result.missCount,
    });
    const playedHere = (current?.playedHere ?? false) || playedRuleset === ruleset;
    return { ruleset, result, lamp, update, playedHere };
  });

  const lastPlayed = playedLogs.at(-1)!;
  const statements: BatchItem<'sqlite'>[] = [
    ...playedLogs.flatMap((playlog, index) => playedChartStatements(db, playlog, playedCharts[index]!, now)),
    db
      .insert(course)
      .values({
        courseFingerprint,
        name: courseLog.course.name,
        kind: courseLog.course.kind,
        constraints: [...new Set(normalizeCourseConstraints(courseLog.course.constraints))].sort(),
        stageChartFingerprints: courseLog.stages.map((entry) =>
          entry.played ? entry.playlog.chart.chartFingerprint! : entry.chartFingerprint!,
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
      verification: playedCharts.every((played) => played.verification === 'L4') ? 'L4' : 'L3',
      stagesPlayed: playedLogs.length,
      recordedBy: courseLog.recorder !== undefined ? { ...courseLog.recorder } : null,
      submittedBy: input.submittedBy ?? null,
      serverEngine: PLAYLOG_ENGINE_VERSION,
      playlogKey,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }),
    ...figures.map(({ ruleset, result, lamp }) =>
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
        gaugeType: result.gauge.type,
        gaugeFinal: result.gauge.final,
        judges: { ...result.judge, fast: result.fast, slow: result.slow },
      }),
    ),
    ...figures.map(({ ruleset, update, playedHere }) => {
      const row = toCourseBestScoreRow(
        { userId: input.userId, courseFingerprint, ruleset, assisted },
        update.next,
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
    figures.map(async ({ ruleset, result, lamp, update }): Promise<CourseRulesetOutcome> => {
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
        improved: update.improved,
      };
    }),
  );
  return { status: 'accepted', courseScoreId, courseFingerprint, results };
}

/**
 * What identifies a course run regardless of who recorded it or when: the course and each played stage as
 * `identifyPlay` identifies a single play. Its hash is the course submission id.
 */
export function identifyCourseRun(
  courseFingerprint: string,
  playedLogs: readonly BeMusicPlaylog[],
  stages: ReadonlyArray<{ playFingerprint: string }>,
): string {
  return JSON.stringify({
    courseFingerprint,
    stages: playedLogs.map((playlog, index) => identifyPlay(playlog, stages[index]!.playFingerprint)),
  });
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
): Promise<CourseRulesetOutcome[]> {
  const rows = await db.select().from(courseScoreResult).where(eq(courseScoreResult.courseScoreId, courseScoreId));
  const outcomes = await Promise.all(
    rows.map(async (row): Promise<CourseRulesetOutcome> => {
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
        clearLamp: row.clearLamp as ClearLamp,
        missCount: row.missCount,
        maxCombo: row.maxCombo,
        stagesPlayed: row.stagesPlayed,
        trophy: row.trophy,
        rank,
        players,
        improved: { exScore: false, lamp: false, missCount: false },
      };
    }),
  );
  return outcomes.sort(byRulesetOrder);
}
