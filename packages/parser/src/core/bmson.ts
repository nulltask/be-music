import type {
  BeMusicJson,
  BeMusicPosition,
  BmsonBpmEventEntry,
  BmsonKeyChannelEntry,
  BmsonKeyNoteEntry,
  BmsonSoundChannelEntry,
  BmsonSoundNoteEntry,
  BmsonStopEventEntry,
} from '@be-music/json';
import { normalizeSortedUniqueNonNegativeIntegers } from '@be-music/utils/core';

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
  back_image?: string;
  eyecatch_image?: string;
  banner_image?: string;
  preview_music?: string;
}

interface BmsonLine {
  y: number;
}

export interface BmsonBpmEvent {
  y: number;
  bpm: number;
}

export interface BmsonStopEvent {
  y: number;
  duration: number;
}

export interface BmsonSoundNote {
  x?: number;
  y: number;
  l?: number;
  c?: boolean;
}

export interface BmsonSoundChannel {
  name: string;
  notes?: BmsonSoundNote[];
}

/**
 * beatoraja's bmson extension for mine notes. Each note carries a
 * gauge `damage` value (0..100) alongside the same lane / timing
 * fields a regular `sound_channels` note has. The channel `name`
 * is the WAV played on contact (the "explosion sample").
 */
export interface BmsonKeyNote {
  x?: number;
  y: number;
  l?: number;
  c?: boolean;
  damage?: number;
}

export interface BmsonKeyChannel {
  name: string;
  notes?: BmsonKeyNote[];
}

export interface BmsonDocument {
  version?: string;
  info?: BmsonInfo;
  lines?: Array<number | BmsonLine>;
  resolution?: number;
  bpm_events?: BmsonBpmEvent[];
  stop_events?: BmsonStopEvent[];
  sound_channels?: BmsonSoundChannel[];
  /**
   * beatoraja extension — mine note channels. Each channel maps
   * onto a BMS landmine channel (`Dx` for 1P, `Ex` for 2P) using
   * the same `mode_hint` lane convention `sound_channels` uses
   * for playable lanes.
   */
  key_channels?: BmsonKeyChannel[];
  bga?: {
    bga_header?: Array<{ id: number; name: string }>;
    bga_events?: Array<{ y: number; id: number }>;
    layer_events?: Array<{ y: number; id: number }>;
    poor_events?: Array<{ y: number; id: number }>;
  };
}

interface MeasurePositionWithFraction {
  measure: number;
  position: BeMusicPosition;
}

/**
 * bmson `mode_hint` → BMS lane channel maps.
 *
 * Each entry maps a bmson `x` lane index (1-based, left-to-right)
 * onto the BMS playable channel that `extractTimedNotes` and
 * `resolveChartPlayVariant` expect. Without these, the legacy
 * positional fallback would mis-route `beat-7k`'s key 6 / 7 onto
 * scratch (`16`) / FREE ZONE (`17`) — the channel digits that
 * happen to come next in numeric order — instead of `18` / `19`.
 *
 * Keys mirror the bmson 1.0.0 spec's mode hints; values follow the
 * canonical IIDX / Pop'n channel layout that LR2 / beatoraja ship
 * default skins for.
 */
const MODE_HINT_LANE_MAPS: Record<string, ReadonlyMap<number, string>> = {
  'beat-5k': new Map([
    [1, '11'],
    [2, '12'],
    [3, '13'],
    [4, '14'],
    [5, '15'],
    [6, '16'],
  ]),
  'beat-7k': new Map([
    [1, '11'],
    [2, '12'],
    [3, '13'],
    [4, '14'],
    [5, '15'],
    [6, '18'],
    [7, '19'],
    [8, '16'],
  ]),
  'beat-10k': new Map([
    [1, '11'],
    [2, '12'],
    [3, '13'],
    [4, '14'],
    [5, '15'],
    [6, '16'],
    [7, '21'],
    [8, '22'],
    [9, '23'],
    [10, '24'],
    [11, '25'],
    [12, '26'],
  ]),
  'beat-14k': new Map([
    [1, '11'],
    [2, '12'],
    [3, '13'],
    [4, '14'],
    [5, '15'],
    [6, '18'],
    [7, '19'],
    [8, '16'],
    [9, '21'],
    [10, '22'],
    [11, '23'],
    [12, '24'],
    [13, '25'],
    [14, '28'],
    [15, '29'],
    [16, '26'],
  ]),
  'popn-5k': new Map([
    [1, '11'],
    [2, '12'],
    [3, '13'],
    [4, '14'],
    [5, '15'],
  ]),
  // PMS-STD (`#PLAYER 3` Pop'n) routes the right-hand half of the
  // 9-lane bank through the 2P-side `22..25` channels — same
  // convention `play_9.lr2skin` and `lane-layout.ts` use.
  'popn-9k': new Map([
    [1, '11'],
    [2, '12'],
    [3, '13'],
    [4, '14'],
    [5, '15'],
    [6, '22'],
    [7, '23'],
    [8, '24'],
    [9, '25'],
  ]),
};

