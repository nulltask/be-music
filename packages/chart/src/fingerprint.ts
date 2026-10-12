/**
 * Be-Music Fingerprint (`bmfp1`) — identifies a chart by what the player plays and sees in the lanes rather than by its
 * bytes. The normative definition is `docs/fingerprint-spec.md`; this module is its reference implementation.
 */
import {
  cloneJson,
  DEFAULT_BPM,
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
  type BmsControlFlowCommand,
  type BmsControlFlowEntry,
  type BmsControlFlowHeaderEntry,
  type BmsControlFlowObjectEntry,
} from '@be-music/json';
import {
  createBeatResolver,
  isLandmineChannel,
  isPlayableChannel,
  parseBpmFrom03Token,
  resolveBmsLongNotes,
  resolveChartPlayVariant,
  resolveLnobjLongNotes,
  sortEvents,
  type ChartPlayVariant,
} from './index.ts';
import {
  compareRational,
  createRational,
  divideRational,
  formatRational,
  isRationalEqual,
  MEASURE_GRID_EPSILON,
  parseDecimalRational,
  parseLeadingDecimalRational,
  RATIONAL_ONE,
  RATIONAL_ZERO,
  rationalFromNumber,
  snapToMeasureGrid,
  snapValue,
  type Rational,
} from './fingerprint-rational.ts';

const FINGERPRINT_VERSION = 'bmfp1';

export interface BeMusicFingerprintOptions {
  /**
   * Path or file name of the chart. Only its extension is read: `.pms` selects the 9-key lane mode, exactly as in
   * {@link resolveChartPlayVariant}.
   */
  chartPath?: string;
}

export interface FingerprintTime {
  m: string;
  p: string;
}

export interface FingerprintNote {
  m: string;
  p: string;
  lane: string;
  end?: FingerprintTime;
  /** Long-note mode: `"1"` LN, `"2"` CN, `"3"` HCN. Only on long notes. */
  ln?: string;
}

export interface FingerprintMine {
  m: string;
  p: string;
  lane: string;
  damage: string;
}

export type FingerprintTimelineType = 'bpm' | 'stop' | 'stp' | 'scroll' | 'speed' | 'exrank';

export interface FingerprintTimelineEvent {
  m: string;
  p: string;
  type: FingerprintTimelineType;
  v: string;
}

export interface FingerprintMeasures {
  count: string;
  lengths: Array<[measure: string, length: string]>;
}

/** Header values a control-flow branch sets itself (`#BPM`, `#BASEBPM`, `#RANK`, `#DEFEXRANK`, `#TOTAL`). */
export interface FingerprintBranchHeader {
  bpm?: string;
  baseBpm?: string;
  rank?: string;
  defExRank?: string;
  total?: string;
}

export interface FingerprintBranch {
  when?: string;
  default?: true;
  header?: FingerprintBranchHeader;
  measures: { lengths: Array<[measure: string, length: string]> };
  notes: FingerprintNote[];
  mines: FingerprintMine[];
  timeline: FingerprintTimelineEvent[];
  random: FingerprintControlFlowNode[];
}

export interface FingerprintControlFlowNode {
  random?: string;
  switch?: string;
  branches: FingerprintBranch[];
}

export type FingerprintJudge = { rank: string } | { exRank: string };

export type FingerprintTotal = { bms: string } | { bmson: string } | null;

/** The canonical document of `docs/fingerprint-spec.md` section 4. Every number is a string. */
export interface BeMusicFingerprintDocument {
  v: typeof FINGERPRINT_VERSION;
  laneMode: ChartPlayVariant;
  bpm: string;
  baseBpm: string | null;
  judge: FingerprintJudge;
  total: FingerprintTotal;
  measures: FingerprintMeasures;
  notes: FingerprintNote[];
  mines: FingerprintMine[];
  timeline: FingerprintTimelineEvent[];
  random: FingerprintControlFlowNode[];
}

/**
 * Builds the canonical document of the **play fingerprint**: the chart exactly as given, i.e. after
 * `resolveBmsControlFlow` chose every `#RANDOM` / `#SWITCH` branch. `json.bms.controlFlow` is ignored, so the
 * document's `random` list is always empty.
 */
export function createPlayFingerprintDocument(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions = {},
): BeMusicFingerprintDocument {
  const lists = collectFingerprintLists(json, true);
  return assembleDocument(json, json.events, options, lists, []);
}

/**
 * Builds the canonical document of the **chart fingerprint**: the chart with its `#RANDOM` / `#SWITCH` structure kept
 * as a tree. Pass the parser's unresolved output (`parseBms` / `parseChart`), whose `events` hold only the content
 * outside control flow; the branches are rebuilt from `json.bms.controlFlow`. For a chart without control flow this
 * equals {@link createPlayFingerprintDocument}.
 */
