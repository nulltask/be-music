import { score } from './db/schema.ts';

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

/** The `score` columns a play's info is read from, for a select over (or joined to) `score`. */
export const PLAY_INFO_COLUMNS = {
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
};

/** A play's info from a row selected with {@link PLAY_INFO_COLUMNS}. */
export function toPlayInfo(row: Omit<PlayInfo, 'createdAt'> & { createdAt: Date }): PlayInfo {
  return { ...row, createdAt: row.createdAt.getTime() };
}

/** The same columns in raw SQL over a `score` aliased `s`, for the hand-written ranking queries. */
export interface RawPlayInfoRow {
  score_id: string;
  created_at: number;
  played_ruleset: string;
  gauge: string;
  assist_flags: string;
  lane_option: string | null;
  duration_ms: number | null;
  verification: string;
  recorded_by: string | null;
  submitted_by: string | null;
  server_engine: string;
}

/** A play's info from a raw row: the JSON columns parsed as drizzle's `mode: 'json'` columns are. */
export function rawToPlayInfo(row: RawPlayInfoRow): PlayInfo {
  return {
    scoreId: row.score_id,
    createdAt: Number(row.created_at),
    playedRuleset: row.played_ruleset,
    gauge: row.gauge,
    assistFlags: JSON.parse(row.assist_flags) as string[],
    laneOption: row.lane_option,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    verification: row.verification,
    recordedBy: row.recorded_by === null ? null : (JSON.parse(row.recorded_by) as Record<string, string>),
    submittedBy: row.submitted_by,
    serverEngine: row.server_engine,
  };
}