/**
 * bmson 1.0.0 spec — when a chart omits / blanks `mode_hint`,
 * the default is `beat-7k` ("Default value is 'beat-7k'").
 * Applied centrally in {@link buildBmsonLaneMap} so the default
 * lane routing follows the spec instead of falling through onto
 * the unknown-hint positional fallback (which used to map
 * x=6/7 onto `16` / `17` because those digits came next in
 * numeric order).
 */
const BMSON_DEFAULT_MODE_HINT = 'beat-7k';

/**
 * `generic-Nkeys` template pattern — bmson allows arbitrary key
 * counts via this naming convention ("a layout for a generic
 * symmetrical keyboard layout, ordered left to right"). The
 * numeric prefix is the key count; we route it as a positional
 * left-to-right `x=1..N → 11, 12, …` map.
 */
const BMSON_GENERIC_KEYS_PATTERN = /^generic-(\d+)keys?$/;

/**
 * Resolves the `x` → BMS channel mapping for a chart's playable
 * lanes. Order of resolution:
 *
 * 1. `mode_hint` blank / undefined → spec default `beat-7k`
 *    (per bmson 1.0.0).
 * 2. Canonical IIDX / Pop'n hint → authoritative table.
 * 3. `generic-Nkeys` template → left-to-right positional map
 *    sized to N keys.
 * 4. Anything else → positional fallback over the chart's
 *    actual `x` values (preserves the historical behaviour for
 *    bmson dialects unknown to us).
 */
