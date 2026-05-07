// Strict-typed normalization for beatoraja's `gauge` element.
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
   * Animation type. `0` = static (cells just flip on/off as gauge crosses thresholds), `1` = pulse
   * (lit cells breathe between two `nodes[]` indices over `cycle` ms). Authors most commonly use
   * `0` so the renderer always picks the first lit-state node when `type !== 1`.
   */
  type: number;
  /** Distance threshold at the gauge rim where lit/off cuts over. Defaults to 3. */
  range: number;
  /** Pulse-cycle duration in ms (`type = 1`). Defaults to 33. */
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
 * Pick the active node for cell `partIndex` (0..parts-1) given the live gauge percent (0..100).
 * Returns `{ nodeId, lit }` — `lit = true` means the cell's threshold has been crossed by the
 * current gauge value.
 *
 * Zone partition mirrors the LR2 4-zone groove gauge:
 *   - parts 0..29% → zone 0 (red)
 *   - parts 30..59% → zone 1 (yellow)
 *   - parts 60..79% → zone 2 (blue)
 *   - parts 80..100% → zone 3 (green)
 *
 * The off-state node for zone Z is `nodes[Z]`; the lit-state node is `nodes[Z + lit_offset]` where
 * `lit_offset = nodes.length / 2`. Skins with fewer / more zones (e.g. only 2-zone red/green
 * gauges) are tolerated — `Z` clamps to `nodes.length/2 - 1` so we never overrun.
 */
export function pickBeatorajaGaugeNode(
  gauge: BeatorajaGaugeElement,
  partIndex: number,
  gaugePercent: number,
): { nodeId: BeatorajaImageId; lit: boolean } | undefined {
  if (gauge.parts <= 0 || gauge.nodes.length === 0) return undefined;
  const partPercent = ((partIndex + 1) * 100) / gauge.parts;
  const lit = gaugePercent >= partPercent;
  const stateCount = Math.max(1, Math.floor(gauge.nodes.length / 2));
  let zone = 0;
  if (partPercent >= 80) zone = Math.min(3, stateCount - 1);
  else if (partPercent >= 60) zone = Math.min(2, stateCount - 1);
  else if (partPercent >= 30) zone = Math.min(1, stateCount - 1);
  else zone = 0;
  const idx = lit ? zone + stateCount : zone;
  const nodeId = gauge.nodes[Math.min(idx, gauge.nodes.length - 1)];
  if (nodeId === undefined) return undefined;
  return { nodeId, lit };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