export function createChartFingerprintDocument(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions = {},
): BeMusicFingerprintDocument {
  if (json.bms.controlFlow.length === 0) {
    return createPlayFingerprintDocument(json, options);
  }

  const base = resolveBmsBase(json);
  const tree = buildControlFlowTree(json.bms.controlFlow);
  const topScope = createScope();
  evaluateControlFlowItems(tree, undefined, undefined, topScope, topScope);

  const top = cloneJson(json);
  for (const header of topScope.headers) {
    applyFingerprintHeader(top, header, base);
  }
  applyScopeObjects(top, topScope.objects, base);

  const context: ChartDocumentContext = { base, maxMeasure: -1 };
  const nodes = buildControlFlowNodes(topScope.blocks, top, context);
  // State-dependent drops (a BPM / SCROLL / SPEED change to the value in effect, a repeated `#EXRANK`) are only sound
  // when no branch can change that state in between.
  const lists = collectFingerprintLists(top, nodes.length === 0);
  lists.maxMeasure = Math.max(lists.maxMeasure, context.maxMeasure);

  const laneEvents: Array<{ channel: string }> = [...top.events];
  for (const entry of json.bms.controlFlow) {
    if (entry.kind === 'object') {
      laneEvents.push(...entry.events.map(() => ({ channel: entry.channel })));
    }
  }
  return assembleDocument(top, laneEvents, options, lists, nodes);
}

/**
 * Serializes a fingerprint document with the JSON Canonicalization Scheme (RFC 8785): object keys sorted by UTF-16
 * code units, no whitespace, ECMAScript string escaping. The fingerprint is the SHA-256 of this text's UTF-8 bytes.
 */
export function canonicalizeFingerprintDocument(document: BeMusicFingerprintDocument): string {
  return canonicalizeJsonValue(document);
}

/** `bmfp1:<sha256>` of the chart fingerprint document. Uses Web Crypto, so it works in Node and browsers alike. */
export async function computeChartFingerprint(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions = {},
): Promise<string> {
  return hashFingerprintDocument(createChartFingerprintDocument(json, options));
}

/** `bmfp1:<sha256>` of the play fingerprint document. Uses Web Crypto, so it works in Node and browsers alike. */
export async function computePlayFingerprint(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions = {},
): Promise<string> {
  return hashFingerprintDocument(createPlayFingerprintDocument(json, options));
}

async function hashFingerprintDocument(document: BeMusicFingerprintDocument): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeFingerprintDocument(document));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `${FINGERPRINT_VERSION}:${hex}`;
}

function canonicalizeJsonValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonical JSON cannot represent a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJsonValue).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(record[key])}`).join(',')}}`;
  }
  throw new TypeError(`canonical JSON cannot represent a ${typeof value}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------------------------------------------------

interface Time {
  m: number;
  p: Rational;
}

interface NoteRecord {
  time: Time;
  lane: string;
  end?: Time;
  ln?: number;
}

interface MineRecord {
  time: Time;
  lane: string;
  damage: Rational;
}

interface TimelineRecord {
  time: Time;
  type: FingerprintTimelineType;
  v: Rational;
}

interface FingerprintLists {
  notes: FingerprintNote[];
  mines: FingerprintMine[];
  timeline: FingerprintTimelineEvent[];
  /** Last measure holding an included event (note start / end, mine, timeline event); `-1` when there is none. */
  maxMeasure: number;
}

function assembleDocument(
  json: BeMusicJson,
  laneEvents: ReadonlyArray<{ channel: string }>,
  options: BeMusicFingerprintOptions,
  lists: FingerprintLists,
  random: FingerprintControlFlowNode[],
): BeMusicFingerprintDocument {
  const count = lists.maxMeasure + 1;
  const lengths = collectMeasureLengths(json)
    .filter(([measure, length]) => measure < count && !isRationalEqual(length, RATIONAL_ONE))
    .map(([measure, length]): [string, string] => [String(measure), formatRational(length)]);
  return {
    v: FINGERPRINT_VERSION,
    laneMode: resolveChartPlayVariant({ chartPath: options.chartPath, events: laneEvents, bms: json.bms }),
    bpm: formatRational(snapValue(rationalFromNumber(json.metadata.bpm) ?? createRational(BigInt(DEFAULT_BPM)))),
    baseBpm: formatOptionalPositiveValue(json.bms.baseBpm) ?? null,
    judge: resolveFingerprintJudge(json),
    total: resolveFingerprintTotal(json),
    measures: { count: String(count), lengths },
    notes: lists.notes,
    mines: lists.mines,
    timeline: lists.timeline,
    random,
  };
}

function resolveFingerprintJudge(json: BeMusicJson): FingerprintJudge {
  if (json.sourceFormat === 'bmson') {
    return { exRank: formatOptionalPositiveValue(json.bmson.info.judgeRank) ?? '100' };
  }
  const exRank = formatOptionalPositiveValue(json.bms.defExRank);
  if (exRank !== undefined) {
    return { exRank };
  }
  return { rank: formatOptionalValue(json.metadata.rank) ?? '2' };
}

function resolveFingerprintTotal(json: BeMusicJson): FingerprintTotal {
  if (json.sourceFormat === 'bmson') {
    const total = formatOptionalValue(json.bmson.info.total);
    return total === undefined ? null : { bmson: total };
  }
  const total = formatOptionalValue(json.metadata.total);
  return total === undefined ? null : { bms: total };
}

function formatOptionalValue(value: number | undefined): string | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  const rational = rationalFromNumber(value);
  return rational === undefined ? undefined : formatRational(snapValue(rational));
}

function formatOptionalPositiveValue(value: number | undefined): string | undefined {
  return typeof value === 'number' && value > 0 ? formatOptionalValue(value) : undefined;
}

/** `[measure, snapped length]` for every measure the chart sets, ordered by measure. */
function collectMeasureLengths(json: BeMusicJson): Array<[number, Rational]> {
  const byMeasure = new Map<number, Rational>();
  for (const measure of json.measures) {
    const length = snapMeasureLength(measure.length);
    if (length !== undefined) {
      byMeasure.set(Math.max(0, Math.floor(measure.index)), length);
    }
  }
  return [...byMeasure.entries()].sort((left, right) => left[0] - right[0]);
}

/**
 * Lengths of at most ε stay exact: their snapping interval would reach 0, which is not a measure length. (Gimmick
 * charts do use such tiny measures.)
 */
function snapMeasureLength(length: number): Rational | undefined {
  if (!(length > 0)) {
    return undefined;
  }
  const rational = rationalFromNumber(length);
  if (rational === undefined) {
    return undefined;
  }
  return compareRational(rational, MEASURE_GRID_EPSILON) <= 0 ? rational : snapToMeasureGrid(rational);
}

// ---------------------------------------------------------------------------------------------------------------------
// Notes, mines, timeline
// ---------------------------------------------------------------------------------------------------------------------

const STP_PATTERN = /^\s*(\d{3})(?:\.(\d{3}))?(?:[ \t　]{1,6})([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:[^0-9].*)?$/u;
const BASE36_OBJECT_KEY_PATTERN = /^[0-9A-Z]{2}$/;
const DEFAULT_MINE_DAMAGE = 4;
const STOP_UNITS_PER_BEAT = createRational(48n);
const TIMELINE_CHANGE_TYPES: ReadonlyArray<FingerprintTimelineType> = ['bpm', 'scroll', 'speed', 'exrank'];

/**
 * Collects the notes, mines, and timeline of `json.events` (plus `#STP`) in canonical, sorted form. `applyStateDrops`
 * enables the drops that depend on the state in effect (a change to the current BPM / SCROLL / SPEED, a repeated
 * `#EXRANK`).
 */
function collectFingerprintLists(json: BeMusicJson, applyStateDrops: boolean): FingerprintLists {
  const idBase = resolveBmsBase(json);
  const sortedEvents = sortEvents(json.events);
  const beatResolver = createBeatResolver(json);
  const beatToTime = createBeatToTimeResolver(json);
  const lnobj = resolveLnobjLongNotes(json);
  const legacyLongNotes = resolveBmsLongNotes(json, { inferLnTypeWhenMissing: true });
  const bmsonResolution = json.sourceFormat === 'bmson' ? Math.max(1, json.bmson.info.resolution || 240) : undefined;

  const notes: NoteRecord[] = [];
  const mines: MineRecord[] = [];
  const changes = new Map<FingerprintTimelineType, Array<{ time: Time; v: Rational }>>();
  const timeline: TimelineRecord[] = [];

  const pushNote = (event: BeMusicEvent, lane: string, endBeat: number | undefined): void => {
    const time = eventToTime(event);
    const note: NoteRecord = { time, lane };
    if (endBeat !== undefined && Number.isFinite(endBeat)) {
      const end = beatToTime(endBeat);
      if (compareTime(end, time) > 0) {
        note.end = end;
        note.ln = resolveLongNoteMode(json, event);
      }
    }
    notes.push(note);
  };
  const pushChange = (type: FingerprintTimelineType, event: BeMusicEvent, value: Rational | undefined): void => {
    if (value === undefined) {
      return;
    }
    let list = changes.get(type);
    if (!list) {
      list = [];
      changes.set(type, list);
    }
    list.push({ time: eventToTime(event), v: snapValue(value) });
  };

  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (isPlayableChannel(channel)) {
      if (lnobj.endEvents.has(event)) {
        continue;
      }
      const length = event.bmson?.l;
      const endBeat =
        bmsonResolution !== undefined && typeof length === 'number' && length > 0
          ? beatResolver.eventToBeat(event) + length / bmsonResolution
          : lnobj.startToEndBeat.get(event);
      pushNote(event, channel, endBeat);
      continue;
    }
    if (isLandmineChannel(channel)) {
      mines.push({
        time: eventToTime(event),
        lane: `${channel.charCodeAt(0) === 0x44 ? '1' : '2'}${channel[1]}`,
        damage: resolveMineDamage(event, idBase),
      });
      continue;
    }
    const key = normalizeObjectKey(event.value, idBase);
    switch (channel) {
      case '03': {
        const bpm = parseBpmFrom03Token(event.value);
        pushChange('bpm', event, bpm > 0 ? rationalFromNumber(bpm) : undefined);
        break;
      }
      case '08': {
        const bpm = json.resources.bpm[key];
        pushChange('bpm', event, typeof bpm === 'number' && bpm > 0 ? rationalFromNumber(bpm) : undefined);
        break;
      }
      case '09': {
        const stop = json.resources.stop[key];
        const units = typeof stop === 'number' && stop > 0 ? rationalFromNumber(stop) : undefined;
        if (units !== undefined) {
          timeline.push({
            time: eventToTime(event),
            type: 'stop',
            v: snapValue(divideRational(units, STOP_UNITS_PER_BEAT)),
          });
        }
        break;
      }
      case 'SC': {
        const scroll = Object.hasOwn(json.bms.scroll, key) ? json.bms.scroll[key] : undefined;
        pushChange('scroll', event, typeof scroll === 'number' ? rationalFromNumber(scroll) : undefined);
        break;
      }
      case 'SP': {
        const speed = Object.hasOwn(json.bms.speed, key) ? json.bms.speed[key] : undefined;
        pushChange('speed', event, typeof speed === 'number' && speed >= 0 ? rationalFromNumber(speed) : undefined);
        break;
      }
      case 'A0': {
        if (json.sourceFormat !== 'bms') {
          break;
        }
        const raw = json.bms.exRank[key];
        const parsed = Number.parseFloat(raw ?? '');
        pushChange(
          'exrank',
          event,
          Number.isFinite(parsed) && parsed > 0 ? parseLeadingDecimalRational(raw!) : undefined,
        );
        break;
      }
      default:
        break;
    }
  }

  for (const longNote of legacyLongNotes.notes) {
    const endBeat =
      typeof longNote.endBeat === 'number' && longNote.endBeat > longNote.beat ? longNote.endBeat : undefined;
    pushNote(longNote.event, longNote.channel, endBeat);
  }

  for (const raw of json.bms.stp) {
    const stp = parseStp(raw);
    if (stp) {
      timeline.push(stp);
    }
  }

  const initialState: Record<FingerprintTimelineType, Rational | undefined> = {
    bpm: snapValue(rationalFromNumber(json.metadata.bpm) ?? createRational(BigInt(DEFAULT_BPM))),
    scroll: RATIONAL_ONE,
    speed: RATIONAL_ONE,
    exrank: undefined,
    stop: undefined,
    stp: undefined,
  };
  for (const type of TIMELINE_CHANGE_TYPES) {
    timeline.push(
      ...collapseChanges(
        type,
        changes.get(type) ?? [],
        applyStateDrops ? initialState[type] : undefined,
        applyStateDrops,
      ),
    );
  }

  notes.sort(compareNoteRecords);
  mines.sort(compareMineRecords);
  timeline.sort(compareTimelineRecords);

  let maxMeasure = -1;
  for (const note of notes) {
    maxMeasure = Math.max(maxMeasure, note.time.m, note.end?.m ?? -1);
  }
  for (const item of [...mines, ...timeline]) {
    maxMeasure = Math.max(maxMeasure, item.time.m);
  }

  return {
    notes: notes.map(formatNoteRecord),
    mines: mines.map((mine) => ({ ...formatTime(mine.time), lane: mine.lane, damage: formatRational(mine.damage) })),
    timeline: timeline.map((item) => ({ ...formatTime(item.time), type: item.type, v: formatRational(item.v) })),
    maxMeasure,
  };
}

