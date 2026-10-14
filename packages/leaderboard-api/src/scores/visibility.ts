import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { score } from '../db/schema.ts';
import { rebuildBestScores } from './bests.ts';

export type VisibilityChange =
  | { ok: true; hidden: boolean }
  | { ok: false; status: 403; error: 'not-your-score' }
  | { ok: false; status: 404; error: 'not-found' };

/**
 * Hides one of a player's plays, or shows it again. A hidden play is kept, but leaves the rankings, the personal bests,
 * the figures and every list, and nobody else can open it; the player's bests on the chart are rebuilt from the plays
 * still shown.
 */
export async function setScoreHidden(
  db: Database,
  scoreId: string,
  userId: string,
  hidden: boolean,
  now: number,
): Promise<VisibilityChange> {
  const found = await db.query.score.findFirst({
    where: eq(score.id, scoreId),
    columns: { userId: true, chartFingerprint: true, hidden: true },
  });
  if (found === undefined) return { ok: false, status: 404, error: 'not-found' };
  if (found.userId !== userId) return { ok: false, status: 403, error: 'not-your-score' };
  if (found.hidden !== hidden) {
    await db.update(score).set({ hidden }).where(eq(score.id, scoreId));
    await rebuildBestScores(db, userId, [found.chartFingerprint], now);
  }
  return { ok: true, hidden };
}

/** Whether a viewer may see a play: anyone a shown one, only its player a hidden one. */
export function canSeeScore(found: { userId: string; hidden: boolean }, viewerId: string | undefined): boolean {
  return !found.hidden || found.userId === viewerId;
}
