/**
 * Be-Music Fingerprint (`bmfp1`) — identifies a chart by what the player plays and sees in the lanes rather than by its
 * bytes. The normative definition is `docs/fingerprint-spec.md`; this module is its reference implementation.
 */
import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
  type BmsControlFlowEntry,
  type BmsControlFlowHeaderEntry,
} from '@be-music/json';
import type { ChartPlayVariant } from './index.ts';
import { formatRational, isRationalEqual, type Rational } from './fingerprint-rational.ts';
import {
  analyzeControlFlow,
  classOfValue,
  classValueRanges,
  countOutcomePaths,
  type ControlFlowAnalysis,
  type ControlFlowVariable,
  type OutcomeNode,
} from './fingerprint-control-flow.ts';
import {
  bucketEvents,
  bucketOfChannel,
  canonicalizeItems,
  compareMineItems,
  compareNoteItems,
  compareTime,
  compareTimelineItems,
  computeChartItems,
  dropNoOpChanges,
  eventTime,
  flattenItems,
  formatJudge,
  formatLengths,
  formatMine,
  formatNote,
  formatTimeline,
  formatTotal,
  HEADER_BUCKET,
  LENGTHS_BUCKET,
  MINES_BUCKET,
  parseJudge,
  parseMine,
  parseNote,
  parseRational,
  parseTimeline,
  parseTotal,
  resolveLaneModeExtension,
  TIMELINE_TYPES,
  usesInferredLongNoteType,
  type ChartItems,
  type FingerprintJudge,
  type FingerprintLength,
  type FingerprintMine,
  type FingerprintNote,
  type FingerprintTimelineEvent,
  type FingerprintTimelineType,
  type FingerprintTotal,
  type FlatItems,
  type FpTime,
  type HeaderItems,
  type LaneModeExtension,
  type MineItem,
  type NoteItem,
  type TimelineItem,
} from './fingerprint-items.ts';
import { sha256Hex } from './sha256.ts';

export type {
  FingerprintJudge,
  FingerprintLength,
  FingerprintMine,
  FingerprintNote,
  FingerprintTime,
  FingerprintTimelineEvent,
  FingerprintTimelineType,
  FingerprintTotal,
} from './fingerprint-items.ts';

const FINGERPRINT_VERSION = 'bmfp1';

/**
 * Most outcome classes one control-flow factor may have (the product of its segments' path counts). A factor with more
 * is fingerprinted by its source lines instead (spec 3.7).
 */
export const FINGERPRINT_FACTOR_OUTCOME_LIMIT = 1024;

/** The lane-mode inputs that are not part of the parsed chart (spec 3.5). */
export interface BeMusicFingerprintOptions {
  /**
   * Path, file name, or bare extension of the chart, or `undefined` when unknown. Only its extension is read, exactly
   * as in `resolveChartPlayVariant`: `.pms` makes the chart 9 KEY, and `.bme` makes a chart without a 6 / 7 key
   * column 7 / 14 KEY. Part of the fingerprint's input, so it is required.
   */
  chartPath: string | undefined;
}

export interface FingerprintMeasures {
  count: string;
  lengths: FingerprintLength[];
  /** `false` when the chart draws no bar lines (bmson `lines: []`). Omitted otherwise. */
  barLines?: false;
}

/** Document of a chart with one outcome: the play fingerprint, and the chart fingerprint of a chart without `#RANDOM`. */
export interface BeMusicPlayFingerprintDocument {
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
}

export interface FingerprintLaneModeInputs {
  /** `".pms"`, `".bme"`, or `null` for any other or unknown extension. */
  extension: LaneModeExtension;
  player3: boolean;
}

export interface FingerprintDeltaLists {
  notes?: FingerprintNote[];
  mines?: FingerprintMine[];
  timeline?: FingerprintTimelineEvent[];
  lengths?: FingerprintLength[];
}

export interface FingerprintHeaderChange {
  bpm?: string;
  baseBpm?: string | null;
  judge?: FingerprintJudge;
  total?: FingerprintTotal;
  player3?: boolean;
}

export interface FingerprintBranch {
  /** The values of the variable this branch stands for: `"n"` or an inclusive range `"low-high"`, ascending. */
  values: string[];
  add?: FingerprintDeltaLists;
  remove?: FingerprintDeltaLists;
  header?: FingerprintHeaderChange;
  /** A later variable the outcome also depends on. */
  next?: FingerprintRandomNode;
}

export interface FingerprintRandomNode {
  random: string;
  branches: FingerprintBranch[];
}

/** A control-flow factor over the evaluation budget, identified by the SHA-256 of its source lines. */
export interface FingerprintOpaqueNode {
  opaque: string;
}

export type FingerprintControlFlowNode = FingerprintRandomNode | FingerprintOpaqueNode;

