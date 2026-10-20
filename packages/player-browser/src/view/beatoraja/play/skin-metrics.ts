import type { BeatorajaSkin } from '@be-music/skin-beatoraja';
import { flipRectToPixi } from '../../../skin/beatoraja/render.ts';

// Values the beatoraja play scene reads off its skin at construction: the lane's authored bottom, the judge combo digit
// pitch, and the fade-out window.

/**
 * Compute the AUTHORED Pixi-Y of the lane's bottom edge from the note section's first dst
 * block. Mirrors upstream's `hl = lanes[0].region.y` (`LaneRenderer.java:275`) — the lane's
 * authored bottom is what every barline / BPM-marker / time-marker offset references.
 *
 * `noteSection.dst[0]` carries the default lane layout (no `if` gating); we ignore the optional
 * gated alts. Each per-lane rect is in libGDX Y-UP; flip to Pixi and take the max bottom edge
 * across all lanes — that's the judgement line in screen space. Returns `0` when the section
 * has no rects (no lane authored), letting the marker layer fall back to "marker bottom =
 * scroll position" via its `laneAuthoredBottomY: undefined` branch.
 */
export function computeAuthoredLaneBottomYPixi(
  rects: ReadonlyArray<{ readonly x: number; readonly y: number; readonly w: number; readonly h: number }>,
  canvasHeight: number,
): number | undefined {
  if (rects.length === 0) return undefined;
  let bottom = 0;
  let any = false;
  for (const rect of rects) {
    const flipped = flipRectToPixi({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, canvasHeight);
    const b = flipped.y + flipped.h;
    if (b > bottom) bottom = b;
    any = true;
  }
  return any ? bottom : undefined;
}

/**
 * Read the per-side combo-digit metrics needed to compute the judge-word-shift amount.
 * Mirrors upstream's `nowCount.getLength()` formula at `SkinNumber.java:185`:
 *
 *     length = (region.width + space) * (currentImages.length - shiftbase)
 *
 * For the shift's purposes we need `region.width + space` as the per-digit pitch — that's
 * what we capture here. Two skin sources contribute:
 *
 *   - `skin.judge[i].numbers[0].dst[0].w` — the per-digit cell width (= `region.width` at
 *     runtime, before any offsets[].w grows it).
 *   - `skin.value[id == numbers[0].id].space` — the inter-digit space (`SkinNumber.space`),
 *     authored on the matching `value[]` declaration. Most skins author 0; some banner-style
 *     digit fonts use small positive values.
 *
 * Default `(width = 40, space = 0)` covers default skin's `play5.json` / `play7main.lua`
 * which both author `numbers[i].dst.w = 40` and the matching `value` block doesn't author
 * a non-zero space.
 */
export function readJudgeComboMetrics(skin: BeatorajaSkin): {
  1: { width: number; space: number };
  2: { width: number; space: number };
} {
  const result = {
    1: { width: 40, space: 0 },
    2: { width: 40, space: 0 },
  };
  const judges = (skin as { judge?: unknown }).judge;
  if (!Array.isArray(judges)) return result;
  // Build a quick `value[].id → value` map so we can look up the `space` field for each
  // judge.numbers[0].id without re-scanning value[] for every judge.
  const valuesById = new Map<string | number, { space?: number }>();
  const values = (skin as { value?: unknown }).value;
  if (Array.isArray(values)) {
    for (const v of values) {
      if (v === null || typeof v !== 'object') continue;
      const obj = v as Readonly<Record<string, unknown>>;
      const id = obj.id;
      if (typeof id === 'string' || typeof id === 'number') {
        valuesById.set(id, obj as { space?: number });
      }
    }
  }
  for (const judge of judges) {
    if (judge === null || typeof judge !== 'object') continue;
    const obj = judge as Readonly<Record<string, unknown>>;
    const index = typeof obj.index === 'number' ? obj.index : 0;
    const side: 1 | 2 = index === 1 ? 2 : 1;
    const numbers = Array.isArray(obj.numbers) ? obj.numbers : [];
    const first = numbers[0];
    if (first === null || typeof first !== 'object') continue;
    const firstObj = first as Readonly<Record<string, unknown>>;
    const dst = firstObj.dst;
    if (Array.isArray(dst) && dst.length > 0) {
      const kf = dst[0];
      if (kf !== null && typeof kf === 'object') {
        const w = (kf as Readonly<Record<string, unknown>>).w;
        if (typeof w === 'number' && Number.isFinite(w) && w > 0) {
          result[side].width = w;
        }
      }
    }
    // `numbers[0].id` references a `value[]` declaration — pull its `space` field.
    const valueId = firstObj.id;
    if (typeof valueId === 'string' || typeof valueId === 'number') {
      const valueDef = valuesById.get(valueId);
      const space = valueDef?.space;
      if (typeof space === 'number' && Number.isFinite(space)) {
        result[side].space = space;
      }
    }
  }
  return result;
}
