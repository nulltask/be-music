import { sql } from 'drizzle-orm';
import { RULESET_IDS } from '../rulesets.ts';
import type { CourseStageFigures } from '../courses/figures.ts';
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
  passkeyCount: integer('passkey_count'),
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

/**
 * Public identity of an account. `handle` is unique and changeable and names the account in URLs; it is stored in
 * lower case, so handles differing only in case are one handle (src/profiles.ts).
 */
export const profile = sqliteTable('profile', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** Accounts avatar URL in OIDC deployments; a legacy R2 key only for standalone local development. */
  avatarKey: text('avatar_key'),
  ...timestamps,
});

/**
 * Handles an account used before. They stay reserved for that account, and their URLs redirect to its current handle.
 */
export const handleHistory = sqliteTable(
  'handle_history',
  {
    handle: text('handle').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamps.createdAt,
  },
  // A player's former handles.
  (table) => [index('handle_history_user_idx').on(table.userId)],
);

/**
 * A chartset: the charts of one work, the original package's and the add-ons (差分), as BMS Search files them. `id` is
 * BMS Search's id for the work (docs/leaderboard.md section 7).
 */
export const chartset = sqliteTable('chartset', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  /** The event the work was entered in (BMS Search's "exhibition"), if any. */
  event: text('event'),
  ...timestamps,
});

/**
 * A chart, keyed by its chart fingerprint. `playFingerprints` lists the play fingerprints verified to be outcomes of
 * the chart (JSON array). `status` is `provisional` until the chart qualifies for public listing.
 */
export const chart = sqliteTable(
  'chart',
  {
    chartFingerprint: text('chart_fingerprint').primaryKey(),
    title: text('title'),
    artist: text('artist'),
    // What the first replay of the chart said about it. Null for charts registered before these were kept.
    subtitle: text('subtitle'),
    genre: text('genre'),
    /** `#PLAYLEVEL` / bmson `info.level` as written, and `#DIFFICULTY` (1 BEGINNER .. 5 INSANE), from a replay. */
    playLevel: text('play_level'),
    difficulty: integer('difficulty'),
    sourceFormat: text('source_format', { enum: ['bms', 'bmson'] }),
    laneMode: text('lane_mode'),
    /** Raw `#TOTAL` / bmson `info.total`, when the chart wrote one. */
    total: real('total'),
    /** Long-note mode: 1 LN, 2 CN, 3 HCN. */
    lnMode: integer('ln_mode'),
    /**
     * Whether a play of the chart had long notes (FREE ZONE notes aside). Null for charts registered before this was
     * kept, until their next play; a later play with long notes sets it, as `#RANDOM` outcomes can differ.
     */
    hasLongNotes: integer('has_long_notes', { mode: 'boolean' }),
    /** Judgment rank as the replay carried it: the window percentage and the raw `#RANK` / `#DEFEXRANK`. */
    judgeRank: text('judge_rank', { mode: 'json' }).$type<{
      percent: number;
      sourceRank?: number;
      sourceExRank?: number;
    }>(),
    noteCount: integer('note_count').notNull(),
    /** The chartset BMS Search files the chart under; null while unknown or unlinked. */
    chartsetId: text('chartset_id').references(() => chartset.id),
    /** Whether the chart came in the work's package or as an add-on (差分), per BMS Search. */
    packType: text('pack_type', { enum: ['included', 'additional'] }),
    /** When BMS Search was last asked about the chart; null until it has been. */
    chartsetCheckedAt: integer('chartset_checked_at', { mode: 'timestamp_ms' }),
    playFingerprints: text('play_fingerprints', { mode: 'json' }).$type<string[]>().notNull(),
    documentKey: text('document_key').notNull(),
    status: text('status', { enum: ['provisional', 'listed'] })
      .notNull()
      .default('provisional'),
    ...timestamps,
  },
  (table) => [
    index('chart_chartset_idx').on(table.chartsetId),
    index('chart_chartset_checked_idx').on(table.chartsetCheckedAt),
  ],
);

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
  (table) => [
    primaryKey({ columns: [table.kind, table.hash] }),
    // A chart's files (its page, its links elsewhere).
    index('chart_alias_chart_idx').on(table.chartFingerprint),
  ],
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
    /**
     * The chart file the play came from, as its client reported it (`chart.sha256` / `chart.md5` of the replay).
     * One chart fingerprint can cover several files (re-saves, re-encodes); rankings can be narrowed to one of them.
     * Null when the log carried no hash; filled for older plays from their logs (src/scores/backfill.ts).
     */
    fileSha256: text('file_sha256'),
    fileMd5: text('file_md5'),
    /** How long the play ran, in milliseconds: to the last note's end or the last input, whichever is later. */
    durationMs: integer('duration_ms'),
    /**
     * The lane arrangement the play used (`RANDOM`, `MIRROR / RANDOM` for the two sides of a double play, ` FLIP`
     * appended for a swapped double play), `OFF` for none. Null until filled in from the replay.
     */
    laneOption: text('lane_option'),
    playedRuleset: text('played_ruleset', { enum: RULESET_IDS }).notNull(),
    gauge: text('gauge').notNull(),
    assisted: integer('assisted', { mode: 'boolean' }).notNull(),
    assistFlags: text('assist_flags', { mode: 'json' }).$type<string[]>().notNull(),
    /** Highest verification layer the play passed (`L3`, `L4`, ... — docs/leaderboard.md section 5.3). */
    verification: text('verification').notNull(),
    recordedBy: text('recorded_by', { mode: 'json' }).$type<Record<string, string>>(),
    submittedBy: text('submitted_by'),
    serverEngine: text('server_engine').notNull(),
    replayKey: text('replay_key').notNull(),
    /** R2 key of the play's share card (`cards/scores/{scoreId}/{sha256}.{ext}`), drawn by the player's browser. */
    cardKey: text('card_key'),
    replayVisibility: text('replay_visibility', { enum: ['public', 'private'] })
      .notNull()
      .default('public'),
    /**
     * Hidden by its player: kept, but out of the rankings, the personal bests, the figures and every list, and shown
     * to no one else. The player can show it again.
     */
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index('score_user_chart_idx').on(table.userId, table.chartFingerprint),
    index('score_chart_file_idx').on(table.chartFingerprint, table.fileSha256),
    // The newest plays (the top page) and a player's newest plays. `id` breaks ties as the lists order them, so the
    // top page walks this index newest-first and stops at its page instead of sorting every play.
    index('score_created_idx').on(table.createdAt, table.id),
    index('score_user_created_idx').on(table.userId, table.createdAt),
    // Plays the hourly backfill has yet to fill in (src/scores/backfill.ts); empty once it has caught up.
    index('score_pending_backfill_idx')
      .on(table.durationMs)
      .where(sql`${table.durationMs} is null`),
    index('score_pending_lane_option_idx')
      .on(table.laneOption)
      .where(sql`${table.laneOption} is null`),
  ],
);

