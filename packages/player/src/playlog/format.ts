import type { RandomDraw } from '@be-music/chart';
import type { GrooveGaugeType } from '../core/groove-gauge.ts';
import type { LongNoteMode } from '../playable-notes.ts';
import type { CourseGaugeSet, CourseJudgeConstraint, RulesetCourseKind } from '../ruleset/course.ts';
import {
  expectFiniteNumber,
  expectNonNegativeInteger,
  expectRecord,
  expectString,
  optionalFiniteNumber,
  optionalString,
  parseRecorder,
  parseResults,
  PlaylogParseError,
} from './parse.ts';

export { PlaylogParseError } from './parse.ts';

/**
 * be-music play-log ("playlog") format.
 *
 * A playlog is an INPUT REPLAY, not a result log: the canonical payload is the resolved chart that actually
 * scrolled past the player (post `#RANDOM`, post lane-shuffle / DP-flip), the raw key press / release stream, and
 * the play settings. Judgments, EX-SCORE, combo, and gauge values are deliberately NOT part of the canonical data —
 * they are re-derived by ruleset simulators (`simulate.ts`), so a later fix to a ruleset re-scores every past play
 * without re-recording anything. `results` is a regenerable cache, never the source of truth.
 *
 * Times are integer microseconds relative to chart zero (the same t=0 the engine's note `seconds` axis uses).
 * Events that share a timestamp are ordered by `seq` — sort key is always `(timeUs, seq)`.
 */
export const BE_MUSIC_PLAYLOG_FORMAT = 'be-music-playlog';
/**
 * The playlog format's revision. `0` while the format is still being defined: it may change incompatibly without the
 * number moving. The first stable revision will be `1`.
 */
export const BE_MUSIC_PLAYLOG_VERSION = 0;

/**
 * Revisions {@link parsePlaylog} still reads. Logs were stamped `1` before the format was marked unstable; their shape is
 * the same, so they parse as revision `0`.
 */
const LEGACY_PLAYLOG_VERSIONS: ReadonlySet<unknown> = new Set([1]);

/** Recommended file suffix for serialized playlogs (JSON payload). */
export const PLAYLOG_FILE_SUFFIX = '.bmplay.json';

export type PlaylogNoteType = 'normal' | 'long' | 'mine' | 'invisible' | 'freezone';

export interface PlaylogNote {
  /** Stable note id — index into the chart's note array at record time. */
  id: number;
  /** Normalized playable channel AFTER every lane transform (`11`..`19` / `21`..`29`), i.e. the lane the player saw. */
  channel: string;
  type: PlaylogNoteType;
  timeUs: number;
  /** Long-note / freezone tail. Present only when `type` is `'long'` or `'freezone'`. */
  endTimeUs?: number;
  /** `#LNMODE`-resolved mode for `type: 'long'` notes (1: LN / 2: CN / 3: HCN). */
  lnMode?: LongNoteMode;
  /** Gauge damage percentage for `type: 'mine'` notes (base-36 value / bmson `damage`, already resolved). */
  damage?: number;
}

export type PlaylogInputAction = 'down' | 'up';

export interface PlaylogInputEvent {
  /** Monotonic sequence number — tie-breaker for events that share `timeUs`. */
  seq: number;
  timeUs: number;
  action: PlaylogInputAction;
  /**
   * Playable channels the physical input resolved to under the play session's lane bindings (auto-scratch lanes
   * already filtered out). One press can cover several channels (e.g. a token bound to multiple lanes); simulators
   * search all of them for a judgable note, mirroring the live engine.
   */
  channels: string[];
  /** Raw input tokens (`'z'`, `'shift-left'`, ...) — diagnostic only; simulators use `channels`. */
  tokens?: string[];
}

export interface PlaylogJudgeRank {
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
}

export interface PlaylogChart {
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
  /** Engine lane display mode (`'7keys'` / `'14keys'` / ... — `resolveLaneDisplayMode` output). */
  laneMode: string;
  /**
   * Raw `#TOTAL` / bmson `info.total` as the chart wrote it — not the effective TOTAL, which each ruleset resolves on
   * replay (bmson `total` is a percentage of the ruleset's default). Omitted when the chart did not specify one.
   */
  total?: number;
  /** Chart-level long-note mode (1: LN / 2: CN / 3: HCN) after `#LNMODE` / `info.ln_type` resolution. */
  lnMode: LongNoteMode;
  judgeRank: PlaylogJudgeRank;
  /** Number of scorable notes (TOTAL / EX-SCORE denominator — mines / invisibles / freezones excluded). */
  noteCount: number;
  /**
   * LR2 negative-BPM reversal in chart µs (#134). Judging and realtime audio froze here during the recorded run,
   * so re-simulations must apply the same cutoff. Absent when the chart has no negative `#BPMxx`.
   */
  reversalTimeUs?: number;
  notes: PlaylogNote[];
}

