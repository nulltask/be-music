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
//   - `angle` — fill direction code (`0` = right, `1` = up, `2` = left, `3` = down)
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
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';

/** Direction the bar fills toward as `value` rises from 0 to 1. */
export type BeatorajaGraphFillDirection = 'right' | 'up' | 'left' | 'down';

export interface BeatorajaGraphElement {
  /** Destination id this graph targets. Same id space as `image[]` / `value[]` / `text[]`. */
  id: BeatorajaImageId;
  /** Source image index this graph crops out of. */
  src: number;
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
  return {
    id,
    src: numberField(f, 'src', 0),
    x: numberField(f, 'x', 0),
    y: numberField(f, 'y', 0),
    w: numberField(f, 'w', 0),
    h: numberField(f, 'h', 0),
    type: numberField(f, 'type', 0),
    angle: angleField(f.angle),
    ifCodes: entry.ifCodes,
  };
}

function angleField(value: unknown): BeatorajaGraphFillDirection {
  if (typeof value === 'number') {
    // Beatoraja uses LR2's numeric angle codes for fill direction. The values here mirror the
    // documented LR2 convention; skins that author angles in degrees fall back to the default
    // `'right'` since the LR2 codes (0–3) are the only canonical encoding.
    switch (value) {
      case 0:
        return 'right';
      case 1:
        return 'up';
      case 2:
        return 'left';
      case 3:
        return 'down';
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
