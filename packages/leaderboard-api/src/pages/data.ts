import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chart, chartAlias, profile, score, scoreResult, user } from '../db/schema.ts';
import type { ChartAlias } from './external.ts';

export interface RecentScore {
  scoreId: string;
  createdAt: number;
  handle: string;
  displayName: string;
  anonymous: boolean;
  chartFingerprint: string;
  title: string | null;
  artist: string | null;
  chartListed: boolean;
  playedRuleset: 'lr2' | 'beatoraja' | 'iidx';
  assisted: boolean;
  exScore: number;
  noteCount: number;
  clearLamp: number;
  missCount: number;
}

export interface RecentScoresFilter {
  limit: number;
  /** The ruleset whose figures each row shows (the viewer's display ruleset). */
  ruleset: 'lr2' | 'beatoraja' | 'iidx';
  /** Include anonymous players. Off by default, like the rankings. */
  includeAnonymous: boolean;
  /** Include charts not listed yet (fewer than two players). Off by default (docs/leaderboard.md section 7). */
  includeUnlisted: boolean;
  /** Only this player's plays. */
  handle?: string;
}

/**
 * The newest accepted plays, each with its figures under the display ruleset (every play is simulated under all three,
 * so any ruleset has figures). Anonymous players and unlisted charts are left out unless asked for.
 */
export async function loadRecentScores(db: Database, filter: RecentScoresFilter): Promise<RecentScore[]> {
  const conditions: SQL[] = [eq(scoreResult.ruleset, filter.ruleset)];
  if (!filter.includeAnonymous) conditions.push(eq(user.isAnonymous, false));
  if (!filter.includeUnlisted) conditions.push(eq(chart.status, 'listed'));
  if (filter.handle !== undefined) conditions.push(eq(profile.handle, filter.handle));
  const rows = await db
    .select({
      scoreId: score.id,
      createdAt: score.createdAt,
      handle: profile.handle,
      displayName: profile.displayName,
      anonymous: user.isAnonymous,
      chartFingerprint: score.chartFingerprint,
      title: chart.title,
      artist: chart.artist,
      chartStatus: chart.status,
      playedRuleset: score.playedRuleset,
      assisted: score.assisted,
      exScore: scoreResult.exScore,
      noteCount: scoreResult.noteCount,
      clearLamp: scoreResult.clearLamp,
      missCount: scoreResult.missCount,
    })
    .from(score)
    .innerJoin(scoreResult, eq(scoreResult.scoreId, score.id))
    .innerJoin(chart, eq(chart.chartFingerprint, score.chartFingerprint))
    .innerJoin(user, eq(user.id, score.userId))
    .innerJoin(profile, eq(profile.userId, score.userId))
    .where(and(...conditions))
    .orderBy(desc(score.createdAt), desc(score.id))
    .limit(filter.limit);
  return rows.map(({ chartStatus, createdAt, anonymous, ...row }) => ({
    ...row,
    createdAt: createdAt.getTime(),
    anonymous: anonymous === true,
    chartListed: chartStatus === 'listed',
  }));
}

export async function loadScoreDetail(db: Database, scoreId: string) {
  const [row] = await db
    .select({
      score,
      chart,
      handle: profile.handle,
      displayName: profile.displayName,
      anonymous: user.isAnonymous,
    })
    .from(score)
    .innerJoin(chart, eq(chart.chartFingerprint, score.chartFingerprint))
    .innerJoin(user, eq(user.id, score.userId))
    .innerJoin(profile, eq(profile.userId, score.userId))
    .where(eq(score.id, scoreId));
  if (row === undefined) return undefined;
  const results = await db.select().from(scoreResult).where(eq(scoreResult.scoreId, scoreId));
  return { ...row, anonymous: row.anonymous === true, results };
}

export async function loadChart(db: Database, chartFingerprint: string) {
  return db.query.chart.findFirst({ where: eq(chart.chartFingerprint, chartFingerprint) });
}

export async function loadPlayer(db: Database, handle: string) {
  const [row] = await db
    .select({ handle: profile.handle, displayName: profile.displayName, anonymous: user.isAnonymous })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(eq(profile.handle, handle));
  return row === undefined ? undefined : { ...row, anonymous: row.anonymous === true };
}

/** The file hashes known for a chart, in a stable order. */
export async function loadChartAliases(db: Database, chartFingerprint: string): Promise<ChartAlias[]> {
  return db
    .select({ kind: chartAlias.kind, hash: chartAlias.hash })
    .from(chartAlias)
    .where(eq(chartAlias.chartFingerprint, chartFingerprint))
    .orderBy(chartAlias.kind, chartAlias.hash);
}
