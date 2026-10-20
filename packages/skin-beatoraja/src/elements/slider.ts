// Strict-typed normalization for beatoraja `slider[]` declarations.
//
// A `slider` is a sprite that translates along a direction within its destination box, driven by a
// runtime value in `[0, 1]`. The classic example is a lanecover line that the player drags up /
// down — the dst rect anchors the bar's home position, the `(x, y, w, h)` defines a sub-rect of the
// source image to paint, and `range` × the value determines how far the sprite slides along
// `angle`. Type values mirror upstream `SkinProperty.SLIDER_*` (sparse enum):
//
//   - `type = 1`: SLIDER_MUSICSELECT_POSITION — select-scene scroll position
//   - `type = 4`: SLIDER_LANECOVER — 1P lanecover height (`num.lanecover1 = 14`)
//   - `type = 5`: SLIDER_LANECOVER2 — 2P lanecover
//   - `type = 6`: SLIDER_MUSIC_PROGRESS — playback progress during the song
//   - `type = 7`: SLIDER_SKINSELECT_POSITION — skin-select scroll position
//   - `type = 17 / 18 / 19`: master / key / BGM volume
//
// HISPEED / LIFT / HIDDEN are NOT slider types in upstream — those values are surfaced via
// `value[]` digit displays (e.g. `num.hispeed = 310`), not slider indicators.
//
// The renderer treats sliders as read-only displays — drag interaction is the host's job. The
// declaration pattern is identical to `graph[]` plus the `range` field.
//
// Direction codes (0=up, 1=right, 2=down, 3=left) are sourced from `SkinSlider.java` line 26.

import { flattenBeatorajaElements, type NormalizedElement } from './base.ts';
import { floatPropertyField, numberField, sourceIdField } from './fields.ts';
import type { BeatorajaImageId } from './image.ts';
import type { BeatorajaSkinSourceId } from '../types.ts';
import type { BeatorajaFloatPropertyRef } from './graph.ts';

/** Direction the slider sprite translates as `value` rises from 0 to 1. */
export type BeatorajaSliderDirection = 'right' | 'up' | 'left' | 'down';

export interface BeatorajaSliderElement {
  /** Destination id this slider targets. Same id space as `image[]` / `value[]` / `text[]` / `graph[]`. */
  id: BeatorajaImageId;
  /** `source[].id` reference. Numeric and symbolic string ids are both valid. */
  src: BeatorajaSkinSourceId;
  /** Source-rect crop. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Direction the sprite translates along. */
  angle: BeatorajaSliderDirection;
  /** Maximum translation distance in skin-pixel units (sprite slides `value * range` along `angle`). */
  range: number;
  /** Runtime value-source code. Renderer resolves it via the host's `resolveSliderValue` callback. */
  type: number;
  /** Optional `value` FloatProperty. Beatoraja evaluates this instead of `type` when authored. */
  valueProperty?: BeatorajaFloatPropertyRef;
  /** `if` codes that gate visibility. */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaSliders(input: unknown): BeatorajaSliderElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaSliderElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaSliderElement | undefined {
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
    angle: angleField(f.angle),
    range: numberField(f, 'range', 0),
    type: numberField(f, 'type', 0),
    ...(valueProperty !== undefined ? { valueProperty } : {}),
    ifCodes: entry.ifCodes,
  };
}

function angleField(value: unknown): BeatorajaSliderDirection {
  if (typeof value === 'number') {
    // Beatoraja's direction codes are explicit in `SkinSlider.java` line 26:
    // slider travel direction `0=up, 1=right, 2=down, 3=left`. The `draw()` math
    // (`region.y + (dir==0 ? +currentValue*range : dir==2 ? -currentValue*range : 0)`) confirms
    // libGDX Y-UP — direction 0 ADDS to skin y, which is visually upward. We Y-flip dst rects on
    // the way to Pixi, so the screen-visual direction labels line up with the source labels here.
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
