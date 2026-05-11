// Strict-typed normalization for beatoraja `bpmgraph[]` declarations.
//
// `bpmgraph` is one of beatoraja's specialized chart-data graphs. Unlike `graph[]` (which scales
// a sub-rect of a source image by a 0..1 ratio), bpmgraph plots the chart's BPM curve as a
// polyline across a destination box. The X axis spans the chart from start to end; the Y axis
// normalizes BPM into `[0, 1]` (min BPM = 0, max BPM = 1). Authors typically point this at a
// destination that occupies a strip on the play / decide / result screen so the player can eye-
// ball where the heavy soflan sections live.
//
// The declaration shape is just `{ id }` — no `src`, no `(x,y,w,h)` (the dst rect carries the
// box), no `type` (BPM is the only data source). The renderer pulls the actual BPM points from a
// host callback (`resolveBpmGraphPoints()`); without that callback the graph hides itself.

import { flattenBeatorajaElements, type NormalizedElement } from './base.ts';
import type { BeatorajaImageId } from './image.ts';

export interface BeatorajaBpmGraphElement {
  /** Destination id this bpmgraph targets. Same id space as `image[]` / `graph[]` / `text[]`. */
  id: BeatorajaImageId;
  /** `if` codes that gate visibility (AND-merged with the destination's `op[]`). */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaBpmGraphs(input: unknown): BeatorajaBpmGraphElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaBpmGraphElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaBpmGraphElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  return { id, ifCodes: entry.ifCodes };
}
