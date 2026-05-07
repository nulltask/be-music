// Strict-typed normalization for beatoraja `gaugegraph[]` declarations.
//
// `gaugegraph` plots the chart's gauge value (0..100) over chart time on the result screen — a
// line chart of the player's gauge across the run. Authors typically point this at a destination
// rect that occupies a strip beneath the score readouts so the player can eyeball where the gauge
// dipped or recovered.
//
// The declaration is `{id, color?}`. The optional `color[]` is a flat list of 24 hex strings
// (`"ff8888"` style — no `#`); two colors per gauge type × 12 entries to cover beatoraja's full
// gauge type set (ASSIST_EASY, EASY, NORMAL, HARD, EXHARD, HAZARD, CLASS, EXCLASS, EXHARDCLASS,
// then three padding entries). The first half of the pair is the lit-state color, the second is
// the dim/background color. Skins that omit `color[]` leave the renderer free to pick a default.
//
// Like bpmgraph, the renderer pulls the actual gauge polyline from a host callback —
// `resolveGaugeGraphPoints()` returns `{x, y}` points in `[0, 1]²` (x = chart progress, y =
// gauge / 100). Without the callback the graph hides itself.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';

export interface BeatorajaGaugeGraphElement {
  /** Destination id this gaugegraph targets. Same id space as `image[]` / `graph[]` / `text[]`. */
  id: BeatorajaImageId;
  /**
   * Optional 24-entry hex color list (no `#` prefix). Pairs (`[lit, dim]`) per gauge variant in
   * beatoraja's `GrooveGauge` order. The renderer picks the lit color of the player's actual
   * gauge type for the foreground line and the dim color for the backdrop. Author-omitted →
   * empty array; the renderer falls back to a single neutral color.
   */
  colors: ReadonlyArray<string>;
  /** `if` codes that gate visibility (AND-merged with the destination's `op[]`). */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaGaugeGraphs(input: unknown): BeatorajaGaugeGraphElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaGaugeGraphElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaGaugeGraphElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  return {
    id,
    colors: stringArray(f.color),
    ifCodes: entry.ifCodes,
  };
}

function stringArray(input: unknown): ReadonlyArray<string> {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out;
}
