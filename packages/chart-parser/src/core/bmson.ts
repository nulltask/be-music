import type {
  BeMusicJSON,
  BeMusicPosition,
  BmsonBPMEventEntry,
  BmsonKeyChannelEntry,
  BmsonMineChannelEntry,
  BmsonMineNoteEntry,
  BmsonScrollEventEntry,
  BmsonSoundChannelEntry,
  BmsonSoundNoteEntry,
  BmsonStopEventEntry,
} from '@be-music/chart-source';
import { resolveBmsonModeHintLayout } from '@be-music/chart-model';
import { normalizeSortedUniqueNonNegativeIntegers } from '@be-music/shared-utils/core';

export interface BmsonInfo {
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  subartists?: unknown;
  chart_name?: string;
  level?: number;
  init_bpm?: number;
  resolution?: number;
  mode_hint?: string;
  judge_rank?: number;
  total?: number;
  ln_type?: number;
  back_image?: string;
  eyecatch_image?: string;
  title_image?: string;
  banner_image?: string;
  preview_music?: string;
}

interface BmsonLine {
  y: number;
}

export interface BmsonBPMEvent {
  y: number;
  bpm: number;
}

export interface BmsonStopEvent {
  y: number;
  duration: number;
}

/** beatoraja extension — from pulse `y` on, the lane scrolls at `rate` times its normal speed. */
export interface BmsonScrollEvent {
  y: number;
  rate: number;
}

export interface BmsonSoundNote {
  x?: number;
  y: number;
  l?: number;
  c?: boolean;
  up?: boolean;
}

export interface BmsonSoundChannel {
  name: string;
  notes?: BmsonSoundNote[];
}

/**
 * beatoraja's bmson extensions `key_channels` (hidden notes) and `mine_channels` (mines) share one note shape: a lane
 * `x`, a pulse `y` and, read on mines only, a gauge `damage` (0..100). The channel `name` is the sample the note plays
 * — the hidden note's keysound, or the mine's explosion.
 */
export interface BmsonExtensionNote {
  x?: number;
  y: number;
  damage?: number;
}

export interface BmsonExtensionChannel {
  name: string;
  notes?: BmsonExtensionNote[];
}

export interface BmsonDocument {
  version?: string;
  info?: BmsonInfo;
  lines?: Array<number | BmsonLine>;
  resolution?: number;
  bpm_events?: BmsonBPMEvent[];
  stop_events?: BmsonStopEvent[];
  /** beatoraja extension — scroll speed changes, read as BMS `#SCROLLxx` on channel `SC`. */
  scroll_events?: BmsonScrollEvent[];
  sound_channels?: BmsonSoundChannel[];
  /**
   * beatoraja extension — hidden (invisible) note channels. Each note maps onto a BMS invisible channel (`3x` for 1P,
   * `4x` for 2P) using the same `mode_hint` lane convention `sound_channels` uses for playable lanes.
   */
  key_channels?: BmsonExtensionChannel[];
  /**
   * beatoraja extension — mine channels. Each note maps onto a BMS landmine channel (`Dx` for 1P, `Ex` for 2P) the
   * same way, keeping its `damage`.
   */
  mine_channels?: BmsonExtensionChannel[];
  bga?: {
    bga_sequence?: Array<{ id: number; sequence: Array<{ time: number; id?: number }> }>;
    bga_header?: Array<{ id: number; name: string }>;
    bga_events?: Array<{ y: number; id?: number; id_set?: number[]; condition?: string; interval?: number }>;
    layer_events?: Array<{ y: number; id?: number; id_set?: number[]; condition?: string; interval?: number }>;
    poor_events?: Array<{ y: number; id?: number; id_set?: number[]; condition?: string; interval?: number }>;
  };
}

interface MeasurePositionWithFraction {
  measure: number;
  position: BeMusicPosition;
}

/** Lane codes of a `<side><lane>` BMS channel, left to right: the classic `1..9` columns, then the extended `A..Z`. */
const BMS_LANE_CODES = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * bmson 1.0.0 spec — when a chart omits / blanks `mode_hint`, the default is `beat-7k` ("Default value is 'beat-7k'").
 * Applied centrally in {@link buildBmsonLaneMap} so the default lane routing follows the spec instead of falling
 * through onto the unknown-hint positional fallback (which used to map x=6/7 onto `16` / `17` because those digits came
 * next in numeric order).
 */
