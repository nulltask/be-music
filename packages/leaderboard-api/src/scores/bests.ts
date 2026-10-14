import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import type { Database } from '../db/client.ts';
import { bestScore, score, scoreResult } from '../db/schema.ts';
import { mergeBestScores, type BestScores } from '../scoring/best.ts';
import type { ClearLamp } from '../scoring/lamp.ts';

export type BestScoreRow = typeof bestScore.$inferInsert;

/** The stored personal bests of one player on one chart and assist class, keyed by ruleset. */
export async function loadBestScores(
  db: Database,
  userId: string,
  chartFingerprint: string,
  assisted: boolean,
): Promise<Map<PlaylogRulesetId, BestScores & { playedHere: boolean }>> {
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
    bestLamp: row.bestLamp as ClearLamp,
    bestLampScoreId: row.bestLampScoreId,
    minMiss: row.minMiss,
    minMissScoreId: row.minMissScoreId,
    playCount: row.playCount,
  };
}

export function toBestScoreRow(
  key: { userId: string; chartFingerprint: string; ruleset: PlaylogRulesetId; assisted: boolean },
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
  const rows = await db
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
    .where(
      and(eq(score.userId, userId), inArray(score.chartFingerprint, [...chartFingerprints]), eq(score.hidden, false)),
    )
    .orderBy(asc(score.createdAt), asc(score.id));

  type Folded = {
    chartFingerprint: string;
    ruleset: PlaylogRulesetId;
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
      lamp: row.clearLamp as ClearLamp,
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

  await db
    .delete(bestScore)
    .where(and(eq(bestScore.userId, userId), inArray(bestScore.chartFingerprint, [...chartFingerprints])));
  const values = [...folded.values()].map(({ chartFingerprint, ruleset, assisted, bests, playedHere }) =>
    toBestScoreRow({ userId, chartFingerprint, ruleset, assisted }, bests, playedHere, now),
  );
  if (values.length > 0) {
    await db.insert(bestScore).values(values);
  }
}