/**
 * Keeps the last change of a time (the one be-music applies), then — when `applyStateDrops` — drops changes to the
 * value already in effect. `initial` is the state before the first change (`undefined` for `#EXRANK`, whose first
 * change is always kept).
 */
function collapseChanges(
  type: FingerprintTimelineType,
  changes: ReadonlyArray<{ time: Time; v: Rational }>,
  initial: Rational | undefined,
  applyStateDrops: boolean,
): TimelineRecord[] {
  const lastByTime = new Map<string, { time: Time; v: Rational }>();
  for (const change of changes) {
    const key = `${change.time.m}:${formatRational(change.time.p)}`;
    lastByTime.delete(key);
    lastByTime.set(key, change);
  }
  const ordered = [...lastByTime.values()].sort((left, right) => compareTime(left.time, right.time));
  const records: TimelineRecord[] = [];
  let current = initial;
  for (const change of ordered) {
    if (applyStateDrops && current !== undefined && isRationalEqual(current, change.v)) {
      continue;
    }
    current = change.v;
    records.push({ time: change.time, type, v: change.v });
  }
  return records;
}

function parseStp(raw: string): TimelineRecord | undefined {
  const match = STP_PATTERN.exec(raw);
  if (!match) {
    return undefined;
  }
  const durationMs = Number.parseFloat(match[3]!);
  const duration = parseDecimalRational(match[3]!);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || duration === undefined) {
    return undefined;
  }
  const position = snapToMeasureGrid(createRational(BigInt(Number.parseInt(match[2] ?? '000', 10)), 1000n));
  return {
    time: normalizeTime(Number.parseInt(match[1]!, 10), position),
    type: 'stp',
    v: snapValue(duration),
  };
}

/** Mine damage: bmson `damage`, else the object value read in base 36, else 4 (`00` / not a base-36 pair). */
function resolveMineDamage(event: BeMusicEvent, idBase: 36 | 62): Rational {
  const bmsonDamage = event.bmson?.damage;
  if (typeof bmsonDamage === 'number' && Number.isFinite(bmsonDamage) && bmsonDamage >= 0) {
    return snapValue(rationalFromNumber(bmsonDamage) ?? RATIONAL_ZERO);
  }
  const key = normalizeObjectKey(event.value, idBase);
  const parsed = BASE36_OBJECT_KEY_PATTERN.test(key) ? Number.parseInt(key, 36) : Number.NaN;
  return createRational(BigInt(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MINE_DAMAGE));
}

