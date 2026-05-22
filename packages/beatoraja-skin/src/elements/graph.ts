// Strict-typed normalization for beatoraja `graph[]` declarations.
//
// Beatoraja `graph` elements are scaling-bar overlays — a sub-rect of a source image that grows /
// shrinks based on a runtime numeric value. The classic example is a lifebar that fills upward
// as the gauge climbs, or a chart-progress indicator that creeps left-to-right as the song plays.
//
// Each entry pairs:
//
//   - `id` — destination id (matches `destination[].id`, same namespace as `image[]` / `value[]` /
//     `text[]`)
//   - `src` — source image index (matches `source[].id`, NOT `image[].src`)
//   - `(x, y, w, h)` — source-rect crop inside that source image
//   - `type` — what runtime value drives the bar (rank by prop.lua-ish op codes; common values
//     listed below)
//   - `angle` — fill direction. **Upstream `SkinGraph.java:99-106` recognizes only TWO values:**
//
//         if (direction == 1) { /* vertical: scale region.height by value */ }
//         else                 { /* horizontal: scale region.width by value */ }
//
//     `JsonSkin.Graph.angle` defaults to `1` (`JsonSkin.java:226`), so a skin that omits the
//     field gets VERTICAL fill. The previous TS impl borrowed SkinSlider's 4-direction codes
//     (0:up / 1:right / 2:down / 3:left), which both inverted the default (we treated 1 as
//     'right') AND added 'left' / 'down' modes that don't exist in upstream — every gauge bar
//     in the reference theme that didn't author `angle` rendered horizontally instead of
//     filling upward.
//
//     Audit A-5 / B-3 (2024-12) re-aligned to upstream's 2-value semantics: any `angle == 1`
//     (or omitted) → 'vertical'; anything else → 'horizontal'. SkinSlider keeps its own
//     4-direction code (see `elements/slider.ts`); the two element types share a JSON
//     field name but NOT the value space.
//
// Common `type` codes the renderer surfaces:
//
//   - `1`  — 1P groove gauge percentage (0..1)
//   - `6`  — 2P groove gauge percentage
//   - `2`  — chart-time progress (0..1, currentSeconds / totalSeconds)
//   - `102`— load progress
//   - `110`/`113`/`115` — score-history polylines (current / best / target). These are
//      polyline-style and don't fit the "scale a sub-rect" model — the renderer hides them
//      until per-frame history tracking ships.
//
// The renderer only consumes `id`, `src`, `(x,y,w,h)`, `type`, `angle`, and `ifCodes` — anything
// else is preserved verbatim for forward compat but not interpreted here.

import { flattenBeatorajaElements, type NormalizedElement } from './base.ts';
import { floatPropertyField, numberField, sourceIdField } from './fields.ts';
import type { BeatorajaLuaFunctionValue } from '../lua.ts';
import type { BeatorajaImageId } from './image.ts';
import type { BeatorajaSkinSourceId } from '../types.ts';

export type BeatorajaFloatPropertyRef = number | BeatorajaLuaFunctionValue;

/**
 * Direction the bar fills toward as `value` rises from 0 to 1.
 *
 * - `'vertical'` — fill grows UPWARD from the dst rect's bottom edge (= upstream `direction == 1`).
 *   The bottom `value*height` portion of the source paints into the bottom `value*height` of
 *   the dst rect.
 * - `'horizontal'` — fill grows RIGHTWARD from the dst rect's left edge (upstream catch-all).
 *
 * Upstream `SkinGraph.java:99-106` only recognises these two cases — `'left'` / `'down'` /
 * tilted directions are NOT supported.
 */
export type BeatorajaGraphFillDirection = 'vertical' | 'horizontal';

export interface BeatorajaGraphElement {
  /** Destination id this graph targets. Same id space as `image[]` / `value[]` / `text[]`. */
  id: BeatorajaImageId;
  /** `source[].id` reference this graph crops out of. Numeric and symbolic string ids are both valid. */
  src: BeatorajaSkinSourceId;
  /** Source-rect crop. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Runtime data source. The renderer interprets this against a fixed table (gauge / progress /
   * load) and falls back to "no data" for codes it doesn't understand. Authors typically use
   * codes from a known per-skin convention; see the file header for the live values surfaced.
   */
  type: number;
  /** Optional `value` FloatProperty. Beatoraja evaluates this instead of `type` when authored. */
  valueProperty?: BeatorajaFloatPropertyRef;
  /** Fill direction. Defaults to `'right'` (LR2-compatible default). */
  angle: BeatorajaGraphFillDirection;
  /** `if` codes that gate visibility (AND-merged with the destination's `op[]`). */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaGraphs(input: unknown): BeatorajaGraphElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaGraphElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaGraphElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const valueProperty = floatPropertyField(f.value);
  return {
    id,
    src: sourceIdField(f, 'src', 0),
    x: numberField(f, 'x', 0),
    y: numberField(f, 'y', 0),
    w: numberField(f, 'w', 0),
    h: numberField(f, 'h', 0),
    type: numberField(f, 'type', 0),
    ...(valueProperty !== undefined ? { valueProperty } : {}),
    angle: angleField(f.angle),
    ifCodes: entry.ifCodes,
  };
}

function angleField(value: unknown): BeatorajaGraphFillDirection {
  // Mirror upstream `SkinGraph.java:99-106`: ONLY `direction == 1` triggers the vertical
  // branch; everything else (including 0, 2, 3, missing) falls into the horizontal catch-all.
  // `JsonSkin.Graph.angle` defaults to 1 (`JsonSkin.java:226`), so an omitted `angle` field
  // resolves to vertical here too.
  if (typeof value === 'number' && value === 1) return 'vertical';
  if (value === undefined) return 'vertical'; // JsonSkin default = 1 = vertical.
  return 'horizontal';
}
