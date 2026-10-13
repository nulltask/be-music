import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------------------------------------------------
// Better Auth (core tables, the anonymous plugin's `is_anonymous`, and the passkey plugin's table)
// ---------------------------------------------------------------------------------------------------------------------

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  isAnonymous: integer('is_anonymous', { mode: 'boolean' }).default(false),
  ...timestamps,
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ...timestamps,
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const passkey = sqliteTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
    transports: text('transports'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    aaguid: text('aaguid'),
  },
  (table) => [index('passkey_user_id_idx').on(table.userId), index('passkey_credential_id_idx').on(table.credentialID)],
);

// ---------------------------------------------------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------------------------------------------------

/** Public identity of an account. `handle` is unique and changeable and names the account in URLs. */
export const profile = sqliteTable('profile', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull().unique(),
  displayName: text('display_name').notNull(),
  ...timestamps,
});

/**
 * A chart, keyed by its chart fingerprint. `playFingerprints` lists the play fingerprints verified to be outcomes of
 * the chart (JSON array). `status` is `provisional` until the chart qualifies for public listing.
 */
export const chart = sqliteTable('chart', {
  chartFingerprint: text('chart_fingerprint').primaryKey(),
  title: text('title'),
  artist: text('artist'),
  noteCount: integer('note_count').notNull(),
  playFingerprints: text('play_fingerprints', { mode: 'json' }).$type<string[]>().notNull(),
  documentKey: text('document_key').notNull(),
  status: text('status', { enum: ['provisional', 'listed'] })
    .notNull()
    .default('provisional'),
  ...timestamps,
});

/** File-hash aliases of a chart (`sha256` of the chart file, later `md5`), many to one. */
export const chartAlias = sqliteTable(
  'chart_alias',
  {
    kind: text('kind', { enum: ['sha256', 'md5'] }).notNull(),
    hash: text('hash').notNull(),
    chartFingerprint: text('chart_fingerprint')
      .notNull()
      .references(() => chart.chartFingerprint, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.kind, table.hash] })],
);

/** One accepted play. Its per-ruleset figures live in `score_result`. */
export const score = sqliteTable(
  'score',
  {
    id: text('id').primaryKey(),
    submissionId: text('submission_id').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chartFingerprint: text('chart_fingerprint')
      .notNull()
      .references(() => chart.chartFingerprint),
    playFingerprint: text('play_fingerprint').notNull(),
    playedRuleset: text('played_ruleset', { enum: ['lr2', 'beatoraja', 'iidx'] }).notNull(),
    gauge: text('gauge').notNull(),
    assisted: integer('assisted', { mode: 'boolean' }).notNull(),
    assistFlags: text('assist_flags', { mode: 'json' }).$type<string[]>().notNull(),
    /** Highest verification layer the play passed (`L3`, `L4`, ... — docs/leaderboard.md section 5.3). */
    verification: text('verification').notNull(),
    recordedBy: text('recorded_by', { mode: 'json' }).$type<Record<string, string>>(),
    submittedBy: text('submitted_by'),
    serverEngine: text('server_engine').notNull(),
    playlogKey: text('playlog_key').notNull(),
    replayVisibility: text('replay_visibility', { enum: ['public', 'private'] })
      .notNull()
      .default('public'),
    ...timestamps,
  },
  (table) => [index('score_user_chart_idx').on(table.userId, table.chartFingerprint)],
);

/** The figures of one score under one ruleset (every play is simulated under all three). */
export const scoreResult = sqliteTable(
  'score_result',
  {
    scoreId: text('score_id')
      .notNull()
      .references(() => score.id, { onDelete: 'cascade' }),
    ruleset: text('ruleset', { enum: ['lr2', 'beatoraja', 'iidx'] }).notNull(),
    rulesetRevision: text('ruleset_revision').notNull(),
    exScore: integer('ex_score').notNull(),
    noteCount: integer('note_count').notNull(),
    clearLamp: integer('clear_lamp').notNull(),
    missCount: integer('miss_count').notNull(),
    maxCombo: integer('max_combo').notNull(),
    gaugeType: text('gauge_type').notNull(),
    /** Gauge at the end of the play, in percent. Null for plays stored before it was recorded. */
    gaugeFinal: real('gauge_final'),
    judges: text('judges', { mode: 'json' }).$type<Record<string, number>>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.scoreId, table.ruleset] })],
);

/** Personal bests per player, chart, ruleset and assist class, beatoraja style (docs/leaderboard.md section 6). */
export const bestScore = sqliteTable(
  'best_score',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chartFingerprint: text('chart_fingerprint')
      .notNull()
      .references(() => chart.chartFingerprint),
    ruleset: text('ruleset', { enum: ['lr2', 'beatoraja', 'iidx'] }).notNull(),
    assisted: integer('assisted', { mode: 'boolean' }).notNull(),
    bestEx: integer('best_ex').notNull(),
    bestExScoreId: text('best_ex_score_id').notNull(),
    bestExAt: integer('best_ex_at', { mode: 'timestamp_ms' }).notNull(),
    bestLamp: integer('best_lamp').notNull(),
    bestLampScoreId: text('best_lamp_score_id').notNull(),
    minMiss: integer('min_miss').notNull(),
    minMissScoreId: text('min_miss_score_id').notNull(),
    playCount: integer('play_count').notNull(),
    /** Whether the player played under this ruleset at least once (the "played under this ruleset" filter). */
    playedHere: integer('played_here', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chartFingerprint, table.ruleset, table.assisted] }),
    index('best_score_ranking_idx').on(table.chartFingerprint, table.ruleset, table.assisted, table.bestEx),
  ],
);
