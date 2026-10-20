import { and, asc, count, desc, eq, gt, type SQL } from 'drizzle-orm';
import type { RulesetId } from '@be-music/player/replay';
import { avatarURL } from './avatars.ts';
import type { Database } from './db/client.ts';
import { bestScore, profile, score, user } from './db/schema.ts';
import { PLAY_INFO_COLUMNS, toPlayInfo, type PlayInfo } from './play-info.ts';

export interface RankingFilter {
  chartFingerprint: string;
  ruleset: RulesetId;
  assisted: boolean;
  /** Include anonymous players (and accounts anonymized on deletion). Off by default. */
  includeAnonymous: boolean;
  /** Only players who played the chart under this ruleset at least once. */
  playedHereOnly: boolean;
  /** Only this player (a chart not listed yet shows a signed-in player their own place, and nobody else's). */
  onlyUserId?: string;
}

export interface RankingEntry {
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

export function filterConditions(filter: RankingFilter): SQL[] {
  const conditions: SQL[] = [
    eq(bestScore.chartFingerprint, filter.chartFingerprint),
    eq(bestScore.ruleset, filter.ruleset),
    eq(bestScore.assisted, filter.assisted),
  ];
  if (!filter.includeAnonymous) conditions.push(eq(user.isAnonymous, false));
  if (filter.playedHereOnly) conditions.push(eq(bestScore.playedHere, true));
  if (filter.onlyUserId !== undefined) conditions.push(eq(bestScore.userId, filter.onlyUserId));
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
  options: { playInfo?: boolean } = {},
): Promise<{ entries: RankingEntry[]; players: number; infos?: Map<string, PlayInfo> }> {
  const conditions = filterConditions(filter);
  // The page and the player count are independent: one round trip to D1 for both. Each row's play (the one that set the
  // best EX-Score, by primary key) comes along, so `playInfo` callers need no second round trip after it.
  const rowsQuery = db
    .select({
      info: PLAY_INFO_COLUMNS,
      handle: profile.handle,
      displayName: profile.displayName,
      anonymous: user.isAnonymous,
      avatarKey: profile.avatarKey,
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
    .leftJoin(score, eq(score.id, bestScore.bestExScoreId))
    .where(and(...conditions))
    .orderBy(desc(bestScore.bestEx), asc(bestScore.bestExAt), asc(profile.handle))
    .limit(page.limit)
    .offset(page.offset);
  const [rows, players] = await Promise.all([rowsQuery, countPlayers(db, filter)]);

  // Rank the page from its first entry, then by position within the page (ties share the rank).
  const entries: RankingEntry[] = [];
  const infos = options.playInfo === true ? new Map<string, PlayInfo>() : undefined;
  let previous: { exScore: number; rank: number } | undefined;
  for (const [index, row] of rows.entries()) {
    const rank =
      previous !== undefined && previous.exScore === row.exScore
        ? previous.rank
        : index === 0
          ? // The first page starts with the best score: nobody is above it.
            page.offset === 0
            ? 1
            : await rankOfExScore(db, filter, row.exScore)
          : page.offset + index + 1;
    previous = { exScore: row.exScore, rank };
    const { avatarKey, info, ...rest } = row;
    if (infos !== undefined && info !== null) {
      infos.set(info.scoreId, toPlayInfo(info));
    }
    entries.push({
      ...rest,
      anonymous: row.anonymous === true,
      avatarUrl: avatarURL(row.handle, avatarKey),
      achievedAt: row.achievedAt.getTime(),
      rank,
    });
  }
  return infos === undefined ? { entries, players } : { entries, players, infos };
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
  query: { userId: string; chartFingerprint: string; ruleset: RulesetId; assisted: boolean },
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
