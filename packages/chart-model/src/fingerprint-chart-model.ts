import { parseHDXLongNoteMode } from './hdx-long-note-mode.ts';
/**
 * The chart fingerprint's model of a chart with control flow (`docs/fingerprint-spec.md`, sections 3.6.3 – 3.6.6):
 * segments are grouped into interacting factors, each factor becomes a reduced decision tree of deltas, what every
 * outcome shares is hoisted, and the chart document is assembled.
 */
import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
  type BeMusicEvent,
  type BeMusicJSON,
  type BMSControlFlowEntry,
} from '@be-music/chart-source';
import { formatRational, isRationalEqual } from './fingerprint-rational.ts';
import {
  analyzeControlFlow,
  classValueRanges,
  countOutcomePaths,
  type ControlFlowAnalysis,
  type ControlFlowVariable,
  type OutcomeNode,
} from './fingerprint-control-flow.ts';
import {
  bucketEvents,
  bucketOfChannel,
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
  TIMELINE_TYPES,
  usesInferredLongNoteType,
  type ChartItems,
  type FlatItems,
  type FpTime,
  type HeaderItems,
  type LaneModeExtension,
  type TimelineItem,
} from './fingerprint-items.ts';
import { sha256Hex } from '@be-music/shared-utils/hash';
import {
  type BeMusicChartFingerprintDocument,
  type BeMusicFingerprintDocument,
  FINGERPRINT_FACTOR_OUTCOME_LIMIT,
  FINGERPRINT_VERSION,
  type FingerprintBranch,
  type FingerprintControlFlowNode,
  type FingerprintRandomNode,
  assemblePlayDocument,
  canonicalizeJSONValue,
} from './fingerprint-document.ts';
import {
  HEADER_FIELDS,
  INDEXED_DEFINITION_PATTERN,
  type ItemDelta,
  type Keyed,
  type ReplayContext,
  applyDelta,
  computeDelta,
  emptyLists,
  formatDelta,
  headerFieldText,
  isEmptyDelta,
  subtractKeyed,
  timeKey,
} from './fingerprint-delta.ts';

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

export function buildChartModel(json: BeMusicJSON, extension: LaneModeExtension): ChartModel {
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
    base: resolveBMSBase(json),
    laneCache: new Map(),
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
function resolveMeasureLimit(top: ChartItems, entries: ReadonlyArray<BMSControlFlowEntry>, json: BeMusicJSON): number {
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
  json: BeMusicJSON,
  entries: ReadonlyArray<BMSControlFlowEntry>,
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
  entries: ReadonlyArray<BMSControlFlowEntry>,
  base: 36 | 62,
  inferredLNType: boolean,
): void {
  for (let index = model.start; index < model.end; index += 1) {
    const entry = entries[index]!;
    if (entry.kind === 'header') {
      if (entry.overriddenByLaterHeader === true) {
        // A later top-level line defines the same header, so this one never applies (file order).
        continue;
      }
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
        case 'OPTION':
          if (parseHDXLongNoteMode(entry.value) !== undefined) model.sets.add('D:LN');
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
      if (inferredLNType && (side === 0x35 || side === 0x36)) {
        model.sets.add('D:LNTYPE?');
      }
      // A lane keeps one judged note per position, so notes of two segments at one position compete.
      for (const event of entry.events) {
        model.timeKeys.add(`${bucket}|${timeKey(eventTime({ ...event, measure: entry.measure }))}`);
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
  entries: ReadonlyArray<BMSControlFlowEntry>,
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
        model.timeKeys.add(`lane:${item.lane}|${timeKey(item.t)}`);
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
    // A run of emitted lines is gathered first and appended once: appending line by line copied the path so far for
    // every line, quadratic in a branch that holds a whole chart. `entries` is shared with sibling paths, so it is
    // never changed in place.
    if (node.kind === 'emit') {
      const run: number[] = [];
      while (node.kind === 'emit') {
        run.push(node.entry);
        node = node.next;
      }
      entries = entries.concat(run);
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
  entries: ReadonlyArray<BMSControlFlowEntry>,
  context: ReplayContext,
  analysis: ControlFlowAnalysis,
): FactorModel {
  const opaque = (): FactorModel => {
    const lines: BMSControlFlowEntry[] = [];
    for (const segment of segments) {
      lines.push(...entries.slice(segment.start, segment.end));
    }
    return { segments, opaque: sha256Hex(canonicalizeJSONValue(lines)) };
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
    tree = { kind: 'leaf', delta, text: canonicalizeJSONValue(formatDelta(delta)) };
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

function mapTree(tree: DeltaTree, transform: (delta: ItemDelta) => ItemDelta): DeltaTree {
  if (tree.kind === 'leaf') {
    const delta = transform(tree.delta);
    return { kind: 'leaf', delta, text: canonicalizeJSONValue(formatDelta(delta)) };
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
    const text = canonicalizeJSONValue(content);
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
      if ('bpm' in leaf.header || 'baseBPM' in leaf.header) {
        touched.add('baseBPM');
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
  const baseBPMIsBPM = header.baseBPM !== null && isRationalEqual(header.baseBPM, header.bpm);
  return {
    v: FINGERPRINT_VERSION,
    lanes: { extension, player3: header.player3, ...(header.modeHint !== null ? { modeHint: header.modeHint } : {}) },
    bpm: formatRational(header.bpm),
    baseBPM:
      header.baseBPM === null || (baseBPMIsBPM && !anyOpaque && !touched.has('baseBPM'))
        ? null
        : formatRational(header.baseBPM),
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
    .map((value) => ({ value, text: canonicalizeJSONValue(value) }))
    .sort((left, right) => (left.text < right.text ? -1 : left.text > right.text ? 1 : 0))
    .map((entry) => entry.value);
}
