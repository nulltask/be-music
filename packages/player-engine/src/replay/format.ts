import type { LongNoteModifier } from '../core/long-note-modifier.ts';
import type { MineModifier } from '../core/mine-modifier.ts';
import {
  parseReplayOptionState,
  parseReplayOptionChanges,
  type ReplayOptionState,
  type ReplayOptionChange,
} from './options.ts';
import type { LongNoteMode, RandomDraw } from '@be-music/chart-model';
import { GAUGE_TYPES, isGaugeType, type GaugeType, type GaugeAutoShift } from '../ruleset/gauge-type.ts';
import type { CourseGaugeSet, CourseJudgeConstraint, RulesetCourseKind } from '../ruleset/course.ts';
import type { RulesetId } from '../ruleset/definitions.ts';
import {
  parseReplayTempoChanges,
  parseReplayViewChanges,
  parseReplayViewState,
  type ReplayTempoChange,
  type ReplayViewChange,
  type ReplayViewState,
} from './view.ts';
import {
  expectFiniteNumber,
  expectNonNegativeInteger,
  expectRecord,
  expectString,
  optionalFiniteNumber,
  optionalString,
  parseRandomDraws,
  parseRecorder,
  parseResults,
  ReplayParseError,
} from './parse.ts';

export { ReplayParseError } from './parse.ts';

/**
 * be-music replay ("replay") format.
 *
 * A replay is an INPUT REPLAY, not a result log: the canonical payload is the resolved chart that actually
 * scrolled past the player (post `#RANDOM`, post lane-shuffle / DP-flip), the raw key press / release stream, and
 * the play settings. Judgments, EX-SCORE, combo, and gauge values are deliberately NOT part of the canonical data —
 * they are re-derived by ruleset simulators (`simulate.ts`), so a later fix to a ruleset re-scores every past play
 * without re-recording anything. `results` is a regenerable cache, never the source of truth.
 *
 * Times are integer microseconds relative to chart zero (the same t=0 the engine's note `seconds` axis uses).
 * Events that share a timestamp are ordered by `seq` — sort key is always `(timeUs, seq)`.
 */
export const BE_MUSIC_REPLAY_FORMAT = 'be-music-replay';
/**
 * The replay format's revision. `0` while the format is still being defined: it may change incompatibly without the
 * number moving. The first stable revision will be `1`.
 */
export const BE_MUSIC_REPLAY_VERSION = 0;

/**
 * Revisions {@link parseReplay} still reads. Logs were stamped `1` before the format was marked unstable; their shape is
 * the same, so they parse as revision `0`.
 */
const LEGACY_REPLAY_VERSIONS: ReadonlySet<unknown> = new Set([1]);

/** Recommended file suffix for serialized replays (JSON payload). */
export const REPLAY_FILE_SUFFIX = '.bmplay.json';

export type ReplayNoteType = 'normal' | 'long' | 'mine' | 'invisible' | 'freezone';

export interface ReplayNote {
  /** Stable note id — index into the chart's note array at record time. */
  id: number;
  /** Normalized playable channel AFTER every lane transform (`11`..`19` / `21`..`29`), i.e. the lane the player saw. */
  channel: string;
  /** Original lane when rearranged; omitted when it is the same as channel or in older replays. */
  sourceChannel?: string;
  /** A generated long-note head; source identity and endpoint reconstruct the modifier without rerolling. */
  generatedLongNote?: true;
  type: ReplayNoteType;
  timeUs: number;
  /** Long-note / freezone tail. Present only when `type` is `'long'` or `'freezone'`. */
  endTimeUs?: number;
  /** `#LNMODE`-resolved mode for `type: 'long'` notes (1: LN / 2: CN / 3: HCN). */
  lnMode?: LongNoteMode;
  /** Gauge damage percentage for `type: 'mine'` notes (base-36 value / bmson `damage`, already resolved). */
  damage?: number;
  /** Generated mines carry no explosion sample. Valid only for mine notes. */
  silent?: boolean;
}

export type ReplayInputAction = 'down' | 'up';

export interface ReplayInputEvent {
  /** Monotonic sequence number — tie-breaker for events that share `timeUs`. */
  seq: number;
  timeUs: number;
  action: ReplayInputAction;
  /**
   * Playable channels the physical input resolved to under the play session's lane bindings (auto-scratch lanes
   * already filtered out). One press can cover several channels (e.g. a token bound to multiple lanes); simulators
   * search all of them for a judgable note, mirroring the live engine.
   */
  channels: string[];
  /** Raw input tokens (`'z'`, `'shift-left'`, ...) — diagnostic only; simulators use `channels`. */
  tokens?: string[];
  /**
   * An `up` the engine inferred: the input reported no key releases (a terminal without the kitty keyboard protocol),
   * so this is the instant the engine took the key as let go — when its repeats stopped for longer than the hold
   * grace. Diagnostic only: replays and simulators read it as any release.
   */
  inferred?: true;
}

