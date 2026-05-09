// Strict-typed normalization for beatoraja's `pmchara[]` (POMYU character) declarations.
//
// `pmchara` is the popn-style 9K skin's dancing-character display block. Each entry pairs an
// element id (referenced from `destination[]`) with a `source[]` slot that supplies the
// character's frame images — beatoraja themes ship these as packs of PNG sequences keyed off
// chart-driven cues (judge events, BPM ticks, etc.). The reference 9K skin authors four
// destinations:
//
//   {"id":"dstPMchara1P", "src":"srcPMchara1P", "color":1, "type":0, "side":1},
//   {"id":"dstPMchara2P", "src":"srcPMchara2P", "color":1, "type":0, "side":2},
//   {"id":"dstPMchara1PBG", "src":"srcPMchara1P", "color":1, "type":1},
//   {"id":"dstPMchara2PBG", "src":"srcPMchara2P", "color":1, "type":1}
//
// The id namespace is shared with `image[]` / `value[]` / `text[]` etc. — destinations match by
// id and the renderer picks the matching kind (image > value > … > pmchara) when the skin
// authored multiple kinds with the same id (rare, but defensively handled).
//
// Note this parser intentionally stops at the data-shape level. POMYU character ANIMATION
// (frame cycling driven by chart cues, color tinting, side-aware visibility) is a follow-up
// patch — the renderer treats a `pmchara` entry as a static sprite sourced from `src` until
// the animation hooks land. With the default `def: "Off"` filepath setting most charts won't
// even load character textures, so the static-only behavior is graceful out of the box.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import type { BeatorajaSkinSourceId } from './beatoraja-skin-types.ts';

/**
 * Display variant — popn skins author both a "main" character animation (foreground, masked
 * around the body) and a "background" silhouette layer that the BG sprite paints behind.
 * `0` is main / `1` is background; values outside that range are tolerated and surface
 * verbatim so future popn extensions can introduce new variants without breaking the parser.
 */
export type BeatorajaPmCharaType = number;

/**
 * 1P or 2P side the character is bound to. Beatoraja's `JsonSkin.PmChara.side` defaults to
 * `1` (per `JsonSkin.java`) and the play loader normalizes `chara.side == 2 ? 2 : 1` —
 * effectively "0 / unset → 1P, 2 → 2P". Our type union keeps `0` for backward compatibility
 * with already-parsed records, but the parser now emits `1` as the default per audit 3.1.
 */
export type BeatorajaPmCharaSide = 0 | 1 | 2;

export interface BeatorajaPmCharaElement {
  /** Destination id this character targets. Same id space as `image[]` / `value[]` / etc. */
  id: BeatorajaImageId;
  /**
   * Source slot id (`source[].id`) — the character pack's path. Numeric and symbolic ids are
   * both valid (matching the rest of beatoraja's source system). Beatoraja's wildcard syntax
   * for character packs uses a `|TAG|` extension (`"POMYU Chara/*|1P|"`) that the standard
   * wildcard expander doesn't honor; the renderer falls back to the source's resolved
   * texture (typically empty when no pack is dropped) so unsupported packs hide cleanly.
   */
  src: BeatorajaSkinSourceId;
  /**
   * Color filter index. `1` = default character coloring; other values request beatoraja's
   * built-in character recolor presets (party / monochrome / etc.). Surfaced verbatim for
   * the renderer to apply once color presets are wired.
   */
  color: number;
  /** Display variant — see {@link BeatorajaPmCharaType}. Defaults to `0` (main). */
  type: BeatorajaPmCharaType;
  /** Side the character is bound to. `0` (= any) is the safe default. */
  side: BeatorajaPmCharaSide;
  /** `if` codes that gate visibility (from `if`/`values` flattening). */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaPmCharas(input: unknown): BeatorajaPmCharaElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaPmCharaElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaPmCharaElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const src = f.src;
  if (typeof src !== 'string' && typeof src !== 'number') return undefined;
  return {
    id,
    src,
    // Default `color = 1` matches beatoraja's `JsonSkin.PmChara.color = 1` declaration
    // (audit 3.1). The play loader further clamps `chara.color == 2 ? 2 : 1` — the only
    // valid runtime values are 1 and 2. The previous default of 0 was non-portable; a skin
    // omitting `color` would lose its character coloring entirely in our impl while showing
    // the default tint in real beatoraja.
    color: numberField(f, 'color', 1),
    type: numberField(f, 'type', 0),
    side: sideField(f.side),
    ifCodes: entry.ifCodes,
  };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sideField(value: unknown): BeatorajaPmCharaSide {
  // Match beatoraja's `JsonPlaySkinObjectLoader` normalization (audit 3.1):
  //   `chara.side == 2 ? 2 : 1`
  // — anything other than literal 2 (including unset, 0, or invalid) means 1P. Earlier we
  // returned 0 for "unset", which is a fictional state in beatoraja's runtime.
  if (typeof value === 'number' && Number.isFinite(value) && value === 2) return 2;
  return 1;
}