/** The figures of one score under one ruleset (every play is simulated under all three). */
export const scoreResult = sqliteTable(
  'score_result',
  {
    scoreId: text('score_id')
      .notNull()
      .references(() => score.id, { onDelete: 'cascade' }),
    ruleset: text('ruleset', { enum: RULESET_IDS }).notNull(),
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
    ruleset: text('ruleset', { enum: RULESET_IDS }).notNull(),
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

// ---------------------------------------------------------------------------------------------------------------------
// Courses (docs/leaderboard.md section 6.1)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A course, keyed by its course fingerprint (`bmcourse0:…`, `computeCourseFingerprint`): its kind, its constraints and
 * its stages' chart fingerprints in order. The name is the one the first run was submitted with; the same course read
 * from another source (a `.lr2crs`, a beatoraja file, a table) shares the row whatever it is called there.
 */
export const course = sqliteTable('course', {
  courseFingerprint: text('course_fingerprint').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['grade', 'expert', 'nonstop'] }).notNull(),
  /** The constraints as the fingerprint reads them: normalized and sorted (JSON array). */
  constraints: text('constraints', { mode: 'json' }).$type<string[]>().notNull(),
  /** Each stage's chart fingerprint, in order (JSON array). */
  stageChartFingerprints: text('stage_chart_fingerprints', { mode: 'json' }).$type<string[]>().notNull(),
  ...timestamps,
});