export interface ReplayJudgeRank {
  /**
   * Initial judgerank on the internal LR2 percent axis (VERY HARD = 25 / HARD = 50 / NORMAL = 75 / EASY = 100),
   * resolved through `resolveJudgeRankPercent` at record time.
   */
  percent: number;
  /** Raw `#RANK` (`metadata.rank`) when the chart specified one. */
  sourceRank?: number;
  /** Raw `#DEFEXRANK` (BMS) / `info.judge_rank` (bmson) when specified (`100 = NORMAL` unit). */
  sourceExRank?: number;
  /** Dynamic `#EXRANKxx` changes (channel `A0`), in chart order. Values share the `100 = NORMAL` unit. */
  timeline?: Array<{ timeUs: number; exRankValue: number }>;
  /**
   * A stitched LR2 NONSTOP play's later stages taking over the judge rank with their `#RANK`, in time order: from
   * `timeUs` on, the windows a chart opening with `rank` gets (`'chart'`) or LR2's NONSTOP rank table
   * (`'lr2-nonstop'`). Absent in logs recorded before it existed, which played with the first stage's rank throughout.
   */
  stageRanks?: Array<{ timeUs: number; rank: number; table: 'chart' | 'lr2-nonstop' | 'bmson' | 'bms-exrank' }>;
}

export interface ReplayChart {
  /** Original header BPM, kept separately from the effective tempo map. */
  headerBPM?: number;
  /** Resolved chart BPM extrema, used for source option classification. */
  bpmRange?: { min: number; max: number };
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  /** `#PLAYLEVEL` / bmson `info.level` as the chart wrote it (a number for most charts, text for some). */
  playLevel?: string;
  /** `#DIFFICULTY`: 1 BEGINNER, 2 NORMAL, 3 HYPER, 4 ANOTHER, 5 INSANE. */
  difficulty?: number;
  /** Lowercase-hex SHA-256 of the source chart FILE bytes — the primary key for matching a log back to its chart. */
  sha256?: string;
  /** Lowercase-hex MD5 of the source chart FILE bytes — how LR2 and LR2IR name a chart. */
  md5?: string;
  /**
   * Chart fingerprint (`bmfp0:…`, docs/fingerprint-spec.md) of the source chart, every `#RANDOM` / `#SWITCH` branch
   * included — identifies the chart regardless of file bytes, keysounds, BGA, metadata or which branches this play
   * rolled, so plays of one chart share it. Equal to {@link playFingerprint} for a chart without control flow. Omitted
   * when the recorder did not have the source chart (a host resolved `#RANDOM` itself without passing it).
   */
  chartFingerprint?: string;
  /**
   * Play fingerprint (`bmfp0:…`) of the chart after this play's `#RANDOM` / `#SWITCH` outcomes — identifies what
   * the player played. Lane options (MIRROR / RANDOM / FLIP) are part of neither fingerprint; they live in `play`.
   */
  playFingerprint?: string;
  sourceFormat: 'bms' | 'bmson';
  /** Explicit TOTAL units for mixed-format NONSTOP charts; otherwise derived from sourceFormat. */
  totalUnit?: 'absolute' | 'percent';
  /** Engine lane display mode (`'7keys'` / `'14keys'` / ... — `resolveLaneDisplayMode` output). */
  laneMode: string;
  /**
   * Raw `#TOTAL` / bmson `info.total` as the chart wrote it — not the effective TOTAL, which each ruleset resolves on
   * replay (bmson `total` is a percentage of the ruleset's default). Omitted when the chart did not specify one.
   */
  total?: number;
  /** Chart-level long-note mode (1: LN / 2: CN / 3: HCN) after `#LNMODE` / `info.ln_type` resolution. */
  lnMode: LongNoteMode;
  judgeRank: ReplayJudgeRank;
  /** Number of scorable notes (TOTAL / EX-SCORE denominator — mines / invisibles / freezones excluded). */
  noteCount: number;
  /**
   * LR2 negative-BPM reversal in chart µs (#134). Judging and realtime audio froze here during the recorded run,
   * so re-simulations must apply the same cutoff. Absent when the chart has no negative `#BPMxx`.
   */
  reversalTimeUs?: number;
  notes: ReplayNote[];
}

