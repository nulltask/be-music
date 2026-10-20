import { and, asc, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { RulesetId } from '@be-music/player/replay';
import type { Database } from '../db/client.ts';
import { bestScore, score, scoreResult } from '../db/schema.ts';
import { mergeBestScores, type BestScores } from '../scoring/best.ts';

export type BestScoreRow = typeof bestScore.$inferInsert;

/** D1 binds at most 100 parameters to one statement (https://developers.cloudflare.com/d1/platform/limits/). */
const D1_MAX_BOUND_PARAMETERS = 100;
/** Charts one statement lists: the rest of the budget goes to the user id and the hidden flag. */
const CHARTS_PER_STATEMENT = D1_MAX_BOUND_PARAMETERS - 2;
/** Best rows one insert carries: each row binds one parameter per column. */
const BEST_ROWS_PER_INSERT = Math.floor(D1_MAX_BOUND_PARAMETERS / Object.keys(getTableColumns(bestScore)).length);

/** The stored personal bests of one player on one chart and assist class, keyed by ruleset. */
export async function loadBestScores(
  db: Database,
  userId: string,
  chartFingerprint: string,
  assisted: boolean,
): Promise<Map<RulesetId, BestScores & { playedHere: boolean }>> {
  const rows = await db
    .select()
    .from(bestScore)
    .where(
      and(
        eq(bestScore.userId, userId),
        eq(bestScore.chartFingerprint, chartFingerprint),
        eq(bestScore.assisted, assisted),
      ),
    );
  return new Map(rows.map((row) => [row.ruleset, { ...toBestScores(row), playedHere: row.playedHere }]));
}

export function toBestScores(row: typeof bestScore.$inferSelect): BestScores {
  return {
    bestEx: row.bestEx,
    bestExScoreId: row.bestExScoreId,
    bestExAt: row.bestExAt.getTime(),
    bestLamp: row.bestLamp,
    bestLampScoreId: row.bestLampScoreId,
    minMiss: row.minMiss,
    minMissScoreId: row.minMissScoreId,
    playCount: row.playCount,
  };
}

export function toBestScoreRow(
  key: { userId: string; chartFingerprint: string; ruleset: RulesetId; assisted: boolean },
  bests: BestScores,
  playedHere: boolean,
  now: number,
): BestScoreRow {
  return {
    ...key,
    bestEx: bests.bestEx,
    bestExScoreId: bests.bestExScoreId,
    bestExAt: new Date(bests.bestExAt),
    bestLamp: bests.bestLamp,
    bestLampScoreId: bests.bestLampScoreId,
    minMiss: bests.minMiss,
    minMissScoreId: bests.minMissScoreId,
    playCount: bests.playCount,
    playedHere,
    updatedAt: new Date(now),
  };
}

/**
 * Recomputes a player's personal bests on the given charts from their stored plays, folding the plays in the order they
 * were accepted so ties keep the earlier play. Hidden plays are left out. Used when plays change owner (an anonymous
 * account linked to a real one) and when a player hides or shows a play.
 */
export async function rebuildBestScores(
  db: Database,
  userId: string,
  chartFingerprints: readonly string[],
  now: number,
): Promise<void> {
  if (chartFingerprints.length === 0) return;
  const chartChunks = chunk(chartFingerprints, CHARTS_PER_STATEMENT);
  const selects = chartChunks.map((charts) =>
    db
      .select({
        scoreId: score.id,
        chartFingerprint: score.chartFingerprint,
        assisted: score.assisted,
        playedRuleset: score.playedRuleset,
        createdAt: score.createdAt,
        ruleset: scoreResult.ruleset,
        exScore: scoreResult.exScore,
        clearLamp: scoreResult.clearLamp,
        missCount: scoreResult.missCount,
      })
      .from(score)
      .innerJoin(scoreResult, eq(scoreResult.scoreId, score.id))
      .where(and(eq(score.userId, userId), inArray(score.chartFingerprint, charts), eq(score.hidden, false)))
      .orderBy(asc(score.createdAt), asc(score.id)),
  );
  // Each chart's plays come from one statement, in order, so folding the chunks one after another keeps that order.
  const rows = (await db.batch(selects as [(typeof selects)[number], ...(typeof selects)[number][]])).flat();

  type Folded = {
    chartFingerprint: string;
    ruleset: RulesetId;
    assisted: boolean;
    bests: BestScores;
    playedHere: boolean;
  };
  const folded = new Map<string, Folded>();
  for (const row of rows) {
    const key = `${row.chartFingerprint}\u0000${row.ruleset}\u0000${row.assisted ? 1 : 0}`;
    const current = folded.get(key);
    const { next } = mergeBestScores(current?.bests, {
      scoreId: row.scoreId,
      playedAt: row.createdAt.getTime(),
      exScore: row.exScore,
      lamp: row.clearLamp,
      missCount: row.missCount,
    });
    folded.set(key, {
      chartFingerprint: row.chartFingerprint,
      ruleset: row.ruleset,
      assisted: row.assisted,
      bests: next,
      playedHere: (current?.playedHere ?? false) || row.playedRuleset === row.ruleset,
    });
  }

  const values = [...folded.values()].map(({ chartFingerprint, ruleset, assisted, bests, playedHere }) =>
    toBestScoreRow({ userId, chartFingerprint, ruleset, assisted }, bests, playedHere, now),
  );
  const statements: BatchItem<'sqlite'>[] = [
    ...chartChunks.map((charts) =>
      db.delete(bestScore).where(and(eq(bestScore.userId, userId), inArray(bestScore.chartFingerprint, charts))),
    ),
    ...chunk(values, BEST_ROWS_PER_INSERT).map((rows) => db.insert(bestScore).values(rows)),
  ];
  // A batch runs as one transaction: the old bests are never gone without the new ones in their place.
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

/** `items` in runs of at most `size`, in order. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const runs: T[][] = [];
  for (let start = 0; start < items.length; start += size) runs.push(items.slice(start, start + size));
  return runs;
}
