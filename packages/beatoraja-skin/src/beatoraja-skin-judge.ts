// Strict-typed normalization for beatoraja's `judge` element.
//
// Each entry in `skin.judge` configures the per-side judgement display: 6 graphics (PERFECT,
// GREAT, GOOD, BAD, POOR, MISS) and an optional 6-entry parallel set of "number" graphics for
// showing the early/late ms offset. Both are author-shaped as `Destination`-style objects with
// their own `id` / `timer` / `dst[]` keyframes — meaning the skin authors them as if each
// judgement kind is its own destination.
//
// We don't render judge entries through a dedicated render kind — instead we **expand** the
// per-kind sub-destinations into the normal destination list with the appropriate per-judge op
// gate (`P1_JUDGE_PERFECT = 241`, etc.) and a synthesized `id` matching the sub-entry's `id`.
// The standard image / value pipeline then handles them: the op gate makes only the active
// judge kind visible, and the existing timer / dst-keyframe sampler handles the per-judge
// fly-in / fade-out animation.
//
// `index` selects the player side (0 = 1P, 1 = 2P). `shift` is unused in our path (no FAST /
// SLOW label displacement yet — surfaced via `BEATORAJA_OP.P*_JUDGE_EARLY` / `_LATE` ops).

import { flattenBeatorajaElements } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import type { BeatorajaValueElement } from './beatoraja-skin-value.ts';

/**
 * One `judge[]` entry as authored. The renderer's expansion pass consumes this and emits 12
 * synthetic destinations (6 images + 6 numbers) targeting the standard destination pipeline.
 */
export interface BeatorajaJudgeElement {
  /** Author-given id. Not directly used by the renderer; preserved for diagnostics. */
  id: string;
  /** Player side. 0 = 1P, 1 = 2P. Drives which `_*P_JUDGE_*` op set the gates use. */
  index: number;
  /** Per-judge image destinations (PG / GR / GD / BD / PR / MS, in that order). */
  images: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Per-judge number destinations — typically the early/late ms readout. Same order as images. */
  numbers: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * `shift` flag from the source. Authors set this to displace the readout based on FAST /
   * SLOW; the renderer doesn't honor this yet (parsed for forward compatibility).
   */
  shift: boolean;
}

export function normalizeBeatorajaJudges(input: unknown): BeatorajaJudgeElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaJudgeElement[] = [];
  for (const entry of flattened) {
    const f = entry.fields;
    const id = typeof f.id === 'string' ? f.id : typeof f.id === 'number' ? String(f.id) : undefined;
    if (id === undefined) continue;
    out.push({
      id,
      index: numberField(f, 'index', 0),
      images: arrayField(f.images),
      numbers: arrayField(f.numbers),
      shift: typeof f.shift === 'boolean' ? f.shift : false,
    });
  }
  return out;
}

/** Per-judge op codes per side (1P / 2P), in PG → MS order. From prop.lua's `_*p_*` block. */
const SIDE_JUDGE_OPS: Record<1 | 2, ReadonlyArray<number>> = {
  1: [
    241, // _1p_perfect
    242, // _1p_great
    243, // _1p_good
    244, // _1p_bad
    245, // _1p_poor
    246, // _1p_miss
  ],
  2: [
    261, // _2p_perfect
    262, // _2p_great
    263, // _2p_good
    264, // _2p_bad
    265, // _2p_poor
    266, // _2p_miss
  ],
};

/** Synthetic "gauge is currently at max" op codes per side (audit 1.2). Mirrors the keys
 * defined in `beatoraja-runtime-ids.ts` (`BEATORAJA_OP.GAUGE_NOW_AT_MAX_*`); kept inline as
 * literal numbers here to avoid a circular import with the broader OP registry. */
const SIDE_GAUGE_MAX_OPS: Record<1 | 2, number> = { 1: 90100, 2: 90101 };

