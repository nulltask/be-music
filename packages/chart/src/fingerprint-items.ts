/**
 * Exact play items of one chart for the Be-Music Fingerprint (`docs/fingerprint-spec.md`, sections 3.3 – 3.5).
 *
 * A chart is turned into **items** (notes, mines, timeline events, measure lengths, header values) grouped in
 * **buckets**: one per lane, one for mines, one per timeline type, one for measure lengths, and one for the header. A
 * bucket's items depend only on the chart events of that bucket and on the definitions it reads, so the chart
 * fingerprint can recompute just the buckets a `#RANDOM` outcome touches. Items keep everything the engine plays;
 * the drops that depend on the state in effect (a BPM change to the BPM already in effect, …) and the FREE ZONE rule
 * (which depends on the lane mode) are applied afterwards by {@link canonicalizeItems}.
 */
import {
  DEFAULT_BPM,
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import {
  compareEvents,
  createBeatResolver,
  mapBmsLongNoteChannelToPlayable,
  resolveBmsLongNotes,
  resolveChartPlayVariant,
  type ChartPlayVariant,
} from './index.ts';
import { resolveKeyboardModeHint, type KeyboardModeHint } from './keyboard-mode-hint.ts';
import { collectExRankChanges, resolveJudgeRankFacts, resolveTotalFacts } from './resolved-chart.ts';
import {
  resolveBmsonLongNoteMode,
  resolveJudgedNoteEntries,
  resolveMineNotes,
  type JudgedNoteEntry,
  type ResolvedNoteContext,
} from './resolved-notes.ts';
import { collectScrollChanges, collectSpeedChanges } from './timelines.ts';
import {
  collectStopChanges,
  collectTempoChanges,
  createTimingBuildContext,
  createTimingResolverWithContext,
  parseStpStop,
} from './timing.ts';
import {
  addRational,
  compareRational,
  createRational,
  divideRational,
  formatRational,
  isRationalEqual,
  parseDecimalRational,
  parseLeadingDecimalRational,
  RATIONAL_ONE,
  RATIONAL_ZERO,
  rationalFromNumber,
  snapMeasureLength,
  snapValue,
  type Rational,
} from './fingerprint-rational.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------------

/** A position: measure `m` and the exact fraction `n / d` of that measure (`0 <= n < d`, lowest terms). */
export interface FpTime {
  m: number;
  n: number;
  d: number;
}

export type FingerprintTimelineType = 'bpm' | 'stop' | 'stp' | 'scroll' | 'speed' | 'exrank';

export interface NoteItem {
  t: FpTime;
  lane: string;
  end?: FpTime;
  /** Long-note mode of a long note: 1 LN, 2 CN, 3 HCN. */
  ln?: number;
  /**
   * Set on a note of lane `17` / `27` that comes from a `1x` / `2x` object or a bmson note: the long-note mode it gets
   * when the lane mode turns that lane into a FREE ZONE (every mode but 9 / 24 / 48 KEY).
   */
  fz?: number;
}

export interface MineItem {
  t: FpTime;
  lane: string;
  damage: Rational;
}

export interface TimelineItem {
  t: FpTime;
  type: FingerprintTimelineType;
  v: Rational;
}

export type JudgeItem = { kind: 'rank'; v: Rational } | { kind: 'exRank'; v: Rational };
export type TotalItem = { kind: 'bms'; v: Rational } | { kind: 'bmson'; v: Rational } | null;

export interface HeaderItems {
  bpm: Rational;
  /** `#BASEBPM` as written (`null` when absent); it is dropped when it equals `bpm` at canonicalization. */
  baseBpm: Rational | null;
  judge: JudgeItem;
  total: TotalItem;
  /** `#PLAYER 3`, one of the lane-mode inputs. */
  player3: boolean;
  /** The bmson keyboard `mode_hint` (`keyboard-24k` / `keyboard-24k-double`), one of the lane-mode inputs. */
  modeHint: KeyboardModeHint | null;
  /** `false` only for a bmson chart with an explicit `lines: []` (no bar lines drawn). */
  barLines: boolean;
}

export interface ChartItems {
  /** Notes by lane bucket (`lane:<lane>`). */
  lanes: Map<string, NoteItem[]>;
  mines: MineItem[];
  timeline: Map<FingerprintTimelineType, TimelineItem[]>;
  /** Snapped measure lengths other than 1, by measure. */
  lengths: Map<number, Rational>;
  header: HeaderItems;
}

export const TIMELINE_TYPES: ReadonlyArray<FingerprintTimelineType> = [
  'bpm',
  'stop',
  'stp',
  'scroll',
  'speed',
  'exrank',
];

// ---------------------------------------------------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------------------------------------------------

function gcdNumber(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function createTime(measure: number, numerator: number, denominator: number): FpTime {
  if (numerator <= 0) {
    return { m: measure, n: 0, d: 1 };
  }
  if (numerator >= denominator) {
    const carry = Math.floor(numerator / denominator);
    return createTime(measure + carry, numerator - carry * denominator, denominator);
  }
  const divisor = gcdNumber(numerator, denominator);
  return { m: measure, n: numerator / divisor, d: denominator / divisor };
}

function normalizePositionDenominator(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 1;
}

function normalizePositionNumerator(value: number, denominator: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(denominator - 1, Math.floor(value))) : 0;
}

/** The exact position an object is written at: cell index / cell count of its measure line (spec 3.3). */
export function eventTime(event: BeMusicEvent): FpTime {
  const measure = Number.isFinite(event.measure) ? Math.max(0, Math.floor(event.measure)) : 0;
  const denominator = normalizePositionDenominator(event.position[1]);
  return createTime(measure, normalizePositionNumerator(event.position[0], denominator), denominator);
}

export function compareTime(left: FpTime, right: FpTime): number {
  if (left.m !== right.m) {
    return left.m - right.m;
  }
  const a = left.n * right.d;
  const b = right.n * left.d;
  if (Number.isSafeInteger(a) && Number.isSafeInteger(b)) {
    return a - b;
  }
  const big = BigInt(left.n) * BigInt(right.d) - BigInt(right.n) * BigInt(left.d);
  return big < 0n ? -1 : big > 0n ? 1 : 0;
}

export function formatPosition(time: FpTime): string {
  return time.n === 0 ? '0' : `${time.n}/${time.d}`;
}

export function parseTime(m: string, p: string): FpTime {
  const slash = p.indexOf('/');
  const measure = Number.parseInt(m, 10);
  return slash < 0
    ? createTime(measure, Number.parseInt(p, 10), 1)
    : createTime(measure, Number.parseInt(p.slice(0, slash), 10), Number.parseInt(p.slice(slash + 1), 10));
}

// ---------------------------------------------------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------------------------------------------------

export const MINES_BUCKET = 'mines';
export const LENGTHS_BUCKET = 'lengths';
export const HEADER_BUCKET = 'header';

/** The bucket an event of the given normalized channel feeds, or `undefined` for channels the fingerprint ignores. */
export function bucketOfChannel(channel: string): string | undefined {
  if (channel.length !== 2) {
    return undefined;
  }
  const side = channel.charCodeAt(0);
  const lane = channel.charCodeAt(1);
  const isLaneCode = (lane >= 0x31 && lane <= 0x39) || (lane >= 0x41 && lane <= 0x5a);
  if (isLaneCode) {
    if (side === 0x31 || side === 0x32) {
      return `lane:${channel}`;
    }
    if (side === 0x35 || side === 0x36) {
      return `lane:${side === 0x35 ? '1' : '2'}${channel[1]}`;
    }
    if (side === 0x44 || side === 0x45) {
      return MINES_BUCKET;
    }
  }
  switch (channel) {
    case '03':
    case '08':
      return 'tl:bpm';
    case '09':
      return 'tl:stop';
    case 'SC':
      return 'tl:scroll';
    case 'SP':
      return 'tl:speed';
    case 'A0':
      return 'tl:exrank';
    default:
      return undefined;
  }
}

/** Events of a chart grouped by bucket, each bucket in the engine's event order. */
export function bucketEvents(events: ReadonlyArray<BeMusicEvent>): Map<string, BeMusicEvent[]> {
  const buckets = new Map<string, BeMusicEvent[]>();
  for (const event of events) {
    const bucket = bucketOfChannel(normalizeChannel(event.channel));
    if (bucket === undefined) {
      continue;
    }
    const list = buckets.get(bucket);
    if (list) {
      list.push(event);
    } else {
      buckets.set(bucket, [event]);
    }
  }
  for (const list of buckets.values()) {
    sortEventsInPlace(list);
  }
  return buckets;
}

function sortEventsInPlace(events: BeMusicEvent[]): void {
  for (let index = 1; index < events.length; index += 1) {
    if (compareEvents(events[index - 1]!, events[index]!) > 0) {
      events.sort(compareEvents);
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Item computation
// ---------------------------------------------------------------------------------------------------------------------
//
// The items are read with the resolvers the Resolved layer (`resolveChart`) is built from, so the fingerprint follows
// be-music's interpretation instead of repeating it: judged notes, long-note pairing, FREE ZONE and one note per lane
// and position (`resolved-notes.ts`), mine damage (`note-rules.ts`), BPM / STOP / `#STP` (`timing.ts`), SCROLL / SPEED
// (`timelines.ts`), and the judge-rank / TOTAL facts (`resolved-chart.ts`). Only the coordinates are the
// fingerprint's own: positions are read exactly from the source events instead of as beats.

const DEFAULT_LONG_NOTE_TYPE = 1;
const STOP_UNITS_PER_BEAT: Rational = { n: 48n, d: 1n };

/** Context shared by every bucket of one chart. */
interface ItemContext {
  json: BeMusicJson;
  base: 36 | 62;
  /** `#LNTYPE` as be-music resolves it for the whole chart (explicit, else inferred from the `5x` / `6x` objects). */
  lnType: 1 | 2;
  bmson?: BmsonGeometry;
}

interface BmsonGeometry {
  resolution: number;
  ticksPerMeasure: number;
  lines: ReadonlyArray<number>;
}

/**
 * Computes the items of `json`. With `only`, just those buckets are computed and every other bucket is taken from
 * `reuse` (which must be the items of a chart that differs from `json` only in those buckets).
 */
export function computeChartItems(
  json: BeMusicJson,
  bucketed: Map<string, BeMusicEvent[]>,
  only?: ReadonlySet<string>,
  reuse?: ChartItems,
): ChartItems {
  const wants = (bucket: string): boolean => only === undefined || only.has(bucket);
  const context = createItemContext(json, bucketed);

  // Lanes are independent once `#LNTYPE` is fixed for the whole chart, so the requested lanes resolve together.
  const lanes = new Map<string, NoteItem[]>(only === undefined ? [] : reuse!.lanes);
  const laneBuckets = [...(only ?? bucketed.keys())].filter((bucket) => bucket.startsWith('lane:'));
  for (const bucket of laneBuckets) {
    lanes.delete(bucket);
  }
  for (const [bucket, notes] of computeLaneNotes(
    context,
    laneBuckets.flatMap((bucket) => bucketed.get(bucket) ?? []),
  )) {
    lanes.set(bucket, notes);
  }

  const timeline = new Map<FingerprintTimelineType, TimelineItem[]>(only === undefined ? [] : reuse!.timeline);
  for (const type of TIMELINE_TYPES) {
    if (wants(`tl:${type}`)) {
      timeline.set(type, computeTimeline(context, type, bucketed.get(`tl:${type}`) ?? []));
    }
  }

  return {
    lanes,
    mines: wants(MINES_BUCKET) ? computeMines(context, bucketed.get(MINES_BUCKET) ?? []) : reuse!.mines,
    timeline,
    lengths: wants(LENGTHS_BUCKET) ? computeLengths(context) : reuse!.lengths,
    header: wants(HEADER_BUCKET) ? computeHeader(json) : reuse!.header,
  };
}

function createItemContext(json: BeMusicJson, bucketed: Map<string, BeMusicEvent[]>): ItemContext {
  let bmson: BmsonGeometry | undefined;
  if (json.sourceFormat === 'bmson') {
    const resolution = Math.max(1, json.bmson.info.resolution || 240);
    bmson = {
      resolution,
      ticksPerMeasure: Math.max(1, Math.floor(resolution * 4)),
      lines: json.preservation.bmson.lines,
    };
  }
  return { json, base: resolveBmsBase(json), lnType: resolveChartLongNoteType(json, bucketed), bmson };
}

/** `true` when `#LNTYPE` is not set, so the `5x` / `6x` objects of every lane decide it together. */
export function usesInferredLongNoteType(json: BeMusicJson): boolean {
  return json.bms.lnType !== 1 && json.bms.lnType !== 2;
}

/** The chart's `#LNTYPE`: its own, else what be-music infers from every lane's `5x` / `6x` objects. */
function resolveChartLongNoteType(json: BeMusicJson, bucketed: Map<string, BeMusicEvent[]>): 1 | 2 {
  if (!usesInferredLongNoteType(json)) {
    return json.bms.lnType as 1 | 2;
  }
  if (json.sourceFormat !== 'bms') {
    return DEFAULT_LONG_NOTE_TYPE;
  }
  const longNoteEvents: BeMusicEvent[] = [];
  for (const [bucket, events] of bucketed) {
    if (bucket.startsWith('lane:')) {
      for (const event of events) {
        if (mapBmsLongNoteChannelToPlayable(event.channel) !== undefined) {
          longNoteEvents.push(event);
        }
      }
    }
  }
  if (longNoteEvents.length === 0) {
    return DEFAULT_LONG_NOTE_TYPE;
  }
  return resolveBmsLongNotes({ ...json, events: longNoteEvents }, { inferLnTypeWhenMissing: true }).lnType;
}

/** `json` reduced to `events`, sharing everything else (the resolvers only read it). */
function withEvents(context: ItemContext, events: BeMusicEvent[]): BeMusicJson {
  const { json } = context;
  return { ...json, events, bms: { ...json.bms, lnType: context.lnType } };
}

function noteContext(json: BeMusicJson, freeZone: boolean): ResolvedNoteContext {
  const timingContext = createTimingBuildContext(json);
  return {
    json,
    timing: createTimingResolverWithContext(json, timingContext),
    beatResolver: timingContext.beatResolver,
    sortedEvents: timingContext.sortedEvents,
    idBase: resolveBmsBase(json),
    // FREE ZONE depends on the lane mode, which a chart document only knows per outcome: the notes are read without
    // it and `canonicalizeItems` applies it (see `NoteItem.fz`).
    resolvePlayVariant: () => '9',
    freeZone,
    inferBmsLnTypeWhenMissing: true,
  };
}

/** The cell right after an object: where an `#LNTYPE 2` run that ends on it stops. */
function nextCellTime(event: BeMusicEvent): FpTime {
  const measure = Math.max(0, Math.floor(event.measure));
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  return createTime(measure, numerator + 1, denominator);
}

/**
 * The judged notes of the given lane events, by lane bucket: `resolveJudgedNoteEntries` (the Resolved layer's notes)
 * without FREE ZONE, with exact start and end positions.
 */
function computeLaneNotes(context: ItemContext, events: BeMusicEvent[]): Map<string, NoteItem[]> {
  const lanes = new Map<string, NoteItem[]>();
  if (events.length === 0) {
    return lanes;
  }
  const json = withEvents(context, events);
  const lnType = json.bmson.info.lnType;
  const chartLongNoteType = lnType === 1 || lnType === 2 || lnType === 3 ? lnType : undefined;
  for (const entry of resolveJudgedNoteEntries(noteContext(json, false)).notes) {
    const time = eventTime(entry.event);
    const note: NoteItem = { t: time, lane: entry.channel };
    const sourceChannel = normalizeChannel(entry.event.channel);
    if (sourceChannel === '17' || sourceChannel === '27') {
      note.fz = resolveBmsonLongNoteMode(entry.event, chartLongNoteType);
    }
    const end = resolveTailTime(context, entry);
    if (end !== undefined && entry.lnMode !== undefined && compareTime(end, time) > 0) {
      note.end = end;
      note.ln = entry.lnMode;
    }
    const bucket = `lane:${entry.channel}`;
    const list = lanes.get(bucket);
    if (list) {
      list.push(note);
    } else {
      lanes.set(bucket, [note]);
    }
  }
  return lanes;
}

function resolveTailTime(context: ItemContext, entry: JudgedNoteEntry): FpTime | undefined {
  const tail = entry.tail;
  switch (tail?.kind) {
    case 'event':
      return eventTime(tail.event);
    case 'after-event':
      return nextCellTime(tail.event);
    case 'pulses':
      return context.bmson === undefined
        ? undefined
        : bmsonPulseToTime(context.bmson, bmsonEventPulse(context.bmson, entry.event) + Math.round(tail.pulses));
    default:
      return undefined;
  }
}

function bmsonEventPulse(geometry: BmsonGeometry, event: BeMusicEvent): number {
  const measure = Math.max(0, Math.floor(event.measure));
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  const { lines, ticksPerMeasure } = geometry;
  if (lines.length < 2) {
    return measure * ticksPerMeasure + numerator;
  }
  const last = lines.length - 1;
  if (measure < last) {
    return lines[measure]! + numerator;
  }
  return lines[last]! + (measure - last) * ticksPerMeasure + numerator;
}

/** Exact inverse of the parser's bmson position mapping: pulse `y` to (measure, position) through `lines`. */
export function bmsonPulseToTime(geometry: BmsonGeometry, pulse: number): FpTime {
  const y = Math.max(0, Math.round(pulse));
  const { lines, ticksPerMeasure } = geometry;
  if (lines.length < 2) {
    return createTime(Math.floor(y / ticksPerMeasure), y % ticksPerMeasure, ticksPerMeasure);
  }
  let low = 0;
  let high = lines.length - 1;
  let index = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle]! <= y) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const last = lines.length - 1;
  if (index < last) {
    const start = lines[index]!;
    const span = Math.max(1, lines[index + 1]! - start);
    return createTime(index, Math.min(span - 1, y - start), span);
  }
  const offset = y - lines[last]!;
  const measureOffset = Math.floor(offset / ticksPerMeasure);
  return createTime(last + measureOffset, offset - measureOffset * ticksPerMeasure, ticksPerMeasure);
}

/** Mines with their damage (`resolveMineNotes`: bmson `damage`, else the BMS value in base 36, else 4). */
function computeMines(context: ItemContext, events: BeMusicEvent[]): MineItem[] {
  if (events.length === 0) {
    return [];
  }
  return resolveMineNotes(noteContext(withEvents(context, events), false)).map((mine) => ({
    t: eventTime(mine.event),
    lane: mine.channel,
    damage: snapValue(rationalFromNumber(mine.damage ?? 0) ?? RATIONAL_ZERO),
  }));
}

function computeTimeline(context: ItemContext, type: FingerprintTimelineType, events: BeMusicEvent[]): TimelineItem[] {
  const { json } = context;
  switch (type) {
    case 'stp':
      return computeStp(json);
    case 'stop':
      return computeStops(context, events);
    case 'bpm':
      return lastChangePerTime(
        type,
        collectTempoChanges(json, events).map((change) => ({ event: change.event, value: change.bpm })),
      );
    case 'scroll':
      return lastChangePerTime(type, collectScrollChanges(json, events));
    case 'speed':
      return lastChangePerTime(type, collectSpeedChanges(json, events));
    case 'exrank':
      return lastChangePerTime(
        type,
        collectExRankChanges(json, events, context.base).map((change) => ({
          event: change.event,
          value: parseLeadingDecimalRational(change.raw),
        })),
      );
    default:
      return [];
  }
}

/** Changes of one type in chart order; of several at one time the last one is the one be-music applies. */
function lastChangePerTime(
  type: FingerprintTimelineType,
  changes: ReadonlyArray<{ event: BeMusicEvent; value: number | Rational | undefined }>,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const change of changes) {
    const exact = typeof change.value === 'number' ? rationalFromNumber(change.value) : change.value;
    if (exact === undefined) {
      continue;
    }
    const value = snapValue(exact);
    const time = eventTime(change.event);
    const last = items[items.length - 1];
    if (last && compareTime(last.t, time) === 0) {
      last.v = value;
    } else {
      items.push({ t: time, type, v: value });
    }
  }
  return items;
}

/**
 * STOPs in beats (`collectStopChanges`: of several BMS `#STOPxx` at one position the last wins, bmson stops on one pulse
 * add up). A bmson stop's length is read exactly from its `duration` in pulses.
 */
function computeStops(context: ItemContext, events: BeMusicEvent[]): TimelineItem[] {
  const { json, bmson } = context;
  const items: TimelineItem[] = [];
  const beatResolver = createBeatResolver(json);
  for (const stop of collectStopChanges(json, events, beatResolver)) {
    let beats: Rational | undefined;
    const bmsonStop = bmson
      ? json.preservation.bmson.stopEvents[Number.parseInt(normalizeObjectKey(stop.event.value, context.base), 36) - 1]
      : undefined;
    if (bmson && bmsonStop && bmsonStop.duration > 0) {
      const pulses = rationalFromNumber(bmsonStop.duration);
      beats = pulses && divideRational(snapValue(pulses), createRational(BigInt(bmson.resolution)));
    } else {
      const units = rationalFromNumber(stop.duration);
      beats = units && divideRational(snapValue(units), STOP_UNITS_PER_BEAT);
    }
    if (beats === undefined || beats.n <= 0n) {
      continue;
    }
    const time = eventTime(stop.event);
    const last = items[items.length - 1];
    if (last && compareTime(last.t, time) === 0) {
      last.v = addRational(last.v, beats);
    } else {
      items.push({ t: time, type: 'stop', v: beats });
    }
  }
  return items;
}

/** `#STP xxx.yyy ms` (`parseStpStop`): at position yyy/1000 of measure xxx, in milliseconds; several at one time add up. */
function computeStp(json: BeMusicJson): TimelineItem[] {
  const byTime = new Map<string, TimelineItem>();
  for (const raw of json.bms.stp) {
    const stop = parseStpStop(raw);
    const duration = stop && parseDecimalRational(stop.durationText);
    if (stop === undefined || duration === undefined) {
      continue;
    }
    const time = createTime(stop.measure, stop.position, 1000);
    const key = `${time.m}:${time.n}/${time.d}`;
    const existing = byTime.get(key);
    if (existing) {
      existing.v = addRational(existing.v, snapValue(duration));
    } else {
      byTime.set(key, { t: time, type: 'stp', v: snapValue(duration) });
    }
  }
  return [...byTime.values()].sort((left, right) => compareTime(left.t, right.t));
}

function computeLengths(context: ItemContext): Map<number, Rational> {
  const lengths = new Map<number, Rational>();
  const { json, bmson } = context;
  if (bmson && bmson.lines.length >= 2) {
    // Exact lengths from the integer pulses of `lines`.
    for (let index = 0; index + 1 < bmson.lines.length; index += 1) {
      const ticks = Math.max(1, bmson.lines[index + 1]! - bmson.lines[index]!);
      const length = snapMeasureLength(createRational(BigInt(ticks), BigInt(bmson.ticksPerMeasure)));
      if (!isRationalEqual(length, RATIONAL_ONE)) {
        lengths.set(index, length);
      }
    }
    return lengths;
  }
  for (const measure of json.measures) {
    if (!(measure.length > 0)) {
      continue;
    }
    const exact = rationalFromNumber(measure.length);
    if (exact === undefined) {
      continue;
    }
    const index = Math.max(0, Math.floor(measure.index));
    const length = snapMeasureLength(exact);
    if (isRationalEqual(length, RATIONAL_ONE)) {
      lengths.delete(index);
    } else {
      lengths.set(index, length);
    }
  }
  return lengths;
}

function optionalSnapped(value: number | undefined): Rational | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  const rational = rationalFromNumber(value);
  return rational === undefined ? undefined : snapValue(rational);
}

