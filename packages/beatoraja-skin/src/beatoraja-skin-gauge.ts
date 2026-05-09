// Strict-typed normalization for beatoraja's `gauge` element.
//
// **Spec note (audit 1.4):** beatoraja's `SkinGauge.java` indexes nodes as
// `images[exgauge + frameOffset + borderFlag]` where `exgauge = gaugeMode * 6` — i.e. each
// runtime gauge mode (GROOVE / EASY / HARD / EX-HARD / HAZARD / CLASS) has its own 6-cell
// slab (border-off + border-on × 3 frame slots). `gauge.type` (`0..3`) is the ANIMATION
// style (`RANDOM` / `INCREASE` / `DECREASE` / `FLICKERING`) — NOT a layout selector — and
// `range` controls the frame stride for the animation cycle, not a "rim distance threshold".
//
// Our impl below is a heuristic that produces visually acceptable output for default
// play9.json (the only sample skin authoring `type=3`) but doesn't faithfully implement the
// 6-cell-per-gauge-mode layout. A full rewrite is a separate project; the current code
// degrades gracefully when beatoraja's strict layout doesn't match (cells fall back to
// `nodes[lastIndex]` rather than throwing) so authoring drift stays survivable.
//
// `gauge` is a special destination kind: a horizontal row of `parts` cells (default 50) painted
// from a per-zone palette of node images. Each cell's "lit" / "off" state is decided by comparing
// its position against the live gauge percentage, and the lit cell's color shifts through the
// authored zones (typically red → yellow → green → blue) as the gauge climbs.
//
//   skin.gauge = {
//     id = "gauge",                          -- destination id (matches `destination[].id`)
//     nodes = { "gauge-r1", "gauge-p1", ... } -- per-zone image ids for off / on states
//     parts = 50,                             -- total cell count
//     type = 0,                               -- animation kind (1 = pulse-on-increase)
//     range = 3,                              -- distance from the rim where state cuts over
//     cycle = 33, starttime = 0, endtime = 500, -- per-cell pulse animation timing
//   }
//
// Node layout convention (mirrors beatoraja's reference theme):
//   - First half of `nodes[]`: OFF cells (one per zone — typically 3 or 4 zones)
//   - Second half: ON cells (lit), same zone order
//   - Zones are author-chosen "color bands" of the gauge — e.g. red (0-30%), yellow (30-60%),
//     blue (60-80%), green (≥80%) for the LR2-style 4-zone groove gauge.
//
// Gates by type — beatoraja's `Gauge.type` distinguishes 6-node basic gauges (just off + lit) from
// extended forms with breath-pulse / max-flash variants. We treat anything beyond 6 nodes as
// "more frames per state available; repeat the first" — degrades gracefully.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';

