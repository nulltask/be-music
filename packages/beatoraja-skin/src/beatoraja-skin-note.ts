// Normalizer for the `skin.note` declaration.
//
// Beatoraja's `note` block defines per-lane note rendering: which `image[]` IDs to use for each note kind
// (regular tap, LN start / body / end / active, hidden charge note variants, mines), plus a `dst[]` block
// that holds per-lane (x, y, w, h) rectangles. The same shape covers JSON skins (where `note` is an object)
// and Lua skins (where `skin.note = {...}` builds the same shape at evaluation time).
//
// The skin author keys per-lane sprite IDs by lane index — entry 0 is lane 1 in the play layout, entry 1
// is lane 2, etc. Lane counts vary by play variant: 8 for 7K (7 keys + 1 scratch), 6 for 5K (5 + scratch),
// 9 for PMS, 16 for double-play, 26 for 24-key (with `note-su` / `note-sd` for the two scratches at the
// trailing end). The renderer uses the `playVariant` to know how many entries to consume and which channel
// → lane mapping to apply.
//
// The `dst[]` block can be a flat array (single layout) or a list of `{ if: [op...], values: [rect...] }`
// gates that the renderer evaluates against `activeOps` to pick the active layout — this is how skins
// support multiple lane geometries from the same author file (e.g., "Half Lane" / "Hybrid Lane" / "Separate
// Lane" in the play24 reference).

import { isElementVisible } from './beatoraja-skin-element.ts';

/**
 * Per-lane sprite-ID lists for each note kind. Each array's index `i` is the lane index (0 = lane 1, 1 =
 * lane 2, …). Empty / missing arrays are returned as `[]` so the renderer can index without `undefined`
 * checks; missing kinds simply mean the skin doesn't draw that note kind on any lane.
 */
