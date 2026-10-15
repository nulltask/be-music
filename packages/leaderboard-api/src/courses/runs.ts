import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { avatarUrl } from '../avatars.ts';
import type { Database } from '../db/client.ts';
import { course, courseScore, courseScoreResult, profile, user } from '../db/schema.ts';
import type { RulesetId } from '../rulesets.ts';

/** One course run in a list of the latest runs, with its figures under the list's ruleset. */
export interface RecentCourseRun {
  id: string;
  createdAt: number;
  courseFingerprint: string;
  courseName: string;
  courseKind: 'grade' | 'expert' | 'nonstop';
  stageCount: number;
  handle: string;
  displayName: string;
  anonymous: boolean;
  avatarUrl: string;
  playedRuleset: RulesetId;
  assisted: boolean;
  /** Hidden by its player; a hidden run reaches lists only for its own player. */
  hidden: boolean;
  exScore: number;
  noteCount: number;
  clearLamp: number;
  missCount: number;
  stagesPlayed: number;
  trophy: string | null;
  /** Where the run's EX-Score stands among the other players' bests on the course, and how many players there are. */
  rank: number;
  players: number;
}

export interface RecentCourseRunsFilter {
  limit: number;
  /** The ruleset whose figures each row shows. */
  ruleset: RulesetId;
  /** Include anonymous players. Off by default, like the rankings. */
  includeAnonymous: boolean;
  /** A player who also sees their own runs while their account is anonymous, and the runs they hid. */
  ownerUserId?: string;
  /** Only this player's runs. */
  handle?: string;
}

/**
 * The newest course runs, each with its figures under the list's ruleset, as `loadRecentScores` lists plays: the page
 * of runs is picked first, newest first, from the runs alone (a walk down `course_score_created_idx`, or
 * `course_score_user_created_idx` for one player), and the figures and the standing are read for those rows only.
 * Anonymous players are left out unless asked for, and hidden runs except for their own player.
 */
export async function loadRecentCourseRuns(db: Database, filter: RecentCourseRunsFilter): Promise<RecentCourseRun[]> {
  const conditions: SQL[] = [];
  const own = (condition: SQL): SQL =>
    filter.ownerUserId === undefined ? condition : or(condition, eq(courseScore.userId, filter.ownerUserId))!;
  if (!filter.includeAnonymous) conditions.push(own(eq(user.isAnonymous, false)));
  conditions.push(own(eq(courseScore.hidden, false)));
  if (filter.handle !== undefined) conditions.push(eq(profile.handle, filter.handle));
  const page = db
    .select({ id: courseScore.id, createdAt: courseScore.createdAt })
    .from(courseScore)
    .innerJoin(user, eq(user.id, courseScore.userId))
    .innerJoin(profile, eq(profile.userId, courseScore.userId))
    .where(and(...conditions))
    .orderBy(desc(courseScore.createdAt), desc(courseScore.id))
    .limit(filter.limit)
    .as('page');
  const anonymous = filter.includeAnonymous ? sql`` : sql`and coalesce(u.is_anonymous, 0) = 0`;
  const ranking = sql`from course_best_score b join "user" u on u.id = b.user_id
    where b.course_fingerprint = ${courseScore.courseFingerprint} and b.ruleset = ${filter.ruleset}
      and b.assisted = ${courseScore.assisted} ${anonymous}`;
  const rows = await db
    .select({
      id: courseScore.id,
      createdAt: courseScore.createdAt,
      courseFingerprint: courseScore.courseFingerprint,
      courseName: course.name,
      courseKind: course.kind,
      stageChartFingerprints: course.stageChartFingerprints,
      handle: profile.handle,
      displayName: profile.displayName,
      anonymous: user.isAnonymous,
      avatarKey: profile.avatarKey,
      playedRuleset: courseScore.playedRuleset,
      assisted: courseScore.assisted,
      hidden: courseScore.hidden,
      exScore: courseScoreResult.exScore,
      noteCount: courseScoreResult.noteCount,
      clearLamp: courseScoreResult.clearLamp,
      missCount: courseScoreResult.missCount,
      stagesPlayed: courseScoreResult.stagesPlayed,
      trophy: courseScoreResult.trophy,
      above: sql<number>`(select count(*) ${ranking} and b.user_id <> ${courseScore.userId} and b.best_ex > ${courseScoreResult.exScore})`,
      players: sql<number>`(select count(*) ${ranking})`,
    })
    .from(page)
    .innerJoin(courseScore, eq(courseScore.id, page.id))
    .innerJoin(
      courseScoreResult,
      and(eq(courseScoreResult.courseScoreId, courseScore.id), eq(courseScoreResult.ruleset, filter.ruleset)),
    )
    .innerJoin(course, eq(course.courseFingerprint, courseScore.courseFingerprint))
    .innerJoin(user, eq(user.id, courseScore.userId))
    .innerJoin(profile, eq(profile.userId, courseScore.userId))
    .orderBy(desc(page.createdAt), desc(page.id));
  return rows.map(({ createdAt, stageChartFingerprints, anonymous, avatarKey, above, players, ...row }) => ({
    ...row,
    createdAt: createdAt.getTime(),
    stageCount: stageChartFingerprints.length,
    anonymous: anonymous === true,
    avatarUrl: avatarUrl(row.handle, avatarKey),
    rank: Number(above) + 1,
    players: Number(players),
  }));
}
