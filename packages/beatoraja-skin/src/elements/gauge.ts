// Strict-typed normalization + per-cell node picker for beatoraja's `gauge` element.
//
// **Spec (audit 1.4):** beatoraja's `bms.player.beatoraja.play.SkinGauge` indexes nodes as
//   `images[exgauge + frameOffset + (border < this.border ? 1 : 0)]`
// where:
//
// - `exgauge = (type >= CLASS ? type - 3 : type) * 6` — runtime gauge mode × 6. Each mode has
//   its own 6-cell slab. CLASS / EXCLASS / EXHARDCLASS reuse HARD / EXHARD / HAZARD slabs.
// - `frameOffset` is `0` (filled), `2` (transition tail), or `4` (animated top) depending on
//   the cell's position relative to `notes` (= the topmost lit cell index).
// - `borderFlag` is `+1` when the cell's threshold (`border = i * max / parts`) is below the
//   gauge's clear border (`this.border`) — i.e., the cell is in the danger zone.
//
// So 6 cells per gauge mode = 3 frame slots × 2 (above / below clear threshold).
//
// `gauge.type` (0..3) is the ANIMATION style:
//   - 0 RANDOM:    `animation = floor(random() * (range + 1))`
//   - 1 INCLEASE:  `animation = (animation + range) % (range + 1)`
//   - 2 DECLEASE:  `animation = (animation + 1) % (range + 1)`
//   - 3 FLICKERING: special case — `animation = (time % cycle)` is unused; instead the picker
//     paints filled / empty + an extra "bright top" overlay at `i == notes`.
//
// `range` is the animation frame stride (NOT a "rim distance threshold" as the previous
// heuristic claimed). `cycle` (= `duration` in Java) is the per-frame interval in ms.
//
// **Node layout for default play9** (12 nodes, type=3 FLICKERING):
//
//   nodes[0..5]   = NORMAL gauge mode (above-border / below-border × 3 frame slots)
//   nodes[6..11]  = (overlap; default play9 only authors enough for one mode)
//
// In practice authors don't ship the full 9 modes × 6 = 54 cells. They ship the modes their
// chart actually exercises and the resolver clamps via `Math.min(idx, nodes.length - 1)` so
// out-of-range indices fall back to the last available cell.

import { flattenBeatorajaElements, type NormalizedElement } from './base.ts';
import type { BeatorajaImageId } from './image.ts';

/**
 * Animation style enum — beatoraja's `SkinGauge.ANIMATION_*` constants. Drives how the
 * `animation` index advances per cycle (and which non-FLICKERING cells get the
 * `frameOffset = 2` "transition tail" treatment).
 */
export const BEATORAJA_GAUGE_ANIMATION = {
  /** `animation = floor(random() * (range + 1))` — random pick each cycle. */
  RANDOM: 0,
  /** `animation = (animation + range) % (range + 1)` — climbs by `range` per cycle. */
  INCLEASE: 1,
  /** `animation = (animation + 1) % (range + 1)` — slow climb. */
  DECLEASE: 2,
  /** Special path — fills are 0 / 2 only; an overlay paints at `i == notes`. */
  FLICKERING: 3,
} as const;

/**
 * Runtime gauge mode — beatoraja's `GrooveGauge` constants. Drives the `exgauge` base offset
 * via `(type >= CLASS ? type - 3 : type) * 6`. Mirrored here so the renderer can map the
 * engine's gauge state to a slab index.
 */
export const BEATORAJA_GAUGE_MODE = {
  ASSISTEASY: 0,
  EASY: 1,
  /** Beatoraja's "groove" / standard recovery gauge. */
  NORMAL: 2,
  HARD: 3,
  EXHARD: 4,
  HAZARD: 5,
  /** CLASS reuses HARD's slab (`exgauge = 18`). */
  CLASS: 6,
  /** EXCLASS reuses EXHARD's slab (`exgauge = 24`). */
  EXCLASS: 7,
  /** EXHARDCLASS reuses HAZARD's slab (`exgauge = 30`). */
  EXHARDCLASS: 8,
} as const;

export type BeatorajaGaugeMode = (typeof BEATORAJA_GAUGE_MODE)[keyof typeof BEATORAJA_GAUGE_MODE];

/** Compute `exgauge` (= base node-array offset) for a given gauge mode. */
export function gaugeExBase(mode: number): number {
  const m = mode >= BEATORAJA_GAUGE_MODE.CLASS ? mode - 3 : mode;
  return Math.max(0, Math.trunc(m)) * 6;
}