const BMSON_DEFAULT_MODE_HINT = 'beat-7k';

/**
 * Resolves the `x` → BMS channel mapping for a chart's playable lanes. Order of resolution:
 *
 * 1. `mode_hint` blank / undefined → spec default `beat-7k` (per bmson 1.0.0).
 * 2. Canonical That-Which-Must-Not-Be-Named / Pop'n / keyboard hint → authoritative table. Unknown hints (BmsONE's single-player
 *    `keyboard-48k` among them, which is NOT the two-player `keyboard-24k-double`) take step 4.
 * 3. `generic-Nkeys` template → left-to-right positional map sized to N keys.
 * 4. Anything else is an unknown hint. When every `x` in use fits the `beat-7k` table, it is read as `beat-7k`, as
 *    beatoraja (with a warning), Qwilight and Bemuse read it. A chart with lanes past that table (BmsONE's
 *    `keyboard-36k` / `48k` / `60k`) would lose them to BGM there, so it keeps the positional map over its `x` values
 *    instead (be-music decision, docs/format-compat.md §3.2).
 */
export function buildBmsonLaneMap(soundChannels: BmsonSoundChannel[], modeHint?: string): Map<number, string> {
  const trimmedHint = typeof modeHint === 'string' ? modeHint.trim() : '';
  const effectiveHint = trimmedHint.length > 0 ? trimmedHint : BMSON_DEFAULT_MODE_HINT;
  // The fixed lane tables (the bmson spec's hints and beatoraja's keyboard hints) come from the play-mode table in
  // `@be-music/chart-model`, which the stringifier writes `x` from too.
  const hinted = resolveBmsonModeHintLayout(effectiveHint);
  if (hinted) {
    return new Map(hinted.channelByX);
  }
  const xValues = new Set<number>();
  for (const soundChannel of soundChannels) {
    for (const note of soundChannel.notes ?? []) {
      if (Number.isFinite(note.x)) {
        const lane = Math.floor(note.x!);
        if (lane > 0) {
          xValues.add(lane);
        }
      }
    }
  }

  const beat7k = resolveBmsonModeHintLayout(BMSON_DEFAULT_MODE_HINT)!;
  if ([...xValues].every((x) => beat7k.channelByX.has(x))) {
    return new Map(beat7k.channelByX);
  }

  const sorted = [...xValues].sort((left, right) => left - right);
  const map = new Map<number, string>();
  for (let index = 0; index < sorted.length; index += 1) {
    map.set(sorted[index], laneIndexToChannel(index));
  }
  return map;
}

/**
 * Converts a BMS playable lane channel into its matching BMS landmine channel — `Dx` for 1P (`1X` keys) and `Ex` for 2P
 * (`2X` keys). Used to route bmson `mine_channels` notes through the same lane resolver as playable notes while keeping
 * them tagged as mines downstream.
 */
export function bmsPlayableChannelToLandmineChannel(channel: string): string | undefined {
  if (channel.length !== 2) return undefined;
  const side = channel[0];
  const lane = channel[1];
  if (side === '1') return `D${lane}`;
  if (side === '2') return `E${lane}`;
  return undefined;
}

/**
 * Converts a BMS playable lane channel into its matching BMS invisible channel — `3x` for 1P (`1X` keys) and `4x` for
 * 2P (`2X` keys). Used to route bmson `key_channels` (hidden notes) through the same lane resolver as playable notes.
 */
export function bmsPlayableChannelToInvisibleChannel(channel: string): string | undefined {
  if (channel.length !== 2) return undefined;
  const side = channel[0];
  const lane = channel[1];
  if (side === '1') return `3${lane}`;
  if (side === '2') return `4${lane}`;
  return undefined;
}

export function resolveBmsonResolution(document: BmsonDocument): number {
  // `info.resolution`, else the root-level `resolution` older writers emit, else the spec default 240.
  return normalizeBmsonResolution(document.info?.resolution) ?? normalizeBmsonResolution(document.resolution) ?? 240;
}

/**
 * Per the bmson 1.0.0 spec, 0 / `null` / missing means the default (`undefined` here) and a negative resolution is read
 * as its absolute value (beatoraja uses 240 for any value <= 0 instead).
 */