export interface BeatorajaNoteSection {
  /** Image-element id this note layer mounts onto (the destination block uses `id = "notes"` to hint placement). */
  id: string;
  /** Per-lane regular-note image IDs. */
  note: ReadonlyArray<string>;
  /** Per-lane long-note start image IDs. */
  lnstart: ReadonlyArray<string>;
  /** Per-lane long-note end image IDs. */
  lnend: ReadonlyArray<string>;
  /** Per-lane hold-charge-note start image IDs (PMS hcn variant). */
  hcnstart: ReadonlyArray<string>;
  /** Per-lane hold-charge-note end image IDs. */
  hcnend: ReadonlyArray<string>;
  /**
   * Raw `lnbody` field. Beatoraja's loader interprets this differently depending on whether
   * the skin uses **legacy** mode or **modern** mode (the latter introduced `lnbodyActive`):
   *
   * - **Legacy** (when `lnbodyActive` is empty): `lnbody` = the "held" body sprite.
   * - **Modern** (when `lnbodyActive` is non-empty): `lnbody` = the "unheld" body sprite.
   *
   * Renderers should consume {@link lnBodyHeld} / {@link lnBodyUnheld} instead of this field
   * directly — they already encode the mode-flip and present a stable per-state slot.
   */
  lnbody: ReadonlyArray<string>;
  /**
   * Raw `lnactive` field. Legacy mode only — beatoraja maps it to the "unheld / failed" slot
   * (`lns[3]`). Renamed to {@link lnbodyActive} in modern mode (where it instead drives the
   * "held" slot). Renderers should use {@link lnBodyHeld} / {@link lnBodyUnheld}.
   */
  lnactive: ReadonlyArray<string>;
  /**
   * Modern-mode "held" body field (audit 1.10). Authored by community skins that follow
   * beatoraja's newer naming convention. When non-empty, the loader switches into modern
   * mode where `lnbody` becomes the "unheld" sprite and `lnbodyActive` is the "held" one.
   */
  lnbodyActive: ReadonlyArray<string>;
  /**
   * Resolved "held" LN body — mirrors beatoraja's `lns[2]`. Modern mode: `lnbodyActive`.
   * Legacy mode: `lnbody`. Use this in the renderer; it already absorbs the mode flip.
   */
  lnBodyHeld: ReadonlyArray<string>;
  /**
   * Resolved "unheld" LN body — mirrors beatoraja's `lns[3]`. Modern mode: `lnbody`.
   * Legacy mode: `lnactive`. Used to paint the body when the player is NOT currently
   * holding the LN (typically the "missed / fading" look).
   */
  lnBodyUnheld: ReadonlyArray<string>;
  /**
   * Raw `hcnbody` field. HCN (hold-charge note, PMS-style) has 4 body states; the field's
   * meaning flips between legacy and modern modes the same way `lnbody` does. See the
   * resolved `hcnBody*` fields below for the post-flip per-state arrays.
   */
  hcnbody: ReadonlyArray<string>;
  /** Legacy "held" HCN — beatoraja's lns[7] in legacy mode. Maps to "unheld" in modern mode. */
  hcnactive: ReadonlyArray<string>;
  /** Legacy "damage" HCN — beatoraja's lns[8] in legacy mode. */
  hcndamage: ReadonlyArray<string>;
  /** Legacy "reactive (after damage)" HCN — beatoraja's lns[9] in legacy mode. */
  hcnreactive: ReadonlyArray<string>;
  /** Modern-mode "held" HCN body field (audit 1.10). When non-empty, switches into modern mode. */
  hcnbodyActive: ReadonlyArray<string>;
  /** Modern-mode "missed / damaged" HCN body field. */
  hcnbodyMiss: ReadonlyArray<string>;
  /** Modern-mode "reactive (recovered after damage)" HCN body field. */
  hcnbodyReactive: ReadonlyArray<string>;
  /**
   * Resolved per-state HCN body slots after the mode flip. Mirrors beatoraja's `lns[6..9]`:
   *
   *   - {@link hcnBodyHeld}     — lns[6]: actively held (modern: `hcnbodyActive`, legacy: `hcnbody`)
   *   - {@link hcnBodyUnheld}   — lns[7]: not held       (modern: `hcnbody`, legacy: `hcnactive`)
   *   - {@link hcnBodyReactive} — lns[8]: recovered      (modern: `hcnbodyReactive`, legacy: `hcndamage`)
   *   - {@link hcnBodyMiss}     — lns[9]: damaged / missed (modern: `hcnbodyMiss`, legacy: `hcnreactive`)
   */
  hcnBodyHeld: ReadonlyArray<string>;
  hcnBodyUnheld: ReadonlyArray<string>;
  hcnBodyReactive: ReadonlyArray<string>;
  hcnBodyMiss: ReadonlyArray<string>;
  /** Per-lane mine image IDs. */
  mine: ReadonlyArray<string>;
  /** Per-lane "hidden cover" image IDs (lift / hidden mode chrome). */
  hidden: ReadonlyArray<string>;
  /** Per-lane "already-judged" note image IDs (used by skins that fade processed notes in place). */
  processed: ReadonlyArray<string>;
  /** Conditional per-lane geometry blocks. Authors may emit a single block (no `if`) or several gated layouts. */
  dst: ReadonlyArray<BeatorajaNoteDestinationBlock>;
  /**
   * Per-marker destination prototypes. Each kind references one or more `image[].id` and an `(x,
   * y, w, h)` rect that defines the marker's visual size on the lane. The renderer paints copies
   * of this rect at every chart-time marker (measure boundary / BPM change / STOP / time tick),
   * scrolled to the matching beat with the same hispeed math the note layer uses. Stored as raw
   * destination records so the renderer's existing destination pipeline can ingest them.
   */
  group: ReadonlyArray<Readonly<Record<string, unknown>>>;
  bpm: ReadonlyArray<Readonly<Record<string, unknown>>>;
  stop: ReadonlyArray<Readonly<Record<string, unknown>>>;
  time: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * Optional pair of integer percentages `[xPct, yPct]` that scale every painted note past the
   * authored `dst[]` rect's natural size. Default 9K's `play9.json` authors `[115, 112]` (= 1.15×
   * width, 1.12× height) for popn-style chunkier notes. `[100, 100]` (or omission) leaves notes
   * at their authored size. Values are clamped to `[1, 1000]` to defensively reject NaN /
   * negative entries.
   */
  expansionRate: { x: number; y: number };
}

/** One `dst` group from the note section — gated by `op` codes that must all be active. */
export interface BeatorajaNoteDestinationBlock {
  /** `op` codes evaluated against `activeOps`. Empty array = always active. Negation via negative codes. */
  ifCodes: ReadonlyArray<number>;
  /** Per-lane rectangles. Index 0 = lane 1, index 1 = lane 2, etc. */
  rects: ReadonlyArray<BeatorajaNoteRect>;
}