/** Document of a chart whose outcome depends on `#RANDOM` / `#SWITCH`. */
export interface BeMusicChartFingerprintDocument {
  v: typeof FINGERPRINT_VERSION;
  lanes: FingerprintLaneModeInputs;
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

export type BeMusicFingerprintDocument = BeMusicPlayFingerprintDocument | BeMusicChartFingerprintDocument;

// ---------------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Builds the canonical document of the **play fingerprint**: the chart exactly as given, i.e. after
 * `resolveBmsControlFlow` chose every `#RANDOM` / `#SWITCH` branch. `json.bms.controlFlow` is ignored.
 */
export function createPlayFingerprintDocument(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions,
): BeMusicPlayFingerprintDocument {
  const items = flattenItems(computeChartItems(json, bucketEvents(json.events)));
  return assemblePlayDocument(items, resolveLaneModeExtension(options.chartPath));
}

/**
 * Builds the canonical document of the **chart fingerprint** from the parser's unresolved output (`parseBms` /
 * `parseChart`), whose `events` hold only the content outside control flow and whose `bms.controlFlow` holds the rest.
 * A chart whose every outcome plays the same (in particular one without control flow) gets its play document.
 */
export function createChartFingerprintDocument(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions,
): BeMusicFingerprintDocument {
  return buildChartModel(json, resolveLaneModeExtension(options.chartPath)).document;
}

/**
 * Serializes a fingerprint document with the JSON Canonicalization Scheme (RFC 8785): object keys sorted by UTF-16
 * code units, no whitespace, ECMAScript string escaping. The fingerprint is the SHA-256 of this text's UTF-8 bytes.
 */
export function canonicalizeFingerprintDocument(document: BeMusicFingerprintDocument): string {
  return canonicalizeJsonValue(document);
}

/** `bmfp1:<sha256>` of the chart fingerprint document. Synchronous and dependency-free, in Node and browsers alike. */
export function computeChartFingerprint(json: BeMusicJson, options: BeMusicFingerprintOptions): string {
  return hashFingerprintDocument(createChartFingerprintDocument(json, options));
}

/** `bmfp1:<sha256>` of the play fingerprint document. Synchronous and dependency-free, in Node and browsers alike. */
export function computePlayFingerprint(json: BeMusicJson, options: BeMusicFingerprintOptions): string {
  return hashFingerprintDocument(createPlayFingerprintDocument(json, options));
}

function hashFingerprintDocument(document: BeMusicFingerprintDocument): string {
  return `${FINGERPRINT_VERSION}:${sha256Hex(canonicalizeFingerprintDocument(document))}`;
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
// Play document
// ---------------------------------------------------------------------------------------------------------------------

function assemblePlayDocument(items: FlatItems, extension: LaneModeExtension): BeMusicPlayFingerprintDocument {
  const lists = canonicalizeItems(items, extension);
  const count = lists.maxMeasure + 1;
  const { header } = items;
  const measures: FingerprintMeasures = { count: String(count), lengths: formatLengths(items.lengths, count) };
  if (!header.barLines) {
    measures.barLines = false;
  }
  return {
    v: FINGERPRINT_VERSION,
    laneMode: lists.laneMode,
    bpm: formatRational(header.bpm),
    baseBpm:
      header.baseBpm === null || isRationalEqual(header.baseBpm, header.bpm) ? null : formatRational(header.baseBpm),
    judge: formatJudge(header.judge),
    total: formatTotal(header.total),
    measures,
    notes: lists.notes,
    mines: lists.mines,
    timeline: lists.timeline,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Deltas: what one outcome of a factor changes in the content outside control flow
// ---------------------------------------------------------------------------------------------------------------------

interface Keyed<T> {
  key: string;
  item: T;
}

interface DeltaLists {
  notes: Array<Keyed<NoteItem>>;
  mines: Array<Keyed<MineItem>>;
  timeline: Array<Keyed<TimelineItem>>;
  lengths: Array<Keyed<[number, Rational]>>;
}

type HeaderField = 'bpm' | 'baseBpm' | 'judge' | 'total' | 'player3';
const HEADER_FIELDS: ReadonlyArray<HeaderField> = ['bpm', 'baseBpm', 'judge', 'total', 'player3'];

interface ItemDelta {
  add: DeltaLists;
  remove: DeltaLists;
  header: Partial<HeaderItems>;
}

function emptyLists(): DeltaLists {
  return { notes: [], mines: [], timeline: [], lengths: [] };
}

function timeKey(time: FpTime): string {
  return `${time.m}:${time.n}/${time.d}`;
}

function noteKey(note: NoteItem): string {
  return `${timeKey(note.t)}|${note.lane}|${note.end ? timeKey(note.end) : ''}|${note.ln ?? ''}|${note.fz ?? ''}`;
}

function mineKey(mine: MineItem): string {
  return `${timeKey(mine.t)}|${mine.lane}|${formatRational(mine.damage)}`;
}

function timelineKey(item: TimelineItem): string {
  return `${item.type}|${timeKey(item.t)}|${formatRational(item.v)}`;
}

function headerFieldText(header: Partial<HeaderItems>, field: HeaderField): string {
  return canonicalizeJsonValue(formatHeaderField(header, field));
}

function formatHeaderField(header: Partial<HeaderItems>, field: HeaderField): unknown {
  switch (field) {
    case 'bpm':
      return header.bpm === undefined ? undefined : formatRational(header.bpm);
    case 'baseBpm':
      return header.baseBpm === undefined ? undefined : header.baseBpm === null ? null : formatRational(header.baseBpm);
    case 'judge':
      return header.judge === undefined ? undefined : formatJudge(header.judge);
    case 'total':
      return header.total === undefined ? undefined : formatTotal(header.total);
    case 'player3':
      return header.player3;
    default:
      return undefined;
  }
}

/** Multiset difference `after - before` and `before - after` of two keyed lists. */
function diffKeyed<T>(
  before: ReadonlyArray<T>,
  after: ReadonlyArray<T>,
  key: (item: T) => string,
  add: Array<Keyed<T>>,
  remove: Array<Keyed<T>>,
): void {
  const counts = new Map<string, { item: T; count: number }>();
  for (const item of before) {
    const k = key(item);
    const entry = counts.get(k);
    if (entry) {
      entry.count -= 1;
    } else {
      counts.set(k, { item, count: -1 });
    }
  }
  for (const item of after) {
    const k = key(item);
    const entry = counts.get(k);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(k, { item, count: 1 });
    }
  }
  for (const [k, entry] of counts) {
    for (let index = 0; index < entry.count; index += 1) {
      add.push({ key: k, item: entry.item });
    }
    for (let index = 0; index > entry.count; index -= 1) {
      remove.push({ key: k, item: entry.item });
    }
  }
}

function isEmptyLists(lists: DeltaLists): boolean {
  return (
    lists.notes.length === 0 && lists.mines.length === 0 && lists.timeline.length === 0 && lists.lengths.length === 0
  );
}

function isEmptyDelta(delta: ItemDelta): boolean {
  return isEmptyLists(delta.add) && isEmptyLists(delta.remove) && Object.keys(delta.header).length === 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Replaying captured lines onto the content outside control flow
// ---------------------------------------------------------------------------------------------------------------------

const INDEXED_DEFINITION_PATTERN = /^(BPM|STOP|EXRANK|SCROLL|SPEED)([0-9A-Za-z]{2})$/;
const ALL_LANES = '*lanes';

interface ReplayContext {
  /** Measures at or after this are past every included event of every outcome (spec 3.6.6). */
  measureLimit: number;
  top: BeMusicJson;
  topBuckets: Map<string, BeMusicEvent[]>;
  topItems: ChartItems;
  base: 36 | 62;
}

/**
 * The chart for one outcome, as the parser's `resolveControlFlow` builds it: the content outside control flow, then the
 * applied lines in file order (headers re-applied with the parser's rules, objects appended). Returns the buckets the
 * lines touch.
 */
function replayEntries(
  context: ReplayContext,
  entries: ReadonlyArray<BmsControlFlowEntry>,
  applied: ReadonlyArray<number>,
): { json: BeMusicJson; buckets: Map<string, BeMusicEvent[]>; touched: Set<string> } {
  const { top, base } = context;
  const json: BeMusicJson = {
    ...top,
    metadata: { ...top.metadata },
    resources: { ...top.resources, bpm: { ...top.resources.bpm }, stop: { ...top.resources.stop } },
    measures: top.measures.map((measure) => ({ index: measure.index, length: measure.length })),
    bms: {
      ...top.bms,
      lnObjs: [...(top.bms.lnObjs ?? [])],
      exRank: { ...top.bms.exRank },
      scroll: { ...top.bms.scroll },
      speed: { ...top.bms.speed },
      stp: [...top.bms.stp],
    },
  };
  const touched = new Set<string>();
  const added = new Map<string, BeMusicEvent[]>();
  for (const index of applied) {
    const entry = entries[index]!;
    if (entry.kind === 'header') {
      applyFingerprintHeader(json, entry, base, touched);
      continue;
    }
    if (entry.kind !== 'object') {
      continue;
    }
    if (typeof entry.measureLength === 'number' && entry.measureLength > 0) {
      const existing = json.measures.find((measure) => measure.index === entry.measure);
      if (existing) {
        existing.length = entry.measureLength;
      } else {
        json.measures.push({ index: entry.measure, length: entry.measureLength });
      }
      touched.add(LENGTHS_BUCKET);
    }
    const channel = normalizeChannel(entry.channel);
    const bucket = bucketOfChannel(channel);
    if (bucket === undefined) {
      continue;
    }
    for (const event of entry.events) {
      const replayed: BeMusicEvent = {
        measure: entry.measure,
        channel,
        position: event.position,
        value: normalizeObjectKey(event.value, base),
        ...(event.bmson ? { bmson: event.bmson } : {}),
      };
      const list = added.get(bucket);
      if (list) {
        list.push(replayed);
      } else {
        added.set(bucket, [replayed]);
      }
      touched.add(bucket);
      if (bucket.startsWith('lane:') && usesInferredLongNoteType(json)) {
        const side = channel.charCodeAt(0);
        if (side === 0x35 || side === 0x36) {
          touched.add(ALL_LANES);
        }
      }
    }
  }
  if (touched.has(ALL_LANES)) {
    touched.delete(ALL_LANES);
    for (const bucket of [...context.topBuckets.keys(), ...added.keys()]) {
      if (bucket.startsWith('lane:')) {
        touched.add(bucket);
      }
    }
  }
  const buckets = new Map(context.topBuckets);
  for (const [bucket, events] of added) {
    const merged = [...(buckets.get(bucket) ?? []), ...events];
    buckets.set(bucket, bucketEvents(merged).get(bucket) ?? []);
  }
  return { json, buckets, touched };
}

/** Re-applies a captured header line, limited to the headers the fingerprint reads, with the parser's rules. */
function applyFingerprintHeader(
  json: BeMusicJson,
  entry: BmsControlFlowHeaderEntry,
  base: 36 | 62,
  touched: Set<string>,
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
        touched.add('tl:exrank');
      }
      return;
    }
    if (!Number.isFinite(numeric)) {
      return;
    }
    switch (directive) {
      case 'BPM':
        json.resources.bpm[key] = numeric;
        touched.add('tl:bpm');
        return;
      case 'STOP':
        json.resources.stop[key] = numeric;
        touched.add('tl:stop');
        return;
      case 'SCROLL':
        json.bms.scroll[key] = numeric;
        touched.add('tl:scroll');
        return;
      default:
        json.bms.speed[key] = numeric;
        touched.add('tl:speed');
        return;
    }
  }

  switch (command) {
    case 'BPM':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.metadata.bpm = numeric;
        touched.add(HEADER_BUCKET);
      }
      return;
    case 'BASEBPM':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.bms.baseBpm = numeric;
        touched.add(HEADER_BUCKET);
      }
      return;
    case 'RANK':
      if (Number.isFinite(numeric)) {
        json.metadata.rank = numeric;
        touched.add(HEADER_BUCKET);
      }
      return;
    case 'DEFEXRANK':
      if (Number.isFinite(numeric)) {
        json.bms.defExRank = numeric;
        touched.add(HEADER_BUCKET);
      }
      return;
    case 'TOTAL':
      if (Number.isFinite(numeric)) {
        json.metadata.total = numeric;
        touched.add(HEADER_BUCKET);
      }
      return;
    case 'PLAYER':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.bms.player = Math.floor(numeric);
        touched.add(HEADER_BUCKET);
      }
      return;
    case 'LNTYPE':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.bms.lnType = Math.floor(numeric);
        touched.add(ALL_LANES);
      }
      return;
    case 'LNMODE':
      if (Number.isFinite(numeric) && numeric > 0) {
        json.bms.lnMode = Math.floor(numeric);
        touched.add(ALL_LANES);
      }
      return;
    case 'LNOBJ':
      if (value.length > 0) {
        json.bms.lnObjs = [...(json.bms.lnObjs ?? []), normalizeObjectKey(value, base)];
        touched.add(ALL_LANES);
      }
      return;
    case 'STP':
      if (value.length > 0) {
        json.bms.stp.push(value);
        touched.add('tl:stp');
      }
      return;
    default:
      return;
  }
}

