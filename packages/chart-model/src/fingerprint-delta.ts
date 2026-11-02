import { parseHDXLongNoteMode } from './hdx-long-note-mode.ts';
import { isChartPlayOptionDeclaration } from './chart-play-options.ts';
/**
 * Deltas of the chart fingerprint (`docs/fingerprint-spec.md`, section 3.6.2): what the lines one `#RANDOM` / `#SWITCH`
 * outcome applies change in the content outside control flow, and how deltas are applied, formatted and read back.
 */
import {
  normalizeChannel,
  normalizeObjectKey,
  type BeMusicEvent,
  type BeMusicJSON,
  type BMSControlFlowEntry,
  type BMSControlFlowHeaderEntry,
} from '@be-music/chart-source';
import { formatRational, type Rational } from './fingerprint-rational.ts';
import {
  bucketEvents,
  bucketOfChannel,
  compareMineItems,
  compareNoteItems,
  compareTimelineItems,
  computeChartItems,
  formatJudge,
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
  usesInferredLongNoteType,
  type ChartItems,
  type LaneNotesCache,
  type FingerprintLength,
  type FingerprintTimelineType,
  type FlatItems,
  type FpTime,
  type HeaderItems,
  type MineItem,
  type NoteItem,
  type TimelineItem,
} from './fingerprint-items.ts';
import {
  type FingerprintBranch,
  type FingerprintDeltaLists,
  type FingerprintHeaderChange,
  canonicalizeJSONValue,
} from './fingerprint-document.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Deltas: what one outcome of a factor changes in the content outside control flow
// ---------------------------------------------------------------------------------------------------------------------

export interface Keyed<T> {
  key: string;
  item: T;
}

interface DeltaLists {
  notes: Array<Keyed<NoteItem>>;
  mines: Array<Keyed<MineItem>>;
  timeline: Array<Keyed<TimelineItem>>;
  lengths: Array<Keyed<[number, Rational]>>;
}

type HeaderField = 'bpm' | 'baseBPM' | 'judge' | 'total' | 'player3' | 'playOptions';
export const HEADER_FIELDS: ReadonlyArray<HeaderField> = ['bpm', 'baseBPM', 'judge', 'total', 'player3', 'playOptions'];

export interface ItemDelta {
  add: DeltaLists;
  remove: DeltaLists;
  header: Partial<HeaderItems>;
}

export function emptyLists(): DeltaLists {
  return { notes: [], mines: [], timeline: [], lengths: [] };
}

