import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { courseScore } from '../db/schema.ts';
import type { VisibilityChange } from '../scores/visibility.ts';
import { rebuildCourseBestScores } from './bests.ts';

/**
 * Hides one of a player's course runs, or shows it again, as `setScoreHidden` does for plays. A hidden run is kept, but
 * leaves the course rankings, the personal bests (the trophy best included), the figures and every list, and nobody
 * else can open it; the player's bests on the course are rebuilt from the runs still shown.
 */
export async function setCourseScoreHidden(
  db: Database,
  courseScoreId: string,
  userId: string,
  hidden: boolean,
  now: number,
): Promise<VisibilityChange> {
  const found = await db.query.courseScore.findFirst({
    where: eq(courseScore.id, courseScoreId),
    columns: { userId: true, courseFingerprint: true, hidden: true },
  });
  if (found === undefined) return { ok: false, status: 404, error: 'not-found' };
  if (found.userId !== userId) return { ok: false, status: 403, error: 'not-your-score' };
  if (found.hidden !== hidden) {
    await db.update(courseScore).set({ hidden }).where(eq(courseScore.id, courseScoreId));
    await rebuildCourseBestScores(db, userId, [found.courseFingerprint], now);
  }
  return { ok: true, hidden };
}