/** What the lines `applied` change in the content outside control flow. */
function computeDelta(
  context: ReplayContext,
  entries: ReadonlyArray<BmsControlFlowEntry>,
  applied: ReadonlyArray<number>,
): ItemDelta {
  const delta: ItemDelta = { add: emptyLists(), remove: emptyLists(), header: {} };
  if (applied.length === 0) {
    return delta;
  }
  const { json, buckets, touched } = replayEntries(context, entries, applied);
  if (touched.size === 0) {
    return delta;
  }
  const items = computeChartItems(json, buckets, touched, context.topItems);
  const top = context.topItems;
  for (const bucket of touched) {
    if (bucket.startsWith('lane:')) {
      diffKeyed(
        top.lanes.get(bucket) ?? [],
        items.lanes.get(bucket) ?? [],
        noteKey,
        delta.add.notes,
        delta.remove.notes,
      );
    } else if (bucket === MINES_BUCKET) {
      diffKeyed(top.mines, items.mines, mineKey, delta.add.mines, delta.remove.mines);
    } else if (bucket.startsWith('tl:')) {
      const type = bucket.slice(3) as FingerprintTimelineType;
      diffKeyed(
        top.timeline.get(type) ?? [],
        items.timeline.get(type) ?? [],
        timelineKey,
        delta.add.timeline,
        delta.remove.timeline,
      );
    } else if (bucket === LENGTHS_BUCKET) {
      const lengthKey = ([measure, length]: [number, Rational]): string => `${measure}|${formatRational(length)}`;
      const below = ([measure]: [number, Rational]): boolean => measure < context.measureLimit;
      diffKeyed(
        [...top.lengths.entries()].filter(below),
        [...items.lengths.entries()].filter(below),
        lengthKey,
        delta.add.lengths,
        delta.remove.lengths,
      );
    } else if (bucket === HEADER_BUCKET) {
      for (const field of HEADER_FIELDS) {
        if (headerFieldText(items.header, field) !== headerFieldText(top.header, field)) {
          (delta.header as Record<string, unknown>)[field] = items.header[field];
        }
      }
    }
  }
  return delta;
}

// ---------------------------------------------------------------------------------------------------------------------
// Chart model: segments, factors, decision trees
// ---------------------------------------------------------------------------------------------------------------------

interface SegmentPath {
  /** Variable index → classes this path takes. Variables not listed take any value. */
  classes: Map<number, number[]>;
  entries: number[];
}

interface SegmentModel {
  index: number;
  start: number;
  end: number;
  variables: number[];
  /** Paths and their deltas, or `undefined` for an opaque segment (over budget). */
  paths?: SegmentPath[];
  deltas?: ItemDelta[];
  sets: Set<string>;
  uses: Set<string>;
  timeKeys: Set<string>;
  /** Lane → [low, high] of the times the segment can affect in that lane (only lanes where long notes pair). */
  hulls: Map<string, [FpTime | null, FpTime | null]>;
}

/** A decision tree over the factor's variables in file order, reduced; leaves are deltas. */
type DeltaTree =
  | { kind: 'leaf'; delta: ItemDelta; text: string }
  | { kind: 'node'; variable: number; branches: Array<{ classes: number[]; tree: DeltaTree }>; text: string };

interface FactorModel {
  segments: SegmentModel[];
  tree?: DeltaTree;
  opaque?: string;
}

interface ChartModel {
  document: BeMusicFingerprintDocument;
  analysis?: ControlFlowAnalysis;
  /** Content every outcome plays, after hoisting, before the state-dependent drops. */
  topFlat?: FlatItems;
  factors: FactorModel[];
  extension: LaneModeExtension;
}