export interface ReplayPlay {
  /** Selected source options at the start; typed effective play/chart fields remain authoritative for judging. */
  options?: ReplayOptionState;
  /** Every later selected-option change, on the same chart clock as inputs and view changes. */
  optionChanges?: ReplayOptionChange[];
  mode: 'manual' | 'auto';
  autoScratch: boolean;
  /** Effective manual assist per side; older replays fall back to autoScratch for both. */
  judgeAlgorithm?: 'combo' | 'duration' | 'lowest';
  longNoteModifier?: LongNoteModifier;
  longNoteRate?: number;
  longNoteModifierChangeCount?: number;
  mineModifier?: MineModifier;
  mineModifierChangeCount?: number;
  autoScratch1P?: boolean;
  autoScratch2P?: boolean;
  /** Gauge the player selected for the session (declared by the host; LR2-family gauge id). */
  gauge: GaugeType;
  /** Lane-arrangement option per side, when the host applied one (`'OFF'` / `'MIRROR'` / `'RANDOM'` / ...). */
  randomLane?: { p1?: string; p2?: string };
  dpFlip?: boolean;
  /** Debug BAD-window override (`PlayerOptions.judgeWindowMs`) — simulations of such plays are non-standard. */
  judgeWindowOverrideMs?: number;
  /** Judgment-window ruleset the live engine ran (`PlayerOptions.judgeRuleset`). Absent = `'lr2'` (the default). */
  judgeRuleset?: RulesetId;
  /**
   * The play's `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` outcomes (`RandomDraws` from `@be-music/chart-model`): one
   * entry per such line of the chart, in file order. With the chart file, `resolveBMSControlFlowWithDraws(json,
   * randomDraws)` rebuilds the chart that was played (so a verifier can recompute `chart.playFingerprint`), and a
   * replay passes them back as `PlayerOptions.randomDraws`. Absent for charts without control flow.
   */
  randomDraws?: RandomDraw[];
  /** True when the play ended early (ESC). The input stream stops at the abort point. */
  aborted?: boolean;
  /**
   * Chart time (µs) the judge had settled through when the play was aborted: everything due before it was judged,
   * nothing from it on. Re-simulations stop there instead of missing the rest of the chart. Absent on older logs.
   */
  abortedAtUs?: number;
  /**
   * True when the play ended the moment its survival gauge emptied (`PlayerOptions.endOnFailure`): nothing after the
   * judgment that emptied it counts. Absent on older logs, which kept judging to the end.
   */
  endOnFailure?: boolean;
  gaugeAutoShift?: GaugeAutoShift;
  /** Set when the play was one stage of a course: what the stage's rules and starting state were. */
  course?: ReplayCourseStage;
  /**
   * The play tempo (`PlayerOptions.speed`): the chart, its audio and the play clock ran `tempo` times as fast (0.5 to
   * 1.5 in the web player). Judgments and input times stay in chart time, so a re-simulation is unaffected; a replay
   * plays back at the same tempo. Absent = 1, and on a log re-recorded from a replay (`replayInputs`), whose speed only
   * sets how fast it is re-driven. A play at another tempo is a practice play and is not ranked. This is the tempo at
   * the start; {@link tempoChanges} lists the changes during the play.
   */
  tempo?: number;
  /** Tempo changes during the play, in chart-time order (the web player lets the tempo change mid-play). */
  tempoChanges?: ReplayTempoChange[];
  /** What the player saw at the start: hi-speed, hi-speed fix, lane covers and lift. Judgments do not depend on it. */
  view?: ReplayViewState;
  /** Changes to {@link view} during the play, in chart-time order. */
  viewChanges?: ReplayViewChange[];
  /** Lossless bag for host-specific settings that don't affect simulation (hi-speed, skin, ...). */
  native?: Record<string, string | number | boolean | null>;
}

/** The course context a stage was played in. A stage log replays on its own with it. */
export interface ReplayCourseStage {
  kind: RulesetCourseKind;
  /** The course's `gauge_*` constraint (beatoraja's class-gauge set), when it named one. */
  gaugeSet?: CourseGaugeSet;
  /** The course's `no_good` / `no_great` constraint. */
  judge?: CourseJudgeConstraint;
  /** The state the previous stage left. Absent for the first stage, which starts on a full gauge and no combo. */
  carryIn?: ReplayCourseCarry;
  /**
   * A stage cut out of a NONSTOP play: the FIT time-stretch it was played at (its notes keep the stretched times; 1
   * without FIT). Display only; the log replays as recorded.
   */
  rate?: number;
}

/** The state carried from one course stage into the next. */
export interface ReplayCourseCarry {
  /** Gauge value in percent. */
  gauge: number;
  /** The course-wide combo running into the stage. */
  combo: number;
  /** The course-wide max combo so far. */
  maxCombo: number;
}

export interface ReplayJudgmentCounts {
  pgreat: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  /** LR2-style empty POOR count — never part of the judgment counters above. */
  emptyPoor: number;
}

export interface ReplayGaugeResult {
  /** Ruleset-scoped gauge id (`'GROOVE'`, `'HARD'`, `'NORMAL'`, `'EX-HARD'`, ...). */
  type: string;
  /** Final gauge value in percent. */
  final: number;
  cleared: boolean;
  /** True when a survival gauge bottomed out mid-play (the simulator keeps judging to the end regardless). */
  failedMidPlay?: boolean;
}