/** Header values, from the same chart facts the Resolved layer exposes (`judgeRank`, `total`, `barLinesSuppressed`). */
function computeHeader(json: BeMusicJson): HeaderItems {
  const bpm = optionalSnapped(json.metadata.bpm);
  return {
    bpm: bpm !== undefined && bpm.n > 0n ? bpm : createRational(BigInt(DEFAULT_BPM)),
    baseBpm:
      (typeof json.bms.baseBpm === 'number' && json.bms.baseBpm > 0 && optionalSnapped(json.bms.baseBpm)) || null,
    judge: resolveJudge(json),
    total: resolveTotal(json),
    player3: json.bms.player === 3,
    modeHint: resolveKeyboardModeHint(json.bmson?.info?.modeHint) ?? null,
    barLines: json.bmson.barlinesSuppressed !== true,
  };
}

/**
 * The judge axis: bmson `judge_rank` (100 when absent or not positive); otherwise a positive `#DEFEXRANK`; otherwise
 * `#RANK` (NORMAL when absent), from `resolveJudgeRankFacts`.
 */
function resolveJudge(json: BeMusicJson): JudgeItem {
  const { rank, exRank } = resolveJudgeRankFacts(json);
  const positiveExRank = exRank !== undefined && exRank > 0 ? optionalSnapped(exRank) : undefined;
  if (json.sourceFormat === 'bmson') {
    return { kind: 'exRank', v: positiveExRank ?? createRational(100n) };
  }
  if (positiveExRank !== undefined) {
    return { kind: 'exRank', v: positiveExRank };
  }
  const snappedRank = optionalSnapped(rank);
  return { kind: 'rank', v: snappedRank === undefined ? createRational(2n) : normalizeRank(snappedRank) };
}