function buildChartModel(json: BeMusicJson, extension: LaneModeExtension): ChartModel {
  const entries = json.bms.controlFlow;
  const topBuckets = bucketEvents(json.events);
  const topItems = computeChartItems(json, topBuckets);
  if (entries.length === 0) {
    return { document: assemblePlayDocument(flattenItems(topItems), extension), factors: [], extension };
  }

  const analysis = analyzeControlFlow(entries);
  const context: ReplayContext = {
    measureLimit: resolveMeasureLimit(topItems, entries, json),
    top: json,
    topBuckets,
    topItems,
    base: resolveBmsBase(json),
  };
  const pairing = resolvePairingStreams(json, entries, topBuckets);
  const segments: SegmentModel[] = [];
  for (const segment of analysis.segments) {
    if (!segment.hasContent) {
      continue;
    }
    const model: SegmentModel = {
      index: segments.length,
      start: segment.start,
      end: segment.end,
      variables: segment.variables,
      sets: new Set(),
      uses: new Set(),
      timeKeys: new Set(),
      hulls: new Map(),
    };
    collectStaticKeys(model, entries, context.base, usesInferredLongNoteType(json));
    if (
      segment.root &&
      countOutcomePaths(segment.root, FINGERPRINT_FACTOR_OUTCOME_LIMIT) <= FINGERPRINT_FACTOR_OUTCOME_LIMIT
    ) {
      model.paths = enumeratePaths(segment.root);
      model.deltas = model.paths.map((path) => computeDelta(context, entries, path.entries));
    }
    collectDynamicKeys(model, entries, pairing);
    segments.push(model);
  }

  // Factors: segments whose outcomes interact are evaluated together.
  const parent = segments.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    parent[index] = root;
    return root;
  };
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      if (segmentsInteract(segments[left]!, segments[right]!)) {
        const a = find(left);
        const b = find(right);
        if (a !== b) {
          parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
  }
  const groups = new Map<number, SegmentModel[]>();
  for (const segment of segments) {
    const root = find(segment.index);
    const group = groups.get(root);
    if (group) {
      group.push(segment);
    } else {
      groups.set(root, [segment]);
    }
  }

  const factors: FactorModel[] = [];
  for (const group of groups.values()) {
    factors.push(buildFactor(group, entries, context, analysis));
  }

  // Hoist what every outcome of a factor does into the content outside control flow.
  const topFlat = flattenItems(topItems);
  for (const factor of factors) {
    if (factor.tree) {
      factor.tree = hoistCommon(factor.tree, topFlat);
    }
  }
  const liveFactors = factors.filter(
    (factor) => factor.opaque !== undefined || (factor.tree && !isEmptyTree(factor.tree)),
  );
  if (liveFactors.length === 0) {
    return { document: assemblePlayDocument(topFlat, extension), analysis, topFlat, factors: [], extension };
  }
  const document = assembleChartDocument(topFlat, liveFactors, extension, analysis, context.measureLimit);
  return { document, analysis, topFlat, factors: liveFactors, extension };
}

const STP_MEASURE_PATTERN = /^\s*(\d{3})/;

/**
 * One more than the last measure any outcome can hold an included event in: the events outside control flow, and every
 * object of an included channel and every `#STP` in control-flow lines (plus the measure after a `5x` / `6x` object,
 * where an `#LNTYPE 2` run can end). Spec 3.6.6.
 */
function resolveMeasureLimit(top: ChartItems, entries: ReadonlyArray<BmsControlFlowEntry>, json: BeMusicJson): number {
  let last = -1;
  const flat = flattenItems(top);
  for (const note of flat.notes) {
    last = Math.max(last, note.t.m, note.end?.m ?? -1);
  }
  for (const item of [...flat.mines, ...flat.timeline]) {
    last = Math.max(last, item.t.m);
  }
  for (const raw of json.bms.stp) {
    const match = STP_MEASURE_PATTERN.exec(raw);
    if (match) {
      last = Math.max(last, Number.parseInt(match[1]!, 10));
    }
  }
  for (const entry of entries) {
    if (entry.kind === 'header' && entry.command === 'STP') {
      const match = STP_MEASURE_PATTERN.exec(entry.value);
      if (match) {
        last = Math.max(last, Number.parseInt(match[1]!, 10));
      }
      continue;
    }
    if (entry.kind !== 'object' || entry.events.length === 0) {
      continue;
    }
    const channel = normalizeChannel(entry.channel);
    if (bucketOfChannel(channel) === undefined) {
      continue;
    }
    const legacy = streamOfChannel(channel)?.legacy === true;
    last = Math.max(last, entry.measure + (legacy ? 1 : 0));
  }
  return last + 1;
}

/**
 * Pairing streams (spec 3.6.3): the sequences of objects whose order decides which objects pair into long notes. Per
 * lane, `obj:<lane>` holds the `1x` / `2x` objects (`#LNOBJ` ends pair with the object before them) and `ln:<lane>`
 * the `5x` / `6x` objects (`#LNTYPE` pairs them by order). A stream counts only when it can pair at all: `obj:` when
 * some `#LNOBJ` exists, `ln:` when the lane has `5x` / `6x` objects anywhere. Each stream lists the times of its
 * objects outside control flow.
 */
interface PairingStreams {
  obj: boolean;
  lnLanes: Set<string>;
  topTimes: Map<string, FpTime[]>;
}

function streamOfChannel(channel: string): { stream: string; legacy: boolean } | undefined {
  const side = channel.charCodeAt(0);
  if (side === 0x31 || side === 0x32) {
    return { stream: `obj:${channel}`, legacy: false };
  }
  if (side === 0x35 || side === 0x36) {
    return { stream: `ln:${side === 0x35 ? '1' : '2'}${channel[1]}`, legacy: true };
  }
  return undefined;
}

function resolvePairingStreams(
  json: BeMusicJson,
  entries: ReadonlyArray<BmsControlFlowEntry>,
  topBuckets: Map<string, BeMusicEvent[]>,
): PairingStreams {
  let obj = json.sourceFormat === 'bms' && (json.bms.lnObjs ?? []).length > 0;
  const lnLanes = new Set<string>();
  const topTimes = new Map<string, FpTime[]>();
  for (const [bucket, events] of topBuckets) {
    if (!bucket.startsWith('lane:')) {
      continue;
    }
    for (const event of events) {
      const target = streamOfChannel(normalizeChannel(event.channel));
      if (!target) {
        continue;
      }
      if (target.legacy) {
        lnLanes.add(target.stream.slice(3));
      }
      const list = topTimes.get(target.stream);
      if (list) {
        list.push(eventTime(event));
      } else {
        topTimes.set(target.stream, [eventTime(event)]);
      }
    }
  }
  for (const list of topTimes.values()) {
    list.sort(compareTime);
  }
  for (const entry of entries) {
    if (entry.kind === 'header' && entry.command === 'LNOBJ' && entry.value.length > 0) {
      obj = true;
    } else if (entry.kind === 'object') {
      const target = streamOfChannel(normalizeChannel(entry.channel));
      if (target?.legacy) {
        lnLanes.add(target.stream.slice(3));
      }
    }
  }
  return { obj, lnLanes, topTimes };
}

