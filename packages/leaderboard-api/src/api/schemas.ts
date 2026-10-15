import * as v from 'valibot';
import { RULESET_IDS } from '../rulesets.ts';

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

export const rulesetSchema = described(v.picklist(RULESET_IDS), 'Ruleset the figures are simulated under.');

const flagSchema = (description: string) =>
  v.optional(described(v.picklist(['0', '1', 'true', 'false']), description), '0');

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

export const courseSubmissionBody = v.object({
  coursePlaylog: described(v.unknown(), 'The course play log (`be-music-course-playlog`, docs/playlog.md).'),
  stages: described(
    v.array(
      v.object({
        playDocument: described(
          v.unknown(),
          'Fingerprint document of the stage chart as played; it must hash to the stage’s `chart.playFingerprint`.',
        ),
        chartDocument: v.optional(
          described(
            v.unknown(),
            'Fingerprint document of the whole stage chart. Required the first time the server sees the chart.',
          ),
        ),
      }),
    ),
    'The fingerprint documents of each played stage, in the order the stages were played. Empty for a NONSTOP run, whose stages are rebuilt from `stageCharts`.',
  ),
  stageCharts: v.optional(
    described(
      v.array(
        v.object({
          stage: described(v.pipe(v.number(), v.integer(), v.minValue(0)), 'The course stage, zero-based.'),
          chart: described(
            v.unknown(),
            'The stage chart as loaded (`BeMusicJson`, `#RANDOM` still in); it must hash to the stage’s chart fingerprint. Used to verify the run, never stored.',
          ),
          pms: v.optional(described(v.boolean(), 'Whether the chart is a `.pms` file (a lane-mode input).')),
        }),
      ),
      'The charts of the stages the server rebuilds: every stage the run never reached (their notes count as BP), and every stage of a NONSTOP run (stitched again to verify the play).',
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
  avatarUrl: described(v.string(), 'The player icon: the uploaded one, or one generated from the account.'),
});

export const profileUpdateBody = v.object({
  handle: v.optional(
    described(
      v.string(),
      'New handle: letters, digits and `_`, 3 to 15 characters, case-insensitive. The old handle stays reserved for the player and its pages redirect.',
    ),
  ),
  displayName: v.optional(
    described(v.string(), 'New display name: 1 to 32 characters, no line breaks or control characters.'),
  ),
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

export const scoreVisibilityBody = v.object({
  hidden: described(
    v.boolean(),
    'Hide the play (`true`): it leaves the rankings, the personal bests, the figures and every list, and only its player can open it. `false` shows it again.',
  ),
});

export const scoreVisibilityResponse = v.object({ id: v.string(), hidden: v.boolean() });

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
  hidden: described(v.boolean(), 'Hidden by its player: only the player sees a hidden play.'),
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

const rankingEntry = v.object({
  rank: described(v.pipe(v.number(), v.integer()), 'Competition rank: ties share a rank.'),
  handle: v.string(),
  displayName: v.string(),
  anonymous: v.boolean(),
  avatarUrl: v.string(),
  exScore: v.pipe(v.number(), v.integer()),
  exScoreId: described(v.string(), 'The score that set the best EX-Score.'),
  clearLamp,
  missCount: v.pipe(v.number(), v.integer()),
  playCount: v.pipe(v.number(), v.integer()),
  playedHere: described(v.boolean(), 'Played under this ruleset at least once.'),
  achievedAt: epochMs('When the best EX-Score was set'),
});

export const rankingResponse = v.object({
  entries: v.array(rankingEntry),
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

const courseRulesetOutcome = v.object({
  ruleset: rulesetSchema,
  rulesetRevision: described(v.string(), 'Revision of the ruleset the run was simulated under (`lr2/0`, ...).'),
  exScore: v.pipe(v.number(), v.integer()),
  noteCount: described(v.pipe(v.number(), v.integer()), 'Judgment notes over every stage, reached or not.'),
  clearLamp,
  missCount: described(v.pipe(v.number(), v.integer()), 'BP, with every note the run never judged.'),
  maxCombo: described(v.pipe(v.number(), v.integer()), 'The course-wide max combo.'),
  stagesPlayed: described(v.pipe(v.number(), v.integer()), 'Stages reached under this ruleset.'),
  trophy: described(v.nullable(v.string()), 'The best trophy the run earned, by name.'),
  rank: described(v.pipe(v.number(), v.integer()), 'The player’s rank on the course after this run.'),
  players: v.pipe(v.number(), v.integer()),
  improved: described(
    v.object({ exScore: v.boolean(), lamp: v.boolean(), missCount: v.boolean(), trophy: v.boolean() }),
    'Which personal bests on the course this run improved.',
  ),
});

export const courseSubmissionResponse = v.object({
  courseScoreId: v.string(),
  courseFingerprint: described(v.string(), 'Course fingerprint (`bmcourse0:…`), the ranking key.'),
  results: described(v.array(courseRulesetOutcome), 'The run under every ruleset.'),
});

export const courseResponse = v.object({
  courseFingerprint: v.string(),
  name: described(v.string(), 'The name the course was first submitted with.'),
  kind: described(v.picklist(['grade', 'expert', 'nonstop']), 'Course kind.'),
  constraints: described(v.array(v.string()), 'Constraints, normalized and sorted (`gauge_lr2`, `grade_mirror`, ...).'),
  stages: v.array(
    v.object({
      chartFingerprint: v.string(),
      title: described(v.nullable(v.string()), 'Null while the server has not seen the chart played.'),
      artist: v.nullable(v.string()),
      playLevel: v.nullable(v.string()),
    }),
  ),
  createdAt: epochMs('When the first run was accepted'),
});

const courseStageFigures = v.object({
  exScore: v.pipe(v.number(), v.integer()),
  noteCount: v.pipe(v.number(), v.integer()),
  missCount: described(v.pipe(v.number(), v.integer()), 'BP, with the notes the stage never judged.'),
  maxCombo: v.pipe(v.number(), v.integer()),
  judges: described(v.record(v.string(), v.number()), 'Judgment counts, with `fast` and `slow`.'),
  gaugeType: v.string(),
  gaugeFinal: described(v.number(), 'Gauge the stage ended on, in percent.'),
  cleared: v.boolean(),
});

export const courseScoreResponse = v.object({
  id: v.string(),
  courseFingerprint: v.string(),
  player: v.nullable(player),
  playedRuleset: rulesetSchema,
  gauge: v.string(),
  assisted: v.boolean(),
  assistFlags: v.array(v.string()),
  verification: described(v.string(), 'Lowest verification layer its stages passed (`L3`, `L4`, ...).'),
  stagesPlayed: described(v.pipe(v.number(), v.integer()), 'Stages the run played.'),
  createdAt: epochMs('When the run was accepted'),
  hidden: v.boolean(),
  results: v.array(
    v.object({
      ruleset: rulesetSchema,
      rulesetRevision: v.string(),
      exScore: v.pipe(v.number(), v.integer()),
      noteCount: v.pipe(v.number(), v.integer()),
      clearLamp,
      missCount: v.pipe(v.number(), v.integer()),
      maxCombo: v.pipe(v.number(), v.integer()),
      stagesPlayed: v.pipe(v.number(), v.integer()),
      trophy: v.nullable(v.string()),
      trophyRank: described(
        v.pipe(v.number(), v.integer()),
        'Where the trophy stands in the run’s course definition, easiest first: 1 for the first, 0 for none.',
      ),
      gaugeType: v.string(),
      gaugeFinal: described(v.number(), 'Gauge the course ended on, in percent.'),
      judges: described(v.record(v.string(), v.number()), 'Judgment counts over the stages played.'),
      stages: described(
        v.nullable(v.array(courseStageFigures)),
        'Each reached stage’s own figures, in order; null for runs stored before they were kept.',
      ),
    }),
  ),
});

export const courseRankingResponse = v.object({
  ...rankingResponse.entries,
  entries: v.array(
    v.object({
      ...rankingEntry.entries,
      exScoreId: described(v.string(), 'The course run that set the best EX-Score.'),
      noteCount: described(
        v.pipe(v.number(), v.integer()),
        'Judgment notes of the course under this ruleset, the DJ LEVEL’s scale.',
      ),
      trophy: described(v.nullable(v.string()), 'The best trophy the player earned on the course, by name.'),
      trophyScoreId: described(v.nullable(v.string()), 'The course run that earned it.'),
    }),
  ),
});

export const myCourseRankResponse = v.object({
  ...myRankResponse.entries,
  trophy: described(v.nullable(v.string()), 'My best trophy on the course, by name.'),
  trophyScoreId: described(v.nullable(v.string()), 'The course run that earned it.'),
});

export const courseVisibilityBody = v.object({
  hidden: described(
    v.boolean(),
    'Hide the run (`true`): it leaves the course rankings, the personal bests, the figures and every list, and only its player can open it. `false` shows it again.',
  ),
});
