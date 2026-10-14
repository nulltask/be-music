import { sql, type SQL } from 'drizzle-orm';
import { avatarUrl } from './avatars.ts';
import type { Database } from './db/client.ts';
import type { RankingEntry, RankingFilter } from './ranking.ts';

/** How a ranking built from the plays themselves (rather than the kept personal bests) is cut. */
export interface PlayRankingOptions {
  /** Every play gets its own row, so a player can appear more than once. Off: each player's best play. */
  everyPlay: boolean;
  /** Only plays of this chart file (its SHA-256). */
  fileSha256?: string;
}

interface PlayRow {
  score_id: string;
  created_at: number;
  ex_score: number;
  clear_lamp: number;
  miss_count: number;
  played_ruleset: string;
  handle: string;
  display_name: string;
  is_anonymous: number | null;
  avatar_key: string | null;
  play_count: number;
  rank: number;
  total: number;
  players: number;
}

/**
 * A chart's ranking read from its plays, for the cuts the kept personal bests cannot answer: every play on its own
 * row, or the plays of one chart file. Under the display ruleset; ties share a rank (1, 1, 3) and the earlier play is
 * listed first. A player's row in the best-play cut shows that play's lamp and BP, not the player's best lamp. Rows
 * carry the player's play count (of the plays that pass the filter); `players` counts the players, `plays` the rows.
 */
export async function loadPlayRanking(
  db: Database,
  filter: RankingFilter,
  options: PlayRankingOptions,
  page: { offset: number; limit: number },
): Promise<{ entries: RankingEntry[]; players: number; plays: number }> {
  const conditions: SQL[] = [
    sql`s.chart_fingerprint = ${filter.chartFingerprint}`,
    sql`s.assisted = ${filter.assisted ? 1 : 0}`,
    sql`s.hidden = 0`,
  ];
  if (!filter.includeAnonymous) conditions.push(sql`coalesce(u.is_anonymous, 0) = 0`);
  if (filter.playedHereOnly) conditions.push(sql`s.played_ruleset = ${filter.ruleset}`);
  if (options.fileSha256 !== undefined) conditions.push(sql`s.file_sha256 = ${options.fileSha256}`);
  if (filter.onlyUserId !== undefined) conditions.push(sql`s.user_id = ${filter.onlyUserId}`);
  const rows = await db.all<PlayRow>(sql`
    with plays as (
      select s.id as score_id, s.created_at, s.played_ruleset, s.user_id,
        r.ex_score, r.clear_lamp, r.miss_count,
        p.handle, p.display_name, p.avatar_key, u.is_anonymous,
        row_number() over (partition by s.user_id order by r.ex_score desc, s.created_at asc) as nth,
        count(*) over (partition by s.user_id) as play_count
      from score s
      join score_result r on r.score_id = s.id and r.ruleset = ${filter.ruleset}
      join "user" u on u.id = s.user_id
      join profile p on p.user_id = s.user_id
      where ${sql.join(conditions, sql` and `)}
    ),
    shown as (select * from plays ${options.everyPlay ? sql`` : sql`where nth = 1`})
    select shown.*,
      rank() over (order by ex_score desc) as rank,
      count(*) over () as total,
      (select count(distinct user_id) from plays) as players
    from shown
    order by ex_score desc, created_at asc, handle asc
    limit ${page.limit} offset ${page.offset}
  `);
  const first = rows[0];
  return {
    entries: rows.map((row) => ({
      rank: Number(row.rank),
      handle: row.handle,
      displayName: row.display_name,
      anonymous: row.is_anonymous === 1,
      avatarUrl: avatarUrl(row.handle, row.avatar_key),
      exScore: Number(row.ex_score),
      exScoreId: row.score_id,
      clearLamp: Number(row.clear_lamp),
      missCount: Number(row.miss_count),
      playCount: Number(row.play_count),
      playedHere: row.played_ruleset === filter.ruleset,
      achievedAt: Number(row.created_at),
    })),
    players: first === undefined ? 0 : Number(first.players),
    plays: first === undefined ? 0 : Number(first.total),
  };
}

/** One chart file a chart's plays came from. */
export interface ChartFile {
  sha256: string;
  md5: string | null;
  plays: number;
  players: number;
}

/**
 * The chart files the plays of a chart came from (by SHA-256, with the MD5 the same plays reported), most played
 * first. One chart fingerprint can cover several files: re-saves, re-encodes, a fixed typo in the metadata.
 */
export async function loadChartFiles(db: Database, chartFingerprint: string): Promise<ChartFile[]> {
  const rows = await db.all<{ sha256: string; md5: string | null; plays: number; players: number }>(sql`
    select file_sha256 as sha256, max(file_md5) as md5, count(*) as plays, count(distinct user_id) as players
    from score
    where chart_fingerprint = ${chartFingerprint} and file_sha256 is not null and hidden = 0
    group by file_sha256
    order by plays desc, sha256 asc
  `);
  return rows.map((row) => ({ ...row, plays: Number(row.plays), players: Number(row.players) }));
}