export interface PlaylogPlay {
  mode: 'manual' | 'auto';
  autoScratch: boolean;
  /** Gauge the player selected for the session (declared by the host; LR2-family gauge id). */
  gauge: GrooveGaugeType;
  /** Lane-arrangement option per side, when the host applied one (`'OFF'` / `'MIRROR'` / `'RANDOM'` / ...). */
  randomLane?: { p1?: string; p2?: string };
  dpFlip?: boolean;
  /** Debug BAD-window override (`PlayerOptions.judgeWindowMs`) — simulations of such plays are non-standard. */
  judgeWindowOverrideMs?: number;
  /** Judge-window ruleset the live engine ran (`PlayerOptions.judgeRuleset`). Absent = `'lr2'` (the default). */
  judgeRuleset?: 'lr2' | 'beatoraja' | 'iidx';
  /**
   * The play's `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` outcomes (`RandomDraws` from `@be-music/chart`): one
   * entry per such line of the chart, in file order. With the chart file, `resolveBmsControlFlowWithDraws(json,
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
  /** Set when the play was one stage of a course: what the stage's rules and starting state were. */
  course?: PlaylogCourseStage;
  /** Lossless bag for host-specific settings that don't affect simulation (hi-speed, skin, ...). */
  native?: Record<string, string | number | boolean | null>;
}

/** The course context a stage was played in. A stage log replays on its own with it. */
export interface PlaylogCourseStage {
  kind: RulesetCourseKind;
  /** The course's `gauge_*` constraint (beatoraja's class-gauge set), when it named one. */
  gaugeSet?: CourseGaugeSet;
  /** The course's `no_good` / `no_great` constraint. */
  judge?: CourseJudgeConstraint;
  /** The state the previous stage left. Absent for the first stage, which starts on a full gauge and no combo. */
  carryIn?: PlaylogCourseCarry;
  /**
   * A stage cut out of a NONSTOP play: the FIT time-stretch it was played at (its notes keep the stretched times; 1
   * without FIT). Display only; the log replays as recorded.
   */
  rate?: number;
}

/** The state carried from one course stage into the next. */
export interface PlaylogCourseCarry {
  /** Gauge value in percent. */
  gauge: number;
  /** The course-wide combo running into the stage. */
  combo: number;
  /** The course-wide max combo so far. */
  maxCombo: number;
}

export interface PlaylogJudgeCounts {
  pgreat: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  /** LR2-style empty POOR count — never part of the judge counters above. */
  emptyPoor: number;
}

export interface PlaylogGaugeResult {
  /** Ruleset-scoped gauge id (`'GROOVE'`, `'HARD'`, `'NORMAL'`, `'EX-HARD'`, ...). */
  type: string;
  /** Final gauge value in percent. */
  final: number;
  cleared: boolean;
  /** True when a survival gauge bottomed out mid-play (the simulator keeps judging to the end regardless). */
  failedMidPlay?: boolean;
}

export interface PlaylogRulesetResult {
  /** Ruleset identifier + revision (e.g. `'lr2/0'`, `'beatoraja/0'`, `'iidx/0'`, `'be-music/native'`). */
  ruleset: string;
  judge: PlaylogJudgeCounts;
  fast: number;
  slow: number;
  exScore: number;
  /**
   * The ruleset's judgment-note count (EX-SCORE denominator ÷ 2). Differs per ruleset: charge-note styles
   * (beatoraja CN/HCN, IIDX CN) count a long note's head and tail as two judgments, LN styles as one.
   */
  noteCount: number;
  maxCombo: number;
  /** 200000-max money score where the ruleset defines one. */
  score?: number;
  /** IIDX DJ LEVEL label (`'AAA'`..`'F'`) where the ruleset defines one. */
  djLevel?: string;
  gauge: PlaylogGaugeResult;
  /** For a course stage: the course-wide combo and max combo the stage left, which the next stage carries in. */
  course?: { combo: number; maxCombo: number };
}

/**
 * Software that recorded the play — self-reported, so it identifies builds for compatibility and bug triage, never
 * for trust. Every field is optional: a log from a host that declared nothing still carries the engine version.
 */