export interface ReplayRulesetResult {
  /** Ruleset identifier + revision (e.g. `'lr2/0'`, `'beatoraja/0'`, `'____/0'`, `'be-music/native'`). */
  ruleset: string;
  judge: ReplayJudgmentCounts;
  fast: number;
  slow: number;
  exScore: number;
  /**
   * The ruleset's judgment-note count (EX-SCORE denominator ÷ 2). Differs per ruleset: charge-note styles
   * (beatoraja CN/HCN, That-Which-Must-Not-Be-Named CN) count a long note's head and tail as two judgments, LN styles as one.
   */
  noteCount: number;
  /** Final combo eligibility when empty POOR can break combo; absent in legacy/count-only results. */
  fullCombo?: boolean;
  maxCombo: number;
  /** LR2 mine hits included in judge.poor, excluded from the judged-note count. */
  minePoor?: number;
  /** 200000-max money score where the ruleset defines one. */
  score?: number;
  /** That-Which-Must-Not-Be-Named DJ LEVEL label (`'AAA'`..`'F'`) where the ruleset defines one. */
  djLevel?: string;
  gauge: ReplayGaugeResult;
  /** For a course stage: the course-wide combo and max combo the stage left, which the next stage carries in. */
  course?: { combo: number; maxCombo: number };
}

/**
 * Software that recorded the play — self-reported, so it identifies builds for compatibility and bug triage, never
 * for trust. Every field is optional: a log from a host that declared nothing still carries the engine version.
 */
export interface ReplayRecorderInfo {
  /** Recording application id (`'be-music-web'`, `'be-music-tui'`, ...). */
  name?: string;
  /** Recording application version. */
  version?: string;
  /** Build identifier of the application, e.g. the source commit. */
  build?: string;
  /** `@be-music/player-engine` version whose engine ran the play — filled by the recorder, not the host. */
  engine?: string;
  /** Coarse platform label (`'web'`, `'node'`, ...). Never a full user-agent string. */
  platform?: string;
}

export interface BeMusicReplay {
  format: typeof BE_MUSIC_REPLAY_FORMAT;
  version: typeof BE_MUSIC_REPLAY_VERSION;
  /** ISO 8601 timestamp of the recording, when the recorder had a clock available. */
  createdAt?: string;
  /** Software that recorded the play. Absent in logs written before the field existed. */
  recorder?: ReplayRecorderInfo;
  clock: { unit: 'us'; origin: 'chart-zero' };
  chart: ReplayChart;
  inputs: ReplayInputEvent[];
  play: ReplayPlay;
  /** Regenerable result cache keyed by ruleset id. Never authoritative — delete freely. */
  results?: Record<string, ReplayRulesetResult>;
}

export function serializeReplay(replay: BeMusicReplay): string {
  return JSON.stringify(replay);
}

/**
 * Suggested download / save filename for a replay: `<title>-<timestamp>.bmplay.json` with
 * filesystem-hostile characters stripped. `when` defaults to the replay's own `createdAt`.
 */
export function resolveReplayFilename(replay: BeMusicReplay, when?: Date): string {
  const stemSource = replay.chart.title ?? 'play';
  const stem =
    stemSource
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'play';
  const timestampSource = when ?? (replay.createdAt !== undefined ? new Date(replay.createdAt) : undefined);
  const timestamp =
    timestampSource !== undefined && Number.isFinite(timestampSource.getTime())
      ? timestampSource.toISOString().replace(/[:.]/g, '-')
      : 'unknown-time';
  return `${stem}-${timestamp}${REPLAY_FILE_SUFFIX}`;
}

/**
 * Parses (and defensively validates) a serialized replay. Accepts either the JSON text or an already-parsed
 * value. Throws {@link ReplayParseError} with a field-path message on structural problems; unknown extra fields
 * are preserved-by-ignoring so future minor additions stay readable.
 */
export function parseReplay(source: unknown): BeMusicReplay {
  let value: unknown = source;
  if (typeof source === 'string') {
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new ReplayParseError(`invalid JSON: ${(error as Error).message}`);
    }
  }
  const root = expectRecord(value, 'replay');
  if (root.format !== BE_MUSIC_REPLAY_FORMAT) {
    throw new ReplayParseError(`format: expected '${BE_MUSIC_REPLAY_FORMAT}', got ${JSON.stringify(root.format)}`);
  }
  if (root.version !== BE_MUSIC_REPLAY_VERSION && !LEGACY_REPLAY_VERSIONS.has(root.version)) {
    throw new ReplayParseError(`version: unsupported version ${JSON.stringify(root.version)}`);
  }
  const clock = expectRecord(root.clock, 'clock');
  if (clock.unit !== 'us' || clock.origin !== 'chart-zero') {
    throw new ReplayParseError(`clock: expected { unit: 'us', origin: 'chart-zero' }`);
  }

  const chart = parseChart(expectRecord(root.chart, 'chart'));
  const inputs = parseInputs(root.inputs);
  const play = parsePlay(expectRecord(root.play, 'play'));
  const results = root.results === undefined ? undefined : parseResults(expectRecord(root.results, 'results'));
  const recorder = root.recorder === undefined ? undefined : parseRecorder(expectRecord(root.recorder, 'recorder'));

  return {
    format: BE_MUSIC_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    createdAt: optionalString(root.createdAt, 'createdAt'),
    ...(recorder !== undefined ? { recorder } : {}),
    clock: { unit: 'us', origin: 'chart-zero' },
    chart,
    inputs,
    play,
    ...(results !== undefined ? { results } : {}),
  };
}