/**
 * `#RANK` values every ruleset reads as NORMAL become `2`: LR2 truncates and maps anything outside 0..4 (and 4) to
 * NORMAL; beatoraja maps anything but the integers 0..4 to NORMAL. Values the rulesets disagree on stay as written.
 */
export function normalizeRank(rank: Rational): Rational {
  const isInteger = rank.d === 1n;
  if (isInteger) {
    return rank.n >= 0n && rank.n <= 4n ? rank : createRational(2n);
  }
  const two = createRational(2n);
  const three = createRational(3n);
  const four = createRational(4n);
  const minusOne = createRational(-1n);
  const between = (low: Rational, high: Rational): boolean =>
    compareRational(rank, low) > 0 && compareRational(rank, high) < 0;
  if (compareRational(rank, minusOne) <= 0 || between(two, three) || compareRational(rank, four) > 0) {
    return two;
  }
  return rank;
}

/** TOTAL from `resolveTotalFacts`: a positive `#TOTAL` / bmson `total` on its own axis, else `null`. */
function resolveTotal(json: BeMusicJson): TotalItem {
  const { value, unit } = resolveTotalFacts(json);
  const snapped = optionalSnapped(value);
  if (snapped === undefined || snapped.n <= 0n) {
    return null;
  }
  return unit === 'percent' ? { kind: 'bmson', v: snapped } : { kind: 'bms', v: snapped };
}

