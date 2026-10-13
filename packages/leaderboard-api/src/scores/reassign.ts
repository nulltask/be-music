import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { score } from '../db/schema.ts';
import { rebuildBestScores } from './bests.ts';

/**
 * Moves every play of one account to another and rebuilds the receiver's personal bests on the affected charts. Used
 * when an anonymous player links a Discord or Google account (docs/leaderboard.md section 3); the anonymous account's
 * own best rows go with the account when Better Auth deletes it.
 */
export async function reassignScores(db: Database, fromUserId: string, toUserId: string): Promise<void> {
  const moved = await db
    .update(score)
    .set({ userId: toUserId })
    .where(eq(score.userId, fromUserId))
    .returning({ chartFingerprint: score.chartFingerprint });
  const charts = [...new Set(moved.map((row) => row.chartFingerprint))];
  await rebuildBestScores(db, toUserId, charts, Date.now());
}