function normalizeBmsonResolution(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const resolution = Math.floor(Math.abs(value));
  return resolution > 0 ? resolution : undefined;
}

export function normalizeBmsonLines(lines: unknown): number[] {
  if (!Array.isArray(lines)) {
    return [];
  }

  const values: number[] = [];
  for (const line of lines) {
    if (typeof line === 'number' && Number.isFinite(line)) {
      values.push(Math.max(0, Math.floor(line)));
      continue;
    }
    if (!line || typeof line !== 'object') {
      continue;
    }
    const y = (line as Record<string, unknown>).y;
    if (typeof y === 'number' && Number.isFinite(y)) {
      values.push(Math.max(0, Math.floor(y)));
    }
  }

  const sorted = normalizeSortedUniqueNonNegativeIntegers(values);
  if (sorted.length === 0) {
    return [];
  }
  if (sorted[0] !== 0) {
    sorted.unshift(0);
  }
  return sorted;
}

export function normalizeBmsonBPMEvents(input: unknown): BmsonBPMEventEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const events: BmsonBPMEventEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.y !== 'number' ||
      !Number.isFinite(raw.y) ||
      typeof raw.bpm !== 'number' ||
      !Number.isFinite(raw.bpm)
    ) {
      continue;
    }
    if (raw.bpm <= 0) {
      continue;
    }
    events.push({
      y: Math.max(0, Math.round(raw.y)),
      bpm: raw.bpm,
    });
  }
  return events;
}

export function normalizeBmsonStopEvents(input: unknown): BmsonStopEventEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const events: BmsonStopEventEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.y !== 'number' ||
      !Number.isFinite(raw.y) ||
      typeof raw.duration !== 'number' ||
      !Number.isFinite(raw.duration)
    ) {
      continue;
    }
    if (raw.duration <= 0) {
      continue;
    }
    events.push({
      y: Math.max(0, Math.round(raw.y)),
      duration: raw.duration,
    });
  }
  return events;
}

/**
 * beatoraja extension `scroll_events`. jbms-parser accepts any `rate` (a zero rate stops the lane, a negative one
 * reverses it), so only entries without a finite `y` or `rate` are dropped.
 */
export function normalizeBmsonScrollEvents(input: unknown): BmsonScrollEventEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const events: BmsonScrollEventEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.y !== 'number' ||
      !Number.isFinite(raw.y) ||
      typeof raw.rate !== 'number' ||
      !Number.isFinite(raw.rate)
    ) {
      continue;
    }
    events.push({
      y: Math.max(0, Math.round(raw.y)),
      rate: raw.rate,
    });
  }
  return events;
}

export function normalizeBmsonSoundChannels(input: unknown): BmsonSoundChannelEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const channels: BmsonSoundChannelEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.name !== 'string') {
      continue;
    }
    channels.push({
      name: raw.name,
      notes: normalizeBmsonSoundNotes(raw.notes),
    });
  }
  return channels;
}

export function normalizeBmsonKeyChannels(input: unknown): BmsonKeyChannelEntry[] {
  return normalizeBmsonExtensionChannels(input, false);
}

export function normalizeBmsonMineChannels(input: unknown): BmsonMineChannelEntry[] {
  return normalizeBmsonExtensionChannels(input, true);
}

function normalizeBmsonExtensionChannels(input: unknown, keepDamage: boolean): BmsonMineChannelEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const channels: BmsonMineChannelEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.name !== 'string') {
      continue;
    }
    channels.push({
      name: raw.name,
      notes: normalizeBmsonExtensionNotes(raw.notes, keepDamage),
    });
  }
  return channels;
}

export function createMeasureLengthsFromBmsonLines(
  lines: number[],
  resolution: number,
): Array<{ index: number; length: number }> {
  if (lines.length < 2) {
    return [];
  }

  const ticksPerMeasure = Math.max(1, Math.floor(resolution * 4));
  const measures: Array<{ index: number; length: number }> = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const ticks = Math.max(1, lines[index + 1] - lines[index]);
    const length = ticks / ticksPerMeasure;
    if (Math.abs(length - 1) < 1e-9) {
      continue;
    }
    measures.push({
      index,
      length,
    });
  }
  return measures;
}

