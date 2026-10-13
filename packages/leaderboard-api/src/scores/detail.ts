import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chart, profile, score, scoreResult, user } from '../db/schema.ts';
import { byRulesetOrder } from '../rulesets.ts';

/** One play with its chart, its player (null when the profile is gone) and its figures under every ruleset. */
export async function loadScoreDetail(db: Database, scoreId: string) {
  const [[row], results] = await Promise.all([
    db
      .select({
        score,
        chart,
        handle: profile.handle,
        displayName: profile.displayName,
        anonymous: user.isAnonymous,
        avatarKey: profile.avatarKey,
      })
      .from(score)
      .innerJoin(chart, eq(chart.chartFingerprint, score.chartFingerprint))
      .leftJoin(user, eq(user.id, score.userId))
      .leftJoin(profile, eq(profile.userId, score.userId))
      .where(eq(score.id, scoreId)),
    db.select().from(scoreResult).where(eq(scoreResult.scoreId, scoreId)),
  ]);
  if (row === undefined) return undefined;
  const player =
    row.handle !== null && row.displayName !== null
      ? {
          handle: row.handle,
          displayName: row.displayName,
          anonymous: row.anonymous === true,
          avatarKey: row.avatarKey,
        }
      : null;
  return { score: row.score, chart: row.chart, player, results: results.sort(byRulesetOrder) };
}

export type ScoreDetail = NonNullable<Awaited<ReturnType<typeof loadScoreDetail>>>;

/** A play as `GET /api/v0/scores/:id` answers it (`scoreResponse` in `src/api/schemas.ts`). */
export function toScoreResponse(detail: ScoreDetail) {
  const { score: found, player } = detail;
  return {
    id: found.id,
    chartFingerprint: found.chartFingerprint,
    playFingerprint: found.playFingerprint,
    player: player === null ? null : { handle: player.handle, displayName: player.displayName },
    playedRuleset: found.playedRuleset,
    gauge: found.gauge,
    assisted: found.assisted,
    assistFlags: found.assistFlags,
    verification: found.verification,
    createdAt: found.createdAt.getTime(),
    results: detail.results.map(({ scoreId: _scoreId, ...result }) => result),
  };
}

/**
 * Where a play's log is stored, if the viewer may read it: anyone for a public replay, only its player for a private
 * one. Undefined otherwise, so a private replay looks the same as a missing one.
 */
export async function loadPlaylogAccess(
  db: Database,
  scoreId: string,
  viewerId: string | undefined,
): Promise<{ key: string; public: boolean } | undefined> {
  const found = await db.query.score.findFirst({
    where: eq(score.id, scoreId),
    columns: { userId: true, playlogKey: true, replayVisibility: true },
  });
  if (found === undefined) return undefined;
  const isPublic = found.replayVisibility === 'public';
  if (!isPublic && found.userId !== viewerId) return undefined;
  return { key: found.playlogKey, public: isPublic };
}