// ---------------------------------------------------------------------------------------------------------------------
// Formatted (document) items
// ---------------------------------------------------------------------------------------------------------------------

export interface FingerprintTime {
  m: string;
  p: string;
}

export interface FingerprintNote {
  m: string;
  p: string;
  lane: string;
  end?: FingerprintTime;
  /** Long-note mode: `"1"` LN, `"2"` CN, `"3"` HCN. On long notes and FREE ZONE notes. */
  ln?: string;
  /**
   * FREE ZONE. In a play document: `true` on a note the engine plays as a FREE ZONE note (a long note one beat long
   * with mode `ln`). In a chart document with `random` nodes: the mode such a note of lane `17` / `27` gets if the lane
   * mode of the outcome uses FREE ZONE.
   */
  fz?: true | string;
}

export interface FingerprintMine {
  m: string;
  p: string;
  lane: string;
  damage: string;
}

export interface FingerprintTimelineEvent {
  m: string;
  p: string;
  type: FingerprintTimelineType;
  v: string;
}

export type FingerprintLength = [measure: string, length: string];

export type FingerprintJudge = { rank: string } | { exRank: string };

export type FingerprintTotal = { bms: string } | { bmson: string } | null;

export function formatNote(note: NoteItem, freeZone: 'raw' | 'apply' | 'drop'): FingerprintNote {
  const formatted: FingerprintNote = { m: String(note.t.m), p: formatPosition(note.t), lane: note.lane };
  if (note.fz !== undefined && freeZone === 'apply') {
    formatted.ln = String(note.fz);
    formatted.fz = true;
    return formatted;
  }
  if (note.end !== undefined && note.ln !== undefined) {
    formatted.end = { m: String(note.end.m), p: formatPosition(note.end) };
    formatted.ln = String(note.ln);
  }
  if (note.fz !== undefined && freeZone === 'raw') {
    formatted.fz = String(note.fz);
  }
  return formatted;
}