export interface BeatorajaGaugeElement {
  /** Destination id this gauge targets. Same id space as image / value / text / graph / slider. */
  id: BeatorajaImageId;
  /** Sub-image ids for cell rendering (off + on states across N zones). */
  nodes: ReadonlyArray<BeatorajaImageId>;
  /** Total cell count painted across the destination rect's width. Defaults to 50. */
  parts: number;
  /**
   * Animation style — beatoraja's `SkinGauge` enumerates `0` = RANDOM, `1` = INCREASE,
   * `2` = DECREASE, `3` = FLICKERING. Our heuristic renderer treats `0` as static, `1`/`3`
   * as pulse-on-lit. The full spec drives a frame-cycling state machine keyed off `range`
   * (frame stride) and `cycle` (interval ms); this is documented here for spec parity but
   * not yet implemented (audit 1.4).
   */
  type: number;
  /**
   * Animation frame stride in beatoraja's spec (`SkinGauge.animationRange`); our heuristic
   * uses it as a "rim distance threshold" for lit/off cutoff. The two interpretations
   * diverge for `type=1`/`3` skins — most authoring is `range=0` or `range=3` and either
   * value happens to look reasonable under our heuristic.
   */
  range: number;
  /** Animation interval in ms (`SkinGauge.duration`). Defaults to 33. */
  cycle: number;
  /** Pulse keyframe times. */
  starttime: number;
  endtime: number;
  /** `if` codes that gate visibility. */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaGauge(input: unknown): BeatorajaGaugeElement | undefined {
  if (input === undefined || input === null) return undefined;
  // The gauge element is authored as a single object, not an array — but `flattenBeatorajaElements`
  // tolerates both shapes (returns a 1-entry list for a bare object).
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
 * Number of state slabs the `gauge.nodes[]` array packs based on the authored `gauge.type`.
 * Beatoraja's 6-node basic gauges use 2 states (off / lit). Popn-style 12-node gauges (`type=3`,
 * authored on `default/play9.json`) use 3 states (off / lit / pulse-bright). Future variants
 * could carry more — the resolver clamps to whatever `nodes.length` actually supports.
 */
function gaugeStateCount(gaugeType: number): number {
  // `type === 3` is the popn 9K extended layout: 4 zones × 3 states (off / lit / bright). The
  // bright slab drives the type-3 pulse animation (cells alternate between lit and bright over
  // `cycle` ms when the cell is lit AND the gauge is in the pulse half of its cycle).
  if (gaugeType === 3) return 3;
  // All other types (`0` static, `1` simple pulse, etc.) use the standard 2-state layout: off
  // and lit. `type === 1`'s pulse alternates *within* the lit slab if authors pack >1 lit node
  // per zone, which the renderer can layer on later — for now both `0` and `1` collapse to the
  // 2-state contract.
  return 2;
}

/**
 * Pick the active node for cell `partIndex` (0..parts-1) given the live gauge percent (0..100).
 * Returns `{ nodeId, lit, state }` — `lit = true` means the cell's threshold has been crossed
 * by the current gauge value, and `state` is the index into the per-cell state slab the
 * resolver picked (0 = off, 1 = lit, 2 = pulse-bright for `type=3`).
 *
 * Zone partition mirrors the LR2 4-zone groove gauge:
 *   - parts 0..29% → zone 0 (red)
 *   - parts 30..59% → zone 1 (yellow)
 *   - parts 60..79% → zone 2 (blue)
 *   - parts 80..100% → zone 3 (green)
 *
 * Node layout: `nodes[zone + state * zonesPerState]` where
 * `zonesPerState = floor(nodes.length / stateCount)`. For default 7K's 8-node gauge with
 * `type=0` (stateCount=2): zonesPerState=4, nodes[0..3] = off / nodes[4..7] = lit. For default
 * 9K's 12-node gauge with `type=3` (stateCount=3): zonesPerState=4, nodes[0..3] = off /
 * nodes[4..7] = lit / nodes[8..11] = pulse-bright.
 *
 * `nowMs` selects the pulse phase for `type` values that animate (`1` or `3`). Omitting it
 * keeps the cell on its base lit slab — used by tests and by callers that want a frozen
 * snapshot. The pulse alternates between state `1` (lit) and the highest available state on a
 * `cycle`-ms square wave.
 */
export function pickBeatorajaGaugeNode(
  gauge: BeatorajaGaugeElement,
  partIndex: number,
  gaugePercent: number,
  nowMs?: number,
): { nodeId: BeatorajaImageId; lit: boolean; state: number } | undefined {
  if (gauge.parts <= 0 || gauge.nodes.length === 0) return undefined;
  const partPercent = ((partIndex + 1) * 100) / gauge.parts;
  const lit = gaugePercent >= partPercent;
  const stateCount = Math.max(1, gaugeStateCount(gauge.type));
  const zonesPerState = Math.max(1, Math.floor(gauge.nodes.length / stateCount));
  let zone = 0;
  if (partPercent >= 80) zone = Math.min(3, zonesPerState - 1);
  else if (partPercent >= 60) zone = Math.min(2, zonesPerState - 1);
  else if (partPercent >= 30) zone = Math.min(1, zonesPerState - 1);
  else zone = 0;
  // Pick which state slab the cell lands in:
  //   - off → state 0 (always)
  //   - lit + animated type with brigh slab + pulse half of cycle → highest available state
  //   - lit + everything else → state 1
  let state = 0;
  if (lit) {
    state = 1;
    if (
      stateCount > 2 &&
      typeof nowMs === 'number' &&
      Number.isFinite(nowMs) &&
      gauge.cycle > 0 &&
      (gauge.type === 1 || gauge.type === 3)
    ) {
      // Square-wave pulse: first half of the cycle = standard lit, second half = bright.
      const phase = ((nowMs % gauge.cycle) + gauge.cycle) % gauge.cycle;
      if (phase >= gauge.cycle / 2) state = stateCount - 1;
    }
  }
  const idx = zone + state * zonesPerState;
  const nodeId = gauge.nodes[Math.min(idx, gauge.nodes.length - 1)];
  if (nodeId === undefined) return undefined;
  return { nodeId, lit, state };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