export function buildBmsonLaneMap(
  soundChannels: BmsonSoundChannel[],
  modeHint?: string,
): Map<number, string> {
  const trimmedHint = typeof modeHint === 'string' ? modeHint.trim() : '';
  const effectiveHint = trimmedHint.length > 0 ? trimmedHint : BMSON_DEFAULT_MODE_HINT;
  const hintedMap = MODE_HINT_LANE_MAPS[effectiveHint];
  if (hintedMap) {
    return new Map(hintedMap);
  }
  const genericMatch = effectiveHint.match(BMSON_GENERIC_KEYS_PATTERN);
  if (genericMatch) {
    const keyCount = Math.max(0, Math.min(99, Number.parseInt(genericMatch[1]!, 10)));
    const map = new Map<number, string>();
    for (let index = 0; index < keyCount; index += 1) {
      map.set(index + 1, laneIndexToChannel(index));
    }
    return map;
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

  const sorted = [...xValues].sort((left, right) => left - right);
  const map = new Map<number, string>();
  for (let index = 0; index < sorted.length; index += 1) {
    map.set(sorted[index], laneIndexToChannel(index));
  }
  return map;
}

/**
 * Converts a BMS playable lane channel into its matching BMS
 * landmine channel — `Dx` for 1P (`1X` keys) and `Ex` for 2P
 * (`2X` keys). Used to route bmson `key_channels` notes through
 * the same lane resolver as playable notes while keeping them
 * tagged as mines downstream.
 */
export function bmsPlayableChannelToLandmineChannel(channel: string): string | undefined {
  if (channel.length !== 2) return undefined;
  const side = channel[0];
  const lane = channel[1];
  if (side === '1') return `D${lane}`;
  if (side === '2') return `E${lane}`;
  return undefined;
}

export function resolveBmsonResolution(document: BmsonDocument): number {
  const infoResolution =
    typeof document.info?.resolution === 'number' && Number.isFinite(document.info.resolution)
      ? Math.floor(document.info.resolution)
      : undefined;
  if (infoResolution && infoResolution > 0) {
    return infoResolution;
  }

  const rootResolution =
    typeof document.resolution === 'number' && Number.isFinite(document.resolution)
      ? Math.floor(document.resolution)
      : undefined;
  if (rootResolution && rootResolution > 0) {
    return rootResolution;
  }

  return 240;
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

export function normalizeBmsonBpmEvents(input: unknown): BmsonBpmEventEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const events: BmsonBpmEventEntry[] = [];
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
  if (!Array.isArray(input)) {
    return [];
  }

  const channels: BmsonKeyChannelEntry[] = [];
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
      notes: normalizeBmsonKeyNotes(raw.notes),
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

export function normalizeBmsonInfoForIr(info: BmsonInfo, resolution: number): BeMusicJson['bmson']['info'] {
  const normalized: BeMusicJson['bmson']['info'] = {};
  copyIfString(normalized, 'title', info.title);
  copyIfString(normalized, 'subtitle', info.subtitle);
  copyIfString(normalized, 'artist', info.artist);
  copyIfString(normalized, 'genre', info.genre);
  copyIfString(normalized, 'chartName', info.chart_name);
  copyIfString(normalized, 'modeHint', info.mode_hint);
  copyIfString(normalized, 'backImage', info.back_image);
  copyIfString(normalized, 'eyecatchImage', info.eyecatch_image);
  copyIfString(normalized, 'bannerImage', info.banner_image);
  copyIfString(normalized, 'previewMusic', info.preview_music);

  const subartists = normalizeBmsonSubartists(info.subartists);
  if (subartists !== undefined) {
    normalized.subartists = subartists;
  }

  copyIfFiniteNumber(normalized, 'level', info.level);
  copyIfFiniteNumber(normalized, 'initBpm', info.init_bpm);
  copyIfFiniteNumber(normalized, 'judgeRank', info.judge_rank);
  // bmson 1.0.0 spec — `total` "must be ≥ 0. If negative, take
  // the absolute value." Normalising at parse time keeps the
  // gauge formula (`+TOTAL/N`) on the positive branch and means
  // every downstream consumer (gauge, stringifier, round-trip
  // re-parse) sees the canonical value. `total: 0` stays
  // semantically meaningful (lifebar doesn't increase, per the
  // same spec section).
  copyIfFiniteNumberAbs(normalized, 'total', info.total);

  if (resolution > 0) {
    normalized.resolution = resolution;
  }

  return normalized;
}

export function normalizeBmsonBgaForIr(input: BmsonDocument['bga'] | undefined): BeMusicJson['bmson']['bga'] {
  if (!input || typeof input !== 'object') {
    return {
      header: [],
      events: [],
      layerEvents: [],
      poorEvents: [],
    };
  }
  return {
    header: normalizeBmsonBgaHeaderEntries(input.bga_header),
    events: normalizeBmsonBgaEventEntries(input.bga_events),
    layerEvents: normalizeBmsonBgaEventEntries(input.layer_events),
    poorEvents: normalizeBmsonBgaEventEntries(input.poor_events),
  };
}

export function normalizeBmsonExtensions(input: unknown): BeMusicJson['bmson'] {
  const normalized: BeMusicJson['bmson'] = {
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

  normalized.info = normalizeBmsonInfoFromIr(raw.info);
  normalized.bga = normalizeBmsonBgaFromIr(raw.bga);
  if (raw.barlinesSuppressed === true) {
    normalized.barlinesSuppressed = true;
  }

  return normalized;
}

function laneIndexToChannel(index: number): string {
  const digits = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const first = digits[Math.floor(index / digits.length)] ?? '1';
  const second = digits[index % digits.length];
  return `${first}${second}`;
}

function normalizeBmsonBgaHeaderEntries(input: unknown): BeMusicJson['bmson']['bga']['header'] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: BeMusicJson['bmson']['bga']['header'] = [];
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

function normalizeBmsonBgaEventEntries(input: unknown): BeMusicJson['bmson']['bga']['events'] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: BeMusicJson['bmson']['bga']['events'] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const id = normalizePositiveInteger(raw.id);
    const y = normalizePositiveInteger(raw.y);
    if (id === undefined || y === undefined) {
      continue;
    }
    entries.push({
      y,
      id,
    });
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
      names.push(canonicaliseSubartistEntry(item));
      continue;
    }
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.name === 'string') {
      names.push(canonicaliseSubartistEntry(raw.name));
    }
  }
  return names;
}