export interface PlaylogRecorderInfo {
  /** Recording application id (`'be-music-web'`, `'be-music-tui'`, ...). */
  name?: string;
  /** Recording application version. */
  version?: string;
  /** Build identifier of the application, e.g. the source commit. */
  build?: string;
  /** `@be-music/player` version whose engine ran the play — filled by the recorder, not the host. */
  engine?: string;
  /** Coarse platform label (`'web'`, `'node'`, ...). Never a full user-agent string. */
  platform?: string;
}

export interface BeMusicPlaylog {
  format: typeof BE_MUSIC_PLAYLOG_FORMAT;
  version: typeof BE_MUSIC_PLAYLOG_VERSION;
  /** ISO 8601 timestamp of the recording, when the recorder had a clock available. */
  createdAt?: string;
  /** Software that recorded the play. Absent in logs written before the field existed. */
  recorder?: PlaylogRecorderInfo;
  clock: { unit: 'us'; origin: 'chart-zero' };
  chart: PlaylogChart;
  inputs: PlaylogInputEvent[];
  play: PlaylogPlay;
  /** Regenerable result cache keyed by ruleset id. Never authoritative — delete freely. */
  results?: Record<string, PlaylogRulesetResult>;
}

export function serializePlaylog(playlog: BeMusicPlaylog): string {
  return JSON.stringify(playlog);
}

/**
 * Suggested download / save filename for a playlog: `<title>-<timestamp>.bmplay.json` with
 * filesystem-hostile characters stripped. `when` defaults to the playlog's own `createdAt`.
 */
export function resolvePlaylogFilename(playlog: BeMusicPlaylog, when?: Date): string {
  const stemSource = playlog.chart.title ?? 'play';
  const stem =
    stemSource
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'play';
  const timestampSource = when ?? (playlog.createdAt !== undefined ? new Date(playlog.createdAt) : undefined);
  const timestamp =
    timestampSource !== undefined && Number.isFinite(timestampSource.getTime())
      ? timestampSource.toISOString().replace(/[:.]/g, '-')
      : 'unknown-time';
  return `${stem}-${timestamp}${PLAYLOG_FILE_SUFFIX}`;
}

/**
 * Parses (and defensively validates) a serialized playlog. Accepts either the JSON text or an already-parsed
 * value. Throws {@link PlaylogParseError} with a field-path message on structural problems; unknown extra fields
 * are preserved-by-ignoring so future minor additions stay readable.
 */
export function parsePlaylog(source: unknown): BeMusicPlaylog {
  let value: unknown = source;
  if (typeof source === 'string') {
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new PlaylogParseError(`invalid JSON: ${(error as Error).message}`);
    }
  }
  const root = expectRecord(value, 'playlog');
  if (root.format !== BE_MUSIC_PLAYLOG_FORMAT) {
    throw new PlaylogParseError(`format: expected '${BE_MUSIC_PLAYLOG_FORMAT}', got ${JSON.stringify(root.format)}`);
  }
  if (root.version !== BE_MUSIC_PLAYLOG_VERSION && !LEGACY_PLAYLOG_VERSIONS.has(root.version)) {
    throw new PlaylogParseError(`version: unsupported version ${JSON.stringify(root.version)}`);
  }
  const clock = expectRecord(root.clock, 'clock');
  if (clock.unit !== 'us' || clock.origin !== 'chart-zero') {
    throw new PlaylogParseError(`clock: expected { unit: 'us', origin: 'chart-zero' }`);
  }

  const chart = parseChart(expectRecord(root.chart, 'chart'));
  const inputs = parseInputs(root.inputs);
  const play = parsePlay(expectRecord(root.play, 'play'));
  const results = root.results === undefined ? undefined : parseResults(expectRecord(root.results, 'results'));
  const recorder = root.recorder === undefined ? undefined : parseRecorder(expectRecord(root.recorder, 'recorder'));

  return {
    format: BE_MUSIC_PLAYLOG_FORMAT,
    version: BE_MUSIC_PLAYLOG_VERSION,
    createdAt: optionalString(root.createdAt, 'createdAt'),
    ...(recorder !== undefined ? { recorder } : {}),
    clock: { unit: 'us', origin: 'chart-zero' },
    chart,
    inputs,
    play,
    ...(results !== undefined ? { results } : {}),
  };
}

