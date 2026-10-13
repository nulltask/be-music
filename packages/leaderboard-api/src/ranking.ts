import { and, asc, count, desc, eq, gt, type SQL } from 'drizzle-orm';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import type { Database } from './db/client.ts';
import { bestScore, profile, user } from './db/schema.ts';

export interface RankingFilter {
  chartFingerprint: string;
  ruleset: PlaylogRulesetId;
  assisted: boolean;
  /** Include anonymous players (and accounts anonymized on deletion). Off by default. */
  includeAnonymous: boolean;
  /** Only players who played the chart under this ruleset at least once. */
  playedHereOnly: boolean;
}

export interface RankingEntry {
  rank: number;
  handle: string;
  displayName: string;
  anonymous: boolean;
  exScore: number;
  exScoreId: string;
  clearLamp: number;
  missCount: number;
  playCount: number;
  playedHere: boolean;
  achievedAt: number;
}

export function filterConditions(filter: RankingFilter): SQL[] {
  const conditions: SQL[] = [
    eq(bestScore.chartFingerprint, filter.chartFingerprint),
    eq(bestScore.ruleset, filter.ruleset),
    eq(bestScore.assisted, filter.assisted),
  ];
  if (!filter.includeAnonymous) conditions.push(eq(user.isAnonymous, false));
  if (filter.playedHereOnly) conditions.push(eq(bestScore.playedHere, true));
  return conditions;
}

/**
 * One page of a chart's ranking by EX score. Ties share a rank (1, 1, 3): a player's rank is one more than the number
 * of players with a strictly higher best EX score. Within a tie the earlier achievement is listed first.
 */
export async function loadRanking(
  db: Database,
  filter: RankingFilter,
  page: { offset: number; limit: number },
): Promise<{ entries: RankingEntry[]; players: number }> {
  const conditions = filterConditions(filter);
  const rows = await db
    .select({
      handle: profile.handle,
      displayName: profile.displayName,
      anonymous: user.isAnonymous,
      exScore: bestScore.bestEx,
      exScoreId: bestScore.bestExScoreId,
      clearLamp: bestScore.bestLamp,
      missCount: bestScore.minMiss,
      playCount: bestScore.playCount,
      playedHere: bestScore.playedHere,
      achievedAt: bestScore.bestExAt,
    })
    .from(bestScore)
    .innerJoin(user, eq(user.id, bestScore.userId))
    .innerJoin(profile, eq(profile.userId, bestScore.userId))
    .where(and(...conditions))
    .orderBy(desc(bestScore.bestEx), asc(bestScore.bestExAt), asc(profile.handle))
    .limit(page.limit)
    .offset(page.offset);

  const players = await countPlayers(db, filter);

  // Rank the page from its first entry, then by position within the page (ties share the rank).
  const entries: RankingEntry[] = [];
  let previous: { exScore: number; rank: number } | undefined;
  for (const [index, row] of rows.entries()) {
    const rank =
      previous !== undefined && previous.exScore === row.exScore
        ? previous.rank
        : index === 0
          ? await rankOfExScore(db, filter, row.exScore)
          : page.offset + index + 1;
    previous = { exScore: row.exScore, rank };
    entries.push({ ...row, anonymous: row.anonymous === true, achievedAt: row.achievedAt.getTime(), rank });
  }
  return { entries, players };
}

/** Competition rank of a best EX score: one more than the number of players strictly above it. */
export async function rankOfExScore(db: Database, filter: RankingFilter, exScore: number): Promise<number> {
  const [{ above }] = await db
    .select({ above: count() })
    .from(bestScore)
    .innerJoin(user, eq(user.id, bestScore.userId))
    .where(and(...filterConditions(filter), gt(bestScore.bestEx, exScore)));
  return (above ?? 0) + 1;
}

/** Number of players in a ranking. */
export async function countPlayers(db: Database, filter: RankingFilter): Promise<number> {
  const [{ players }] = await db
    .select({ players: count() })
    .from(bestScore)
    .innerJoin(user, eq(user.id, bestScore.userId))
    .where(and(...filterConditions(filter)));
  return players ?? 0;
}

/** The viewer's best on a chart and their rank among every player, anonymous ones included. */
export async function loadMyRank(
  db: Database,
  query: { userId: string; chartFingerprint: string; ruleset: PlaylogRulesetId; assisted: boolean },
) {
  const mine = await db.query.bestScore.findFirst({
    where: and(
      eq(bestScore.userId, query.userId),
      eq(bestScore.chartFingerprint, query.chartFingerprint),
      eq(bestScore.ruleset, query.ruleset),
      eq(bestScore.assisted, query.assisted),
    ),
  });
  if (mine === undefined) return undefined;
  // The viewer's own rank counts everyone, anonymous players included, so an anonymous viewer is ranked too.
  const filter: RankingFilter = {
    chartFingerprint: query.chartFingerprint,
    ruleset: query.ruleset,
    assisted: query.assisted,
    includeAnonymous: true,
    playedHereOnly: false,
  };
  return {
    rank: await rankOfExScore(db, filter, mine.bestEx),
    players: await countPlayers(db, filter),
    exScore: mine.bestEx,
    exScoreId: mine.bestExScoreId,
    clearLamp: mine.bestLamp,
    missCount: mine.minMiss,
    playCount: mine.playCount,
  };
}