/** Per-note long-note mode: bmson per-note `t`, else bmson `info.ln_type`, else `#LNMODE`, else 1 (LN). */
function resolveLongNoteMode(json: BeMusicJson, event: BeMusicEvent): number {
  for (const candidate of [event.bmson?.t, json.bmson.info.lnType, json.bms.lnMode]) {
    if (candidate === 1 || candidate === 2 || candidate === 3) {
      return candidate;
    }
  }
  return 1;
}

function eventToTime(event: BeMusicEvent): Time {
  const measure = Number.isFinite(event.measure) ? Math.max(0, Math.floor(event.measure)) : 0;
  const rawDenominator = event.position[1];
  const denominator =
    Number.isFinite(rawDenominator) && rawDenominator > 0 ? Math.max(1, Math.floor(rawDenominator)) : 1;
  const rawNumerator = Number.isFinite(event.position[0]) ? Math.floor(event.position[0]) : 0;
  const numerator = Math.max(0, Math.min(denominator - 1, rawNumerator));
  return normalizeTime(measure, snapToMeasureGrid(createRational(BigInt(numerator), BigInt(denominator))));
}

/** A position that snapped to exactly `1` is position `0` of the next measure. */
function normalizeTime(measure: number, position: Rational): Time {
  if (compareRational(position, RATIONAL_ONE) >= 0) {
    return { m: measure + 1, p: RATIONAL_ZERO };
  }
  return { m: measure, p: compareRational(position, RATIONAL_ZERO) < 0 ? RATIONAL_ZERO : position };
}

/**
 * Inverse of `createBeatResolver`: maps a beat back to `(measure, snapped position)`. Long-note ends are only known as
 * beats (`resolveBmsLongNotes`, `resolveLnobjLongNotes`, bmson `l`), so they come back to the measure grid here.
 */
function createBeatToTimeResolver(json: BeMusicJson): (beat: number) => Time {
  const lengths: number[] = [];
  let maxDefined = -1;
  for (const measure of json.measures) {
    const index = Math.max(0, Math.floor(measure.index));
    lengths[index] = Number.isFinite(measure.length) && measure.length > 0 ? measure.length : 1;
    maxDefined = Math.max(maxDefined, index);
  }
  const starts: number[] = [];
  let total = 0;
  for (let measure = 0; measure <= maxDefined; measure += 1) {
    starts.push(total);
    total += 4 * (lengths[measure] ?? 1);
  }
  const denseLimit = maxDefined + 1;

  return (beat: number): Time => {
    if (!(beat > 0)) {
      return { m: 0, p: RATIONAL_ZERO };
    }
    let measure: number;
    let fraction: number;
    if (beat >= total) {
      const offset = beat - total;
      const measureOffset = Math.floor(offset / 4);
      measure = denseLimit + measureOffset;
      fraction = (offset - measureOffset * 4) / 4;
    } else {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle]! <= beat) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      measure = low;
      fraction = (beat - starts[low]!) / (4 * (lengths[low] ?? 1));
    }
    const position = rationalFromNumber(Math.max(0, fraction)) ?? RATIONAL_ZERO;
    return normalizeTime(measure, snapToMeasureGrid(position));
  };
}

function compareTime(left: Time, right: Time): number {
  return left.m !== right.m ? left.m - right.m : compareRational(left.p, right.p);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNoteRecords(left: NoteRecord, right: NoteRecord): number {
  const byTime = compareTime(left.time, right.time);
  if (byTime !== 0) {
    return byTime;
  }
  const byLane = compareStrings(left.lane, right.lane);
  if (byLane !== 0) {
    return byLane;
  }
  if (left.end === undefined || right.end === undefined) {
    return (left.end === undefined ? 0 : 1) - (right.end === undefined ? 0 : 1);
  }
  return compareTime(left.end, right.end) || (left.ln ?? 0) - (right.ln ?? 0);
}

function compareMineRecords(left: MineRecord, right: MineRecord): number {
  return (
    compareTime(left.time, right.time) ||
    compareStrings(left.lane, right.lane) ||
    compareRational(left.damage, right.damage)
  );
}

function compareTimelineRecords(left: TimelineRecord, right: TimelineRecord): number {
  return (
    compareTime(left.time, right.time) || compareStrings(left.type, right.type) || compareRational(left.v, right.v)
  );
}

function formatTime(time: Time): FingerprintTime {
  return { m: String(time.m), p: formatRational(time.p) };
}

function formatNoteRecord(note: NoteRecord): FingerprintNote {
  const formatted: FingerprintNote = { ...formatTime(note.time), lane: note.lane };
  if (note.end !== undefined && note.ln !== undefined) {
    formatted.end = formatTime(note.end);
    formatted.ln = String(note.ln);
  }
  return formatted;
}

// ---------------------------------------------------------------------------------------------------------------------
// Control flow (`#RANDOM` / `#SWITCH`) for the chart fingerprint
// ---------------------------------------------------------------------------------------------------------------------

type ControlFlowContentEntry = BmsControlFlowHeaderEntry | BmsControlFlowObjectEntry;

type ControlFlowItem =
  | { kind: 'content'; entry: ControlFlowContentEntry }
  | { kind: 'directive'; command: BmsControlFlowCommand; value?: string }
  | { kind: 'block'; block: ControlFlowBlock };

interface ControlFlowBlock {
  type: 'random' | 'switch';
  /** `#RANDOM n` / `#SWITCH n` range. */
  max: number;
  /** Set when only one outcome is possible (`#SETRANDOM n`, `#SETSWITCH n`, `#RANDOM 1`, `#SWITCH 1`). */
  fixedValue?: number;
  items: ControlFlowItem[];
}

interface ControlFlowScope {
  objects: BmsControlFlowObjectEntry[];
  headers: BmsControlFlowHeaderEntry[];
  /** Blocks with more than one outcome, with the `#RANDOM` value `#IF`s inside a `#SWITCH` block compare against. */
  blocks: Array<{ block: ControlFlowBlock; randomValue: number | undefined }>;
}

interface ChartDocumentContext {
  base: 36 | 62;
  maxMeasure: number;
}

function createScope(): ControlFlowScope {
  return { objects: [], headers: [], blocks: [] };
}

/** Nests the flat `json.bms.controlFlow` capture into `#RANDOM` / `#SWITCH` blocks. */
function buildControlFlowTree(entries: ReadonlyArray<BmsControlFlowEntry>): ControlFlowItem[] {
  const root: ControlFlowItem[] = [];
  const stack: ControlFlowBlock[] = [];
  const currentItems = (): ControlFlowItem[] => (stack.length > 0 ? stack[stack.length - 1]!.items : root);

  for (const entry of entries) {
    if (entry.kind !== 'directive') {
      currentItems().push({ kind: 'content', entry });
      continue;
    }
    const { command, value } = entry;
    if (command === 'RANDOM' || command === 'SWITCH' || command === 'SETRANDOM' || command === 'SETSWITCH') {
      const parsed = parsePositiveInteger(value);
      const isSet = command === 'SETRANDOM' || command === 'SETSWITCH';
      const max = parsed ?? 1;
      const block: ControlFlowBlock = {
        type: command === 'RANDOM' || command === 'SETRANDOM' ? 'random' : 'switch',
        max,
        fixedValue: isSet ? max : max <= 1 ? 1 : undefined,
        items: [],
      };
      currentItems().push({ kind: 'block', block });
      stack.push(block);
      continue;
    }
    if (command === 'ENDRANDOM' || command === 'ENDSW') {
      const type = command === 'ENDRANDOM' ? 'random' : 'switch';
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index]!.type === type) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    currentItems().push({ kind: 'directive', command, value });
  }
  return root;
}