export function timeKey(time: FpTime): string {
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

// Field-by-field equality that implies equal keys, so `diffKeyedAgainstTop` can find the runs an outcome shares with the
// top without building a key for every item of the lane.
function sameTime(a: FpTime, b: FpTime): boolean {
  return a.m === b.m && a.n === b.n && a.d === b.d;
}

function sameNote(a: NoteItem, b: NoteItem): boolean {
  return (
    a.lane === b.lane &&
    sameTime(a.t, b.t) &&
    (a.end === undefined ? b.end === undefined : b.end !== undefined && sameTime(a.end, b.end)) &&
    a.ln === b.ln &&
    a.fz === b.fz
  );
}

function sameMine(a: MineItem, b: MineItem): boolean {
  return a.lane === b.lane && sameTime(a.t, b.t) && a.damage.n === b.damage.n && a.damage.d === b.damage.d;
}

function sameTimelineItem(a: TimelineItem, b: TimelineItem): boolean {
  return a.type === b.type && sameTime(a.t, b.t) && a.v.n === b.v.n && a.v.d === b.v.d;
}

export function headerFieldText(header: Partial<HeaderItems>, field: HeaderField): string {
  return canonicalizeJSONValue(formatHeaderField(header, field));
}

function formatHeaderField(header: Partial<HeaderItems>, field: HeaderField): unknown {
  switch (field) {
    case 'bpm':
      return header.bpm === undefined ? undefined : formatRational(header.bpm);
    case 'baseBPM':
      return header.baseBPM === undefined ? undefined : header.baseBPM === null ? null : formatRational(header.baseBPM);
    case 'judge':
      return header.judge === undefined ? undefined : formatJudge(header.judge);
    case 'total':
      return header.total === undefined ? undefined : formatTotal(header.total);
    case 'player3':
      return header.player3;
    case 'playOptions':
      return header.playOptions === undefined ? undefined : { ...header.playOptions };
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

/** The keys of a top-level list and where each key first appears, worked out once per list. */
interface KeyedTop {
  keys: string[];
  first: Map<string, number>;
}

const KEYED_TOPS = new WeakMap<ReadonlyArray<unknown>, KeyedTop>();

function keyedTop<T>(list: ReadonlyArray<T>, key: (item: T) => string): KeyedTop {
  let keyed = KEYED_TOPS.get(list);
  if (keyed === undefined) {
    const keys = list.map(key);
    const first = new Map<string, number>();
    for (const [index, itemKey] of keys.entries()) {
      if (!first.has(itemKey)) {
        first.set(itemKey, index);
      }
    }
    keyed = { keys, first };
    KEYED_TOPS.set(list, keyed);
  }
  return keyed;
}

/**
 * `diffKeyed` against a top-level list that every outcome is diffed against: the top's keys are worked out once, and
 * the runs both lists share at their start and end (an outcome usually changes one stretch of a lane) cancel out, so
 * only the stretch between them is counted. The result is `diffKeyed`'s, in its order: keys the top holds by where the
 * top first holds them, then the outcome's own keys by where it first holds them, each with the item `diffKeyed` would
 * take (the top's first for a key the top holds).
 */
function diffKeyedAgainstTop<T>(
  before: ReadonlyArray<T>,
  after: ReadonlyArray<T>,
  key: (item: T) => string,
  same: (a: T, b: T) => boolean,
  add: Array<Keyed<T>>,
  remove: Array<Keyed<T>>,
): void {
  const top = keyedTop(before, key);
  const beforeLength = before.length;
  const afterLength = after.length;
  // The shared runs are found by `same`, which implies equal keys: a pair it misses has equal keys and cancels out in
  // the counts below, so only the outcome's changed stretch needs keys.
  let prefix = 0;
  while (prefix < beforeLength && prefix < afterLength && same(before[prefix]!, after[prefix]!)) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLength - prefix &&
    suffix < afterLength - prefix &&
    same(before[beforeLength - 1 - suffix]!, after[afterLength - 1 - suffix]!)
  ) {
    suffix += 1;
  }

  const counts = new Map<string, { item: T; count: number; order: number }>();
  for (let index = prefix; index < beforeLength - suffix; index += 1) {
    const itemKey = top.keys[index]!;
    const entry = counts.get(itemKey);
    if (entry) {
      entry.count -= 1;
    } else {
      const first = top.first.get(itemKey)!;
      counts.set(itemKey, { item: before[first]!, count: -1, order: first });
    }
  }
  for (let index = prefix; index < afterLength - suffix; index += 1) {
    const itemKey = key(after[index]!);
    const entry = counts.get(itemKey);
    if (entry) {
      entry.count += 1;
    } else {
      const first = top.first.get(itemKey);
      counts.set(
        itemKey,
        first === undefined
          ? { item: after[index]!, count: 1, order: beforeLength + index }
          : { item: before[first]!, count: 1, order: first },
      );
    }
  }
  const changed = [...counts].filter(([, entry]) => entry.count !== 0);
  changed.sort((left, right) => left[1].order - right[1].order);
  for (const [itemKey, entry] of changed) {
    for (let index = 0; index < entry.count; index += 1) {
      add.push({ key: itemKey, item: entry.item });
    }
    for (let index = 0; index > entry.count; index -= 1) {
      remove.push({ key: itemKey, item: entry.item });
    }
  }
}

function isEmptyLists(lists: DeltaLists): boolean {
  return (
    lists.notes.length === 0 && lists.mines.length === 0 && lists.timeline.length === 0 && lists.lengths.length === 0
  );
}

export function isEmptyDelta(delta: ItemDelta): boolean {
  return isEmptyLists(delta.add) && isEmptyLists(delta.remove) && Object.keys(delta.header).length === 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Replaying captured lines onto the content outside control flow
// ---------------------------------------------------------------------------------------------------------------------

export const INDEXED_DEFINITION_PATTERN = /^(BPM|STOP|EXRANK|SCROLL|SPEED)([0-9A-Za-z]{2})$/;
const ALL_LANES = '*lanes';

export interface ReplayContext {
  /** Measures at or after this are past every included event of every outcome (spec 3.6.6). */
  measureLimit: number;
  top: BeMusicJSON;
  topBuckets: Map<string, BeMusicEvent[]>;
  topItems: ChartItems;
  base: 36 | 62;
  /** Lane notes shared by the outcomes that change only events ({@link LaneNotesCache}). */
  laneCache?: LaneNotesCache;
}

/**
 * The chart for one outcome, as the parser's `resolveControlFlow` builds it: the content outside control flow, then the
 * applied lines in file order (headers re-applied with the parser's rules, objects appended). Returns the buckets the
 * lines touch.
 */
function replayEntries(
  context: ReplayContext,
  entries: ReadonlyArray<BMSControlFlowEntry>,
  applied: ReadonlyArray<number>,
): { json: BeMusicJSON; buckets: Map<string, BeMusicEvent[]>; touched: Set<string> } {
  const { top, base } = context;
  const json: BeMusicJSON = {
    ...top,
    metadata: { ...top.metadata },
    resources: { ...top.resources, bpm: { ...top.resources.bpm }, stop: { ...top.resources.stop } },
    measures: top.measures.map((measure) => ({ index: measure.index, length: measure.length })),
    bms: {
      ...top.bms,
      lnObjs: [...(top.bms.lnObjs ?? [])],
      ...(top.bms.options !== undefined ? { options: [...top.bms.options] } : {}),
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
  json: BeMusicJSON,
  entry: BMSControlFlowHeaderEntry,
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
        json.bms.baseBPM = numeric;
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
    case 'OPTION': {
      const longNoteMode = parseHDXLongNoteMode(value) !== undefined;
      if (longNoteMode || isChartPlayOptionDeclaration(value)) {
        const declarations = (json.bms.options ??= json.bms.option ? [json.bms.option] : []);
        declarations.push(value);
        json.bms.option = value;
        // An HDX LONGMODE changes the long notes; a gameplay option, the header's `playOptions`.
        touched.add(longNoteMode ? ALL_LANES : HEADER_BUCKET);
      }
      return;
    }
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
export function computeDelta(
  context: ReplayContext,
  entries: ReadonlyArray<BMSControlFlowEntry>,
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
  // The lane cache holds only for outcomes whose chart differs from the top-level one in its events.
  const eventsOnly = !touched.has(LENGTHS_BUCKET) && applied.every((index) => entries[index]!.kind !== 'header');
  const items = computeChartItems(json, buckets, touched, context.topItems, eventsOnly ? context.laneCache : undefined);
  const top = context.topItems;
  for (const bucket of touched) {
    if (bucket.startsWith('lane:')) {
      diffKeyedAgainstTop(
        top.lanes.get(bucket) ?? [],
        items.lanes.get(bucket) ?? [],
        noteKey,
        sameNote,
        delta.add.notes,
        delta.remove.notes,
      );
    } else if (bucket === MINES_BUCKET) {
      diffKeyedAgainstTop(top.mines, items.mines, mineKey, sameMine, delta.add.mines, delta.remove.mines);
    } else if (bucket.startsWith('tl:')) {
      const type = bucket.slice(3) as FingerprintTimelineType;
      diffKeyedAgainstTop(
        top.timeline.get(type) ?? [],
        items.timeline.get(type) ?? [],
        timelineKey,
        sameTimelineItem,
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
export function subtractKeyed<T>(list: ReadonlyArray<Keyed<T>>, remove: ReadonlyArray<Keyed<T>>): Array<Keyed<T>> {
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

export function applyDelta(top: FlatItems, delta: ItemDelta): void {
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

/**
 * The keys of a list `applyKeyed` returned, so the next delta applied to it (one per factor, `hoistCommon`) reuses them
 * instead of keying every item of the chart again. The lists are never changed in place.
 */
const APPLIED_KEYS = new WeakMap<ReadonlyArray<unknown>, readonly string[]>();

function applyKeyed<T>(
  list: ReadonlyArray<T>,
  key: (item: T) => string,
  remove: ReadonlyArray<Keyed<T>>,
  add: ReadonlyArray<Keyed<T>>,
): T[] {
  const keys = APPLIED_KEYS.get(list) ?? list.map(key);
  // `subtractKeyed`: each removed key takes out its earliest remaining item.
  const counts = new Map<string, number>();
  for (const entry of remove) {
    counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  }
  const items: T[] = [];
  const itemKeys: string[] = [];
  let removed = 0;
  for (let index = 0; index < list.length; index += 1) {
    const itemKey = keys[index]!;
    const count = counts.get(itemKey) ?? 0;
    if (count > 0) {
      counts.set(itemKey, count - 1);
      removed += 1;
    } else {
      items.push(list[index]!);
      itemKeys.push(itemKey);
    }
  }
  if (removed !== remove.length) {
    throw new Error('fingerprint: a removed item is not present');
  }
  for (const entry of add) {
    items.push(entry.item);
    itemKeys.push(entry.key);
  }
  APPLIED_KEYS.set(items, itemKeys);
  return items;
}

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

export function formatDelta(delta: ItemDelta): Omit<FingerprintBranch, 'values' | 'next'> {
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

export function parseDelta(branch: FingerprintBranch): ItemDelta {
  const header: Partial<HeaderItems> = {};
  const change = branch.header ?? {};
  if (change.bpm !== undefined) {
    header.bpm = parseRational(change.bpm);
  }
  if (change.baseBPM !== undefined) {
    header.baseBPM = change.baseBPM === null ? null : parseRational(change.baseBPM);
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
  if (change.playOptions !== undefined) {
    header.playOptions = { ...change.playOptions };
  }
  return { add: parseDeltaLists(branch.add), remove: parseDeltaLists(branch.remove), header };
}