/**
 * bmson 1.0.0 spec SHOULD — "Implementers should trim the spaces
 * before and after `key` and `value` in subartists."
 *
 * Trims each half of the `role:name` form (or just the name when
 * the entry doesn't carry a role) and rejoins so the stored
 * array contains canonicalised strings. Role case is preserved
 * — the consumer-facing helper {@link parseBmsonSubartist} is
 * the one that lower-cases for grouping; we don't want to lose
 * the author's intended capitalisation in the IR.
 */
function canonicaliseSubartistEntry(entry: string): string {
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
    notes.push(note);
  }
  return notes;
}

function normalizeBmsonKeyNotes(input: unknown): BmsonKeyNoteEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const notes: BmsonKeyNoteEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.y !== 'number' || !Number.isFinite(raw.y)) {
      continue;
    }

    const note: BmsonKeyNoteEntry = {
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
    if (typeof raw.damage === 'number' && Number.isFinite(raw.damage) && raw.damage >= 0) {
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
 * Same as {@link copyIfFiniteNumber} but applies `Math.abs` so
 * spec fields that say "if negative, take the absolute value"
 * (notably `info.total`) get normalised at parse time. Keeps
 * `0` intact so its spec-defined "lifebar doesn't increase"
 * meaning is preserved.
 */
function copyIfFiniteNumberAbs<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    (target as Record<string, unknown>)[key] = Math.abs(value);
  }
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

function normalizeBmsonInfoFromIr(input: unknown): BeMusicJson['bmson']['info'] {
  const info: BeMusicJson['bmson']['info'] = {};
  if (!input || typeof input !== 'object') {
    return info;
  }

  const raw = input as Record<string, unknown>;
  copyIfString(info, 'title', raw.title);
  copyIfString(info, 'subtitle', raw.subtitle);
  copyIfString(info, 'artist', raw.artist);
  copyIfString(info, 'genre', raw.genre);
  copyIfString(info, 'chartName', raw.chartName ?? raw.chart_name);
  copyIfString(info, 'modeHint', raw.modeHint ?? raw.mode_hint);
  copyIfString(info, 'backImage', raw.backImage ?? raw.back_image);
  copyIfString(info, 'eyecatchImage', raw.eyecatchImage ?? raw.eyecatch_image);
  copyIfString(info, 'bannerImage', raw.bannerImage ?? raw.banner_image);
  copyIfString(info, 'previewMusic', raw.previewMusic ?? raw.preview_music);

  const subartists = normalizeBmsonSubartists(raw.subartists);
  if (subartists !== undefined) {
    info.subartists = subartists;
  }

  copyIfFiniteNumber(info, 'level', raw.level);
  copyIfFiniteNumber(info, 'initBpm', raw.initBpm ?? raw.init_bpm);
  copyIfFiniteNumber(info, 'judgeRank', raw.judgeRank ?? raw.judge_rank);
  // Match `normalizeBmsonInfoForIr`'s spec-compliant absolute
  // value handling so re-parsing a previously-stringified IR
  // doesn't reintroduce a negative `total`.
  copyIfFiniteNumberAbs(info, 'total', raw.total);

  const resolution = normalizePositiveInteger(raw.resolution);
  if (resolution !== undefined && resolution > 0) {
    info.resolution = resolution;
  }

  return info;
}

function normalizeBmsonBgaFromIr(input: unknown): BeMusicJson['bmson']['bga'] {
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
    header: normalizeBmsonBgaHeaderEntries(raw.header ?? raw.bga_header),
    events: normalizeBmsonBgaEventEntries(raw.events ?? raw.bga_events),
    layerEvents: normalizeBmsonBgaEventEntries(raw.layerEvents ?? raw.layer_events),
    poorEvents: normalizeBmsonBgaEventEntries(raw.poorEvents ?? raw.poor_events),
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