interface IfFrame {
  active: boolean;
  matched: boolean;
  hasElse: boolean;
}

interface SwitchFrame {
  value: number;
  active: boolean;
  matched: boolean;
  fallthrough: boolean;
  terminated: boolean;
}

/**
 * Walks one block's items for one outcome with the same frame rules as the parser's `resolveControlFlow`. Active
 * content inside an `#IF` / `#CASE` goes to `conditional`; active content outside any of them (always played, whatever
 * the outcome) goes to `unconditional`. Blocks with one possible outcome are resolved in place.
 */
function evaluateControlFlowItems(
  items: ReadonlyArray<ControlFlowItem>,
  randomValue: number | undefined,
  switchValue: number | undefined,
  conditional: ControlFlowScope,
  unconditional: ControlFlowScope,
): void {
  const ifFrames: IfFrame[] = [];
  const switchFrame: SwitchFrame | undefined =
    switchValue === undefined
      ? undefined
      : { value: switchValue, active: false, matched: false, fallthrough: false, terminated: false };

  for (const item of items) {
    if (item.kind === 'directive') {
      applyControlFlowDirective(item.command, item.value, randomValue, ifFrames, switchFrame);
      continue;
    }
    if ((switchFrame && !switchFrame.active) || ifFrames.some((frame) => !frame.active)) {
      continue;
    }
    const target = switchFrame || ifFrames.length > 0 ? conditional : unconditional;
    if (item.kind === 'content') {
      if (item.entry.kind === 'header') {
        target.headers.push(item.entry);
      } else {
        target.objects.push(item.entry);
      }
      continue;
    }
    const { block } = item;
    if (block.fixedValue !== undefined) {
      if (block.type === 'random') {
        evaluateControlFlowItems(block.items, block.fixedValue, undefined, target, target);
      } else {
        evaluateControlFlowItems(block.items, randomValue, block.fixedValue, target, target);
      }
      continue;
    }
    target.blocks.push({ block, randomValue });
    if (block.type === 'random') {
      // Content of a `#RANDOM` block outside every `#IF` plays whatever the roll, so it belongs to the enclosing scope.
      // `0` matches no `#IF` label.
      evaluateControlFlowItems(block.items, 0, undefined, createScope(), target);
    }
  }
}

