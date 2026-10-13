import { and, countDistinct, eq } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { bestScore, chart, user } from './db/schema.ts';

/** Players a chart needs before it is listed publicly (docs/leaderboard.md section 7). */
export const LISTING_PLAYER_THRESHOLD = 2;

/**
 * Lists a chart publicly once enough players have played it. Only accounts that are not anonymous count: anonymous
 * accounts cost nothing to create, so two of them would let anyone list an invented chart. A listed chart stays listed.
 */
export async function refreshChartListing(db: Database, chartFingerprint: string): Promise<boolean> {
  const found = await db.query.chart.findFirst({
    where: eq(chart.chartFingerprint, chartFingerprint),
    columns: { status: true },
  });
  if (found === undefined) return false;
  if (found.status === 'listed') return true;
  const [{ players }] = await db
    .select({ players: countDistinct(bestScore.userId) })
    .from(bestScore)
    .innerJoin(user, eq(user.id, bestScore.userId))
    .where(and(eq(bestScore.chartFingerprint, chartFingerprint), eq(user.isAnonymous, false)));
  if (players < LISTING_PLAYER_THRESHOLD) return false;
  await db.update(chart).set({ status: 'listed' }).where(eq(chart.chartFingerprint, chartFingerprint));
  return true;
}
