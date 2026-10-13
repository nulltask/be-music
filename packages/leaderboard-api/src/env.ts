/** Bindings of the Leaderboard Worker (see `cloudflare.config.ts`). */
export interface Env {
  DB: D1Database;
  /** Play logs, chart documents (and later ghosts and OG cards), keyed by prefix (docs/leaderboard.md section 7). */
  BLOBS: R2Bucket;
  /** Submissions per user or device and minute. Absent in tests and local runs that do not configure it. */
  SUBMIT_LIMITER?: RateLimit;
  RIVAL_LIMIT?: string;
  BETTER_AUTH_SECRET: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
