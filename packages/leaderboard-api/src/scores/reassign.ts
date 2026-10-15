import { eq } from 'drizzle-orm';
import { refreshPlayedChartListings } from '../charts.ts';
import type { Database } from '../db/client.ts';
import { score } from '../db/schema.ts';
import { reassignCourseScores } from '../courses/bests.ts';
import { rebuildBestScores } from './bests.ts';

/**
 * Moves every play (and every course run) of one account to another, rebuilds the receiver's personal bests on the affected charts and lists
 * the charts the receiver now counts towards. Used when an anonymous player links a Discord or Google account
 * (docs/leaderboard.md section 3); the anonymous account's own best rows go with the account when Better Auth deletes
 * it.
 */
export async function reassignScores(db: Database, fromUserId: string, toUserId: string): Promise<void> {
  const moved = await db
    .update(score)
    .set({ userId: toUserId })
    .where(eq(score.userId, fromUserId))
    .returning({ chartFingerprint: score.chartFingerprint });
  const charts = [...new Set(moved.map((row) => row.chartFingerprint))];
  await rebuildBestScores(db, toUserId, charts, Date.now());
  await refreshPlayedChartListings(db, toUserId);
  await reassignCourseScores(db, fromUserId, toUserId);
}