export function formatMine(mine: MineItem): FingerprintMine {
  return { m: String(mine.t.m), p: formatPosition(mine.t), lane: mine.lane, damage: formatRational(mine.damage) };
}

export function formatTimeline(item: TimelineItem): FingerprintTimelineEvent {
  return { m: String(item.t.m), p: formatPosition(item.t), type: item.type, v: formatRational(item.v) };
}

export function formatJudge(judge: JudgeItem): FingerprintJudge {
  return judge.kind === 'rank' ? { rank: formatRational(judge.v) } : { exRank: formatRational(judge.v) };
}

export function formatTotal(total: TotalItem): FingerprintTotal {
  if (total === null) {
    return null;
  }
  return total.kind === 'bms' ? { bms: formatRational(total.v) } : { bmson: formatRational(total.v) };
}

function parseRationalText(text: string): Rational {
  const slash = text.indexOf('/');
  return slash < 0
    ? createRational(BigInt(text))
    : createRational(BigInt(text.slice(0, slash)), BigInt(text.slice(slash + 1)));
}

/** Reads a note of a chart document (raw FREE ZONE form) back into an item. */
export function parseNote(note: FingerprintNote): NoteItem {
  const item: NoteItem = { t: parseTime(note.m, note.p), lane: note.lane };
  if (note.end !== undefined && note.ln !== undefined) {
    item.end = parseTime(note.end.m, note.end.p);
    item.ln = Number.parseInt(note.ln, 10);
  }
  if (typeof note.fz === 'string') {
    item.fz = Number.parseInt(note.fz, 10);
  }
  return item;
}