function parseChart(chart: Record<string, unknown>): ReplayChart {
  const sourceFormat = chart.sourceFormat;
  if (chart.totalUnit !== undefined && chart.totalUnit !== 'absolute' && chart.totalUnit !== 'percent')
    throw new ReplayParseError('chart.totalUnit: expected absolute or percent');
  if (sourceFormat !== 'bms' && sourceFormat !== 'bmson') {
    throw new ReplayParseError(`chart.sourceFormat: expected 'bms' | 'bmson'`);
  }
  const judgeRankRaw = expectRecord(chart.judgeRank, 'chart.judgeRank');
  const judgeRank: ReplayJudgeRank = {
    percent: expectFiniteNumber(judgeRankRaw.percent, 'chart.judgeRank.percent'),
    sourceRank: optionalFiniteNumber(judgeRankRaw.sourceRank, 'chart.judgeRank.sourceRank'),
    sourceExRank: optionalFiniteNumber(judgeRankRaw.sourceExRank, 'chart.judgeRank.sourceExRank'),
    timeline: parseJudgeRankTimeline(judgeRankRaw.timeline),
    stageRanks: parseStageRanks(judgeRankRaw.stageRanks),
  };
  if (judgeRank.sourceRank === undefined) delete judgeRank.sourceRank;
  if (judgeRank.sourceExRank === undefined) delete judgeRank.sourceExRank;
  if (judgeRank.timeline === undefined) delete judgeRank.timeline;
  if (judgeRank.stageRanks === undefined) delete judgeRank.stageRanks;

  const notesRaw = chart.notes;
  if (!Array.isArray(notesRaw)) {
    throw new ReplayParseError('chart.notes: expected an array');
  }
  const notes = notesRaw.map((note, index) => parseNote(note, index));

  const lnMode = chart.lnMode;
  if (lnMode !== 1 && lnMode !== 2 && lnMode !== 3) {
    throw new ReplayParseError('chart.lnMode: expected 1 | 2 | 3');
  }

  let bpmRange: ReplayChart['bpmRange'];
  if (chart.bpmRange !== undefined) {
    const range = expectRecord(chart.bpmRange, 'chart.bpmRange');
    const min = expectFiniteNumber(range.min, 'chart.bpmRange.min');
    const max = expectFiniteNumber(range.max, 'chart.bpmRange.max');
    if (min > max) throw new ReplayParseError('chart.bpmRange: min must not exceed max');
    bpmRange = { min, max };
  }
  const parsed: ReplayChart = {
    ...(bpmRange !== undefined ? { bpmRange } : {}),
    ...(chart.headerBPM !== undefined ? { headerBPM: expectFiniteNumber(chart.headerBPM, 'chart.headerBPM') } : {}),
    title: optionalString(chart.title, 'chart.title'),
    subtitle: optionalString(chart.subtitle, 'chart.subtitle'),
    artist: optionalString(chart.artist, 'chart.artist'),
    genre: optionalString(chart.genre, 'chart.genre'),
    playLevel: optionalString(chart.playLevel, 'chart.playLevel'),
    difficulty: optionalFiniteNumber(chart.difficulty, 'chart.difficulty'),
    sha256: optionalString(chart.sha256, 'chart.sha256'),
    md5: optionalString(chart.md5, 'chart.md5'),
    chartFingerprint: optionalString(chart.chartFingerprint, 'chart.chartFingerprint'),
    playFingerprint: optionalString(chart.playFingerprint, 'chart.playFingerprint'),
    sourceFormat,
    laneMode: expectString(chart.laneMode, 'chart.laneMode'),
    total: optionalFiniteNumber(chart.total, 'chart.total'),
    ...(chart.totalUnit !== undefined ? { totalUnit: chart.totalUnit as 'absolute' | 'percent' } : {}),
    lnMode,
    judgeRank,
    noteCount: expectFiniteNumber(chart.noteCount, 'chart.noteCount'),
    reversalTimeUs: optionalFiniteNumber(chart.reversalTimeUs, 'chart.reversalTimeUs'),
    notes,
  };
  for (const key of [
    'title',
    'subtitle',
    'artist',
    'genre',
    'playLevel',
    'difficulty',
    'sha256',
    'md5',
    'chartFingerprint',
    'playFingerprint',
    'total',
    'reversalTimeUs',
  ] as const) {
    if (parsed[key] === undefined) delete parsed[key];
  }
  return parsed;
}