export function createBmsonPositionResolver(
  resolution: number,
  lines: number[],
): (y: number) => MeasurePositionWithFraction {
  const ticksPerMeasure = Math.max(1, Math.floor(resolution * 4));
  return (y: number) => {
    const normalizedY = Math.max(0, Math.round(y));
    if (lines.length < 2) {
      const measure = Math.max(0, Math.floor(normalizedY / ticksPerMeasure));
      const positionNumerator = normalizedY % ticksPerMeasure;
      return {
        measure,
        position: [positionNumerator, ticksPerMeasure],
      };
    }

    const lineIndex = findLastLineIndex(lines, normalizedY);
    const lastIndex = lines.length - 1;
    if (lineIndex < lastIndex) {
      const start = lines[lineIndex];
      const end = lines[lineIndex + 1];
      const denominator = Math.max(1, end - start);
      const numerator = Math.max(0, Math.min(denominator - 1, normalizedY - start));
      return {
        measure: lineIndex,
        position: [numerator, denominator],
      };
    }

    const start = lines[lastIndex];
    const offset = normalizedY - start;
    const measureOffset = Math.floor(offset / ticksPerMeasure);
    const numerator = offset % ticksPerMeasure;
    return {
      measure: lastIndex + measureOffset,
      position: [numerator, ticksPerMeasure],
    };
  };
}

/**
 * beatoraja bmson extension — long-note type values are `1` (LN), `2` (CN), `3` (HCN). Anything else (including the
 * spec-absent `0`) is treated as "unspecified" so the consumer falls back to the chart-level / player default.
 */
function normalizeBmsonLongNoteType(value: unknown): 1 | 2 | 3 | undefined {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  return undefined;
}

export function normalizeBmsonInfoForIR(info: BmsonInfo, resolution: number): BeMusicJSON['bmson']['info'] {
  const normalized: BeMusicJSON['bmson']['info'] = {};
  copyIfString(normalized, 'title', info.title);
  copyIfString(normalized, 'subtitle', info.subtitle);
  copyIfString(normalized, 'artist', info.artist);
  copyIfString(normalized, 'genre', info.genre);
  copyIfString(normalized, 'chartName', info.chart_name);
  copyIfString(normalized, 'modeHint', info.mode_hint);
  copyIfString(normalized, 'backImage', info.back_image);
  copyIfString(normalized, 'eyecatchImage', info.eyecatch_image);
  copyIfString(normalized, 'titleImage', info.title_image);
  copyIfString(normalized, 'bannerImage', info.banner_image);
  copyIfString(normalized, 'previewMusic', info.preview_music);

  const subartists = normalizeBmsonSubartists(info.subartists);
  if (subartists !== undefined) {
    normalized.subartists = subartists;
  }

  // bmson 1.0.0 spec — `level` is an `unsigned long` and "must be ≥ 0. Negative values may be regarded as invalid by a
  // player." We treat the negative case as "invalid → drop the field" rather than silently coerce, so the missing-level
  // fallback (`undefined` → no displayed level) is what the chart's level shows in the UI. Non-integer inputs are
  // floored to honor the spec's `unsigned long` type.
  copyIfNonNegativeInteger(normalized, 'level', info.level);
  copyIfFiniteNumber(normalized, 'initBPM', info.init_bpm);
  // bmson 1.0.0 spec — `judge_rank` describes "the width of judgment window" with the spec text only making sense for
  // positive values ("smaller than 100" / "larger than 100" are framed relative to the player's default; 0 / negative
  // would mean a zero-or-inverted window). Drop the field for non-positive inputs so the consumer falls back to the
  // spec default of 100 rather than producing a nonsensical judge window.
  copyIfPositiveFiniteNumber(normalized, 'judgeRank', info.judge_rank);
  // bmson 1.0.0 spec — `total` "must be ≥ 0. If negative, take the absolute value." Normalizing at parse time keeps the
  // gauge formula (`+TOTAL/N`) on the positive branch and means every downstream consumer (gauge, stringifier,
  // round-trip re-parse) sees the canonical value. `total: 0` is kept as written; the spec says the lifebar then doesn't
  // increase, but the player's rulesets follow beatoraja and treat `total <= 0` as 100 % of their default TOTAL.
  copyIfFiniteNumberAbs(normalized, 'total', info.total);
  // beatoraja bmson extension — `info.ln_type` picks the chart-wide long-note type (1: LN, 2: CN, 3: HCN). Per-note
  // `t` entries override it downstream.
  const lnType = normalizeBmsonLongNoteType(info.ln_type);
  if (lnType !== undefined) {
    normalized.lnType = lnType;
  }

  if (resolution > 0) {
    normalized.resolution = resolution;
  }

  return normalized;
}

