import { and, asc, countDistinct, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { avatarUrl } from '../avatars.ts';
import type { Database } from '../db/client.ts';
import type { RulesetId } from '../rulesets.ts';
import { bestScore, chart, chartAlias, chartset, profile, score, scoreResult, user } from '../db/schema.ts';
import type { ChartAlias } from './external.ts';

export interface RecentScore {
  scoreId: string;
  createdAt: number;
  handle: string;
  displayName: string;
  anonymous: boolean;
  avatarUrl: string;
  chartFingerprint: string;
  title: string | null;
  artist: string | null;
  laneMode: string | null;
  /** Whether the chart is listed; a play of one that is not reaches lists only for its own player. */
  chartListed: boolean;
  /** Hidden by its player; a hidden play reaches lists only for its own player. */
  hidden: boolean;
  playLevel: string | null;
  difficulty: number | null;
  playedRuleset: RulesetId;
  /** The lane arrangement (`RANDOM`, ...), `OFF` for none; null or `-` when unknown. */
  laneOption: string | null;
  assisted: boolean;
  exScore: number;
  noteCount: number;
  clearLamp: number;
  missCount: number;
  gaugeType: string;
  gaugeFinal: number | null;
  /**
   * The player's best on the chart before this play, under the same ruleset and assist class; undefined for their
   * first play of it.
   */
  previous?: { exScore: number; clearLamp: number; missCount: number };
  /** Where the play's EX-Score stands among the other players' bests on the chart, and how many players there are. */
  rank: number;
  players: number;
}

export interface RecentScoresFilter {
  limit: number;
  /** The ruleset whose figures each row shows (the viewer's display ruleset). */
  ruleset: RulesetId;
  /** Include anonymous players. Off by default, like the rankings. */
  includeAnonymous: boolean;
  /** Include charts not listed yet (fewer than two players). Off by default (docs/leaderboard.md section 7). */
  includeUnlisted: boolean;
  /**
   * A player who also sees their own plays of charts not listed yet, while their account is anonymous, and that they
   * hid (the signed-in viewer), while everyone else's stay out. Ignored where the filters already let them all in.
   */
  ownerUserId?: string;
  /** Only this player's plays. */
  handle?: string;
}

/**
 * The newest accepted plays, each with its figures under the display ruleset (every play is simulated under all three,
 * so any ruleset has figures). Anonymous players and unlisted charts are left out unless asked for.
 */
export async function loadRecentScores(db: Database, filter: RecentScoresFilter): Promise<RecentScore[]> {
  // The page is picked first, from the plays alone, newest first: the figures and the per-play subqueries below then run
  // for the rows shown rather than for every play that passes the filters (SQLite does not flatten a subquery with a
  // LIMIT into a join, so the page stays a walk down `score_created_idx` that stops at `limit`).
  const conditions: SQL[] = [];
  if (!filter.includeAnonymous) {
    // A viewer's own plays show even while their account is anonymous.
    const named = eq(user.isAnonymous, false);
    conditions.push(filter.ownerUserId === undefined ? named : or(named, eq(score.userId, filter.ownerUserId))!);
  }
  if (!filter.includeUnlisted) {
    const listed = eq(chart.status, 'listed');
    conditions.push(filter.ownerUserId === undefined ? listed : or(listed, eq(score.userId, filter.ownerUserId))!);
  }
  // Hidden plays stay out, except for their own player.
  const shown = eq(score.hidden, false);
  conditions.push(filter.ownerUserId === undefined ? shown : or(shown, eq(score.userId, filter.ownerUserId))!);
  if (filter.handle !== undefined) conditions.push(eq(profile.handle, filter.handle));
  const page = db
    .select({ id: score.id, createdAt: score.createdAt })
    .from(score)
    .innerJoin(chart, eq(chart.chartFingerprint, score.chartFingerprint))
    .innerJoin(user, eq(user.id, score.userId))
    .innerJoin(profile, eq(profile.userId, score.userId))
    .where(and(...conditions))
    .orderBy(desc(score.createdAt), desc(score.id))
    .limit(filter.limit)
    .as('page');
  const rows = await db
    .select({
      scoreId: score.id,
      createdAt: score.createdAt,
      handle: profile.handle,
      displayName: profile.displayName,
      anonymous: user.isAnonymous,
      avatarKey: profile.avatarKey,
      chartFingerprint: score.chartFingerprint,
      title: chart.title,
      artist: chart.artist,
      laneMode: chart.laneMode,
      chartStatus: chart.status,
      hidden: score.hidden,
      playLevel: chart.playLevel,
      difficulty: chart.difficulty,
      playedRuleset: score.playedRuleset,
      laneOption: score.laneOption,
      assisted: score.assisted,
      exScore: scoreResult.exScore,
      noteCount: scoreResult.noteCount,
      clearLamp: scoreResult.clearLamp,
      missCount: scoreResult.missCount,
      gaugeType: scoreResult.gaugeType,
      gaugeFinal: scoreResult.gaugeFinal,
      ...previousBest(filter.ruleset),
      ...standing(filter),
    })
    .from(page)
    .innerJoin(score, eq(score.id, page.id))
    .innerJoin(scoreResult, and(eq(scoreResult.scoreId, score.id), eq(scoreResult.ruleset, filter.ruleset)))
    .innerJoin(chart, eq(chart.chartFingerprint, score.chartFingerprint))
    .innerJoin(user, eq(user.id, score.userId))
    .innerJoin(profile, eq(profile.userId, score.userId))
    // Ordered by the page's own columns, so the page drives the join rather than a scan of every play in index order.
    .orderBy(desc(page.createdAt), desc(page.id));
  return rows.map(
    ({
      createdAt,
      chartStatus,
      anonymous,
      avatarKey,
      previousEx,
      previousLamp,
      previousMiss,
      above,
      players,
      ...row
    }) => ({
      ...row,
      avatarUrl: avatarUrl(row.handle, avatarKey),
      createdAt: createdAt.getTime(),
      anonymous: anonymous === true,
      chartListed: chartStatus === 'listed',
      ...(previousEx === null
        ? {}
        : {
            previous: {
              exScore: Number(previousEx),
              clearLamp: Number(previousLamp),
              missCount: Number(previousMiss),
            },
          }),
      rank: Number(above) + 1,
      players: Number(players),
    }),
  );
}

/**
 * The player's earlier plays of the chart under the ruleset and the play's assist class: their best EX-Score, best
 * lamp and fewest misses. The plays come off `score_user_chart_idx`, so each row costs one short index range.
 */
function previousBest(ruleset: RulesetId) {
  const earlier = (column: SQL) => sql`(
    select ${column} from score p join score_result pr on pr.score_id = p.id and pr.ruleset = ${ruleset}
    where p.user_id = ${score.userId} and p.chart_fingerprint = ${score.chartFingerprint}
      and p.assisted = ${score.assisted} and p.created_at < ${score.createdAt} and p.hidden = 0
  )`;
  return {
    previousEx: sql<number | null>`${earlier(sql`max(pr.ex_score)`)}`,
    previousLamp: sql<number | null>`${earlier(sql`max(pr.clear_lamp)`)}`,
    previousMiss: sql<number | null>`${earlier(sql`min(pr.miss_count)`)}`,
  };
}

/**
 * The play's place in the chart's ranking (the kept bests under the display ruleset and the play's assist class): how
 * many other players' bests beat its EX-Score, and how many players the ranking has. Anonymous players count only when
 * the list includes them, as in the rankings.
 */
function standing(filter: RecentScoresFilter) {
  const anonymous = filter.includeAnonymous ? sql`` : sql`and coalesce(u.is_anonymous, 0) = 0`;
  const ranking = sql`from best_score b join "user" u on u.id = b.user_id
    where b.chart_fingerprint = ${score.chartFingerprint} and b.ruleset = ${filter.ruleset}
      and b.assisted = ${score.assisted} ${anonymous}`;
  return {
    above: sql<number>`(select count(*) ${ranking} and b.user_id <> ${score.userId} and b.best_ex > ${scoreResult.exScore})`,
    players: sql<number>`(select count(*) ${ranking})`,
  };
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
      avatarKey: profile.avatarKey,
      joinedAt: profile.createdAt,
    })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(eq(profile.handle, handle.toLowerCase()));
  return row === undefined
    ? undefined
    : {
        ...row,
        anonymous: row.anonymous === true,
        joinedAt: row.joinedAt.getTime(),
        avatarUrl: avatarUrl(row.handle, row.avatarKey),
      };
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
  /** The lane arrangement (`RANDOM`, ...); null or `-` while unknown. */
  laneOption: string | null;
  durationMs: number | null;
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
      laneOption: score.laneOption,
      durationMs: score.durationMs,
      verification: score.verification,
      recordedBy: score.recordedBy,
      submittedBy: score.submittedBy,
      serverEngine: score.serverEngine,
    })
    .from(score)
    .where(inArray(score.id, [...new Set(scoreIds)]));
  return new Map(rows.map((row) => [row.scoreId, { ...row, createdAt: row.createdAt.getTime() }]));
}