export function parseMine(mine: FingerprintMine): MineItem {
  return { t: parseTime(mine.m, mine.p), lane: mine.lane, damage: parseRationalText(mine.damage) };
}

export function parseTimeline(item: FingerprintTimelineEvent): TimelineItem {
  return { t: parseTime(item.m, item.p), type: item.type, v: parseRationalText(item.v) };
}

export function parseJudge(judge: FingerprintJudge): JudgeItem {
  return 'rank' in judge
    ? { kind: 'rank', v: parseRationalText(judge.rank) }
    : { kind: 'exRank', v: parseRationalText(judge.exRank) };
}

export function parseTotal(total: FingerprintTotal): TotalItem {
  if (total === null) {
    return null;
  }
  return 'bms' in total
    ? { kind: 'bms', v: parseRationalText(total.bms) }
    : { kind: 'bmson', v: parseRationalText(total.bmson) };
}

export function parseRational(text: string): Rational {
  return parseRationalText(text);
}

// ---------------------------------------------------------------------------------------------------------------------
// Sorting and canonical lists
// ---------------------------------------------------------------------------------------------------------------------

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareNoteItems(left: NoteItem, right: NoteItem): number {
  const byTime = compareTime(left.t, right.t);
  if (byTime !== 0) {
    return byTime;
  }
  const byLane = compareStrings(left.lane, right.lane);
  if (byLane !== 0) {
    return byLane;
  }
  if (left.end === undefined || right.end === undefined) {
    const byEnd = (left.end === undefined ? 0 : 1) - (right.end === undefined ? 0 : 1);
    if (byEnd !== 0) {
      return byEnd;
    }
  } else {
    const byEnd = compareTime(left.end, right.end);
    if (byEnd !== 0) {
      return byEnd;
    }
  }
  return (left.ln ?? 0) - (right.ln ?? 0) || (left.fz ?? 0) - (right.fz ?? 0);
}