/** Definitions a segment sets and uses, from every line it holds (whatever the outcome). */
function collectStaticKeys(
  model: SegmentModel,
  entries: ReadonlyArray<BmsControlFlowEntry>,
  base: 36 | 62,
  inferredLnType: boolean,
): void {
  for (let index = model.start; index < model.end; index += 1) {
    const entry = entries[index]!;
    if (entry.kind === 'header') {
      const indexed = INDEXED_DEFINITION_PATTERN.exec(entry.command);
      if (indexed) {
        const keyRaw = base === 62 ? (entry.commandRaw ?? entry.command).slice(indexed[1]!.length) : indexed[2]!;
        model.sets.add(`D:${indexed[1]}:${normalizeObjectKey(keyRaw, base)}`);
        continue;
      }
      switch (entry.command) {
        case 'BPM':
        case 'BASEBPM':
        case 'TOTAL':
        case 'PLAYER':
          model.sets.add(`H:${entry.command}`);
          break;
        case 'RANK':
        case 'DEFEXRANK':
          model.sets.add('H:JUDGE');
          break;
        case 'LNOBJ':
        case 'LNTYPE':
        case 'LNMODE':
          model.sets.add('D:LN');
          break;
        default:
          break;
      }
      continue;
    }
    if (entry.kind !== 'object') {
      continue;
    }
    if (typeof entry.measureLength === 'number' && entry.measureLength > 0) {
      model.sets.add(`M:${entry.measure}`);
    }
    const channel = normalizeChannel(entry.channel);
    const bucket = bucketOfChannel(channel);
    if (bucket === undefined) {
      continue;
    }
    if (bucket.startsWith('lane:')) {
      model.uses.add('D:LN');
      const side = channel.charCodeAt(0);
      if (inferredLnType && (side === 0x35 || side === 0x36)) {
        model.sets.add('D:LNTYPE?');
      }
      continue;
    }
    const definition =
      channel === '08'
        ? 'BPM'
        : channel === '09'
          ? 'STOP'
          : channel === 'SC'
            ? 'SCROLL'
            : channel === 'SP'
              ? 'SPEED'
              : channel === 'A0'
                ? 'EXRANK'
                : undefined;
    for (const event of entry.events) {
      if (definition !== undefined) {
        model.uses.add(`D:${definition}:${normalizeObjectKey(event.value, base)}`);
      }
      if (bucket.startsWith('tl:')) {
        model.timeKeys.add(`${bucket}|${timeKey(eventTime({ ...event, measure: entry.measure }))}`);
      }
    }
  }
  if (model.sets.has('D:LNTYPE?')) {
    model.uses.add('D:LNTYPE?');
  }
}

/**
 * Times a segment touches: the timeline times of its deltas, and for each pairing stream the stretch it can affect —
 * from the last object of the stream outside control flow before the segment's first object (or the deltas' first
 * note) to the first one after its last (spec 3.6.3).
 */
function collectDynamicKeys(
  model: SegmentModel,
  entries: ReadonlyArray<BmsControlFlowEntry>,
  pairing: PairingStreams,
): void {
  const raw = new Map<string, [FpTime, FpTime]>();
  const widen = (stream: string, time: FpTime): void => {
    const hull = raw.get(stream);
    if (!hull) {
      raw.set(stream, [time, time]);
      return;
    }
    if (compareTime(time, hull[0]) < 0) {
      hull[0] = time;
    }
    if (compareTime(time, hull[1]) > 0) {
      hull[1] = time;
    }
  };
  for (let index = model.start; index < model.end; index += 1) {
    const entry = entries[index]!;
    if (entry.kind !== 'object') {
      continue;
    }
    const target = streamOfChannel(normalizeChannel(entry.channel));
    if (!target) {
      continue;
    }
    for (const event of entry.events) {
      const time = eventTime({ ...event, measure: entry.measure });
      widen(target.stream, time);
      if (target.legacy) {
        // A `5x` / `6x` object also resets `#LNOBJ` pairing at its tick.
        widen(`obj:${target.stream.slice(3)}`, time);
      }
    }
  }
  for (const delta of model.deltas ?? []) {
    for (const lists of [delta.add, delta.remove]) {
      for (const { item } of lists.timeline) {
        model.timeKeys.add(`tl:${item.type}|${timeKey(item.t)}`);
      }
      for (const { item } of lists.notes) {
        for (const stream of [`obj:${item.lane}`, `ln:${item.lane}`]) {
          widen(stream, item.t);
          if (item.end) {
            widen(stream, item.end);
          }
        }
      }
    }
  }
  for (const [stream, [low, high]] of raw) {
    const pairs = stream.startsWith('obj:') ? pairing.obj : pairing.lnLanes.has(stream.slice(3));
    if (!pairs) {
      continue;
    }
    if (!model.deltas) {
      model.hulls.set(stream, [null, null]);
      continue;
    }
    let before: FpTime | null = null;
    let after: FpTime | null = null;
    for (const time of pairing.topTimes.get(stream) ?? []) {
      if (compareTime(time, low) < 0) {
        before = time;
      } else if (compareTime(time, high) > 0) {
        after = time;
        break;
      }
    }
    model.hulls.set(stream, [before, after]);
  }
}

function hullsOverlap(left: [FpTime | null, FpTime | null], right: [FpTime | null, FpTime | null]): boolean {
  // Closed intervals; `null` is −∞ for a low end and +∞ for a high end.
  const leftLowBeforeRightHigh = left[0] === null || right[1] === null || compareTime(left[0], right[1]) <= 0;
  const rightLowBeforeLeftHigh = right[0] === null || left[1] === null || compareTime(right[0], left[1]) <= 0;
  return leftLowBeforeRightHigh && rightLowBeforeLeftHigh;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const key of small) {
    if (large.has(key)) {
      return true;
    }
  }
  return false;
}

/** Spec 3.6.3: two segments interact when one's outcome can change how the other's content plays. */
function segmentsInteract(left: SegmentModel, right: SegmentModel): boolean {
  if (intersects(left.sets, right.sets) || intersects(left.sets, right.uses) || intersects(right.sets, left.uses)) {
    return true;
  }
  if (intersects(left.timeKeys, right.timeKeys)) {
    return true;
  }
  for (const [bucket, hull] of left.hulls) {
    const other = right.hulls.get(bucket);
    if (other && hullsOverlap(hull, other)) {
      return true;
    }
  }
  return false;
}

/** All paths of a segment's diagram, iteratively. */
function enumeratePaths(root: OutcomeNode): SegmentPath[] {
  const paths: SegmentPath[] = [];
  const stack: Array<{ node: OutcomeNode; classes: Map<number, number[]>; entries: number[] }> = [
    { node: root, classes: new Map(), entries: [] },
  ];
  while (stack.length > 0) {
    let { node, classes, entries } = stack.pop()!;
    while (node.kind === 'emit') {
      entries = [...entries, node.entry];
      node = node.next;
    }
    if (node.kind === 'end') {
      paths.push({ classes, entries });
      continue;
    }
    for (let index = node.branches.length - 1; index >= 0; index -= 1) {
      const branch = node.branches[index]!;
      const next = new Map(classes);
      next.set(node.variable, branch.classes);
      stack.push({ node: branch.node, classes: next, entries });
    }
  }
  return paths;
}