/**
 * Map the engine's ruleset-scoped gauge id to beatoraja's int constant. The id space spans all three compat
 * rulesets — LR2 names its recovery gauge `GROOVE` and its instant-death gauge `DEATH`, beatoraja calls the same
 * two `NORMAL` and `HAZARD`, and IIDX spells assisted easy with the `-ED-` suffix — so every spelling maps onto the
 * one beatoraja slab that renders it. Unknown ids and `undefined` fall back to `NORMAL` (= 2), beatoraja's default.
 */
export function beatorajaGaugeModeFromString(type: string | undefined): BeatorajaGaugeMode {
  switch (type) {
    case 'ASSIST-EASY':
    case 'ASSISTED-EASY':
      return BEATORAJA_GAUGE_MODE.ASSISTEASY;
    case 'EASY':
      return BEATORAJA_GAUGE_MODE.EASY;
    case 'HARD':
      return BEATORAJA_GAUGE_MODE.HARD;
    case 'EX-HARD':
      return BEATORAJA_GAUGE_MODE.EXHARD;
    case 'DEATH':
    case 'HAZARD':
      return BEATORAJA_GAUGE_MODE.HAZARD;
    case 'GROOVE':
    case 'NORMAL':
    default:
      return BEATORAJA_GAUGE_MODE.NORMAL;
  }
}

export interface BeatorajaGaugeElement {
  /** Destination id this gauge targets. Same id space as image / value / text / graph / slider. */
  id: BeatorajaImageId;
  /** Sub-image ids — packed in 6-cell slabs per gauge mode (see file header). */
  nodes: ReadonlyArray<BeatorajaImageId>;
  /** Total cell count painted across the destination rect's width. Defaults to 50. */
  parts: number;
  /**
   * Animation style — see {@link BEATORAJA_GAUGE_ANIMATION}. Defaults to `0` (RANDOM).
   */
  type: number;
  /**
   * Animation frame stride. The `animation` counter wraps modulo `range + 1` per cycle, so a
   * range of `3` produces 4 distinct animation phases (0/1/2/3). Defaults to `3`.
   */
  range: number;
  /** Per-cycle interval in ms (beatoraja `SkinGauge.duration`). Defaults to `33`. */
  cycle: number;
  /** Pulse keyframe times — preserved for forward compat; not consumed by the picker today. */
  starttime: number;
  endtime: number;
  /** `if` codes that gate visibility. */
  ifCodes: ReadonlyArray<number>;
}

/**
 * Live gauge state the picker needs to compute the per-cell node index. The renderer derives
 * this from the runtime adapter (engine's `summary.gauge`).
 */
export interface BeatorajaGaugeState {
  /** Current gauge value in `[0, max]`. */
  value: number;
  /** Maximum gauge value for this mode (typically 100, but EXHARD / HAZARD differ). */
  max: number;
  /** Clear-threshold border in the same units as {@link value}. Cells below it are "danger". */
  border: number;
  /** Runtime gauge mode (= `BEATORAJA_GAUGE_MODE.*`). */
  mode: number;
}

export function normalizeBeatorajaGauge(input: unknown): BeatorajaGaugeElement | undefined {
  if (input === undefined || input === null) return undefined;
  const flattened = flattenBeatorajaElements(input);
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function normalizeOne(entry: NormalizedElement): BeatorajaGaugeElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const rawNodes = f.nodes;
  if (!Array.isArray(rawNodes)) return undefined;
  const nodes: BeatorajaImageId[] = [];
  for (const v of rawNodes) {
    if (typeof v === 'string' || typeof v === 'number') nodes.push(v);
  }
  if (nodes.length === 0) return undefined;
  return {
    id,
    nodes,
    parts: numberField(f, 'parts', 50),
    type: numberField(f, 'type', 0),
    range: numberField(f, 'range', 3),
    cycle: numberField(f, 'cycle', 33),
    starttime: numberField(f, 'starttime', 0),
    endtime: numberField(f, 'endtime', 500),
    ifCodes: entry.ifCodes,
  };
}

/**
 * Compute the animation frame index given the gauge's animation style and the current time.
 * Mirrors `SkinGauge.prepare()`'s animation update — except RANDOM uses a deterministic stamp
 * (cycle-based) instead of `Math.random()` so the visual is stable across re-renders. The
 * wraparound period is `range + 1` regardless of style.
 *
 * Returns a value in `[0, range]`.
 */