function parseJudgeRankTimeline(value: unknown): ReplayJudgeRank['timeline'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ReplayParseError('chart.judgeRank.timeline: expected an array');
  }
  return value.map((entry, index) => {
    const record = expectRecord(entry, `chart.judgeRank.timeline[${index}]`);
    return {
      timeUs: expectFiniteNumber(record.timeUs, `chart.judgeRank.timeline[${index}].timeUs`),
      exRankValue: expectFiniteNumber(record.exRankValue, `chart.judgeRank.timeline[${index}].exRankValue`),
    };
  });
}

function parseStageRanks(value: unknown): ReplayJudgeRank['stageRanks'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ReplayParseError('chart.judgeRank.stageRanks: expected an array');
  }
  return value.map((entry, index) => {
    const path = `chart.judgeRank.stageRanks[${index}]`;
    const record = expectRecord(entry, path);
    const table = record.table;
    if (table !== 'chart' && table !== 'lr2-nonstop' && table !== 'bmson' && table !== 'bms-exrank') {
      throw new ReplayParseError(`${path}.table: expected 'chart', 'lr2-nonstop', 'bmson' or 'bms-exrank'`);
    }
    return {
      timeUs: expectFiniteNumber(record.timeUs, `${path}.timeUs`),
      rank: expectFiniteNumber(record.rank, `${path}.rank`),
      table,
    };
  });
}

const REPLAY_NOTE_TYPES: ReadonlySet<string> = new Set(['normal', 'long', 'mine', 'invisible', 'freezone']);

function parseNote(value: unknown, index: number): ReplayNote {
  const record = expectRecord(value, `chart.notes[${index}]`);
  const type = record.type;
  if (typeof type !== 'string' || !REPLAY_NOTE_TYPES.has(type)) {
    throw new ReplayParseError(`chart.notes[${index}].type: expected one of ${[...REPLAY_NOTE_TYPES].join(' | ')}`);
  }
  const note: ReplayNote = {
    id: expectFiniteNumber(record.id, `chart.notes[${index}].id`),
    channel: expectString(record.channel, `chart.notes[${index}].channel`),
    type: type as ReplayNoteType,
    timeUs: expectFiniteNumber(record.timeUs, `chart.notes[${index}].timeUs`),
  };
  if (record.sourceChannel !== undefined) {
    if (typeof record.sourceChannel !== 'string' || !/^[12][0-9A-Z]$/.test(record.sourceChannel))
      throw new ReplayParseError(`chart.notes[${index}].sourceChannel: expected a normalized playable lane`);
    note.sourceChannel = record.sourceChannel;
  }
  const endTimeUs = optionalFiniteNumber(record.endTimeUs, `chart.notes[${index}].endTimeUs`);
  if (endTimeUs !== undefined) note.endTimeUs = endTimeUs;
  if (record.lnMode !== undefined) {
    if (record.lnMode !== 1 && record.lnMode !== 2 && record.lnMode !== 3) {
      throw new ReplayParseError(`chart.notes[${index}].lnMode: expected 1 | 2 | 3`);
    }
    note.lnMode = record.lnMode;
  }
  const damage = optionalFiniteNumber(record.damage, `chart.notes[${index}].damage`);
  if (damage !== undefined) note.damage = damage;
  if (record.generatedLongNote !== undefined) {
    if (
      record.generatedLongNote !== true ||
      type !== 'long' ||
      note.lnMode === undefined ||
      !Number.isSafeInteger(note.timeUs) ||
      !Number.isSafeInteger(note.endTimeUs) ||
      !(note.endTimeUs! > note.timeUs)
    )
      throw new ReplayParseError(
        `chart.notes[${index}].generatedLongNote: expected a timed long note with a resolved mode`,
      );
    note.generatedLongNote = true;
  }
  if (record.silent !== undefined) {
    if (type !== 'mine' || typeof record.silent !== 'boolean')
      throw new ReplayParseError(`chart.notes[${index}].silent: expected a mine boolean`);
    note.silent = record.silent;
  }
  return note;
}