function buildFactor(
  segments: SegmentModel[],
  entries: ReadonlyArray<BmsControlFlowEntry>,
  context: ReplayContext,
  analysis: ControlFlowAnalysis,
): FactorModel {
  const opaque = (): FactorModel => {
    const lines: BmsControlFlowEntry[] = [];
    for (const segment of segments) {
      lines.push(...entries.slice(segment.start, segment.end));
    }
    return { segments, opaque: sha256Hex(canonicalizeJsonValue(lines)) };
  };
  if (segments.some((segment) => segment.paths === undefined)) {
    return opaque();
  }
  let joint: Array<{ classes: Map<number, number[]>; delta: ItemDelta }>;
  if (segments.length === 1) {
    const [segment] = segments;
    joint = segment!.paths!.map((path, index) => ({ classes: path.classes, delta: segment!.deltas![index]! }));
  } else {
    let total = 1;
    for (const segment of segments) {
      total *= segment.paths!.length;
      if (total > FINGERPRINT_FACTOR_OUTCOME_LIMIT) {
        return opaque();
      }
    }
    let combos: SegmentPath[] = [{ classes: new Map(), entries: [] }];
    for (const segment of segments) {
      const next: SegmentPath[] = [];
      for (const combo of combos) {
        for (const path of segment.paths!) {
          next.push({
            classes: new Map([...combo.classes, ...path.classes]),
            entries: [...combo.entries, ...path.entries],
          });
        }
      }
      combos = next;
    }
    joint = combos.map((combo) => ({ classes: combo.classes, delta: computeDelta(context, entries, combo.entries) }));
  }
  const variables = segments.flatMap((segment) => segment.variables).map((index) => analysis.variables[index]!);
  return { segments, tree: buildDeltaTree(variables, 0, joint) };
}

/**
 * Reduced ordered decision tree over `variables[from..]` for paths that partition the outcomes (spec 3.6.4). Subtrees
 * are compared by a text that includes the variables they test, so the tree maps every outcome to its own delta;
 * {@link formatTree} later merges branches whose documents are equal.
 */
function buildDeltaTree(
  variables: ReadonlyArray<ControlFlowVariable>,
  from: number,
  paths: ReadonlyArray<{ classes: Map<number, number[]>; delta: ItemDelta }>,
  memo: Map<string, DeltaTree> = new Map(),
  indices: ReadonlyArray<number> = paths.map((_, index) => index),
): DeltaTree {
  const memoKey = `${from}|${indices.join(',')}`;
  const known = memo.get(memoKey);
  if (known) {
    return known;
  }
  let tree: DeltaTree;
  let level = from;
  while (level < variables.length && !indices.some((index) => paths[index]!.classes.has(variables[level]!.index))) {
    level += 1;
  }
  if (level >= variables.length) {
    if (indices.length !== 1) {
      throw new Error('fingerprint: control-flow paths do not partition the outcomes');
    }
    const delta = paths[indices[0]!]!.delta;
    tree = { kind: 'leaf', delta, text: canonicalizeJsonValue(formatDelta(delta)) };
  } else {
    const variable = variables[level]!;
    const groups = new Map<string, { classes: number[]; tree: DeltaTree }>();
    for (const value of variable.classes) {
      const matching = indices.filter((index) => {
        const classes = paths[index]!.classes.get(variable.index);
        return classes === undefined || classes.includes(value);
      });
      const child = buildDeltaTree(variables, level + 1, paths, memo, matching);
      const group = groups.get(child.text);
      if (group) {
        group.classes.push(value);
      } else {
        groups.set(child.text, { classes: [value], tree: child });
      }
    }
    tree = groups.size === 1 ? [...groups.values()][0]!.tree : createNode(variable.index, [...groups.values()]);
  }
  memo.set(memoKey, tree);
  return tree;
}

function createNode(variable: number, branches: Array<{ classes: number[]; tree: DeltaTree }>): DeltaTree {
  const text = `{${variable}:${branches.map((branch) => `${branch.classes.join(',')}=${branch.tree.text}`).join(';')}}`;
  return { kind: 'node', variable, branches, text };
}

function isEmptyTree(tree: DeltaTree): boolean {
  return tree.kind === 'leaf' && isEmptyDelta(tree.delta);
}

function treeLeaves(tree: DeltaTree, out: ItemDelta[] = []): ItemDelta[] {
  if (tree.kind === 'leaf') {
    out.push(tree.delta);
  } else {
    for (const branch of tree.branches) {
      treeLeaves(branch.tree, out);
    }
  }
  return out;
}

function commonKeyed<T>(lists: ReadonlyArray<ReadonlyArray<Keyed<T>>>): Array<Keyed<T>> {
  let counts: Map<string, { item: Keyed<T>; count: number }> | undefined;
  for (const list of lists) {
    const local = new Map<string, { item: Keyed<T>; count: number }>();
    for (const entry of list) {
      const existing = local.get(entry.key);
      if (existing) {
        existing.count += 1;
      } else {
        local.set(entry.key, { item: entry, count: 1 });
      }
    }
    if (counts === undefined) {
      counts = local;
    } else {
      for (const [key, value] of counts) {
        value.count = Math.min(value.count, local.get(key)?.count ?? 0);
      }
    }
  }
  const common: Array<Keyed<T>> = [];
  for (const { item, count } of counts?.values() ?? []) {
    for (let index = 0; index < count; index += 1) {
      common.push(item);
    }
  }
  return common;
}

function subtractKeyed<T>(list: ReadonlyArray<Keyed<T>>, remove: ReadonlyArray<Keyed<T>>): Array<Keyed<T>> {
  const counts = new Map<string, number>();
  for (const entry of remove) {
    counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  }
  const kept: Array<Keyed<T>> = [];
  for (const entry of list) {
    const count = counts.get(entry.key) ?? 0;
    if (count > 0) {
      counts.set(entry.key, count - 1);
    } else {
      kept.push(entry);
    }
  }
  return kept;
}

/**
 * Moves what every leaf of a factor does into `top` (spec 3.6.5) and rebuilds the factor's tree without it. A factor
 * whose leaves are then all empty plays the same for every outcome.
 */
function hoistCommon(tree: DeltaTree, top: FlatItems): DeltaTree {
  const leaves = treeLeaves(tree);
  const common: ItemDelta = { add: emptyLists(), remove: emptyLists(), header: {} };
  for (const side of ['add', 'remove'] as const) {
    common[side] = {
      notes: commonKeyed(leaves.map((leaf) => leaf[side].notes)),
      mines: commonKeyed(leaves.map((leaf) => leaf[side].mines)),
      timeline: commonKeyed(leaves.map((leaf) => leaf[side].timeline)),
      lengths: commonKeyed(leaves.map((leaf) => leaf[side].lengths)),
    };
  }
  for (const field of HEADER_FIELDS) {
    const first = leaves[0]!.header;
    if (!(field in first)) {
      continue;
    }
    const text = headerFieldText(first, field);
    if (leaves.every((leaf) => field in leaf.header && headerFieldText(leaf.header, field) === text)) {
      (common.header as Record<string, unknown>)[field] = first[field];
    }
  }
  if (isEmptyDelta(common)) {
    return tree;
  }
  applyDelta(top, common);
  return mapTree(tree, (delta) => ({
    add: {
      notes: subtractKeyed(delta.add.notes, common.add.notes),
      mines: subtractKeyed(delta.add.mines, common.add.mines),
      timeline: subtractKeyed(delta.add.timeline, common.add.timeline),
      lengths: subtractKeyed(delta.add.lengths, common.add.lengths),
    },
    remove: {
      notes: subtractKeyed(delta.remove.notes, common.remove.notes),
      mines: subtractKeyed(delta.remove.mines, common.remove.mines),
      timeline: subtractKeyed(delta.remove.timeline, common.remove.timeline),
      lengths: subtractKeyed(delta.remove.lengths, common.remove.lengths),
    },
    header: Object.fromEntries(
      Object.entries(delta.header).filter(([field]) => !(field in common.header)),
    ) as Partial<HeaderItems>,
  }));
}

