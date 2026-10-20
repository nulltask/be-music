import { and, eq, inArray } from 'drizzle-orm';
import type { RulesetId } from '@be-music/player-engine/replay';
import type { Database } from '../db/client.ts';
import { chart, course, courseBestScore, courseScore, courseScoreResult, profile } from '../db/schema.ts';
import { byRulesetOrder } from '../rulesets.ts';
import { canSeeScore } from '../scores/visibility.ts';
import { countCoursePlayers, rankOfCourseExScore } from './ranking.ts';

export interface CourseDetail {
  courseFingerprint: string;
  name: string;
  kind: string;
  constraints: string[];
  stages: Array<{
    chartFingerprint: string;
    title: string | null;
    artist: string | null;
    playLevel: string | null;
    laneMode: string | null;
  }>;
  createdAt: number;
}

/** A course and what the server knows of its stage charts (a stage nobody reached may be a chart it never saw). */
export async function loadCourseDetail(db: Database, courseFingerprint: string): Promise<CourseDetail | undefined> {
  const found = await db.query.course.findFirst({ where: eq(course.courseFingerprint, courseFingerprint) });
  if (found === undefined) return undefined;
  const charts =
    found.stageChartFingerprints.length === 0
      ? []
      : await db
          .select({
            chartFingerprint: chart.chartFingerprint,
            title: chart.title,
            artist: chart.artist,
            playLevel: chart.playLevel,
            laneMode: chart.laneMode,
          })
          .from(chart)
          .where(inArray(chart.chartFingerprint, [...new Set(found.stageChartFingerprints)]));
  const byFingerprint = new Map(charts.map((row) => [row.chartFingerprint, row]));
  return {
    courseFingerprint: found.courseFingerprint,
    name: found.name,
    kind: found.kind,
    constraints: found.constraints,
    stages: found.stageChartFingerprints.map((chartFingerprint) => {
      const known = byFingerprint.get(chartFingerprint);
      return {
        chartFingerprint,
        title: known?.title ?? null,
        artist: known?.artist ?? null,
        playLevel: known?.playLevel ?? null,
        laneMode: known?.laneMode ?? null,
      };
    }),
    createdAt: found.createdAt.getTime(),
  };
}

/** One course run with its figures under every ruleset. Hidden runs answer only their player. */
export async function loadCourseScoreDetail(db: Database, id: string, viewerId: string | undefined) {
  const [found] = await db
    .select({ score: courseScore, handle: profile.handle, displayName: profile.displayName })
    .from(courseScore)
    .leftJoin(profile, eq(profile.userId, courseScore.userId))
    .where(eq(courseScore.id, id));
  if (found === undefined || !canSeeScore(found.score, viewerId)) return undefined;
  const results = await db.select().from(courseScoreResult).where(eq(courseScoreResult.courseScoreId, id));
  const { score } = found;
  return {
    id: score.id,
    courseFingerprint: score.courseFingerprint,
    player: found.handle === null ? null : { handle: found.handle, displayName: found.displayName ?? found.handle },
    playedRuleset: score.playedRuleset,
    gauge: score.gauge,
    assisted: score.assisted,
    assistFlags: score.assistFlags,
    verification: score.verification,
    stagesPlayed: score.stagesPlayed,
    createdAt: score.createdAt.getTime(),
    hidden: score.hidden,
    results: results
      .map((row) => ({
        ruleset: row.ruleset,
        rulesetRevision: row.rulesetRevision,
        exScore: row.exScore,
        noteCount: row.noteCount,
        clearLamp: row.clearLamp,
        missCount: row.missCount,
        maxCombo: row.maxCombo,
        stagesPlayed: row.stagesPlayed,
        trophy: row.trophy,
        trophyRank: row.trophyRank,
        gaugeType: row.gaugeType,
        gaugeFinal: row.gaugeFinal,
        judges: row.judges,
        stages: row.stages ?? null,
      }))
      .sort(byRulesetOrder),
  };
}

/** The viewer's best on a course and their rank among every player, anonymous ones included. */
export async function loadMyCourseRank(
  db: Database,
  query: { userId: string; courseFingerprint: string; ruleset: RulesetId; assisted: boolean },
) {
  const mine = await db.query.courseBestScore.findFirst({
    where: and(
      eq(courseBestScore.userId, query.userId),
      eq(courseBestScore.courseFingerprint, query.courseFingerprint),
      eq(courseBestScore.ruleset, query.ruleset),
      eq(courseBestScore.assisted, query.assisted),
    ),
  });
  if (mine === undefined) return undefined;
  const filter = {
    courseFingerprint: query.courseFingerprint,
    ruleset: query.ruleset,
    assisted: query.assisted,
    includeAnonymous: true,
    playedHereOnly: false,
  };
  const [rank, players] = await Promise.all([
    rankOfCourseExScore(db, filter, mine.bestEx),
    countCoursePlayers(db, filter),
  ]);
  return {
    rank,
    players,
    exScore: mine.bestEx,
    exScoreId: mine.bestExScoreId,
    clearLamp: mine.bestLamp,
    missCount: mine.minMiss,
    playCount: mine.playCount,
    trophy: mine.bestTrophy,
    trophyScoreId: mine.bestTrophyScoreId,
  };
}

/**
 * Where a course run's replay is stored, if the viewer may read it, as `loadReplayAccess` answers for a play. Course
 * runs have no replay setting of their own: a shown run's log is anyone's, a hidden run's only its player's. Undefined
 * otherwise, so a hidden run looks the same as a missing one.
 */
export async function loadCourseReplayAccess(
  db: Database,
  courseScoreId: string,
  viewerId: string | undefined,
): Promise<{ key: string; public: boolean } | undefined> {
  const found = await db.query.courseScore.findFirst({
    where: eq(courseScore.id, courseScoreId),
    columns: { userId: true, replayKey: true, hidden: true },
  });
  if (found === undefined || !canSeeScore(found, viewerId)) return undefined;
  return { key: found.replayKey, public: !found.hidden };
}
