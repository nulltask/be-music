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
): Array<Readonly<Record<string, unknown>>> {
  const out: Array<Readonly<Record<string, unknown>>> = [];
  for (const judge of judges) {
    const side: 1 | 2 = judge.index === 1 ? 2 : 1;
    const ops = SIDE_JUDGE_OPS[side];
    for (let i = 0; i < judge.images.length; i += 1) {
      const child = judge.images[i];
      if (child === undefined) continue;
      const gate = ops[i] ?? ops[0]!;
      out.push(addOpGate(child, gate));
    }
    // judge.numbers[] (the ms / count readouts paired with each judge tier) are only emitted
    // for the top three tiers (PG / GR / GD) per beatoraja's `SkinJudge.java:96`:
    //   `nowCount = judgenow < 3 ? count[judgenow] : null;`
    // Tiers 3..5 (BD / PR / MS) get NO number — beatoraja deliberately hides the readout on
    // failed judgments so a stale combo / FAST-SLOW digit doesn't linger over a miss splash.
    // The previous TS impl emitted all 6 tiers identically, so authoring `judge.numbers[3..5]`
    // (or, more commonly, having ALL 6 entries reference the same MAXCOMBO ref like
    // ModernChic Play/lua/sp/judge.lua and GdbG play/values.lua do) painted a wrong digit on
    // BAD/POOR/MISS where Java would render nothing (audit 1.3).
    const numberLimit = Math.min(judge.numbers.length, 3);
    for (let i = 0; i < numberLimit; i += 1) {
      const child = judge.numbers[i];
      if (child === undefined) continue;
      const gate = ops[i] ?? ops[0]!;
      out.push(addOpGate(child, gate));
    }
  }
  return out;
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