/** Rebuilds a tree with every leaf transformed, re-reducing it (leaves that became equal merge). */
function mapTree(tree: DeltaTree, transform: (delta: ItemDelta) => ItemDelta): DeltaTree {
  if (tree.kind === 'leaf') {
    const delta = transform(tree.delta);
    return { kind: 'leaf', delta, text: canonicalizeJsonValue(formatDelta(delta)) };
  }
  const groups = new Map<string, { classes: number[]; tree: DeltaTree }>();
  for (const branch of tree.branches) {
    const mapped = mapTree(branch.tree, transform);
    const group = groups.get(mapped.text);
    if (group) {
      group.classes.push(...branch.classes);
    } else {
      groups.set(mapped.text, { classes: [...branch.classes], tree: mapped });
    }
  }
  return groups.size === 1 ? [...groups.values()][0]!.tree : createNode(tree.variable, [...groups.values()]);
}

/** `top - delta.remove + delta.add`, header fields overridden. */
function applyDelta(top: FlatItems, delta: ItemDelta): void {
  top.notes = applyKeyed(top.notes, noteKey, delta.remove.notes, delta.add.notes);
  top.mines = applyKeyed(top.mines, mineKey, delta.remove.mines, delta.add.mines);
  top.timeline = applyKeyed(top.timeline, timelineKey, delta.remove.timeline, delta.add.timeline);
  const lengths = new Map(top.lengths);
  for (const { item } of delta.remove.lengths) {
    lengths.delete(item[0]);
  }
  for (const { item } of delta.add.lengths) {
    lengths.set(item[0], item[1]);
  }
  top.lengths = lengths;
  top.header = { ...top.header, ...delta.header };
}

function applyKeyed<T>(
  list: ReadonlyArray<T>,
  key: (item: T) => string,
  remove: ReadonlyArray<Keyed<T>>,
  add: ReadonlyArray<Keyed<T>>,
): T[] {
  const keyed = list.map((item) => ({ key: key(item), item }));
  const kept = subtractKeyed(keyed, remove);
  if (kept.length + remove.length !== keyed.length) {
    throw new Error('fingerprint: a removed item is not present');
  }
  return [...kept.map((entry) => entry.item), ...add.map((entry) => entry.item)];
}

// ---------------------------------------------------------------------------------------------------------------------
// Chart document assembly
// ---------------------------------------------------------------------------------------------------------------------

function formatDeltaLists(lists: DeltaLists): FingerprintDeltaLists {
  const formatted: FingerprintDeltaLists = {};
  if (lists.notes.length > 0) {
    formatted.notes = lists.notes
      .map((entry) => entry.item)
      .sort(compareNoteItems)
      .map((note) => formatNote(note, 'raw'));
  }
  if (lists.mines.length > 0) {
    formatted.mines = lists.mines
      .map((entry) => entry.item)
      .sort(compareMineItems)
      .map(formatMine);
  }
  if (lists.timeline.length > 0) {
    formatted.timeline = lists.timeline
      .map((entry) => entry.item)
      .sort(compareTimelineItems)
      .map(formatTimeline);
  }
  if (lists.lengths.length > 0) {
    formatted.lengths = lists.lengths
      .map((entry) => entry.item)
      .sort((left, right) => left[0] - right[0])
      .map(([measure, length]): FingerprintLength => [String(measure), formatRational(length)]);
  }
  return formatted;
}

function formatDelta(delta: ItemDelta): Omit<FingerprintBranch, 'values' | 'next'> {
  const formatted: Omit<FingerprintBranch, 'values' | 'next'> = {};
  const add = formatDeltaLists(delta.add);
  const remove = formatDeltaLists(delta.remove);
  if (Object.keys(add).length > 0) {
    formatted.add = add;
  }
  if (Object.keys(remove).length > 0) {
    formatted.remove = remove;
  }
  const header: FingerprintHeaderChange = {};
  for (const field of HEADER_FIELDS) {
    if (field in delta.header) {
      (header as Record<string, unknown>)[field] = formatHeaderField(delta.header, field);
    }
  }
  if (Object.keys(header).length > 0) {
    formatted.header = header;
  }
  return formatted;
}

function formatValueRanges(ranges: ReadonlyArray<[number, number]>): string[] {
  return ranges.map(([low, high]) => (low === high ? String(low) : `${low}-${high}`));
}

/**
 * The document node of a tree. Branches whose documents are equal merge (their outcomes play alike, whichever later
 * variable decides them), and a node left with one branch is that branch's nested node.
 */
function formatTree(tree: DeltaTree & { kind: 'node' }, analysis: ControlFlowAnalysis): FingerprintRandomNode {
  const variable = analysis.variables[tree.variable]!;
  const groups = new Map<string, { classes: number[]; content: Omit<FingerprintBranch, 'values'> }>();
  for (const branch of tree.branches) {
    const content: Omit<FingerprintBranch, 'values'> =
      branch.tree.kind === 'node' ? { next: formatTree(branch.tree, analysis) } : formatDelta(branch.tree.delta);
    const text = canonicalizeJsonValue(content);
    const group = groups.get(text);
    if (group) {
      group.classes.push(...branch.classes);
    } else {
      groups.set(text, { classes: [...branch.classes], content });
    }
  }
  if (groups.size === 1) {
    const only = [...groups.values()][0]!.content;
    if (only.next) {
      return only.next;
    }
  }
  const branches = [...groups.values()].map(({ classes, content }) => {
    const ranges = classValueRanges(variable, classes);
    return { first: ranges[0]![0], branch: { values: formatValueRanges(ranges), ...content } as FingerprintBranch };
  });
  branches.sort((left, right) => left.first - right.first);
  return { random: String(variable.max), branches: branches.map((entry) => entry.branch) };
}