/**
 * Expand the parsed judge entries into raw destination-shaped records the standard destination
 * pipeline can ingest. Each sub-image / sub-number gains an `op = [...currentOp, judgeKindOp]`
 * gate so only the active judge kind paints. The existing op gate (if the author set one) is
 * preserved by appending — both must be active for visibility.
 *
 * Indices beyond the 6-tier `PG/GR/GD/BD/PR/MS` set alias back to PERFECT — beatoraja themes
 * use the extra slots for popn-style PG-only secondary effects. Default 9K's `play9.json`
 * authors a 7-image judge with `judgef-pg2` at index 6, and the engine fires both that AND
 * the standard `judgef-pg` simultaneously on a PERFECT verdict. Without this aliasing the
 * 7th entry was silently dropped (`i < ops.length` cap), so 9K plays missed half of the
 * authored PG splash.
 *
 * Returns the freshly-allocated destination records; caller concats them with `skin.destination`
 * before passing to `normalizeBeatorajaDestinations`.
 */
export function expandBeatorajaJudgeDestinations(
  judges: ReadonlyArray<BeatorajaJudgeElement>,
  /**
   * Optional lookup of `value[]` declarations by id. When supplied, judge.numbers[i] children
   * receive upstream's combo-digit-specific treatment:
   *
   *   1. PRE-SHIFT: each child dst's `x` is decremented by `dst.w * value.digit / 2`. Mirrors
   *      `JsonPlaySkinObjectLoader.java:267-270` (`for ani: ani.x -= ani.w * value.digit / 2`).
   *      Effectively converts the authored child.x from "left edge of digit row" to "centre of
   *      digit row".
   *   2. ALIGN OVERRIDE: the matching value's `align` is mutated to `2` (CENTER), mirroring
   *      `SkinJudge`'s hard-coded center-align mode for combo digits regardless of any
   *      `value.align` the JSON authored.
   *
   * Without these, default `play5.json`'s combo digit "46" rendered far to the right of the
   * judge popup (= 4 leading-blank slot widths × 40 px = 160 px gap before the visible "46"),
   * because the value declaration has `digit:6` with no align field (defaults to RIGHT in our
   * convention) and our fold treated child.x as the left edge of the digit row.
   *
   * Omitting the lookup falls back to the previous behaviour (parent.x + child.x as-is, no
   * align override) — useful for tests that don't need the full skin context.
   */
  valuesById?: ReadonlyMap<BeatorajaImageId, BeatorajaValueElement>,
): Array<Readonly<Record<string, unknown>>> {
  const out: Array<Readonly<Record<string, unknown>>> = [];
  for (const judge of judges) {
    const side: 1 | 2 = judge.index === 1 ? 2 : 1;
    const ops = SIDE_JUDGE_OPS[side];
    // Detect whether the skin authored the modern fullgauge-PG substitute at index 6 (audit
    // 1.2). When it has, beatoraja's `SkinJudge.prepare()` makes `judge[0]` and `judge[6]`
    // mutually exclusive: PG with full gauge → judge[6], PG without full gauge → judge[0].
    // Without this flag the previous TS impl emitted both side-by-side, so default play9's
    // `judgef-pg2` (the only sample skin that authors the slot today) double-rendered on
    // every PG, not just full-gauge PGs.
    const hasFullgaugeSubstitute = judge.images.length > 6 && judge.images[6] !== undefined;
    const gaugeMaxOp = SIDE_GAUGE_MAX_OPS[side];
    for (let i = 0; i < judge.images.length; i += 1) {
      const child = judge.images[i];
      if (child === undefined) continue;
      const gate = ops[i] ?? ops[0]!;
      // When a fullgauge substitute is present, gate the PG slot (i=0) on NOT-fullgauge and
      // the substitute slot (i=6) on fullgauge. All other slots (1..5, plus 7+ aliases)
      // keep their per-tier op only.
      if (hasFullgaugeSubstitute && i === 0) {
        out.push(addOpGate(addOpGate(child, gate), -gaugeMaxOp));
        continue;
      }
      if (hasFullgaugeSubstitute && i === 6) {
        out.push(addOpGate(addOpGate(child, gate), gaugeMaxOp));
        continue;
      }
      out.push(addOpGate(child, gate));
    }
    // judge.numbers[] (the ms / count readouts paired with each judge tier) are only emitted
    // for the top three tiers (PG / GR / GD) per beatoraja's `SkinJudge.java:96`:
    //   `nowCount = judgenow < 3 ? count[judgenow] : null;`
    // Tiers 3..5 (BD / PR / MS) get NO number — beatoraja deliberately hides the readout on
    // failed judgments so a stale combo / FAST-SLOW digit doesn't linger over a miss splash.
    //
    // Position fold: `judge.numbers[i].dst` is RELATIVE to the matching `judge.images[i].dst`
    // — beatoraja's `SkinJudge.draw()` paints the number at `(parent.x + child.x, parent.y +
    // child.y)`. The previous TS impl emitted children verbatim with their `(child.x, child.y)`
    // as ABSOLUTE skin coords, so default `play5.json`'s `judgen-pg` at `{x:200, y:0}` painted
    // at the bottom of the screen (Y-UP `y=0`) next to DURATION instead of "to the right of
    // the PERFECT word". Folded dst keyframes are emitted per parent variant (the parent's
    // `if[layout]`-gated rect drives the absolute position; the child's `(x, y, w, h)` adds the
    // offset and overrides the size). Pure-time keyframes (e.g. `{time:500}` fade-out) pass
    // through unchanged so the animation timeline survives the fold.
    const numberLimit = Math.min(judge.numbers.length, 3);
    for (let i = 0; i < numberLimit; i += 1) {
      const child = judge.numbers[i];
      const parent = judge.images[i];
      if (child === undefined) continue;
      const gate = ops[i] ?? ops[0]!;
      // Look up the matching `value[]` declaration to apply the combo-digit-specific
      // adjustments (see {@link expandBeatorajaJudgeDestinations}'s `valuesById` doc).
      const valueId = typeof child.id === 'string' || typeof child.id === 'number' ? child.id : undefined;
      const valueElement = valueId !== undefined ? valuesById?.get(valueId as BeatorajaImageId) : undefined;
      const valueDigit = valueElement !== undefined ? Math.max(1, Math.trunc(valueElement.digit)) : undefined;
      const folded =
        parent !== undefined ? foldChildDestIntoParent(child, parent, valueDigit) : child;
      // Override the value's align to 2 (CENTER) — beatoraja's `SkinJudge` hardcodes center-
      // align for combo digits regardless of the JSON's `value.align` field. Mutation is safe
      // because `judgen-*` ids are conventionally only referenced from `judge[].numbers[]`.
      if (valueElement !== undefined) {
        (valueElement as { align: number }).align = 2;
      }
      out.push(addOpGate(folded, gate));
    }
  }
  return out;
}

