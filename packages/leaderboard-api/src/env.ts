/** Bindings of the Leaderboard Worker (see `cloudflare.config.ts`). */
export interface Env {
  AUTH_ISSUER?: string;
  PUBLIC_ORIGIN?: string;
  OIDC_CLIENT_ID?: string;
  SESSION_SECRET?: string;
  API_AUDIENCE?: string;
  DB: D1Database;
  ACCOUNTS?: Pick<Fetcher, 'fetch'>;
  /** Play logs, chart documents and share-card images. Accounts owns avatars. */
  BLOBS: R2Bucket;
  /** Submissions per user or device and minute. Absent in tests and local runs that do not configure it. */
  SUBMIT_LIMITER?: RateLimit;
  RIVAL_LIMIT?: string;
  BETTER_AUTH_SECRET: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Where Better Auth lives (docs/services.md section 3): `https://accounts.be-music.app`. Unset (local runs, tests),
   * each request's own origin is used, as before the services were split.
   */
  AUTH_ORIGIN?: string;
  /** Parent domain the session cookies are shared on (`be-music.app`). Unset, cookies stay on the request's host. */
  COOKIE_DOMAIN?: string;
  /** Cookie name prefix; the preview sets its own so production's parent-domain cookies never collide with it. */
  COOKIE_PREFIX?: string;
  /** Comma-separated origins allowed to call Better Auth and run passkey ceremonies, besides `AUTH_ORIGIN`. */
  TRUSTED_ORIGINS?: string;
  /** Passkey relying party ID (`be-music.app`). Unset, the auth origin's hostname. */
  PASSKEY_RP_ID?: string;
}
