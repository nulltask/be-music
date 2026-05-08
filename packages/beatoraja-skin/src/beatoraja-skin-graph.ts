// Strict-typed normalization for beatoraja `graph[]` declarations.
//
// Beatoraja `graph` elements are scaling-bar overlays — a sub-rect of a source image that grows /
// shrinks based on a runtime numeric value. The classic example is a lifebar that fills horizontally
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
//   - `angle` — fill direction code. Beatoraja's source is unambiguous: `SkinSlider.java` line 26
//     comments `slider移動方向(0:上, 1:右, 2:下, 3:左)`, and the `draw()` math (`region.y + (dir==0 ?
//     +v : dir==2 ? -v : 0)`) confirms beatoraja uses libGDX Y-UP coordinates internally — direction
//     `0` ADDS to skin y (which means UP visually in Y-UP). So the canonical mapping is `0 = up`,
//     `1 = right` (default), `2 = down`, `3 = left`. Our renderer Y-flips dst rects from libGDX
//     Y-UP into Pixi Y-DOWN at draw time, so the visual labels here line up with the screen-space
//     direction the bar fills toward.
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

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import { isBeatorajaLuaFunctionValue, type BeatorajaLuaFunctionValue } from './beatoraja-skin-lua.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import type { BeatorajaSkinSourceId } from './beatoraja-skin-types.ts';

export type BeatorajaFloatPropertyRef = number | BeatorajaLuaFunctionValue;

/** Direction the bar fills toward as `value` rises from 0 to 1. */
export type BeatorajaGraphFillDirection = 'right' | 'up' | 'left' | 'down';

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
  if (typeof value === 'number') {
    // Beatoraja's direction codes are explicit in `SkinSlider.java` line 26:
    // `slider移動方向(0:上, 1:右, 2:下, 3:左)` (0=up, 1=right, 2=down, 3=left). The `draw()` math
    // confirms libGDX Y-UP semantics — direction 0 ADDS to skin y, which is visually upward. We
    // Y-flip dst rects when handing them to Pixi, so the screen-visual direction labels line up
    // with the source labels as a happy coincidence.
    switch (value) {
      case 0:
        return 'up';
      case 1:
        return 'right';
      case 2:
        return 'down';
      case 3:
        return 'left';
      default:
        return 'right';
    }
  }
  return 'right';
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function floatPropertyField(value: unknown): BeatorajaFloatPropertyRef | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isBeatorajaLuaFunctionValue(value)) return value;
  return undefined;
}

function sourceIdField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback: BeatorajaSkinSourceId,
): BeatorajaSkinSourceId {
  const v = record[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0) return v;
  return fallback;
}