/** One accepted course run. Its per-ruleset figures live in `course_score_result`; it creates no chart scores. */
export const courseScore = sqliteTable(
  'course_score',
  {
    id: text('id').primaryKey(),
    submissionId: text('submission_id').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    courseFingerprint: text('course_fingerprint')
      .notNull()
      .references(() => course.courseFingerprint),
    playedRuleset: text('played_ruleset', { enum: RULESET_IDS }).notNull(),
    /** The gauge the player picked on the last stage played, which the course lamp follows. */
    gauge: text('gauge').notNull(),
    assisted: integer('assisted', { mode: 'boolean' }).notNull(),
    assistFlags: text('assist_flags', { mode: 'json' }).$type<string[]>().notNull(),
    /** The lowest verification layer its stages passed (`L3`, `L4`, ...). */
    verification: text('verification').notNull(),
    /** Stages the run played; the rest were never reached. */
    stagesPlayed: integer('stages_played').notNull(),
    recordedBy: text('recorded_by', { mode: 'json' }).$type<Record<string, string>>(),
    submittedBy: text('submitted_by'),
    serverEngine: text('server_engine').notNull(),
    replayKey: text('replay_key').notNull(),
    /** Hidden by its player, as `score.hidden`. */
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index('course_score_user_course_idx').on(table.userId, table.courseFingerprint),
    index('course_score_course_created_idx').on(table.courseFingerprint, table.createdAt),
    // The latest course runs, everyone's and one player's (`loadRecentCourseRuns`).
    index('course_score_created_idx').on(table.createdAt, table.id),
    index('course_score_user_created_idx').on(table.userId, table.createdAt),
  ],
);

/** The figures of one course run under one ruleset (every run is simulated under all three). */
export const courseScoreResult = sqliteTable(
  'course_score_result',
  {
    courseScoreId: text('course_score_id')
      .notNull()
      .references(() => courseScore.id, { onDelete: 'cascade' }),
    ruleset: text('ruleset', { enum: RULESET_IDS }).notNull(),
    rulesetRevision: text('ruleset_revision').notNull(),
    exScore: integer('ex_score').notNull(),
    /** Judgment notes over every stage, reached or not. */
    noteCount: integer('note_count').notNull(),
    clearLamp: integer('clear_lamp').notNull(),
    /** BP, with every note the run never judged. */
    missCount: integer('miss_count').notNull(),
    maxCombo: integer('max_combo').notNull(),
    /** Stages reached under this ruleset (a stage can empty one ruleset's gauge and not another's). */
    stagesPlayed: integer('stages_played').notNull(),
    /** The best trophy the run earned, by name. */
    trophy: text('trophy'),
    /**
     * Where that trophy stands in the run's course definition, which lists its trophies easiest first: 1 for the first,
     * 0 for none (`courseTrophyRank`). It orders the trophies of one course's runs for the trophy best.
     */
    trophyRank: integer('trophy_rank').notNull().default(0),
    /** Each reached stage's own figures, in order (`CourseStageFigures`); null for runs stored before they were kept. */
    stages: text('stages', { mode: 'json' }).$type<CourseStageFigures[]>(),
    gaugeType: text('gauge_type').notNull(),
    gaugeFinal: real('gauge_final').notNull(),
    judges: text('judges', { mode: 'json' }).$type<Record<string, number>>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.courseScoreId, table.ruleset] })],
);

/** Personal bests per player, course, ruleset and assist class, beatoraja style, as `best_score` keeps them for charts. */
export const courseBestScore = sqliteTable(
  'course_best_score',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    courseFingerprint: text('course_fingerprint')
      .notNull()
      .references(() => course.courseFingerprint),
    ruleset: text('ruleset', { enum: RULESET_IDS }).notNull(),
    assisted: integer('assisted', { mode: 'boolean' }).notNull(),
    bestEx: integer('best_ex').notNull(),
    bestExScoreId: text('best_ex_score_id').notNull(),
    bestExAt: integer('best_ex_at', { mode: 'timestamp_ms' }).notNull(),
    bestLamp: integer('best_lamp').notNull(),
    bestLampScoreId: text('best_lamp_score_id').notNull(),
    minMiss: integer('min_miss').notNull(),
    minMissScoreId: text('min_miss_score_id').notNull(),
    /** The best trophy, by name, and the run that earned it; null until a run earns one. */
    bestTrophy: text('best_trophy'),
    /** `course_score_result.trophy_rank` of the best trophy: 0 for none. */
    bestTrophyRank: integer('best_trophy_rank').notNull().default(0),
    bestTrophyScoreId: text('best_trophy_score_id'),
    playCount: integer('play_count').notNull(),
    /** Whether the player ran the course under this ruleset at least once. */
    playedHere: integer('played_here', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.courseFingerprint, table.ruleset, table.assisted] }),
    index('course_best_score_ranking_idx').on(table.courseFingerprint, table.ruleset, table.assisted, table.bestEx),
  ],
);

/** External subjects are scoped to their issuer; never link users by email. */
export const oidcIdentity = sqliteTable(
  'oidc_identity',
  {
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
  },
  (table) => [primaryKey({ columns: [table.issuer, table.subject] })],
);
