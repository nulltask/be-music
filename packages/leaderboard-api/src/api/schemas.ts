import * as v from 'valibot';

/**
 * Request and response schemas of `/api/v0`. The request schemas validate what comes in; the response schemas describe
 * what goes out. Both feed the OpenAPI document (`GET /api/v0/openapi.json`), so the document cannot drift from the
 * validation the routes run.
 */

const described = <T extends v.GenericSchema>(schema: T, description: string) =>
  v.pipe(schema, v.description(description));

// ---------------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------------

export const rulesetSchema = described(
  v.picklist(['lr2', 'beatoraja', 'iidx']),
  'Ruleset the figures are simulated under.',
);

const flagSchema = (description: string) =>
  v.optional(described(v.picklist(['0', '1', 'true', 'false']), description), '0');

export const isOn = (flag: string): boolean => flag === '1' || flag === 'true';

export const rankingQuery = v.object({
  ruleset: rulesetSchema,
  assisted: flagSchema('Rank assisted plays (their own ranking) instead of unassisted ones.'),
  anonymous: flagSchema('Include anonymous players.'),
  played: flagSchema('Only players who played the chart under this ruleset at least once.'),
  offset: v.optional(described(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0)), 'Entries to skip.'), '0'),
  limit: v.optional(
    described(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1), v.maxValue(100)), 'Entries to return.'),
    '50',
  ),
});

export const myRankQuery = v.object({
  ruleset: rulesetSchema,
  assisted: flagSchema('My rank among assisted plays instead of unassisted ones.'),
});

export const submissionBody = v.object({
  playlog: described(v.unknown(), 'The play log (`be-music-playlog`, docs/playlog.md).'),
  playDocument: described(
    v.unknown(),
    'Fingerprint document of the played chart (the rolled branches); it must hash to `chart.playFingerprint`.',
  ),
  chartDocument: v.optional(
    described(
      v.unknown(),
      'Fingerprint document of the whole chart (every branch). Required the first time the server sees the chart.',
    ),
  ),
});

// ---------------------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------------------

/** Every error answers `{ error }`, a stable kebab-case code, plus a `detail` for some. */
export const errorResponse = (codes: readonly [string, ...string[]]) =>
  v.object({
    error: described(v.picklist(codes), 'Error code.'),
    detail: v.optional(described(v.string(), 'Human-readable detail, for some errors.')),
  });

const clearLamp = described(
  v.pipe(v.number(), v.integer(), v.minValue(0)),
  'Clear lamp: 0 NO PLAY, 1 FAILED, 2 ASSIST EASY, 3 EASY, 4 CLEAR, 5 HARD, 6 EX HARD, 7 FULL COMBO, 8 PERFECT, 9 MAX.',
);
const epochMs = (description: string) => described(v.pipe(v.number(), v.integer()), `${description} (epoch ms).`);
const player = v.object({ handle: v.string(), displayName: v.string() });

export const accountResponse = v.object({
  handle: v.string(),
  displayName: v.string(),
  anonymous: described(v.boolean(), 'True until the account has a way back in (a passkey).'),
  passkeys: v.pipe(v.number(), v.integer()),
});

const rulesetOutcome = v.object({
  ruleset: rulesetSchema,
  rulesetRevision: described(v.string(), 'Revision of the ruleset the play was simulated under (`lr2/0`, ...).'),
  exScore: v.pipe(v.number(), v.integer()),
  noteCount: v.pipe(v.number(), v.integer()),
  clearLamp,
  missCount: described(v.pipe(v.number(), v.integer()), 'BP: BADs plus POORs.'),
  rank: described(v.pipe(v.number(), v.integer()), 'The player’s rank on the chart after this play.'),
  players: v.pipe(v.number(), v.integer()),
  improved: described(
    v.object({ exScore: v.boolean(), lamp: v.boolean(), missCount: v.boolean() }),
    'Which personal bests this play improved.',
  ),
});

export const submissionResponse = v.object({
  scoreId: v.string(),
  chartFingerprint: described(v.string(), 'Chart fingerprint (`bmfp0:…`), the ranking key.'),
  results: described(v.array(rulesetOutcome), 'The play under every ruleset.'),
});

export const scoreResponse = v.object({
  id: v.string(),
  chartFingerprint: v.string(),
  playFingerprint: described(v.string(), 'Fingerprint of the branches this play rolled.'),
  player: v.nullable(player),
  playedRuleset: rulesetSchema,
  gauge: v.string(),
  assisted: v.boolean(),
  assistFlags: v.array(v.string()),
  verification: described(v.string(), 'Highest verification layer passed (`L3`, `L4`, ...).'),
  createdAt: epochMs('When the play was accepted'),
  results: v.array(
    v.object({
      ruleset: rulesetSchema,
      rulesetRevision: v.string(),
      exScore: v.pipe(v.number(), v.integer()),
      noteCount: v.pipe(v.number(), v.integer()),
      clearLamp,
      missCount: v.pipe(v.number(), v.integer()),
      maxCombo: v.pipe(v.number(), v.integer()),
      gaugeType: v.string(),
      gaugeFinal: described(v.nullable(v.number()), 'Gauge at the end of the play, in percent.'),
      judges: described(v.record(v.string(), v.number()), 'Judgment counts.'),
    }),
  ),
});

export const rankingResponse = v.object({
  entries: v.array(
    v.object({
      rank: described(v.pipe(v.number(), v.integer()), 'Competition rank: ties share a rank.'),
      handle: v.string(),
      displayName: v.string(),
      anonymous: v.boolean(),
      exScore: v.pipe(v.number(), v.integer()),
      exScoreId: described(v.string(), 'The score that set the best EX-Score.'),
      clearLamp,
      missCount: v.pipe(v.number(), v.integer()),
      playCount: v.pipe(v.number(), v.integer()),
      playedHere: described(v.boolean(), 'Played under this ruleset at least once.'),
      achievedAt: epochMs('When the best EX-Score was set'),
    }),
  ),
  players: described(v.pipe(v.number(), v.integer()), 'Players matching the filters.'),
  offset: v.pipe(v.number(), v.integer()),
  limit: v.pipe(v.number(), v.integer()),
});

export const myRankResponse = v.object({
  rank: v.pipe(v.number(), v.integer()),
  players: v.pipe(v.number(), v.integer()),
  exScore: v.pipe(v.number(), v.integer()),
  exScoreId: v.string(),
  clearLamp: described(v.pipe(v.number(), v.integer()), 'Best clear lamp (see the score results).'),
  missCount: described(v.pipe(v.number(), v.integer()), 'Fewest BP.'),
  playCount: v.pipe(v.number(), v.integer()),
});
