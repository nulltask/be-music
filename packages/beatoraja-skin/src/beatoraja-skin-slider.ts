// Strict-typed normalization for beatoraja `slider[]` declarations.
//
// A `slider` is a sprite that translates along a direction within its destination box, driven by a
// runtime value in `[0, 1]`. The classic example is a lanecover line that the player drags up /
// down — the dst rect anchors the bar's home position, the `(x, y, w, h)` defines a sub-rect of the
// source image to paint, and `range` × the value determines how far the sprite slides along
// `angle`. Common types in beatoraja's reference theme:
//
//   - `type = 4`: 1P lanecover position (slider moves with `num.lanecover1 = 14`)
//   - `type = 5`: 2P lanecover
//   - `type = 6`: hispeed lift / hidden indicator
//
// The renderer treats sliders as read-only displays — drag interaction is the host's job. The
// declaration pattern is identical to `graph[]` plus the `range` field.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';

/** Direction the slider sprite translates as `value` rises from 0 to 1. */
export type BeatorajaSliderDirection = 'right' | 'up' | 'left' | 'down';

export interface BeatorajaSliderElement {
  /** Destination id this slider targets. Same id space as `image[]` / `value[]` / `text[]` / `graph[]`. */
  id: BeatorajaImageId;
  /** Source image index. */
  src: number;
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
  return {
    id,
    src: numberField(f, 'src', 0),
    x: numberField(f, 'x', 0),
    y: numberField(f, 'y', 0),
    w: numberField(f, 'w', 0),
    h: numberField(f, 'h', 0),
    angle: angleField(f.angle),
    range: numberField(f, 'range', 0),
    type: numberField(f, 'type', 0),
    ifCodes: entry.ifCodes,
  };
}

function angleField(value: unknown): BeatorajaSliderDirection {
  if (typeof value === 'number') {
    // Beatoraja's `angle` parity: 0/2 → vertical, 1/3 → horizontal (verified in
    // `JSONSkinLoader.java` via `angle == 1 || angle == 3 ? width : height`). The reference
    // theme's lanecover slider uses `angle = 2` and slides upward, confirming `2 = up`. This
    // mapping is INVERTED from LR2's convention — beatoraja and LR2 disagree on this.
    switch (value) {
      case 0:
        return 'down';
      case 1:
        return 'right';
      case 2:
        return 'up';
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