function assembleChartDocument(
  top: FlatItems,
  factors: ReadonlyArray<FactorModel>,
  extension: LaneModeExtension,
  analysis: ControlFlowAnalysis,
  count: number,
): BeMusicChartFingerprintDocument {
  // State kinds some factor can change: their no-op drops depend on the outcome (spec 3.4).
  const touched = new Set<string>();
  let anyOpaque = false;
  for (const factor of factors) {
    if (factor.opaque !== undefined || !factor.tree) {
      anyOpaque = true;
      continue;
    }
    for (const leaf of treeLeaves(factor.tree)) {
      for (const lists of [leaf.add, leaf.remove]) {
        for (const { item } of lists.timeline) {
          touched.add(item.type);
        }
      }
      if ('bpm' in leaf.header) {
        touched.add('bpm');
      }
      if ('bpm' in leaf.header || 'baseBpm' in leaf.header) {
        touched.add('baseBpm');
      }
    }
  }

  const timeline: TimelineItem[] = [];
  for (const type of TIMELINE_TYPES) {
    const items = top.timeline.filter((item) => item.type === type);
    timeline.push(...(anyOpaque || touched.has(type) ? items : dropNoOpChanges(type, items, top.header.bpm)));
  }
  timeline.sort(compareTimelineItems);

  const random = factors.map((factor): FingerprintControlFlowNode => {
    if (factor.opaque !== undefined || !factor.tree || factor.tree.kind !== 'node') {
      return { opaque: factor.opaque ?? '' };
    }
    return formatTree(factor.tree, analysis);
  });
  const { header } = top;
  const baseBpmIsBpm = header.baseBpm !== null && isRationalEqual(header.baseBpm, header.bpm);
  return {
    v: FINGERPRINT_VERSION,
    lanes: { extension, player3: header.player3 },
    bpm: formatRational(header.bpm),
    baseBpm:
      header.baseBpm === null || (baseBpmIsBpm && !anyOpaque && !touched.has('baseBpm'))
        ? null
        : formatRational(header.baseBpm),
    judge: formatJudge(header.judge),
    total: formatTotal(header.total),
    measures: { count: String(count), lengths: formatLengths(top.lengths, count) },
    notes: [...top.notes].sort(compareNoteItems).map((note) => formatNote(note, 'raw')),
    mines: [...top.mines].sort(compareMineItems).map(formatMine),
    timeline: timeline.map(formatTimeline),
    random: sortByCanonicalText(random),
  };
}

function sortByCanonicalText<T>(values: T[]): T[] {
  return values
    .map((value) => ({ value, text: canonicalizeJsonValue(value) }))
    .sort((left, right) => (left.text < right.text ? -1 : left.text > right.text ? 1 : 0))
    .map((entry) => entry.value);
}

// ---------------------------------------------------------------------------------------------------------------------
// Composition (used by tests and by verifiers): the play document of one outcome
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A function from an outcome (the value of every `#RANDOM` / `#SWITCH` line in file order, as a play log's
 * `randomOutcomes` records it) to its play document, composed from the chart model rather than by resolving the chart.
 * The function throws for an outcome of an opaque factor. Not part of the package API; used to check the model against
 * the parser.
 */
export function createOutcomeComposer(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions,
): (outcomes: ReadonlyArray<number>) => BeMusicPlayFingerprintDocument {
  const model = buildChartModel(json, resolveLaneModeExtension(options.chartPath));
  return (outcomes) => {
    if (!model.topFlat || !model.analysis) {
      return model.document as BeMusicPlayFingerprintDocument;
    }
    const analysis = model.analysis;
    const items: FlatItems = { ...model.topFlat };
    for (const factor of model.factors) {
      if (!factor.tree) {
        throw new Error('fingerprint: an opaque factor has no per-outcome content');
      }
      let tree = factor.tree;
      while (tree.kind === 'node') {
        const variable = analysis.variables[tree.variable]!;
        const valueClass = classOfValue(variable, outcomes[variable.line] ?? 1);
        tree = tree.branches.find((branch) => branch.classes.includes(valueClass))!.tree;
      }
      applyDelta(items, tree.delta);
    }
    return assemblePlayDocument(items, model.extension);
  };
}

/**
 * Every outcome a chart document stands for, with its probability, composed from the document alone: one entry per
 * combination of branch paths of its `random` nodes. Not part of the package API; used to check documents in tests.
 */
export function expandChartFingerprintDocument(
  document: BeMusicFingerprintDocument,
): Array<{ probability: Rational; document: BeMusicPlayFingerprintDocument }> {
  if (!('random' in document)) {
    return [{ probability: { n: 1n, d: 1n }, document }];
  }
  const top: FlatItems = {
    notes: document.notes.map(parseNote),
    mines: document.mines.map(parseMine),
    timeline: document.timeline.map(parseTimeline),
    lengths: new Map(document.measures.lengths.map(([measure, length]) => [Number(measure), parseRational(length)])),
    header: {
      bpm: parseRational(document.bpm),
      baseBpm: document.baseBpm === null ? null : parseRational(document.baseBpm),
      judge: parseJudge(document.judge),
      total: parseTotal(document.total),
      player3: document.lanes.player3,
      barLines: true,
    },
  };
  let combos: Array<{ probability: Rational; deltas: ItemDelta[] }> = [{ probability: { n: 1n, d: 1n }, deltas: [] }];
  for (const node of document.random) {
    if ('opaque' in node) {
      throw new Error('fingerprint: an opaque node has no per-outcome content');
    }
    const leaves = expandNode(node);
    const next: typeof combos = [];
    for (const combo of combos) {
      for (const leaf of leaves) {
        next.push({
          probability: { n: combo.probability.n * leaf.probability.n, d: combo.probability.d * leaf.probability.d },
          deltas: [...combo.deltas, leaf.delta],
        });
      }
    }
    combos = next;
  }
  return combos.map((combo) => {
    const items: FlatItems = { ...top };
    for (const delta of combo.deltas) {
      applyDelta(items, delta);
    }
    return { probability: combo.probability, document: assemblePlayDocument(items, document.lanes.extension) };
  });
}

function expandNode(node: FingerprintRandomNode): Array<{ probability: Rational; delta: ItemDelta }> {
  const max = BigInt(node.random);
  const result: Array<{ probability: Rational; delta: ItemDelta }> = [];
  for (const branch of node.branches) {
    let count = 0n;
    for (const range of branch.values) {
      const dash = range.indexOf('-');
      count += dash < 0 ? 1n : BigInt(range.slice(dash + 1)) - BigInt(range.slice(0, dash)) + 1n;
    }
    const children = branch.next
      ? expandNode(branch.next)
      : [{ probability: { n: 1n, d: 1n }, delta: parseDelta(branch) }];
    for (const child of children) {
      result.push({
        probability: { n: count * child.probability.n, d: max * child.probability.d },
        delta: child.delta,
      });
    }
  }
  return result;
}

function parseDeltaLists(lists: FingerprintDeltaLists | undefined): DeltaLists {
  return {
    notes: (lists?.notes ?? []).map(parseNote).map((item) => ({ key: noteKey(item), item })),
    mines: (lists?.mines ?? []).map(parseMine).map((item) => ({ key: mineKey(item), item })),
    timeline: (lists?.timeline ?? []).map(parseTimeline).map((item) => ({ key: timelineKey(item), item })),
    lengths: (lists?.lengths ?? []).map(([measure, length]) => {
      const item: [number, Rational] = [Number(measure), parseRational(length)];
      return { key: `${item[0]}|${length}`, item };
    }),
  };
}

function parseDelta(branch: FingerprintBranch): ItemDelta {
  const header: Partial<HeaderItems> = {};
  const change = branch.header ?? {};
  if (change.bpm !== undefined) {
    header.bpm = parseRational(change.bpm);
  }
  if (change.baseBpm !== undefined) {
    header.baseBpm = change.baseBpm === null ? null : parseRational(change.baseBpm);
  }
  if (change.judge !== undefined) {
    header.judge = parseJudge(change.judge);
  }
  if (change.total !== undefined) {
    header.total = parseTotal(change.total);
  }
  if (change.player3 !== undefined) {
    header.player3 = change.player3;
  }
  return { add: parseDeltaLists(branch.add), remove: parseDeltaLists(branch.remove), header };
}
