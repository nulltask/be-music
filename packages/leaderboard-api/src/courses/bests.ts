import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import type { Database } from '../db/client.ts';
import { courseBestScore, courseScore, courseScoreResult } from '../db/schema.ts';
import { mergeBestScores, type BestScores } from '../scoring/best.ts';
import type { ClearLamp } from '../scoring/lamp.ts';

export type CourseBestScoreRow = typeof courseBestScore.$inferInsert;

/** The stored personal bests of one player on one course and assist class, keyed by ruleset. */
export async function loadCourseBestScores(
  db: Database,
  userId: string,
  courseFingerprint: string,
  assisted: boolean,
): Promise<Map<PlaylogRulesetId, BestScores & { playedHere: boolean }>> {
  const rows = await db
    .select()
    .from(courseBestScore)
    .where(
      and(
        eq(courseBestScore.userId, userId),
        eq(courseBestScore.courseFingerprint, courseFingerprint),
        eq(courseBestScore.assisted, assisted),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.ruleset,
      {
        bestEx: row.bestEx,
        bestExScoreId: row.bestExScoreId,
        bestExAt: row.bestExAt.getTime(),
        bestLamp: row.bestLamp as ClearLamp,
        bestLampScoreId: row.bestLampScoreId,
        minMiss: row.minMiss,
        minMissScoreId: row.minMissScoreId,
        playCount: row.playCount,
        playedHere: row.playedHere,
      },
    ]),
  );
}

export function toCourseBestScoreRow(
  key: { userId: string; courseFingerprint: string; ruleset: PlaylogRulesetId; assisted: boolean },
  bests: BestScores,
  playedHere: boolean,
  now: number,
): CourseBestScoreRow {
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
 * Recomputes a player's course bests on the given courses from their stored runs, in the order they were accepted, as
 * `rebuildBestScores` does for charts. Hidden runs are left out. Used when runs change owner (an anonymous account
 * linked to a real one).
 */
export async function rebuildCourseBestScores(
  db: Database,
  userId: string,
  courseFingerprints: readonly string[],
  now: number,
): Promise<void> {
  if (courseFingerprints.length === 0) return;
  const rows = await db
    .select({
      scoreId: courseScore.id,
      courseFingerprint: courseScore.courseFingerprint,
      assisted: courseScore.assisted,
      playedRuleset: courseScore.playedRuleset,
      createdAt: courseScore.createdAt,
      ruleset: courseScoreResult.ruleset,
      exScore: courseScoreResult.exScore,
      clearLamp: courseScoreResult.clearLamp,
      missCount: courseScoreResult.missCount,
    })
    .from(courseScore)
    .innerJoin(courseScoreResult, eq(courseScoreResult.courseScoreId, courseScore.id))
    .where(
      and(
        eq(courseScore.userId, userId),
        inArray(courseScore.courseFingerprint, [...courseFingerprints]),
        eq(courseScore.hidden, false),
      ),
    )
    .orderBy(asc(courseScore.createdAt), asc(courseScore.id));

  const folded = new Map<string, CourseBestScoreRow>();
  const bests = new Map<string, { bests: BestScores; playedHere: boolean }>();
  for (const row of rows) {
    const key = `${row.courseFingerprint}\u0000${row.ruleset}\u0000${row.assisted ? 1 : 0}`;
    const current = bests.get(key);
    const { next } = mergeBestScores(current?.bests, {
      scoreId: row.scoreId,
      playedAt: row.createdAt.getTime(),
      exScore: row.exScore,
      lamp: row.clearLamp as ClearLamp,
      missCount: row.missCount,
    });
    const playedHere = (current?.playedHere ?? false) || row.playedRuleset === row.ruleset;
    bests.set(key, { bests: next, playedHere });
    folded.set(
      key,
      toCourseBestScoreRow(
        { userId, courseFingerprint: row.courseFingerprint, ruleset: row.ruleset, assisted: row.assisted },
        next,
        playedHere,
        now,
      ),
    );
  }
  const statements: BatchItem<'sqlite'>[] = [
    db
      .delete(courseBestScore)
      .where(
        and(eq(courseBestScore.userId, userId), inArray(courseBestScore.courseFingerprint, [...courseFingerprints])),
      ),
    // One row per statement keeps each insert well under D1's 100 bound parameters.
    ...[...folded.values()].map((row) => db.insert(courseBestScore).values(row)),
  ];
  // A batch runs as one transaction: the old bests are never gone without the new ones in their place.
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

/**
 * Moves every course run of one account to another and rebuilds the receiver's course bests, as `reassignScores` does
 * for chart plays.
 */
export async function reassignCourseScores(db: Database, fromUserId: string, toUserId: string): Promise<void> {
  const moved = await db
    .update(courseScore)
    .set({ userId: toUserId })
    .where(eq(courseScore.userId, fromUserId))
    .returning({ courseFingerprint: courseScore.courseFingerprint });
  const courses = [...new Set(moved.map((row) => row.courseFingerprint))];
  // D1 binds at most 100 parameters per statement: rebuild the courses in runs.
  for (let start = 0; start < courses.length; start += 90) {
    await rebuildCourseBestScores(db, toUserId, courses.slice(start, start + 90), Date.now());
  }
}
