import { and, asc, countDistinct, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { RulesetId } from '../rulesets.ts';
import { chart, chartAlias, chartset, profile, score, scoreResult, user } from '../db/schema.ts';
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
  playedRuleset: RulesetId;
  assisted: boolean;
  exScore: number;
  noteCount: number;
  clearLamp: number;
  missCount: number;
  gaugeType: string;
  gaugeFinal: number | null;
}

export interface RecentScoresFilter {
  limit: number;
  /** The ruleset whose figures each row shows (the viewer's display ruleset). */
  ruleset: RulesetId;
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
      gaugeType: scoreResult.gaugeType,
      gaugeFinal: scoreResult.gaugeFinal,
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

export async function loadChart(db: Database, chartFingerprint: string) {
  return db.query.chart.findFirst({ where: eq(chart.chartFingerprint, chartFingerprint) });
}

/** The chartset a chart is filed under, for the breadcrumbs and the link to it. */
export async function loadChartsetOf(db: Database, chartsetId: string | null) {
  if (chartsetId === null) return undefined;
  return db.query.chartset.findFirst({ where: eq(chartset.id, chartsetId) });
}

export async function loadChartset(db: Database, id: string) {
  return db.query.chartset.findFirst({ where: eq(chartset.id, id) });
}

export interface ChartsetChart {
  chartFingerprint: string;
  title: string | null;
  subtitle: string | null;
  artist: string | null;
  laneMode: string | null;
  noteCount: number;
  packType: 'included' | 'additional' | null;
  listed: boolean;
  players: number;
}

/** The charts of a chartset with their player counts: the work's own charts first, then the add-ons, by note count. */
export async function loadChartsetCharts(db: Database, chartsetId: string): Promise<ChartsetChart[]> {
  const rows = await db
    .select({
      chartFingerprint: chart.chartFingerprint,
      title: chart.title,
      subtitle: chart.subtitle,
      artist: chart.artist,
      laneMode: chart.laneMode,
      noteCount: chart.noteCount,
      packType: chart.packType,
      status: chart.status,
      players: countDistinct(score.userId),
    })
    .from(chart)
    .leftJoin(score, eq(score.chartFingerprint, chart.chartFingerprint))
    .where(eq(chart.chartsetId, chartsetId))
    .groupBy(chart.chartFingerprint)
    .orderBy(asc(chart.noteCount));
  const order = (packType: ChartsetChart['packType']): number =>
    packType === 'included' ? 0 : packType === 'additional' ? 1 : 2;
  return rows
    .map(({ status, ...row }) => ({ ...row, listed: status === 'listed' }))
    .sort((a, b) => order(a.packType) - order(b.packType) || a.noteCount - b.noteCount);
}

export async function loadPlayer(db: Database, handle: string) {
  const [row] = await db
    .select({
      userId: profile.userId,
      handle: profile.handle,
      displayName: profile.displayName,
      anonymous: user.isAnonymous,
      joinedAt: profile.createdAt,
    })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(eq(profile.handle, handle));
  return row === undefined
    ? undefined
    : { ...row, anonymous: row.anonymous === true, joinedAt: row.joinedAt.getTime() };
}

/** The file hashes known for a chart, in a stable order. */
export async function loadChartAliases(db: Database, chartFingerprint: string): Promise<ChartAlias[]> {
  return db
    .select({ kind: chartAlias.kind, hash: chartAlias.hash })
    .from(chartAlias)
    .where(eq(chartAlias.chartFingerprint, chartFingerprint))
    .orderBy(chartAlias.kind, chartAlias.hash);
}

/** What a score's info popover shows: how the play was made and which software recorded and sent it. */
export interface PlayInfo {
  scoreId: string;
  createdAt: number;
  playedRuleset: string;
  gauge: string;
  assistFlags: string[];
  verification: string;
  /** The play log's `recorder` (application, version, build, engine version, platform). */
  recordedBy: Record<string, string> | null;
  /** The `Be-Music-Client` header the play was sent with. */
  submittedBy: string | null;
  serverEngine: string;
}

/** Info of several scores at once, keyed by score id. */
export async function loadPlayInfos(db: Database, scoreIds: readonly string[]): Promise<Map<string, PlayInfo>> {
  if (scoreIds.length === 0) return new Map();
  const rows = await db
    .select({
      scoreId: score.id,
      createdAt: score.createdAt,
      playedRuleset: score.playedRuleset,
      gauge: score.gauge,
      assistFlags: score.assistFlags,
      verification: score.verification,
      recordedBy: score.recordedBy,
      submittedBy: score.submittedBy,
      serverEngine: score.serverEngine,
    })
    .from(score)
    .where(inArray(score.id, [...new Set(scoreIds)]));
  return new Map(rows.map((row) => [row.scoreId, { ...row, createdAt: row.createdAt.getTime() }]));
}