function parseInputs(value: unknown): ReplayInputEvent[] {
  if (!Array.isArray(value)) {
    throw new ReplayParseError('inputs: expected an array');
  }
  return value.map((entry, index) => {
    const record = expectRecord(entry, `inputs[${index}]`);
    const action = record.action;
    if (action !== 'down' && action !== 'up') {
      throw new ReplayParseError(`inputs[${index}].action: expected 'down' | 'up'`);
    }
    const channelsRaw = record.channels;
    if (!Array.isArray(channelsRaw) || channelsRaw.some((channel) => typeof channel !== 'string')) {
      throw new ReplayParseError(`inputs[${index}].channels: expected string[]`);
    }
    const event: ReplayInputEvent = {
      seq: expectFiniteNumber(record.seq, `inputs[${index}].seq`),
      timeUs: expectFiniteNumber(record.timeUs, `inputs[${index}].timeUs`),
      action,
      channels: channelsRaw as string[],
    };
    if (record.tokens !== undefined) {
      if (!Array.isArray(record.tokens) || record.tokens.some((token) => typeof token !== 'string')) {
        throw new ReplayParseError(`inputs[${index}].tokens: expected string[]`);
      }
      event.tokens = record.tokens as string[];
    }
    if (record.inferred !== undefined) {
      if (record.inferred !== true || action !== 'up') {
        throw new ReplayParseError(`inputs[${index}].inferred: expected true on an 'up'`);
      }
      event.inferred = true;
    }
    return event;
  });
}

function parsePlay(play: Record<string, unknown>): ReplayPlay {
  const mode = play.mode;
  if (mode !== 'manual' && mode !== 'auto') {
    throw new ReplayParseError(`play.mode: expected 'manual' | 'auto'`);
  }
  const gauge = play.gauge;
  if (!isGaugeType(gauge)) {
    throw new ReplayParseError(`play.gauge: expected one of ${GAUGE_TYPES.join(' | ')}`);
  }
  const parsed: ReplayPlay = {
    mode,
    autoScratch: play.autoScratch === true,
    gauge,
  };
  if (play.randomLane !== undefined) {
    const randomLane = expectRecord(play.randomLane, 'play.randomLane');
    parsed.randomLane = {};
    const p1 = optionalString(randomLane.p1, 'play.randomLane.p1');
    const p2 = optionalString(randomLane.p2, 'play.randomLane.p2');
    if (p1 !== undefined) parsed.randomLane.p1 = p1;
    if (p2 !== undefined) parsed.randomLane.p2 = p2;
  }
  if (play.dpFlip !== undefined) parsed.dpFlip = play.dpFlip === true;
  const judgeWindowOverrideMs = optionalFiniteNumber(play.judgeWindowOverrideMs, 'play.judgeWindowOverrideMs');
  if (judgeWindowOverrideMs !== undefined) parsed.judgeWindowOverrideMs = judgeWindowOverrideMs;
  if (play.judgeRuleset !== undefined) {
    if (play.judgeRuleset !== 'lr2' && play.judgeRuleset !== 'beatoraja' && play.judgeRuleset !== '____') {
      throw new ReplayParseError(`play.judgeRuleset: expected 'lr2' | 'beatoraja' | '____'`);
    }
    parsed.judgeRuleset = play.judgeRuleset;
  }
  if (play.randomDraws !== undefined) {
    parsed.randomDraws = parseRandomDraws(play.randomDraws, 'play.randomDraws');
  }
  if (play.aborted !== undefined) parsed.aborted = play.aborted === true;
  if (play.abortedAtUs !== undefined) parsed.abortedAtUs = expectFiniteNumber(play.abortedAtUs, 'play.abortedAtUs');
  if (play.endOnFailure !== undefined) parsed.endOnFailure = play.endOnFailure === true;
  if (play.gaugeAutoShift !== undefined) {
    if (!['NONE', 'CONTINUE', 'SURVIVAL_TO_GROOVE'].includes(play.gaugeAutoShift as string))
      throw new ReplayParseError('play.gaugeAutoShift: expected NONE, CONTINUE or SURVIVAL_TO_GROOVE');
    parsed.gaugeAutoShift = play.gaugeAutoShift as GaugeAutoShift;
  }
  if (play.course !== undefined) parsed.course = parseCourseStage(expectRecord(play.course, 'play.course'));
  if (play.tempo !== undefined) {
    const tempo = expectFiniteNumber(play.tempo, 'play.tempo');
    if (!(tempo > 0)) throw new ReplayParseError('play.tempo: expected a positive number');
    if (tempo !== 1) parsed.tempo = tempo;
  }
  if (play.tempoChanges !== undefined) {
    const changes = parseReplayTempoChanges(play.tempoChanges, 'play.tempoChanges');
    if (changes.length > 0) parsed.tempoChanges = changes;
  }
  if (play.view !== undefined) parsed.view = parseReplayViewState(expectRecord(play.view, 'play.view'), 'play.view');
  if (play.viewChanges !== undefined) {
    const changes = parseReplayViewChanges(play.viewChanges, 'play.viewChanges');
    if (changes.length > 0) parsed.viewChanges = changes;
  }
  if (play.judgeAlgorithm !== undefined) {
    if (!['combo', 'duration', 'lowest'].includes(play.judgeAlgorithm as string)) {
      throw new ReplayParseError('play.judgeAlgorithm: expected combo, duration or lowest');
    }
    parsed.judgeAlgorithm = play.judgeAlgorithm as 'combo' | 'duration' | 'lowest';
  }
  if (play.mineModifier !== undefined) {
    if (!['OFF', 'REMOVE', 'ADD_RANDOM', 'ADD_NEAR', 'ADD_BLANK'].includes(play.mineModifier as string))
      throw new ReplayParseError('play.mineModifier: expected OFF, REMOVE, ADD_RANDOM, ADD_NEAR or ADD_BLANK');
    parsed.mineModifier = play.mineModifier as MineModifier;
  }
  if (play.mineModifierChangeCount !== undefined)
    parsed.mineModifierChangeCount = expectNonNegativeInteger(
      play.mineModifierChangeCount,
      'play.mineModifierChangeCount',
    );
  if (play.longNoteRate !== undefined) {
    const rate = expectFiniteNumber(play.longNoteRate, 'play.longNoteRate');
    if (rate < 0 || rate > 1) throw new ReplayParseError('play.longNoteRate: expected 0..1');
    parsed.longNoteRate = rate;
  }
  if (play.longNoteModifierChangeCount !== undefined)
    parsed.longNoteModifierChangeCount = expectNonNegativeInteger(
      play.longNoteModifierChangeCount,
      'play.longNoteModifierChangeCount',
    );
  if (play.longNoteModifier !== undefined) {
    if (
      !['OFF', 'LEGACY', 'REMOVE', 'ADD_LN', 'ADD_CN', 'ADD_HCN', 'ADD_ALL'].includes(play.longNoteModifier as string)
    ) {
      throw new ReplayParseError(
        'play.longNoteModifier must be OFF, LEGACY, REMOVE, ADD_LN, ADD_CN, ADD_HCN or ADD_ALL',
      );
    }
    parsed.longNoteModifier = play.longNoteModifier as LongNoteModifier;
  }
  for (const key of ['autoScratch1P', 'autoScratch2P'] as const) {
    if (play[key] !== undefined) {
      if (typeof play[key] !== 'boolean') throw new ReplayParseError(`play.${key}: expected a boolean`);
      parsed[key] = play[key];
    }
  }
  if (play.options !== undefined) parsed.options = parseReplayOptionState(play.options);
  if (play.optionChanges !== undefined) parsed.optionChanges = parseReplayOptionChanges(play.optionChanges);
  if (play.native !== undefined) {
    const native = expectRecord(play.native, 'play.native');
    const copied: Record<string, string | number | boolean | null> = {};
    for (const [key, raw] of Object.entries(native)) {
      if (raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
        copied[key] = raw;
      }
    }
    parsed.native = copied;
  }
  return parsed;
}