function parseChart(chart: Record<string, unknown>): PlaylogChart {
  const sourceFormat = chart.sourceFormat;
  if (sourceFormat !== 'bms' && sourceFormat !== 'bmson') {
    throw new PlaylogParseError(`chart.sourceFormat: expected 'bms' | 'bmson'`);
  }
  const judgeRankRaw = expectRecord(chart.judgeRank, 'chart.judgeRank');
  const judgeRank: PlaylogJudgeRank = {
    percent: expectFiniteNumber(judgeRankRaw.percent, 'chart.judgeRank.percent'),
    sourceRank: optionalFiniteNumber(judgeRankRaw.sourceRank, 'chart.judgeRank.sourceRank'),
    sourceExRank: optionalFiniteNumber(judgeRankRaw.sourceExRank, 'chart.judgeRank.sourceExRank'),
    timeline: parseJudgeRankTimeline(judgeRankRaw.timeline),
  };
  if (judgeRank.sourceRank === undefined) delete judgeRank.sourceRank;
  if (judgeRank.sourceExRank === undefined) delete judgeRank.sourceExRank;
  if (judgeRank.timeline === undefined) delete judgeRank.timeline;

  const notesRaw = chart.notes;
  if (!Array.isArray(notesRaw)) {
    throw new PlaylogParseError('chart.notes: expected an array');
  }
  const notes = notesRaw.map((note, index) => parseNote(note, index));

  const lnMode = chart.lnMode;
  if (lnMode !== 1 && lnMode !== 2 && lnMode !== 3) {
    throw new PlaylogParseError('chart.lnMode: expected 1 | 2 | 3');
  }

  const parsed: PlaylogChart = {
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

function parseJudgeRankTimeline(value: unknown): PlaylogJudgeRank['timeline'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new PlaylogParseError('chart.judgeRank.timeline: expected an array');
  }
  return value.map((entry, index) => {
    const record = expectRecord(entry, `chart.judgeRank.timeline[${index}]`);
    return {
      timeUs: expectFiniteNumber(record.timeUs, `chart.judgeRank.timeline[${index}].timeUs`),
      exRankValue: expectFiniteNumber(record.exRankValue, `chart.judgeRank.timeline[${index}].exRankValue`),
    };
  });
}

const PLAYLOG_NOTE_TYPES: ReadonlySet<string> = new Set(['normal', 'long', 'mine', 'invisible', 'freezone']);

function parseNote(value: unknown, index: number): PlaylogNote {
  const record = expectRecord(value, `chart.notes[${index}]`);
  const type = record.type;
  if (typeof type !== 'string' || !PLAYLOG_NOTE_TYPES.has(type)) {
    throw new PlaylogParseError(`chart.notes[${index}].type: expected one of ${[...PLAYLOG_NOTE_TYPES].join(' | ')}`);
  }
  const note: PlaylogNote = {
    id: expectFiniteNumber(record.id, `chart.notes[${index}].id`),
    channel: expectString(record.channel, `chart.notes[${index}].channel`),
    type: type as PlaylogNoteType,
    timeUs: expectFiniteNumber(record.timeUs, `chart.notes[${index}].timeUs`),
  };
  const endTimeUs = optionalFiniteNumber(record.endTimeUs, `chart.notes[${index}].endTimeUs`);
  if (endTimeUs !== undefined) note.endTimeUs = endTimeUs;
  if (record.lnMode !== undefined) {
    if (record.lnMode !== 1 && record.lnMode !== 2 && record.lnMode !== 3) {
      throw new PlaylogParseError(`chart.notes[${index}].lnMode: expected 1 | 2 | 3`);
    }
    note.lnMode = record.lnMode;
  }
  const damage = optionalFiniteNumber(record.damage, `chart.notes[${index}].damage`);
  if (damage !== undefined) note.damage = damage;
  return note;
}

function parseInputs(value: unknown): PlaylogInputEvent[] {
  if (!Array.isArray(value)) {
    throw new PlaylogParseError('inputs: expected an array');
  }
  return value.map((entry, index) => {
    const record = expectRecord(entry, `inputs[${index}]`);
    const action = record.action;
    if (action !== 'down' && action !== 'up') {
      throw new PlaylogParseError(`inputs[${index}].action: expected 'down' | 'up'`);
    }
    const channelsRaw = record.channels;
    if (!Array.isArray(channelsRaw) || channelsRaw.some((channel) => typeof channel !== 'string')) {
      throw new PlaylogParseError(`inputs[${index}].channels: expected string[]`);
    }
    const event: PlaylogInputEvent = {
      seq: expectFiniteNumber(record.seq, `inputs[${index}].seq`),
      timeUs: expectFiniteNumber(record.timeUs, `inputs[${index}].timeUs`),
      action,
      channels: channelsRaw as string[],
    };
    if (record.tokens !== undefined) {
      if (!Array.isArray(record.tokens) || record.tokens.some((token) => typeof token !== 'string')) {
        throw new PlaylogParseError(`inputs[${index}].tokens: expected string[]`);
      }
      event.tokens = record.tokens as string[];
    }
    return event;
  });
}

const GAUGE_TYPES: ReadonlySet<string> = new Set(['GROOVE', 'HARD', 'DEATH', 'EASY']);

function parsePlay(play: Record<string, unknown>): PlaylogPlay {
  const mode = play.mode;
  if (mode !== 'manual' && mode !== 'auto') {
    throw new PlaylogParseError(`play.mode: expected 'manual' | 'auto'`);
  }
  const gauge = play.gauge;
  if (typeof gauge !== 'string' || !GAUGE_TYPES.has(gauge)) {
    throw new PlaylogParseError(`play.gauge: expected one of ${[...GAUGE_TYPES].join(' | ')}`);
  }
  const parsed: PlaylogPlay = {
    mode,
    autoScratch: play.autoScratch === true,
    gauge: gauge as GrooveGaugeType,
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
    if (play.judgeRuleset !== 'lr2' && play.judgeRuleset !== 'beatoraja' && play.judgeRuleset !== 'iidx') {
      throw new PlaylogParseError(`play.judgeRuleset: expected 'lr2' | 'beatoraja' | 'iidx'`);
    }
    parsed.judgeRuleset = play.judgeRuleset;
  }
  if (play.randomDraws !== undefined) {
    parsed.randomDraws = parseRandomDraws(play.randomDraws);
  }
  if (play.aborted !== undefined) parsed.aborted = play.aborted === true;
  if (play.abortedAtUs !== undefined) parsed.abortedAtUs = expectFiniteNumber(play.abortedAtUs, 'play.abortedAtUs');
  if (play.endOnFailure !== undefined) parsed.endOnFailure = play.endOnFailure === true;
  if (play.course !== undefined) parsed.course = parseCourseStage(expectRecord(play.course, 'play.course'));
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

function parseCourseStage(course: Record<string, unknown>): PlaylogCourseStage {
  if (typeof course.kind !== 'string' || !COURSE_KINDS.has(course.kind)) {
    throw new PlaylogParseError(`play.course.kind: expected 'grade' | 'expert' | 'nonstop'`);
  }
  const parsed: PlaylogCourseStage = { kind: course.kind as RulesetCourseKind };
  if (course.gaugeSet !== undefined) {
    if (typeof course.gaugeSet !== 'string' || !COURSE_GAUGE_SETS.has(course.gaugeSet)) {
      throw new PlaylogParseError(`play.course.gaugeSet: expected 'lr2' | '5k' | '7k' | '9k' | '24k'`);
    }
    parsed.gaugeSet = course.gaugeSet as CourseGaugeSet;
  }
  if (course.judge !== undefined) {
    if (typeof course.judge !== 'string' || !COURSE_JUDGE_CONSTRAINTS.has(course.judge)) {
      throw new PlaylogParseError(`play.course.judge: expected 'no-good' | 'no-great'`);
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

const RANDOM_DRAW_COMMANDS: ReadonlySet<string> = new Set(['RANDOM', 'SETRANDOM', 'SWITCH', 'SETSWITCH']);

function parseRandomDraws(value: unknown): RandomDraw[] {
  if (!Array.isArray(value)) {
    throw new PlaylogParseError('play.randomDraws: expected an array');
  }
  return value.map((entry: unknown, index): RandomDraw => {
    const path = `play.randomDraws[${index}]`;
    const draw = expectRecord(entry, path);
    const { command, range, value: drawn } = draw;
    if (typeof command !== 'string' || !RANDOM_DRAW_COMMANDS.has(command)) {
      throw new PlaylogParseError(`${path}.command: expected 'RANDOM' | 'SETRANDOM' | 'SWITCH' | 'SETSWITCH'`);
    }
    if (typeof range !== 'number' || !Number.isInteger(range) || range < 1) {
      throw new PlaylogParseError(`${path}.range: expected a positive integer`);
    }
    const fixed = command === 'SETRANDOM' || command === 'SETSWITCH';
    if (typeof drawn !== 'number' || !Number.isInteger(drawn) || drawn < 1 || (fixed ? range !== 1 : drawn > range)) {
      throw new PlaylogParseError(`${path}.value: expected an integer in 1..range (range 1 for a #SET… line)`);
    }
    return { command: command as RandomDraw['command'], range, value: drawn };
  });
}
