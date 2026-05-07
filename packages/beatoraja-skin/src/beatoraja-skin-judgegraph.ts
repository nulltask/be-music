// Strict-typed normalization for beatoraja `judgegraph[]` declarations.
//
// `judgegraph` is one of beatoraja's specialized chart-data graphs. It plots judge-distribution
// histograms across a destination box — most often shown on the result screen so the player can
// see how their PERFECT / GREAT / GOOD / BAD / POOR counts (or EARLY / LATE counts) shape up at
// a glance. The bars are equal-width and stretch upward from the destination's bottom edge,
// scaled to whatever the largest bar is.
//
// Common `type` codes (matching the reference theme conventions):
//   - `1` — judgement-spread bars: PG / GR / GD / BD / PR (5 bars)
//   - `2` — early/late spread: EARLY / LATE (2 bars)
//
// Authors typically point this at a destination that occupies a strip of the screen (e.g.
// `judgegraph_w × judgegraph_h` in the play7 reference). The renderer pulls the bar values from
// a host callback (`resolveJudgeGraphBars(type)`); without that callback the graph hides itself.
// `backTexOff` is preserved verbatim — it controls a background-texture offset on themes that
// ship a striped backdrop, but we don't render that backdrop yet.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';

export interface BeatorajaJudgeGraphElement {
  /** Destination id this judgegraph targets. Same id space as `image[]` / `graph[]` / `text[]`. */
  id: BeatorajaImageId;
  /**
   * Graph kind. `1` = judgement spread (PG/GR/GD/BD/PR), `2` = early/late spread. Other values
   * are uninterpreted; the renderer hides them.
   */
  type: number;
  /**
   * Background-texture offset for themes that decorate the histogram with a striped backdrop.
   * Preserved here for forward compat — not consumed by the current renderer.
   */
  backTexOff: number;
  /** `if` codes that gate visibility (AND-merged with the destination's `op[]`). */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaJudgeGraphs(input: unknown): BeatorajaJudgeGraphElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaJudgeGraphElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaJudgeGraphElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  return {
    id,
    type: numberField(f, 'type', 0),
    backTexOff: numberField(f, 'backTexOff', 0),
    ifCodes: entry.ifCodes,
  };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
