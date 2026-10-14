import { and, count, countDistinct, desc, eq, max, min, sql, type SQL } from 'drizzle-orm';
import { computeScoreRate, IIDX_RANK_LABELS, type IidxRankLabel } from '@be-music/player/core/scoring';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import type { Database } from '../db/client.ts';
import { bestScore, chart, score, scoreResult, user } from '../db/schema.ts';
import { filterConditions, type RankingFilter } from '../ranking.ts';
import { djLevel, LAMP_STYLES } from './format.ts';

/** How many players hold each clear lamp (or DJ Rank), highest first. */
export interface Distribution<Key> {
  total: number;
  buckets: Array<{ key: Key; count: number }>;
}

/** Every lamp, highest first; a distribution lists them all so bars line up from page to page. */
const LAMPS_HIGH_TO_LOW = Object.keys(LAMP_STYLES)
  .map(Number)
  .sort((a, b) => b - a);

export type DjRank = IidxRankLabel;

/** Lamp counts (`{lamp, count}` rows from a GROUP BY) as a distribution over every lamp, highest first. */
export function lampDistribution(rows: ReadonlyArray<{ lamp: number; count: number }>): Distribution<number> {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.lamp, (counts.get(row.lamp) ?? 0) + row.count);
  const buckets = LAMPS_HIGH_TO_LOW.map((lamp) => ({ key: lamp, count: counts.get(lamp) ?? 0 }));
  return { total: buckets.reduce((sum, bucket) => sum + bucket.count, 0), buckets };
}

/** DJ Ranks of best EX-Scores, AAA first. Charts without notes are left out. */
export function djRankDistribution(bests: ReadonlyArray<{ exScore: number; noteCount: number }>): Distribution<DjRank> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const best of bests) {
    if (best.noteCount <= 0) continue;
    const rank = djLevel(best.exScore, best.noteCount);
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
    total += 1;
  }
  return { total, buckets: IIDX_RANK_LABELS.map((rank) => ({ key: rank, count: counts.get(rank) ?? 0 })) };
}

/** Mean score rate (0–1) of best EX-Scores, or null without any. */
export function averageRate(bests: ReadonlyArray<{ exScore: number; noteCount: number }>): number | null {
  const rated = bests.filter((best) => best.noteCount > 0);
  if (rated.length === 0) return null;
  return (
    rated.reduce((sum, best) => sum + computeScoreRate({ exScore: best.exScore, total: best.noteCount }), 0) /
    rated.length
  );
}

/** An aggregated timestamp: D1 hands MIN / MAX back as a number even where the column maps to a Date. */
const epochMs = (value: Date | number | null | undefined): number | null =>
  value === null || value === undefined ? null : typeof value === 'number' ? value : value.getTime();

export interface ChartStats {
  plays: number;
  players: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  /** Best lamps of the players in the ranking (same ruleset, assist class and anonymous filter). */
  lamps: Distribution<number>;
}

/** A chart's play counts and lamp spread, for the players the ranking shows. */
export async function loadChartStats(db: Database, filter: RankingFilter): Promise<ChartStats> {
  const playConditions: SQL[] = [
    eq(score.chartFingerprint, filter.chartFingerprint),
    eq(score.assisted, filter.assisted),
    eq(score.hidden, false),
  ];
  if (!filter.includeAnonymous) playConditions.push(eq(user.isAnonymous, false));
  const [[plays], lampRows] = await Promise.all([
    db
      .select({
        plays: count(),
        players: countDistinct(score.userId),
        first: min(score.createdAt),
        last: max(score.createdAt),
      })
      .from(score)
      .innerJoin(user, eq(user.id, score.userId))
      .where(and(...playConditions)),
    db
      .select({ lamp: bestScore.bestLamp, count: count() })
      .from(bestScore)
      .innerJoin(user, eq(user.id, bestScore.userId))
      .where(and(...filterConditions(filter)))
      .groupBy(bestScore.bestLamp),
  ]);
  return {
    plays: plays?.plays ?? 0,
    players: plays?.players ?? 0,
    firstPlayedAt: epochMs(plays?.first),
    lastPlayedAt: epochMs(plays?.last),
    lamps: lampDistribution(lampRows),
  };
}