export function normalizeBmsonBGAForIR(input: BmsonDocument['bga'] | undefined): BeMusicJSON['bmson']['bga'] {
  if (!input || typeof input !== 'object') {
    return {
      header: [],
      events: [],
      layerEvents: [],
      poorEvents: [],
    };
  }
  return {
    ...(input.bga_sequence !== undefined ? { sequences: normalizeBmsonBGASequences(input.bga_sequence) } : {}),
    header: normalizeBmsonBGAHeaderEntries(input.bga_header),
    events: normalizeBmsonBGAEventEntries(input.bga_events),
    layerEvents: normalizeBmsonBGAEventEntries(input.layer_events),
    poorEvents: normalizeBmsonBGAEventEntries(input.poor_events),
  };
}

export function normalizeBmsonExtensions(input: unknown): BeMusicJSON['bmson'] {
  const normalized: BeMusicJSON['bmson'] = {
    info: {},
    bga: {
      header: [],
      events: [],
      layerEvents: [],
      poorEvents: [],
    },
  };
  if (!input || typeof input !== 'object') {
    return normalized;
  }

  const raw = input as Record<string, unknown>;
  if (typeof raw.version === 'string' && raw.version.length > 0) {
    normalized.version = raw.version;
  }

  normalized.info = normalizeBmsonInfoFromIR(raw.info);
  normalized.bga = normalizeBmsonBGAFromIR(raw.bga);
  if (raw.barlinesSuppressed === true) {
    normalized.barlinesSuppressed = true;
  }

  return normalized;
}

function laneIndexToChannel(index: number): string {
  const first = BMS_LANE_CODES[Math.floor(index / BMS_LANE_CODES.length)] ?? '1';
  const second = BMS_LANE_CODES[index % BMS_LANE_CODES.length];
  return `${first}${second}`;
}

function normalizeBmsonBGAHeaderEntries(input: unknown): BeMusicJSON['bmson']['bga']['header'] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: BeMusicJSON['bmson']['bga']['header'] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const id = normalizePositiveInteger(raw.id);
    if (id === undefined || typeof raw.name !== 'string') {
      continue;
    }
    entries.push({
      id,
      name: raw.name,
    });
  }
  return entries;
}

function normalizeBmsonBGAEventEntries(input: unknown): BeMusicJSON['bmson']['bga']['events'] {
  if (!Array.isArray(input)) return [];
  const entries: BeMusicJSON['bmson']['bga']['events'] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = normalizePositiveInteger(raw.id);
    const rawIdSet = raw.idSet ?? raw.id_set;
    const idSet = Array.isArray(rawIdSet)
      ? rawIdSet.map(normalizePositiveInteger).filter((value): value is number => value !== undefined)
      : undefined;
    const y = normalizePositiveInteger(raw.y);
    if (y === undefined || (id === undefined && idSet === undefined)) continue;
    const interval = normalizePositiveInteger(raw.interval);
    entries.push({
      y,
      id: id ?? 0,
      ...(idSet !== undefined ? { idSet } : {}),
      ...(typeof raw.condition === 'string' ? { condition: raw.condition } : {}),
      ...(interval !== undefined ? { interval } : {}),
    });
  }
  return entries;
}

