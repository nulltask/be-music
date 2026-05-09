// Strict-typed normalization for beatoraja `imageset[]` declarations.
//
// An `imageset` aggregates multiple `image[]` entries under a single id, with the live render picking
// one of the children based on a runtime numeric reference. Beatoraja's reference theme uses this for
// per-lane chrome that flips state — the lane keybeam toggling between "neutral" and "perfect-judge
// flash" variants, the bomb cycling between frames of an animation strip, etc:
//
//   { id = "keybeam1", ref = 501, images = { "keybeam-w", "keybeam-w-pg" } }
//
// When op `501` (per-lane state) reads `0`, the destination renders `keybeam-w`; when it reads `1`,
// `keybeam-w-pg` paints instead. The image ids inside `images[]` are normal `image[].id` references —
// the renderer crops them through the standard texture pipeline.
//
// Imageset ids share the namespace with `image[]`, `value[]`, `text[]`, `graph[]`, `slider[]` —
// destinations match by id, with image / value / text / graph / slider winning on collision (mirrors
// beatoraja's resolver order).

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import { isBeatorajaLuaFunctionValue } from './beatoraja-skin-lua.ts';
import type { BeatorajaIntegerPropertyRef } from './beatoraja-skin-value.ts';

export interface BeatorajaImagesetElement {
  /** Destination id this imageset targets. Same id space as `image[]` / `value[]` / `text[]`. */
  id: BeatorajaImageId;
  /**
   * Op-code reference whose runtime value picks the active sub-image. The value is treated as an
   * index into `images[]`; out-of-range values clamp to `images[0]` (the "neutral" state).
   * `0` means "no ref" — always render `images[0]`.
   */
  ref: number;
  /** Optional `value` IntegerProperty. Beatoraja evaluates this instead of `ref` when authored. */
  valueProperty?: BeatorajaIntegerPropertyRef;
  /** Sub-image ids (each an `image[].id`). Empty array → renders nothing. */
  images: ReadonlyArray<BeatorajaImageId>;
  /**
   * Click-event code (audit 2.5). Mirrors beatoraja's `Event act` field on `JsonSkin.ImageSet`.
   * When non-zero AND the host wires an `onButtonAction` callback, the renderer makes the
   * imageset's sprite interactive and forwards this code on tap. Default skin uses it for
   * `modeset` (`act:11` cycles keymode filter), GdbG for its mode-cycle button, and
   * ModernChic for various sub-icon flips. Without this parsed the click was dropped at the
   * data layer.
   */
  act: number;
  /**
   * Click mode tag (`int click = 0` in beatoraja). Identifies how the host should interpret
   * the click — typical values are `0` (= regular tap), `1` (= long-press / hold), etc. The
   * renderer forwards this verbatim to the host callback so per-skin variants work.
   */
  click: number;
  /** `if` codes that gate visibility (AND-merged with the destination's `op[]`). */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaImagesets(input: unknown): BeatorajaImagesetElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaImagesetElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaImagesetElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const rawImages = f.images;
  if (!Array.isArray(rawImages)) return undefined;
  const images: BeatorajaImageId[] = [];
  for (const v of rawImages) {
    if (typeof v === 'string' || typeof v === 'number') images.push(v);
  }
  if (images.length === 0) return undefined;
  const valueProperty = integerPropertyField(f.value);
  return {
    id,
    ref: numberField(f, 'ref', 0),
    ...(valueProperty !== undefined ? { valueProperty } : {}),
    images,
    act: numberField(f, 'act', 0),
    click: numberField(f, 'click', 0),
    ifCodes: entry.ifCodes,
  };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function integerPropertyField(value: unknown): BeatorajaIntegerPropertyRef | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isBeatorajaLuaFunctionValue(value)) return value;
  return undefined;
}