const COURSE_KINDS: ReadonlySet<string> = new Set(['grade', 'expert', 'nonstop']);
const COURSE_GAUGE_SETS: ReadonlySet<string> = new Set(['lr2', '5k', '7k', '9k', '24k']);
const COURSE_JUDGE_CONSTRAINTS: ReadonlySet<string> = new Set(['no-good', 'no-great']);

function parseCourseStage(course: Record<string, unknown>): ReplayCourseStage {
  if (typeof course.kind !== 'string' || !COURSE_KINDS.has(course.kind)) {
    throw new ReplayParseError(`play.course.kind: expected 'grade' | 'expert' | 'nonstop'`);
  }
  const parsed: ReplayCourseStage = { kind: course.kind as RulesetCourseKind };
  if (course.gaugeSet !== undefined) {
    if (typeof course.gaugeSet !== 'string' || !COURSE_GAUGE_SETS.has(course.gaugeSet)) {
      throw new ReplayParseError(`play.course.gaugeSet: expected 'lr2' | '5k' | '7k' | '9k' | '24k'`);
    }
    parsed.gaugeSet = course.gaugeSet as CourseGaugeSet;
  }
  if (course.judge !== undefined) {
    if (typeof course.judge !== 'string' || !COURSE_JUDGE_CONSTRAINTS.has(course.judge)) {
      throw new ReplayParseError(`play.course.judge: expected 'no-good' | 'no-great'`);
    }
    parsed.judge = course.judge as CourseJudgeConstraint;
  }
  if (course.carryIn !== undefined) {
    const carry = expectRecord(course.carryIn, 'play.course.carryIn');
    parsed.carryIn = {
      gauge: expectFiniteNumber(carry.gauge, 'play.course.carryIn.gauge'),
      combo: expectNonNegativeInteger(carry.combo, 'play.course.carryIn.combo'),
      maxCombo: expectNonNegativeInteger(carry.maxCombo, 'play.course.carryIn.maxCombo'),
    };
  }
  if (course.rate !== undefined) parsed.rate = expectFiniteNumber(course.rate, 'play.course.rate');
  return parsed;
}