function normalizeBmsonBGASequences(input: unknown): NonNullable<BeMusicJSON['bmson']['bga']['sequences']> {
  if (!Array.isArray(input)) return [];
  const entries: NonNullable<BeMusicJSON['bmson']['bga']['sequences']> = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = normalizePositiveInteger(raw.id);
    if (id === undefined || !Array.isArray(raw.sequence)) continue;
    const sequence: (typeof entries)[number]['sequence'] = [];
    for (const item of raw.sequence) {
      if (!item || typeof item !== 'object') continue;
      const frame = item as Record<string, unknown>;
      const time = normalizePositiveInteger(frame.time);
      if (time === undefined) continue;
      if (frame.id === undefined || frame.id === -2147483648) {
        sequence.push({ time, ...(frame.id === -2147483648 ? { id: -2147483648 } : {}) });
      } else {
        const id = normalizePositiveInteger(frame.id);
        if (id !== undefined) sequence.push({ time, id });
      }
    }
    entries.push({ id, sequence });
  }
  return entries;
}

function normalizeBmsonSubartists(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const names: string[] = [];
  for (const item of input) {
    if (typeof item === 'string') {
      names.push(canonicalizeSubartistEntry(item));
      continue;
    }
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.name === 'string') {
      names.push(canonicalizeSubartistEntry(raw.name));
    }
  }
  return names;
}

/**
 * bmson 1.0.0 spec SHOULD — "Implementers should trim the spaces before and after `key` and `value` in subartists."
 *
 * Trims each half of the `role:name` form (or just the name when the entry doesn't carry a role) and rejoins so the
 * stored array contains canonicalized strings. Role case is preserved — the consumer-facing helper {@link
 * parseBmsonSubartist} is the one that lower-cases for grouping; we don't want to lose the author's intended
 * capitalization in the IR.
 */
function canonicalizeSubartistEntry(entry: string): string {
  const colon = entry.indexOf(':');
  if (colon < 0) {
    return entry.trim();
  }
  const role = entry.slice(0, colon).trim();
  const name = entry.slice(colon + 1).trim();
  if (role.length === 0) {
    return name;
  }
  return `${role}:${name}`;
}

function normalizeBmsonSoundNotes(input: unknown): BmsonSoundNoteEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const notes: BmsonSoundNoteEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.y !== 'number' || !Number.isFinite(raw.y)) {
      continue;
    }

    const note: BmsonSoundNoteEntry = {
      y: Math.max(0, Math.round(raw.y)),
    };
    if (typeof raw.x === 'number' && Number.isFinite(raw.x)) {
      note.x = Math.floor(raw.x);
    }
    if (typeof raw.l === 'number' && Number.isFinite(raw.l) && raw.l >= 0) {
      note.l = Math.floor(raw.l);
    }
    if (typeof raw.c === 'boolean') {
      note.c = raw.c;
    }
    if (typeof raw.up === 'boolean') note.up = raw.up;
    const noteType = normalizeBmsonLongNoteType(raw.t);
    if (noteType !== undefined) {
      note.t = noteType;
    }
    notes.push(note);
  }
  return notes;
}

function normalizeBmsonExtensionNotes(input: unknown, keepDamage: boolean): BmsonMineNoteEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const notes: BmsonMineNoteEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.y !== 'number' || !Number.isFinite(raw.y)) {
      continue;
    }

    const note: BmsonMineNoteEntry = {
      y: Math.max(0, Math.round(raw.y)),
    };
    if (typeof raw.x === 'number' && Number.isFinite(raw.x)) {
      note.x = Math.floor(raw.x);
    }
    if (keepDamage && typeof raw.damage === 'number' && Number.isFinite(raw.damage) && raw.damage >= 0) {
      note.damage = raw.damage;
    }
    notes.push(note);
  }
  return notes;
}

function copyIfString<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (typeof value === 'string') {
    (target as Record<string, unknown>)[key] = value;
  }
}

function copyIfFiniteNumber<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    (target as Record<string, unknown>)[key] = value;
  }
}

/**
 * Same as {@link copyIfFiniteNumber} but applies `Math.abs` so spec fields that say "if negative, take the absolute
 * value" (notably `info.total`) get normalized at parse time. Keeps `0` intact so consumers see the value as written.
 */
function copyIfFiniteNumberAbs<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    (target as Record<string, unknown>)[key] = Math.abs(value);
  }
}

/**
 * Copies a finite numeric value as a non-negative integer, dropping the field entirely when the input is negative or
 * non-finite. Matches the bmson 1.0.0 spec's `unsigned long` fields (notably `info.level`) which require `≥ 0` and the
 * spec's MAY clause that lets implementations regard negatives as invalid. Non-integer inputs are floored.
 */