/**
 * Fold each child dst keyframe's `(x, y)` into the matching parent's authored position so the
 * combined record paints at the parent's anchor + child offset. The CHILD'S `(w, h)` overrides
 * the parent (numbers are typically smaller than the judgef word sprite); other fields like
 * `r/g/b/a/angle` pass through from the child verbatim.
 *
 * Layout-variant handling: parent dst entries wrapped in `{if:[...], value:{...}}` (= dst alts
 * gated on layout option ops) emit one matching `{if:[...], value:{...}}` entry per parent
 * variant in the output, joined with the child's position-defining keyframe. Direct keyframes
 * (`{time:N, x:X, ...}`) on the parent emit one position-folded keyframe per child position
 * keyframe at that parent's coords. Pure-time child keyframes (e.g. `{time:500}` fade) pass
 * through unchanged.
 */
function foldChildDestIntoParent(
  child: Readonly<Record<string, unknown>>,
  parent: Readonly<Record<string, unknown>>,
  /**
   * When set, applies upstream's combo-digit pre-shift `(ckf.w * digit) / 2` to each
   * folded x. Mirrors `JsonPlaySkinObjectLoader.java:267-270`. Skipped when `undefined`
   * (= the child isn't a judge.numbers entry, or no matching value declaration is
   * available to read `digit` from).
   */
  valueDigitForPreShift?: number,
): Readonly<Record<string, unknown>> {
  const childDst = Array.isArray(child.dst) ? (child.dst as ReadonlyArray<unknown>) : [];
  const parentDst = Array.isArray(parent.dst) ? (parent.dst as ReadonlyArray<unknown>) : [];
  if (childDst.length === 0 || parentDst.length === 0) return child;

  // Split the child's keyframes: position-bearing entries get folded against parent positions;
  // pure-time entries (no x/y) survive verbatim as fade-out / hold cues.
  const childPositionKfs: Array<Readonly<Record<string, unknown>>> = [];
  const childPureKfs: Array<Readonly<Record<string, unknown>>> = [];
  for (const kf of childDst) {
    if (kf === null || typeof kf !== 'object') continue;
    const obj = kf as Readonly<Record<string, unknown>>;
    if (typeof obj.x === 'number' || typeof obj.y === 'number') childPositionKfs.push(obj);
    else childPureKfs.push(obj);
  }
  if (childPositionKfs.length === 0) return child;

  // Walk parent keyframes. For each one that defines a position, emit folded child variants.
  const out: Array<Readonly<Record<string, unknown>>> = [];
  let parentHadPositionedKf = false;
  for (const parentKf of parentDst) {
    if (parentKf === null || typeof parentKf !== 'object') continue;
    const parentObj = parentKf as Readonly<Record<string, unknown>>;
    // `{if:[...], value:{...}}` wrapper — preserve the if-gating around the folded child entries.
    if (Array.isArray(parentObj.if) && parentObj.value !== undefined) {
      const inner = parentObj.value as Readonly<Record<string, unknown>>;
      if (typeof inner.x === 'number' || typeof inner.y === 'number') {
        parentHadPositionedKf = true;
        const px = numberOrZero(inner.x);
        const py = numberOrZero(inner.y);
        for (const ckf of childPositionKfs) {
          const folded: Record<string, unknown> = { ...ckf };
          const preShiftX =
            valueDigitForPreShift !== undefined ? (numberOrZero(ckf.w) * valueDigitForPreShift) / 2 : 0;
          folded.x = px + numberOrZero(ckf.x) - preShiftX;
          folded.y = py + numberOrZero(ckf.y);
          out.push({ if: parentObj.if, value: folded });
        }
      }
      continue;
    }
    // Direct keyframe with x/y. Combine with each child position kf.
    if (typeof parentObj.x === 'number' || typeof parentObj.y === 'number') {
      parentHadPositionedKf = true;
      const px = numberOrZero(parentObj.x);
      const py = numberOrZero(parentObj.y);
      for (const ckf of childPositionKfs) {
        const folded: Record<string, unknown> = { ...ckf };
        const preShiftX =
          valueDigitForPreShift !== undefined ? (numberOrZero(ckf.w) * valueDigitForPreShift) / 2 : 0;
        folded.x = px + numberOrZero(ckf.x) - preShiftX;
        folded.y = py + numberOrZero(ckf.y);
        out.push(folded);
      }
    }
  }
  // Parent never authored a positioned keyframe → no fold to perform. Pass the child through
  // verbatim so authors that intentionally pin numbers to absolute coords (rare; no in-tree
  // skin currently does this) keep their authored layout.
  if (!parentHadPositionedKf) return child;
  for (const kf of childPureKfs) out.push(kf);
  return { ...child, dst: out };
}

function numberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Produce a copy of the destination record with `op` extended to AND-include `gateOp`. If the
 * source already has an `op` array, the new code is appended; otherwise a fresh single-element
 * array is set. Other fields pass through unchanged — this is a lightweight clone that doesn't
 * deep-copy the `dst[]` keyframes (those are read-only at this point).
 */
function addOpGate(child: Readonly<Record<string, unknown>>, gateOp: number): Readonly<Record<string, unknown>> {
  const existingOp = child.op;
  const merged: number[] = [];
  if (Array.isArray(existingOp)) {
    for (const v of existingOp) {
      if (typeof v === 'number' && Number.isFinite(v)) merged.push(v);
    }
  }
  merged.push(gateOp);
  return { ...child, op: merged };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function arrayField(value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Readonly<Record<string, unknown>>> = [];
  for (const v of value) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(v as Readonly<Record<string, unknown>>);
    }
  }
  return out;
}
