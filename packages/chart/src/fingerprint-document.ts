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

export const FINGERPRINT_VERSION = 'bmfp1';

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
  /** `".pms"`, or `null` for any other or unknown extension. */
  extension: LaneModeExtension;
  player3: boolean;
  /** The bmson keyboard `mode_hint`; omitted when the chart has none (any other hint is not a lane-mode input). */
  modeHint?: KeyboardModeHint;
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

export function canonicalizeJsonValue(value: unknown): string {
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