function copyIfNonNegativeInteger<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return;
  }
  const floored = Math.floor(value);
  if (floored < 0) {
    return;
  }
  (target as Record<string, unknown>)[key] = floored;
}

/**
 * Copies a finite numeric value only when it is strictly positive (`> 0`). Matches bmson 1.0.0 spec fields whose
 * semantics only make sense for positive values — notably `info.judge_rank`, where the spec text ("smaller than 100" /
 * "larger than 100") frames the value as a width relative to the player's default. A `0` or negative input would imply
 * a zero-width or inverted judgement window, both nonsensical; dropping the field lets the consumer fall back to the
 * spec default of 100.
 */
function copyIfPositiveFiniteNumber<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return;
  }
  (target as Record<string, unknown>)[key] = value;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return undefined;
  }
  return normalized;
}

function normalizeBmsonInfoFromIR(input: unknown): BeMusicJSON['bmson']['info'] {
  const info: BeMusicJSON['bmson']['info'] = {};
  if (!input || typeof input !== 'object') {
    return info;
  }

  const raw = input as Record<string, unknown>;
  if (raw.totalUnit === 'absolute' || raw.totalUnit === 'percent') info.totalUnit = raw.totalUnit;
  copyIfString(info, 'title', raw.title);
  copyIfString(info, 'subtitle', raw.subtitle);
  copyIfString(info, 'artist', raw.artist);
  copyIfString(info, 'genre', raw.genre);
  copyIfString(info, 'chartName', raw.chartName ?? raw.chart_name);
  copyIfString(info, 'modeHint', raw.modeHint ?? raw.mode_hint);
  copyIfString(info, 'backImage', raw.backImage ?? raw.back_image);
  copyIfString(info, 'eyecatchImage', raw.eyecatchImage ?? raw.eyecatch_image);
  copyIfString(info, 'titleImage', raw.titleImage ?? raw.title_image);
  copyIfString(info, 'bannerImage', raw.bannerImage ?? raw.banner_image);
  copyIfString(info, 'previewMusic', raw.previewMusic ?? raw.preview_music);

  const subartists = normalizeBmsonSubartists(raw.subartists);
  if (subartists !== undefined) {
    info.subartists = subartists;
  }

  // Match `normalizeBmsonInfoForIR`'s spec-compliant unsigned- integer + positive + abs handling for the re-parse path
  // so JSON round-trips don't reintroduce a negative / float level / judge_rank / total.
  copyIfNonNegativeInteger(info, 'level', raw.level);
  copyIfFiniteNumber(info, 'initBPM', raw.initBPM ?? raw.initBpm ?? raw.init_bpm);
  copyIfPositiveFiniteNumber(info, 'judgeRank', raw.judgeRank ?? raw.judge_rank);
  copyIfFiniteNumberAbs(info, 'total', raw.total);
  const lnType = normalizeBmsonLongNoteType(raw.lnType ?? raw.ln_type);
  if (lnType !== undefined) {
    info.lnType = lnType;
  }

  const resolution = normalizePositiveInteger(raw.resolution);
  if (resolution !== undefined && resolution > 0) {
    info.resolution = resolution;
  }

  return info;
}

function normalizeBmsonBGAFromIR(input: unknown): BeMusicJSON['bmson']['bga'] {
  if (!input || typeof input !== 'object') {
    return {
      header: [],
      events: [],
      layerEvents: [],
      poorEvents: [],
    };
  }
  const raw = input as Record<string, unknown>;
  return {
    ...((raw.sequences ?? raw.bga_sequence) !== undefined
      ? { sequences: normalizeBmsonBGASequences(raw.sequences ?? raw.bga_sequence) }
      : {}),
    header: normalizeBmsonBGAHeaderEntries(raw.header ?? raw.bga_header),
    events: normalizeBmsonBGAEventEntries(raw.events ?? raw.bga_events),
    layerEvents: normalizeBmsonBGAEventEntries(raw.layerEvents ?? raw.layer_events),
    poorEvents: normalizeBmsonBGAEventEntries(raw.poorEvents ?? raw.poor_events),
  };
}

function findLastLineIndex(lines: number[], y: number): number {
  let low = 0;
  let high = lines.length - 1;
  let answer = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid] <= y) {
      answer = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return answer;
}
