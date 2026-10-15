import { and, asc, count, desc, eq, gt, type SQL } from 'drizzle-orm';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import { avatarUrl } from '../avatars.ts';
import type { Database } from '../db/client.ts';
import { courseBestScore, profile, user } from '../db/schema.ts';

/** A course ranking's filters, as `RankingFilter` for charts. */
export interface CourseRankingFilter {
  courseFingerprint: string;
  ruleset: PlaylogRulesetId;
  assisted: boolean;
  /** Include anonymous players. Off by default. */
  includeAnonymous: boolean;
  /** Only players who ran the course under this ruleset at least once. */
  playedHereOnly: boolean;
}

export interface CourseRankingEntry {
  rank: number;
  handle: string;
  displayName: string;
  anonymous: boolean;
  avatarUrl: string;
  exScore: number;
  exScoreId: string;
  clearLamp: number;
  missCount: number;
  playCount: number;
  playedHere: boolean;
  achievedAt: number;
}

function filterConditions(filter: CourseRankingFilter): SQL[] {
  const conditions: SQL[] = [
    eq(courseBestScore.courseFingerprint, filter.courseFingerprint),
    eq(courseBestScore.ruleset, filter.ruleset),
    eq(courseBestScore.assisted, filter.assisted),
  ];
  if (!filter.includeAnonymous) conditions.push(eq(user.isAnonymous, false));
  if (filter.playedHereOnly) conditions.push(eq(courseBestScore.playedHere, true));
  return conditions;
}

/**
 * One page of a course's ranking by best EX score, ranked like a chart's: ties share a rank (1, 1, 3), and within a tie
 * the earlier achievement is listed first.
 */
export async function loadCourseRanking(
  db: Database,
  filter: CourseRankingFilter,
  page: { offset: number; limit: number },
): Promise<{ entries: CourseRankingEntry[]; players: number }> {
  const rowsQuery = db
    .select({
      handle: profile.handle,
      displayName: profile.displayName,
      anonymous: user.isAnonymous,
      avatarKey: profile.avatarKey,
      exScore: courseBestScore.bestEx,
      exScoreId: courseBestScore.bestExScoreId,
      clearLamp: courseBestScore.bestLamp,
      missCount: courseBestScore.minMiss,
      playCount: courseBestScore.playCount,
      playedHere: courseBestScore.playedHere,
      achievedAt: courseBestScore.bestExAt,
    })
    .from(courseBestScore)
    .innerJoin(user, eq(user.id, courseBestScore.userId))
    .innerJoin(profile, eq(profile.userId, courseBestScore.userId))
    .where(and(...filterConditions(filter)))
    .orderBy(desc(courseBestScore.bestEx), asc(courseBestScore.bestExAt), asc(profile.handle))
    .limit(page.limit)
    .offset(page.offset);
  const [rows, players] = await Promise.all([rowsQuery, countCoursePlayers(db, filter)]);

  const entries: CourseRankingEntry[] = [];
  let previous: { exScore: number; rank: number } | undefined;
  for (const [index, row] of rows.entries()) {
    const rank =
      previous !== undefined && previous.exScore === row.exScore
        ? previous.rank
        : index === 0
          ? page.offset === 0
            ? 1
            : await rankOfCourseExScore(db, filter, row.exScore)
          : page.offset + index + 1;
    previous = { exScore: row.exScore, rank };
    const { avatarKey, ...rest } = row;
    entries.push({
      ...rest,
      anonymous: row.anonymous === true,
      avatarUrl: avatarUrl(row.handle, avatarKey),
      achievedAt: row.achievedAt.getTime(),
      rank,
    });
  }
  return { entries, players };
}

/** Competition rank of a best EX score on a course: one more than the number of players strictly above it. */
export async function rankOfCourseExScore(db: Database, filter: CourseRankingFilter, exScore: number): Promise<number> {
  const [{ above }] = await db
    .select({ above: count() })
    .from(courseBestScore)
    .innerJoin(user, eq(user.id, courseBestScore.userId))
    .where(and(...filterConditions(filter), gt(courseBestScore.bestEx, exScore)));
  return (above ?? 0) + 1;
}

/** Number of players in a course ranking. */
export async function countCoursePlayers(db: Database, filter: CourseRankingFilter): Promise<number> {
  const [{ players }] = await db
    .select({ players: count() })
    .from(courseBestScore)
    .innerJoin(user, eq(user.id, courseBestScore.userId))
    .where(and(...filterConditions(filter)));
  return players ?? 0;
}