/** A single per-lane rect inside `note.dst[]`. */
export interface BeatorajaNoteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EMPTY_SECTION: BeatorajaNoteSection = Object.freeze({
  id: '',
  note: [],
  lnstart: [],
  lnbody: [],
  lnend: [],
  lnactive: [],
  lnbodyActive: [],
  lnBodyHeld: [],
  lnBodyUnheld: [],
  hcnstart: [],
  hcnbody: [],
  hcnend: [],
  hcnactive: [],
  hcndamage: [],
  hcnreactive: [],
  hcnbodyActive: [],
  hcnbodyMiss: [],
  hcnbodyReactive: [],
  hcnBodyHeld: [],
  hcnBodyUnheld: [],
  hcnBodyReactive: [],
  hcnBodyMiss: [],
  mine: [],
  hidden: [],
  processed: [],
  dst: [],
  group: [],
  bpm: [],
  stop: [],
  time: [],
  expansionRate: { x: 100, y: 100 },
});

/**
 * Normalize the raw `skin.note` block into a typed structure. Returns an empty section (every list `[]`)
 * when the skin doesn't author a `note` block — the renderer treats that as "no notes drawn", which lets
 * a skin omit lane notes entirely (e.g., a key-config preview skin).
 */
export function normalizeBeatorajaNote(input: unknown): BeatorajaNoteSection {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) {
    return EMPTY_SECTION;
  }
  const obj = input as Readonly<Record<string, unknown>>;
  // Read every raw field first; the resolved per-state slots are then derived from these via
  // beatoraja's mode-flip logic (see comments on `BeatorajaNoteSection`).
  const lnbody = stringArray(obj.lnbody);
  const lnactive = stringArray(obj.lnactive);
  const lnbodyActive = stringArray(obj.lnbodyActive);
  const hcnbody = stringArray(obj.hcnbody);
  const hcnactive = stringArray(obj.hcnactive);
  const hcndamage = stringArray(obj.hcndamage);
  const hcnreactive = stringArray(obj.hcnreactive);
  const hcnbodyActive = stringArray(obj.hcnbodyActive);
  const hcnbodyMiss = stringArray(obj.hcnbodyMiss);
  const hcnbodyReactive = stringArray(obj.hcnbodyReactive);
  // LN mode flip — mirrors `JsonPlaySkinObjectLoader.java:38-43`. The presence of any
  // `lnbodyActive` entry switches the loader into modern mode.
  const lnModern = lnbodyActive.length > 0;
  const lnBodyHeld = lnModern ? lnbodyActive : lnbody;
  const lnBodyUnheld = lnModern ? lnbody : lnactive;
  // HCN mode flip — mirrors `JsonPlaySkinObjectLoader.java:44-54`.
  const hcnModern = hcnbodyActive.length > 0;
  const hcnBodyHeld = hcnModern ? hcnbodyActive : hcnbody;
  const hcnBodyUnheld = hcnModern ? hcnbody : hcnactive;
  const hcnBodyReactive = hcnModern ? hcnbodyReactive : hcndamage;
  const hcnBodyMiss = hcnModern ? hcnbodyMiss : hcnreactive;
  return {
    id: typeof obj.id === 'string' ? obj.id : '',
    note: stringArray(obj.note),
    lnstart: stringArray(obj.lnstart),
    lnbody,
    lnend: stringArray(obj.lnend),
    lnactive,
    lnbodyActive,
    lnBodyHeld,
    lnBodyUnheld,
    hcnstart: stringArray(obj.hcnstart),
    hcnbody,
    hcnend: stringArray(obj.hcnend),
    hcnactive,
    hcndamage,
    hcnreactive,
    hcnbodyActive,
    hcnbodyMiss,
    hcnbodyReactive,
    hcnBodyHeld,
    hcnBodyUnheld,
    hcnBodyReactive,
    hcnBodyMiss,
    mine: stringArray(obj.mine),
    hidden: stringArray(obj.hidden),
    processed: stringArray(obj.processed),
    dst: normalizeNoteDst(obj.dst),
    group: rawObjectArray(obj.group),
    bpm: rawObjectArray(obj.bpm),
    stop: rawObjectArray(obj.stop),
    time: rawObjectArray(obj.time),
    expansionRate: parseExpansionRate(obj.expansionrate),
  };
}

