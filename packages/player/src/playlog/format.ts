import type { GrooveGaugeType } from '../core/groove-gauge.ts';
import type { LongNoteMode } from '../playable-notes.ts';

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
export const BE_MUSIC_PLAYLOG_VERSION = 1;

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
  /** Lowercase-hex SHA-256 of the source chart FILE bytes — the primary key for matching a log back to its chart. */
  sha256?: string;
  sourceFormat: 'bms' | 'bmson';
  /** Engine lane display mode (`'7keys'` / `'14keys'` / ... — `resolveLaneDisplayMode` output). */
  laneMode: string;
  /** Raw `#TOTAL` / bmson `info.total`. Omitted when the chart did not specify one — each ruleset applies its own default. */
  total?: number;
  /** Chart-level long-note mode (1: LN / 2: CN / 3: HCN) after `#LNMODE` / `info.ln_type` resolution. */
  lnMode: LongNoteMode;
  judgeRank: PlaylogJudgeRank;
  /** Number of scorable notes (TOTAL / EX-SCORE denominator — mines / invisibles / freezones excluded). */
  noteCount: number;
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
  /** True when the play ended early (ESC). The input stream stops at the abort point. */
  aborted?: boolean;
  /** Lossless bag for host-specific settings that don't affect simulation (hi-speed, skin, ...). */
  native?: Record<string, string | number | boolean | null>;
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
  /** Ruleset identifier + revision (e.g. `'lr2/1'`, `'beatoraja/1'`, `'iidx/1'`, `'be-music/native'`). */
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
}

export interface BeMusicPlaylog {
  format: typeof BE_MUSIC_PLAYLOG_FORMAT;
  version: typeof BE_MUSIC_PLAYLOG_VERSION;
  /** ISO 8601 timestamp of the recording, when the recorder had a clock available. */
  createdAt?: string;
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

export class PlaylogParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaylogParseError';
  }
}

/**
 * Parses (and defensively validates) a serialized playlog. Accepts either the JSON text or an already-parsed
 * value. Throws {@link PlaylogParseError} with a field-path message on structural problems; unknown extra fields
 * are preserved-by-ignoring so future minor additions stay readable.
 */
export function parsePlaylog(source: string | unknown): BeMusicPlaylog {
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
  if (root.version !== BE_MUSIC_PLAYLOG_VERSION) {
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

  return {
    format: BE_MUSIC_PLAYLOG_FORMAT,
    version: BE_MUSIC_PLAYLOG_VERSION,
    createdAt: optionalString(root.createdAt, 'createdAt'),
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
    sha256: optionalString(chart.sha256, 'chart.sha256'),
    sourceFormat,
    laneMode: expectString(chart.laneMode, 'chart.laneMode'),
    total: optionalFiniteNumber(chart.total, 'chart.total'),
    lnMode,
    judgeRank,
    noteCount: expectFiniteNumber(chart.noteCount, 'chart.noteCount'),
    notes,
  };
  for (const key of ['title', 'subtitle', 'artist', 'genre', 'sha256', 'total'] as const) {
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
  if (play.aborted !== undefined) parsed.aborted = play.aborted === true;
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

function parseResults(results: Record<string, unknown>): Record<string, PlaylogRulesetResult> {
  const parsed: Record<string, PlaylogRulesetResult> = {};
  for (const [key, raw] of Object.entries(results)) {
    const record = expectRecord(raw, `results.${key}`);
    const judge = expectRecord(record.judge, `results.${key}.judge`);
    const gauge = expectRecord(record.gauge, `results.${key}.gauge`);
    const result: PlaylogRulesetResult = {
      ruleset: expectString(record.ruleset, `results.${key}.ruleset`),
      judge: {
        pgreat: expectFiniteNumber(judge.pgreat, `results.${key}.judge.pgreat`),
        great: expectFiniteNumber(judge.great, `results.${key}.judge.great`),
        good: expectFiniteNumber(judge.good, `results.${key}.judge.good`),
        bad: expectFiniteNumber(judge.bad, `results.${key}.judge.bad`),
        poor: expectFiniteNumber(judge.poor, `results.${key}.judge.poor`),
        emptyPoor: expectFiniteNumber(judge.emptyPoor, `results.${key}.judge.emptyPoor`),
      },
      fast: expectFiniteNumber(record.fast, `results.${key}.fast`),
      slow: expectFiniteNumber(record.slow, `results.${key}.slow`),
      exScore: expectFiniteNumber(record.exScore, `results.${key}.exScore`),
      noteCount: expectFiniteNumber(record.noteCount, `results.${key}.noteCount`),
      maxCombo: expectFiniteNumber(record.maxCombo, `results.${key}.maxCombo`),
      gauge: {
        type: expectString(gauge.type, `results.${key}.gauge.type`),
        final: expectFiniteNumber(gauge.final, `results.${key}.gauge.final`),
        cleared: gauge.cleared === true,
      },
    };
    if (gauge.failedMidPlay !== undefined) result.gauge.failedMidPlay = gauge.failedMidPlay === true;
    const score = optionalFiniteNumber(record.score, `results.${key}.score`);
    if (score !== undefined) result.score = score;
    const djLevel = optionalString(record.djLevel, `results.${key}.djLevel`);
    if (djLevel !== undefined) result.djLevel = djLevel;
    parsed[key] = result;
  }
  return parsed;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlaylogParseError(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new PlaylogParseError(`${path}: expected a string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return expectString(value, path);
}

function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PlaylogParseError(`${path}: expected a finite number`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  return expectFiniteNumber(value, path);
}
