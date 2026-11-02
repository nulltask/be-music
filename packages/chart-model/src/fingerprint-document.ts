/**
 * The Be-Music Fingerprint documents (`docs/fingerprint-spec.md`, section 4): their types, the RFC 8785 serialization,
 * and the play document of one fully resolved outcome.
 */
import type { ChartPlayVariant } from './index.ts';
import { formatRational, isRationalEqual } from './fingerprint-rational.ts';
import {
  canonicalizeItems,
  formatJudge,
  formatLengths,
  formatTotal,
  type FingerprintJudge,
  type FingerprintLength,
  type FingerprintMine,
  type FingerprintNote,
  type FingerprintTimelineEvent,
  type FingerprintTotal,
  type FlatItems,
  type LaneModeExtension,
} from './fingerprint-items.ts';
import type { KeyboardModeHint } from './keyboard-mode-hint.ts';
import type { ChartPlayOptions } from './chart-play-options.ts';

export const FINGERPRINT_VERSION = 'bmfp0';

/**
 * Most outcome classes one control-flow factor may have (the product of its segments' path counts). A factor with more
 * is fingerprinted by its source lines instead (spec 3.7).
 */
export const FINGERPRINT_FACTOR_OUTCOME_LIMIT = 1024;

/** The lane-mode inputs that are not part of the parsed chart (spec 3.5). */
export interface BeMusicFingerprintOptions {
  /**
   * Path, file name, or bare extension of the chart, or `undefined` when unknown. Only its extension is read, exactly
   * as in `resolveChartPlayVariant`: `.pms` makes the chart 9 KEY, and any other extension counts as none. Part of the
   * fingerprint's input, so it is required.
   */
  chartPath: string | undefined;
}

export interface FingerprintMeasures {
  count: string;
  lengths: FingerprintLength[];
  /** `false` when the chart draws no bar lines (bmson `lines: []`). Omitted otherwise. */
  barLines?: false;
}

/**
 * The chart-authored gameplay options of a document (spec 2): the compiled `ChartPlayOptions`, string values and `true`
 * flags. Omitted from a document when the chart declares none.
 */
export type FingerprintPlayOptions = ChartPlayOptions;

/** Document of a chart with one outcome: the play fingerprint, and the chart fingerprint of a chart without `#RANDOM`. */
export interface BeMusicPlayFingerprintDocument {
  v: typeof FINGERPRINT_VERSION;
  laneMode: ChartPlayVariant;
  bpm: string;
  baseBPM: string | null;
  judge: FingerprintJudge;
  total: FingerprintTotal;
  measures: FingerprintMeasures;
  notes: FingerprintNote[];
  mines: FingerprintMine[];
  timeline: FingerprintTimelineEvent[];
  playOptions?: FingerprintPlayOptions;
}

export interface FingerprintLaneModeInputs {
  /** `".pms"`, or `null` for any other or unknown extension. */
  extension: LaneModeExtension;
  player3: boolean;
  /** The explicit bmson keyboard or generic hint; omitted for hints that do not determine lane identity. */
  modeHint?: KeyboardModeHint | `generic-${number}keys`;
}

export interface FingerprintDeltaLists {
  notes?: FingerprintNote[];
  mines?: FingerprintMine[];
  timeline?: FingerprintTimelineEvent[];
  lengths?: FingerprintLength[];
}

export interface FingerprintHeaderChange {
  bpm?: string;
  baseBPM?: string | null;
  judge?: FingerprintJudge;
  total?: FingerprintTotal;
  player3?: boolean;
  /** The outcome's gameplay options in full; `{}` when the outcome has none. */
  playOptions?: FingerprintPlayOptions;
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
  baseBPM: string | null;
  judge: FingerprintJudge;
  total: FingerprintTotal;
  measures: FingerprintMeasures;
  notes: FingerprintNote[];
  mines: FingerprintMine[];
  timeline: FingerprintTimelineEvent[];
  random: FingerprintControlFlowNode[];
  /** The gameplay options outside control flow; omitted when there are none. */
  playOptions?: FingerprintPlayOptions;
}

export type BeMusicFingerprintDocument = BeMusicPlayFingerprintDocument | BeMusicChartFingerprintDocument;

/**
 * Serializes a JSON value with the JSON Canonicalization Scheme (RFC 8785): object keys sorted by UTF-16 code units,
 * `undefined` fields left out, no whitespace, ECMAScript string and number forms. Fingerprints hash this text.
 */
export function canonicalizeJSONValue(value: unknown): string {
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
    let text = '[';
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        text += ',';
      }
      text += canonicalizeJSONValue(value[index]);
    }
    return `${text}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const order = keyOrderOf(Object.keys(record));
    let text = '{';
    let first = true;
    for (let index = 0; index < order.sorted.length; index += 1) {
      const field = record[order.sorted[index]!];
      if (field === undefined) {
        continue;
      }
      text += first ? order.quoted[index]! : `,${order.quoted[index]!}`;
      text += canonicalizeJSONValue(field);
      first = false;
    }
    return `${text}}`;
  }
  throw new TypeError(`canonical JSON cannot represent a ${typeof value}`);
}

/** An object's keys in canonical (code unit) order, each quoted with its colon, for `canonicalizeJSONValue`. */
interface KeyOrder {
  keys: readonly string[];
  sorted: readonly string[];
  quoted: readonly string[];
}

/**
 * The fingerprint documents hold many objects of a few shapes (notes, mines, timeline items): their key orders are
 * worked out once per shape, keyed by the keys as `Object.keys` lists them. A hit is checked key by key, so two shapes
 * whose joined keys collide never share an order. Cleared if odd input ever fills it.
 */
const KEY_ORDERS = new Map<string, KeyOrder>();
const KEY_ORDER_LIMIT = 1024;

function keyOrderOf(keys: string[]): KeyOrder {
  const signature = keys.join('\u0000');
  const cached = KEY_ORDERS.get(signature);
  if (cached !== undefined && sameKeys(cached.keys, keys)) {
    return cached;
  }
  const sorted = [...keys].sort();
  const order: KeyOrder = { keys, sorted, quoted: sorted.map((key) => `${JSON.stringify(key)}:`) };
  if (cached === undefined) {
    if (KEY_ORDERS.size >= KEY_ORDER_LIMIT) {
      KEY_ORDERS.clear();
    }
    KEY_ORDERS.set(signature, order);
  }
  return order;
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function assemblePlayDocument(items: FlatItems, extension: LaneModeExtension): BeMusicPlayFingerprintDocument {
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
    baseBPM:
      header.baseBPM === null || isRationalEqual(header.baseBPM, header.bpm) ? null : formatRational(header.baseBPM),
    judge: formatJudge(header.judge),
    total: formatTotal(header.total),
    measures,
    notes: lists.notes,
    mines: lists.mines,
    timeline: lists.timeline,
    ...formatPlayOptionsField(header.playOptions),
  };
}

/** The `playOptions` field of a document: omitted when the chart declares no gameplay options. */
export function formatPlayOptionsField(options: FingerprintPlayOptions): { playOptions?: FingerprintPlayOptions } {
  return Object.keys(options).length > 0 ? { playOptions: { ...options } } : {};
}