/**
 * Parse the `expansionrate` array. Beatoraja authors a 2-element `[xPct, yPct]` (default 9K
 * authors `[115, 112]`). Single-element arrays apply uniformly. Anything malformed / missing
 * collapses to `[100, 100]` (= no scaling), matching the renderer's "no-op when factor is 1"
 * fast path.
 */
function parseExpansionRate(input: unknown): { x: number; y: number } {
  if (!Array.isArray(input)) return { x: 100, y: 100 };
  const x = clampPercent(input[0], 100);
  const y = clampPercent(input[1] ?? input[0], 100);
  return { x, y };
}

function clampPercent(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  // Audit 3.2 — allow `0` so authors can set `expansionrate = [0, 0]` to hide notes entirely
  // (a "preview without notes" debug mode some skins use). The previous `value < 1 → 1`
  // clamp silently lifted 0 to 1, which made an authored-zero scale render at 1% (= almost
  // invisible but not actually invisible). Negative values still clamp up to 0 since they're
  // never meaningful here.
  if (value < 0) return 0;
  if (value > 1000) return 1000;
  return value;
}

/**
 * Coerce a possibly-array of objects to a frozen-shape `Record<string, unknown>[]`. Drops
 * non-object entries — typically a defensive shape check, since the marker arrays are author-
 * shaped destinations and we want them as opaque records.
 */
function rawObjectArray(input: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (!Array.isArray(input)) return [];
  const out: Array<Readonly<Record<string, unknown>>> = [];
  for (const v of input) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(v as Readonly<Record<string, unknown>>);
    }
  }
  return out;
}

/**
 * Pick the per-lane rect block whose `if` codes are satisfied by `activeOps`. Returns the first match in
 * declaration order, falling back to the first block with no `if` (the "default" layout). Returns `[]`
 * when nothing matches — the renderer treats that as "lane geometry undefined" and skips note drawing.
 */
export function pickBeatorajaNoteRects(
  section: BeatorajaNoteSection,
  activeOps: ReadonlySet<number>,
): ReadonlyArray<BeatorajaNoteRect> {
  for (const block of section.dst) {
    if (isElementVisible(block.ifCodes, activeOps)) {
      return block.rects;
    }
  }
  return [];
}

// ─── Internals ────────────────────────────────────────────────────────────────────────────────

function stringArray(input: unknown): ReadonlyArray<string> {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    out.push(typeof v === 'string' ? v : '');
  }
  return out;
}

function normalizeNoteDst(input: unknown): ReadonlyArray<BeatorajaNoteDestinationBlock> {
  if (!Array.isArray(input)) return [];
  // Two valid shapes:
  //   1. Flat list of rect objects → one block with no `if` codes.
  //   2. List of `{ if: [...], values: [...] }` gated blocks.
  // We disambiguate by sniffing the first entry: if it has `values`, the whole list is gated blocks; if
  // it has rect-shaped fields (`x`/`y`/`w`/`h`), the whole list is flat rects.
  const flatBlock = collectFlatRects(input);
  if (flatBlock !== undefined) {
    return [{ ifCodes: [], rects: flatBlock }];
  }
  const blocks: BeatorajaNoteDestinationBlock[] = [];
  for (const entry of input) {
    if (entry === null || entry === undefined || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    if (!Array.isArray(obj.values)) continue;
    const rects = collectFlatRects(obj.values) ?? [];
    blocks.push({ ifCodes: collectIfCodes(obj.if), rects });
  }
  return blocks;
}

function collectFlatRects(input: ReadonlyArray<unknown>): BeatorajaNoteRect[] | undefined {
  if (input.length === 0) return undefined;
  // Sniff first entry to distinguish flat from gated.
  const first = input[0];
  if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
    const obj = first as Readonly<Record<string, unknown>>;
    if ('values' in obj || 'if' in obj) return undefined;
  }
  const out: BeatorajaNoteRect[] = [];
  for (const entry of input) {
    if (entry === null || entry === undefined || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    out.push({
      x: toNumber(obj.x, 0),
      y: toNumber(obj.y, 0),
      w: toNumber(obj.w, 0),
      h: toNumber(obj.h, 0),
    });
  }
  return out;
}

function collectIfCodes(input: unknown): ReadonlyArray<number> {
  if (!Array.isArray(input)) return [];
  const out: number[] = [];
  for (const v of input) {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function toNumber(input: unknown, fallback: number): number {
  return typeof input === 'number' && Number.isFinite(input) ? input : fallback;
}