export interface PlayerStats {
  plays: number;
  charts: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  /** Plays per ruleset the player played under. */
  playsByRuleset: Array<{ ruleset: PlaylogRulesetId; count: number }>;
  /** Best lamps per chart under the display ruleset, unassisted. */
  lamps: Distribution<number>;
  /** DJ Ranks of the best EX-Scores per chart under the display ruleset, unassisted. */
  djRanks: Distribution<DjRank>;
  averageRate: number | null;
  /** Time spent playing, summed over every play (plays older than the recorded length count once backfilled). */
  playTimeMs: number;
  /** Notes played under the display ruleset, and how each was judged. */
  notes: number;
  judges: JudgeTotals;
}

/** Judgment counts summed over plays; `emptyPoor` counts presses that hit no note (空POOR). */
export interface JudgeTotals {
  pgreat: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  emptyPoor: number;
}

export const JUDGE_KEYS = ['pgreat', 'great', 'good', 'bad', 'poor', 'emptyPoor'] as const satisfies ReadonlyArray<
  keyof JudgeTotals
>;

/** A player's play counts and the spread of their bests under one ruleset. */
export async function loadPlayerStats(db: Database, userId: string, ruleset: PlaylogRulesetId): Promise<PlayerStats> {
  const judgeSum = (key: keyof JudgeTotals) =>
    sql<number | null>`sum(json_extract(${scoreResult.judges}, ${`$.${key}`}))`;
  const [[plays], byRuleset, bests, [totals]] = await Promise.all([
    db
      .select({
        plays: count(),
        charts: countDistinct(score.chartFingerprint),
        first: min(score.createdAt),
        last: max(score.createdAt),
      })
      .from(score)
      .where(and(eq(score.userId, userId), eq(score.hidden, false))),
    db
      .select({ ruleset: score.playedRuleset, count: count() })
      .from(score)
      .where(and(eq(score.userId, userId), eq(score.hidden, false)))
      .groupBy(score.playedRuleset)
      .orderBy(desc(count())),
    db
      .select({ lamp: bestScore.bestLamp, exScore: bestScore.bestEx, noteCount: chart.noteCount })
      .from(bestScore)
      .innerJoin(chart, eq(chart.chartFingerprint, bestScore.chartFingerprint))
      .where(and(eq(bestScore.userId, userId), eq(bestScore.ruleset, ruleset), eq(bestScore.assisted, false))),
    db
      .select({
        playTimeMs: sql<number | null>`sum(${score.durationMs})`,
        notes: sql<number | null>`sum(${scoreResult.noteCount})`,
        ...Object.fromEntries(JUDGE_KEYS.map((key) => [key, judgeSum(key)])),
      })
      .from(score)
      .innerJoin(scoreResult, and(eq(scoreResult.scoreId, score.id), eq(scoreResult.ruleset, ruleset)))
      .where(and(eq(score.userId, userId), eq(score.hidden, false))),
  ]);
  const totalOf = (value: unknown) => Number(value ?? 0);
  return {
    plays: plays?.plays ?? 0,
    charts: plays?.charts ?? 0,
    firstPlayedAt: epochMs(plays?.first),
    lastPlayedAt: epochMs(plays?.last),
    playsByRuleset: byRuleset,
    lamps: lampDistribution(bests.map((best) => ({ lamp: best.lamp, count: 1 }))),
    djRanks: djRankDistribution(bests),
    averageRate: averageRate(bests),
    playTimeMs: totalOf(totals?.playTimeMs),
    notes: totalOf(totals?.notes),
    judges: Object.fromEntries(
      JUDGE_KEYS.map((key) => [key, totalOf((totals as Record<string, unknown> | undefined)?.[key])]),
    ) as unknown as JudgeTotals,
  };
}