export function computeBeatorajaGaugeAnimation(gauge: BeatorajaGaugeElement, nowMs: number): number {
  const range = Math.max(0, Math.trunc(gauge.range));
  if (range === 0 || gauge.cycle <= 0 || !Number.isFinite(nowMs)) return 0;
  const cycleCount = Math.floor(nowMs / gauge.cycle);
  const period = range + 1;
  switch (gauge.type) {
    case BEATORAJA_GAUGE_ANIMATION.INCLEASE:
      return (cycleCount * range) % period;
    case BEATORAJA_GAUGE_ANIMATION.DECLEASE:
      return cycleCount % period;
    case BEATORAJA_GAUGE_ANIMATION.RANDOM:
    case BEATORAJA_GAUGE_ANIMATION.FLICKERING:
    default:
      // RANDOM in beatoraja picks `floor(random() * period)` each cycle. We use a hash-like
      // function over `cycleCount` so consecutive cycles produce different but deterministic
      // values — matches the visual feel without the per-frame instability of true random.
      return ((cycleCount * 1664525 + 1013904223) >>> 0) % period;
  }
}

/**
 * Pick the active node for cell index `partIndex` (1..parts) at the given gauge state.
 * Returns the resolved `nodeId` plus diagnostic flags (whether the cell is filled, whether
 * it's in the "danger zone" below the clear border, and whether the FLICKERING overlay
 * should fire).
 *
 * Index formula (mirrors `SkinGauge.draw()`):
 *
 * Non-FLICKERING (RANDOM / INCLEASE / DECLEASE):
 *   `index = exgauge + (notes == i ? 4 : (notes - animation > i ? 0 : 2)) + borderFlag`
 *
 * FLICKERING:
 *   `index = exgauge + (notes >= i ? 0 : 2) + borderFlag`
 *   Plus an overlay at `i == notes`: `flickerIndex = exgauge + 4 + borderFlag`
 *
 * `notes = max(1, value * parts / max)` when `value > 0`, else `0`.
 *
 * The picker returns `flickerOverlayId` populated only for the FLICKERING + `i == notes`
 * case; the renderer paints it ON TOP of the base node when present.
 */
export function pickBeatorajaGaugeNode(
  gauge: BeatorajaGaugeElement,
  partIndex: number,
  state: BeatorajaGaugeState,
  animation: number,
): { nodeId: BeatorajaImageId; flickerOverlayId?: BeatorajaImageId; lit: boolean; danger: boolean } | undefined {
  const parts = Math.max(1, Math.trunc(gauge.parts));
  if (gauge.nodes.length === 0) return undefined;
  // Beatoraja's loop is 1-indexed (`for i = 1..parts`); we accept either 0- or 1-indexed
  // input by clamping into the 1..parts range. The host iterates 0..parts-1 in JS; bump by 1
  // before applying the formulas.
  const i = Math.max(1, Math.min(parts, Math.trunc(partIndex) + (partIndex >= parts ? 0 : 1)));
  const max = Math.max(0, state.max);
  const value = Math.max(0, state.value);
  const notes = value > 0 && max > 0 ? Math.max(1, Math.floor((value * parts) / max)) : 0;
  const cellBorder = (i * max) / parts;
  const danger = max > 0 && cellBorder < state.border;
  const borderFlag = danger ? 1 : 0;
  const exgauge = gaugeExBase(state.mode);
  const lit = i <= notes;

  let frameOffset: number;
  let flickerOverlayId: BeatorajaImageId | undefined;
  if (gauge.type === BEATORAJA_GAUGE_ANIMATION.FLICKERING) {
    frameOffset = lit ? 0 : 2;
    if (i === notes) {
      const overlayIdx = exgauge + 4 + borderFlag;
      flickerOverlayId = pickNode(gauge.nodes, overlayIdx);
    }
  } else {
    if (i === notes) {
      frameOffset = 4;
    } else if (notes - animation > i) {
      frameOffset = 0;
    } else {
      frameOffset = 2;
    }
  }
  const baseIdx = exgauge + frameOffset + borderFlag;
  const nodeId = pickNode(gauge.nodes, baseIdx);
  if (nodeId === undefined) return undefined;
  return {
    nodeId,
    ...(flickerOverlayId !== undefined ? { flickerOverlayId } : {}),
    lit,
    danger,
  };
}

/** Clamp the index into `nodes` and return the matching id. Out-of-range falls back to the
 * last authored node (matches beatoraja's "skin shipped a partial slab" graceful-degrade). */
function pickNode(nodes: ReadonlyArray<BeatorajaImageId>, index: number): BeatorajaImageId | undefined {
  if (nodes.length === 0) return undefined;
  if (!Number.isFinite(index) || index < 0) return nodes[0];
  if (index >= nodes.length) return nodes[nodes.length - 1];
  return nodes[index];
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