function applyControlFlowDirective(
  command: BmsControlFlowCommand,
  rawValue: string | undefined,
  randomValue: number | undefined,
  ifFrames: IfFrame[],
  switchFrame: SwitchFrame | undefined,
): void {
  const label = parsePositiveInteger(rawValue);
  const currentIf = ifFrames[ifFrames.length - 1];
  switch (command) {
    case 'IF': {
      const matched = label !== undefined && randomValue !== undefined && label === randomValue;
      ifFrames.push({ active: matched, matched, hasElse: false });
      return;
    }
    case 'ELSEIF': {
      if (!currentIf || currentIf.hasElse || currentIf.matched) {
        if (currentIf) {
          currentIf.active = false;
        }
        return;
      }
      const matched = label !== undefined && randomValue !== undefined && label === randomValue;
      currentIf.active = matched;
      currentIf.matched ||= matched;
      return;
    }
    case 'ELSE': {
      if (!currentIf || currentIf.hasElse) {
        if (currentIf) {
          currentIf.active = false;
        }
        return;
      }
      currentIf.hasElse = true;
      currentIf.active = !currentIf.matched;
      currentIf.matched = true;
      return;
    }
    case 'ENDIF':
      ifFrames.pop();
      return;
    case 'CASE':
    case 'DEF': {
      if (!switchFrame) {
        return;
      }
      if (switchFrame.terminated) {
        switchFrame.active = false;
        switchFrame.fallthrough = false;
        return;
      }
      if (switchFrame.fallthrough) {
        switchFrame.active = true;
        return;
      }
      const matched = command === 'CASE' ? label !== undefined && label === switchFrame.value : !switchFrame.matched;
      switchFrame.active = matched;
      switchFrame.fallthrough = matched;
      switchFrame.matched ||= matched;
      return;
    }
    case 'SKIP':
      if (switchFrame?.active) {
        switchFrame.terminated = true;
        switchFrame.active = false;
        switchFrame.fallthrough = false;
      }
      return;
    default:
      return;
  }
}

function buildControlFlowNodes(
  blocks: ControlFlowScope['blocks'],
  parent: BeMusicJson,
  context: ChartDocumentContext,
): FingerprintControlFlowNode[] {
  const nodes: FingerprintControlFlowNode[] = [];
  for (const { block, randomValue } of blocks) {
    const node = buildControlFlowNode(block, randomValue, parent, context);
    if (node) {
      nodes.push(node);
    }
  }
  return sortByCanonicalText(nodes);
}

/**
 * One node per `#RANDOM` / `#SWITCH` block: a branch per label the block tests (`#IF` / `#ELSEIF` / `#CASE` values
 * within `1..max`), plus a default branch standing for every other value when some are left. Evaluating per value
 * merges sibling `#IF`s with the same label, and gives `#ELSE` / `#DEF` / fall-through content to exactly the values
 * that reach it.
 */
function buildControlFlowNode(
  block: ControlFlowBlock,
  outerRandomValue: number | undefined,
  parent: BeMusicJson,
  context: ChartDocumentContext,
): FingerprintControlFlowNode | undefined {
  const labels = new Set<number>();
  for (const item of block.items) {
    if (item.kind !== 'directive') {
      continue;
    }
    const isLabel =
      block.type === 'random' ? item.command === 'IF' || item.command === 'ELSEIF' : item.command === 'CASE';
    const label = isLabel ? parsePositiveInteger(item.value) : undefined;
    if (label !== undefined && label <= block.max) {
      labels.add(label);
    }
  }
  const outcomes: Array<{ value: number; isDefault: boolean }> = [...labels]
    .sort((left, right) => left - right)
    .map((value) => ({ value, isDefault: false }));
  if (labels.size < block.max) {
    let representative = 1;
    while (labels.has(representative)) {
      representative += 1;
    }
    outcomes.push({ value: representative, isDefault: true });
  }

  const branches: FingerprintBranch[] = [];
  for (const outcome of outcomes) {
    const scope = createScope();
    if (block.type === 'random') {
      evaluateControlFlowItems(block.items, outcome.value, undefined, scope, createScope());
    } else {
      evaluateControlFlowItems(block.items, outerRandomValue, outcome.value, scope, createScope());
    }
    const branch = buildBranch(scope, parent, context);
    if (branch) {
      branches.push(outcome.isDefault ? { default: true, ...branch } : { when: String(outcome.value), ...branch });
    }
  }
  if (branches.length === 0) {
    return undefined;
  }
  return block.type === 'random' ? { random: String(block.max), branches } : { switch: String(block.max), branches };
}

/**
 * A branch holds only its own content. Definitions it makes (`#BPMxx`, `#STOPxx`, `#LNOBJ`, `#LNTYPE`, …) apply to its
 * own objects and nested branches on top of the enclosing scope's; header values it sets are listed in `header`.
 */
function buildBranch(
  scope: ControlFlowScope,
  parent: BeMusicJson,
  context: ChartDocumentContext,
): Omit<FingerprintBranch, 'when' | 'default'> | undefined {
  const json = forkScopeJson(parent);
  const header: FingerprintBranchHeader = {};
  for (const entry of scope.headers) {
    applyFingerprintHeader(json, entry, context.base, header);
  }
  const lengths = applyScopeObjects(json, scope.objects, context.base);
  const lists = collectFingerprintLists(json, false);
  context.maxMeasure = Math.max(context.maxMeasure, lists.maxMeasure);
  const random = buildControlFlowNodes(scope.blocks, json, context);

  const hasHeader = Object.keys(header).length > 0;
  if (
    !hasHeader &&
    lengths.length === 0 &&
    lists.notes.length === 0 &&
    lists.mines.length === 0 &&
    lists.timeline.length === 0 &&
    random.length === 0
  ) {
    return undefined;
  }
  return {
    ...(hasHeader ? { header } : {}),
    measures: {
      lengths: lengths.map(([measure, length]): [string, string] => [String(measure), formatRational(length)]),
    },
    notes: lists.notes,
    mines: lists.mines,
    timeline: lists.timeline,
    random,
  };
}