export function compareMineItems(left: MineItem, right: MineItem): number {
  return (
    compareTime(left.t, right.t) || compareStrings(left.lane, right.lane) || compareRational(left.damage, right.damage)
  );
}

export function compareTimelineItems(left: TimelineItem, right: TimelineItem): number {
  return compareTime(left.t, right.t) || compareStrings(left.type, right.type) || compareRational(left.v, right.v);
}

/** Items of a whole chart (or a composed outcome), flattened out of their buckets. */
export interface FlatItems {
  notes: NoteItem[];
  mines: MineItem[];
  timeline: TimelineItem[];
  lengths: Map<number, Rational>;
  header: HeaderItems;
}

export function flattenItems(items: ChartItems): FlatItems {
  const notes: NoteItem[] = [];
  for (const list of items.lanes.values()) {
    notes.push(...list);
  }
  const timeline: TimelineItem[] = [];
  for (const list of items.timeline.values()) {
    timeline.push(...list);
  }
  return { notes, mines: [...items.mines], timeline, lengths: items.lengths, header: items.header };
}

/** The chart-file extensions the lane mode reads (spec 3.5); any other extension counts as none. */
export type LaneModeExtension = '.pms' | '.bme' | null;

/**
 * The lane-mode extension of a chart path or bare extension: only the last path segment counts, as in
 * `resolveChartPlayVariant`.
 */
export function resolveLaneModeExtension(chartPath: string | undefined): LaneModeExtension {
  if (typeof chartPath !== 'string') {
    return null;
  }
  const trimmed = chartPath.trim();
  const dot = trimmed.lastIndexOf('.');
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (dot < 0 || dot < slash) {
    return null;
  }
  const extension = trimmed.slice(dot).toLowerCase();
  return extension === '.pms' || extension === '.bme' ? extension : null;
}

/**
 * Lane mode from the lane-mode inputs: the lanes that hold notes, the extension, `#PLAYER 3`, and the bmson keyboard
 * `mode_hint` (spec 3.5).
 */
export function resolveFingerprintLaneMode(
  notes: ReadonlyArray<NoteItem>,
  extension: LaneModeExtension,
  player3: boolean,
  modeHint: KeyboardModeHint | null,
): ChartPlayVariant {
  const lanes = new Set<string>();
  for (const note of notes) {
    lanes.add(note.lane);
  }
  return resolveChartPlayVariant({
    chartPath: extension ?? undefined,
    events: [...lanes].map((channel) => ({ channel })),
    bms: { player: player3 ? 3 : 1 },
    ...(modeHint !== null ? { bmson: { info: { modeHint } } } : {}),
  });
}

export function usesFreeZone(laneMode: ChartPlayVariant): boolean {
  return laneMode !== '9' && laneMode !== '24' && laneMode !== '48';
}

