import { and, countDistinct, eq, gte, inArray, type SQLWrapper } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { bestScore, chart, user } from './db/schema.ts';

/** Players a chart needs before it is listed publicly (docs/leaderboard.md section 7). */
export const LISTING_PLAYER_THRESHOLD = 2;

/**
 * The players who count towards listing a chart, as a one-row count. Only accounts that are not anonymous count:
 * anonymous accounts cost nothing to create, so two of them would let anyone list an invented chart.
 */
function listingPlayers(db: Database, chartFingerprint: string | SQLWrapper) {
  return db
    .select({ players: countDistinct(bestScore.userId) })
    .from(bestScore)
    .innerJoin(user, eq(user.id, bestScore.userId))
    .where(and(eq(bestScore.chartFingerprint, chartFingerprint), eq(user.isAnonymous, false)));
}

/** Lists a chart publicly once enough players have played it (see `listingPlayers`). A listed chart stays listed. */
export async function refreshChartListing(db: Database, chartFingerprint: string): Promise<boolean> {
  const found = await db.query.chart.findFirst({
    where: eq(chart.chartFingerprint, chartFingerprint),
    columns: { status: true },
  });
  if (found === undefined) return false;
  if (found.status === 'listed') return true;
  const [{ players }] = await listingPlayers(db, chartFingerprint);
  if (players < LISTING_PLAYER_THRESHOLD) return false;
  await db.update(chart).set({ status: 'listed' }).where(eq(chart.chartFingerprint, chartFingerprint));
  return true;
}

/**
 * `refreshChartListing` over every chart a player has played, as one statement however many charts that is. Returns
 * the statement so it can run in a batch; awaiting it runs it on its own.
 */
export function refreshPlayedChartListings(db: Database, userId: string) {
  return db
    .update(chart)
    .set({ status: 'listed' })
    .where(
      and(
        eq(chart.status, 'provisional'),
        inArray(
          chart.chartFingerprint,
          db
            .select({ chartFingerprint: bestScore.chartFingerprint })
            .from(bestScore)
            .where(eq(bestScore.userId, userId)),
        ),
        gte(listingPlayers(db, chart.chartFingerprint), LISTING_PLAYER_THRESHOLD),
      ),
    );
}