/** Copy of `parent` with its definitions but none of its content (`events`, `#STP`), for one branch. */
function forkScopeJson(parent: BeMusicJson): BeMusicJson {
  return {
    ...parent,
    metadata: { ...parent.metadata },
    resources: { ...parent.resources, bpm: { ...parent.resources.bpm }, stop: { ...parent.resources.stop } },
    measures: parent.measures.map((measure) => ({ index: measure.index, length: measure.length })),
    events: [],
    bms: {
      ...parent.bms,
      lnObjs: [...(parent.bms.lnObjs ?? [])],
      exRank: { ...parent.bms.exRank },
      scroll: { ...parent.bms.scroll },
      speed: { ...parent.bms.speed },
      stp: [],
    },
  };
}

/**
 * Appends captured object lines to `json` the way `resolveControlFlow` replays them. Returns the snapped measure
 * lengths the lines set, ordered by measure (the last line of a measure wins).
 */
function applyScopeObjects(
  json: BeMusicJson,
  objects: ReadonlyArray<BmsControlFlowObjectEntry>,
  base: 36 | 62,
): Array<[number, Rational]> {
  const lengths = new Map<number, Rational>();
  for (const object of objects) {
    if (typeof object.measureLength === 'number' && object.measureLength > 0) {
      const existing = json.measures.find((measure) => measure.index === object.measure);
      if (existing) {
        existing.length = object.measureLength;
      } else {
        json.measures.push({ index: object.measure, length: object.measureLength });
      }
      const snapped = snapMeasureLength(object.measureLength);
      if (snapped !== undefined) {
        lengths.set(object.measure, snapped);
      }
    }
    for (const event of object.events) {
      json.events.push({
        measure: object.measure,
        channel: normalizeChannel(object.channel),
        position: event.position,
        value: normalizeObjectKey(event.value, base),
        ...(event.bmson ? { bmson: event.bmson } : {}),
      });
    }
  }
  return [...lengths.entries()].sort((left, right) => left[0] - right[0]);
}

const INDEXED_DEFINITION_PATTERN = /^(BPM|STOP|EXRANK|SCROLL|SPEED)([0-9A-Za-z]{2})$/;

/**
 * Re-applies a captured header line, limited to the headers the fingerprint reads, with the parser's rules
 * (`pushHeaderLine`). Header values are also recorded in `record` for a branch's `header`.
 */
function applyFingerprintHeader(
  json: BeMusicJson,
  entry: BmsControlFlowHeaderEntry,
  base: 36 | 62,
  record?: FingerprintBranchHeader,
): void {
  const { command, value } = entry;
  const numeric = Number.parseFloat(value);
  const indexed = INDEXED_DEFINITION_PATTERN.exec(command);
  if (indexed) {
    const directive = indexed[1]!;
    const keyRaw = base === 62 ? (entry.commandRaw ?? command).slice(directive.length) : indexed[2]!;
    const key = normalizeObjectKey(keyRaw, base);
    if (directive === 'EXRANK') {
      if (value.length > 0) {
        json.bms.exRank[key] = value;
      }
      return;
    }
    if (!Number.isFinite(numeric)) {
      return;
    }
    const target =
      directive === 'BPM'
        ? json.resources.bpm
        : directive === 'STOP'
          ? json.resources.stop
          : directive === 'SCROLL'
            ? json.bms.scroll
            : json.bms.speed;
    target[key] = numeric;
    return;
  }

  switch (command) {
    case 'BPM':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.metadata.bpm = numeric;
        recordValue(record, 'bpm', numeric);
      }
      return;
    case 'BASEBPM':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.bms.baseBpm = numeric;
        recordValue(record, 'baseBpm', numeric);
      }
      return;
    case 'RANK':
      if (Number.isFinite(numeric)) {
        json.metadata.rank = numeric;
        recordValue(record, 'rank', numeric);
      }
      return;
    case 'DEFEXRANK':
      if (Number.isFinite(numeric)) {
        json.bms.defExRank = numeric;
        recordValue(record, 'defExRank', numeric);
      }
      return;
    case 'TOTAL':
      if (Number.isFinite(numeric)) {
        json.metadata.total = numeric;
        recordValue(record, 'total', numeric);
      }
      return;
    case 'LNTYPE':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.bms.lnType = Math.floor(numeric);
      }
      return;
    case 'LNMODE':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.bms.lnMode = Math.floor(numeric);
      }
      return;
    case 'LNOBJ':
      if (value.length > 0) {
        json.bms.lnObjs = [...(json.bms.lnObjs ?? []), normalizeObjectKey(value, base)];
      }
      return;
    case 'STP':
      if (value.length > 0) {
        json.bms.stp.push(value);
      }
      return;
    default:
      return;
  }
}

function recordValue(
  record: FingerprintBranchHeader | undefined,
  key: keyof FingerprintBranchHeader,
  value: number,
): void {
  if (!record) {
    return;
  }
  const rational = rationalFromNumber(value);
  if (rational !== undefined) {
    record[key] = formatRational(snapValue(rational));
  }
}

function sortByCanonicalText<T>(values: T[]): T[] {
  return values
    .map((value) => ({ value, text: canonicalizeJsonValue(value) }))
    .sort((left, right) => compareStrings(left.text, right.text))
    .map((entry) => entry.value);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