/**
 * Applies the drops that depend on the state in effect (spec 3.4) to one timeline type, in time order: a BPM change to
 * the BPM in effect, a SCROLL change to the SCROLL in effect, an `#EXRANK` change to the previous `#EXRANK`, and the
 * SPEED keyframes whose removal leaves the speed curve unchanged.
 */
export function dropNoOpChanges(
  type: FingerprintTimelineType,
  items: ReadonlyArray<TimelineItem>,
  initialBpm: Rational,
): TimelineItem[] {
  const sorted = [...items].sort((left, right) => compareTime(left.t, right.t));
  if (type === 'speed') {
    return dropRedundantSpeedKeyframes(sorted);
  }
  if (type !== 'bpm' && type !== 'scroll' && type !== 'exrank') {
    return sorted;
  }
  let current: Rational | undefined = type === 'bpm' ? initialBpm : type === 'scroll' ? RATIONAL_ONE : undefined;
  const kept: TimelineItem[] = [];
  for (const item of sorted) {
    if (current !== undefined && isRationalEqual(current, item.v)) {
      continue;
    }
    current = item.v;
    kept.push(item);
  }
  return kept;
}

/**
 * SPEED is interpolated linearly (in beats) between keyframes and holds the last one's value after it. Before the first
 * keyframe it ramps from 1 at measure 0, position 0, as beatoraja ramps from 1.0 at time 0; a keyframe at that position
 * applies at once instead. So the curve runs through a head keyframe (0, 1), replaced by a keyframe at 0, and the
 * keyframes. Within each maximal run of equal consecutive values (head included) only the run's first and last
 * keyframes matter, and the trailing run only its first. The head is written only when a keyframe at 0 sets a value
 * other than 1, so a curve that is 1 throughout has no keyframes.
 */
function dropRedundantSpeedKeyframes(sorted: ReadonlyArray<TimelineItem>): TimelineItem[] {
  const origin: FpTime = { m: 0, n: 0, d: 1 };
  const explicitHead = sorted[0] !== undefined && compareTime(sorted[0].t, origin) === 0 ? sorted[0] : undefined;
  const head: TimelineItem = explicitHead ?? { t: origin, type: 'speed', v: RATIONAL_ONE };
  const points = explicitHead ? sorted : [head, ...sorted];
  const runs: Array<{ first: TimelineItem; last: TimelineItem }> = [];
  for (const item of points) {
    const run = runs[runs.length - 1];
    if (run && isRationalEqual(run.last.v, item.v)) {
      run.last = item;
    } else {
      runs.push({ first: item, last: item });
    }
  }
  const kept: TimelineItem[] = [];
  runs.forEach((run, index) => {
    kept.push(run.first);
    if (index < runs.length - 1 && run.last !== run.first) {
      kept.push(run.last);
    }
  });
  return isRationalEqual(head.v, RATIONAL_ONE) ? kept.filter((item) => item !== head) : kept;
}

export interface CanonicalLists {
  laneMode: ChartPlayVariant;
  notes: FingerprintNote[];
  mines: FingerprintMine[];
  timeline: FingerprintTimelineEvent[];
  /** Last measure holding an included event, `-1` when there is none. */
  maxMeasure: number;
}

/**
 * Canonical play lists of a fully resolved outcome: lane mode, FREE ZONE, the state-dependent drops, and sorting.
 */
export function canonicalizeItems(items: FlatItems, extension: LaneModeExtension): CanonicalLists {
  const laneMode = resolveFingerprintLaneMode(items.notes, extension, items.header.player3, items.header.modeHint);
  const freeZone = usesFreeZone(laneMode) ? 'apply' : 'drop';
  const notes = [...items.notes].sort(compareNoteItems);
  const mines = [...items.mines].sort(compareMineItems);
  const byType = new Map<FingerprintTimelineType, TimelineItem[]>();
  for (const item of items.timeline) {
    const list = byType.get(item.type);
    if (list) {
      list.push(item);
    } else {
      byType.set(item.type, [item]);
    }
  }
  const timeline: TimelineItem[] = [];
  for (const [type, list] of byType) {
    timeline.push(...dropNoOpChanges(type, list, items.header.bpm));
  }
  timeline.sort(compareTimelineItems);
  let maxMeasure = -1;
  for (const note of notes) {
    maxMeasure = Math.max(
      maxMeasure,
      note.t.m,
      freeZone === 'apply' && note.fz !== undefined ? -1 : (note.end?.m ?? -1),
    );
  }
  for (const item of mines) {
    maxMeasure = Math.max(maxMeasure, item.t.m);
  }
  for (const item of timeline) {
    maxMeasure = Math.max(maxMeasure, item.t.m);
  }
  return {
    laneMode,
    notes: notes.map((note) => formatNote(note, freeZone)),
    mines: mines.map(formatMine),
    timeline: timeline.map(formatTimeline),
    maxMeasure,
  };
}

export function formatLengths(lengths: Map<number, Rational>, count: number): FingerprintLength[] {
  return [...lengths.entries()]
    .filter(([measure, length]) => measure < count && !isRationalEqual(length, RATIONAL_ONE))
    .sort((left, right) => left[0] - right[0])
    .map(([measure, length]): FingerprintLength => [String(measure), formatRational(length)]);
}
