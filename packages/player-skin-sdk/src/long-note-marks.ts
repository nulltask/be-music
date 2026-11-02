/**
 * Telling the long-note kinds apart by shape (#940): an LN, a charge note (CN), a hell charge note (HCN) and a
 * back-spin scratch (BSS) all share the lane's colour, so a skin marks the difference with shapes that read without
 * colour:
 *
 * - **LN**: only the head is judged, so the tail cap is drawn faint — where to let go, not a note to hit.
 * - **CN**: the release is judged too, so the tail keeps a full cap.
 * - **HCN**: the gauge drains while it is not held, so rungs cross the body ({@link hellChargeRungs}); they flow toward
 *   the judgement line while the note is held (charging) and stand still otherwise.
 * - **BSS**: a charge note on a scratch lane, whose tail is judged on a spin the other way, so a chevron pointing back
 *   up the lane sits on the tail cap ({@link backSpinChevron}). A hell-charge BSS carries both marks.
 */
import type { BeMusicLaneKind, BeMusicLongNote, BeMusicLongNoteMode } from './types.ts';

/** The marks a long note carries: see the module comment. */
export interface BeMusicLongNoteMarks {
  /** The tail is judged (CN / HCN / BSS): draw the full tail cap. An LN's tail is drawn faint. */
  judgedTail: boolean;
  /** Hell charge: rungs across the body. */
  hellCharge: boolean;
  /** Back-spin scratch: a chevron on the tail cap. */
  backSpin: boolean;
}

/**
 * True when a long note is a back-spin scratch: a charge note (`'cn'` / `'hcn'`, the mode the ruleset plays it in) on a
 * scratch lane. Hosts set {@link BeMusicLongNote.backSpinScratch} from this.
 */
export function isBackSpinScratchLongNote(kind: BeMusicLaneKind, mode: BeMusicLongNoteMode | undefined): boolean {
  return kind === 'scratch' && (mode === 'cn' || mode === 'hcn');
}

/** The marks of one long note of the frame. A note whose mode is not known yet carries none (a full tail cap). */
export function resolveLongNoteMarks(note: Pick<BeMusicLongNote, 'mode' | 'backSpinScratch'>): BeMusicLongNoteMarks {
  return {
    judgedTail: note.mode !== 'ln',
    hellCharge: note.mode === 'hcn',
    backSpin: note.backSpinScratch === true,
  };
}

export interface HellChargeRungOptions {
  /** Distance between rungs in pixels. Default 14. */
  spacing?: number;
  /** Play time, for the flow while {@link flowing}. */
  nowMs?: number;
  /** The note is held (charging): the rungs flow down toward the judgement line. Default false. */
  flowing?: boolean;
  /** Flow speed in pixels per second. Default 60. */
  speed?: number;
}

/**
 * The y of each rung across a hell charge note's body between `top` (the tail, upper) and `bottom` (the head, lower),
 * `spacing` apart and inset half a spacing from both ends, top to bottom. While {@link HellChargeRungOptions.flowing}
 * they move down by `speed` px/s and wrap, so a held note reads as charging; otherwise they stand still.
 */
export function hellChargeRungs(top: number, bottom: number, options: HellChargeRungOptions = {}): number[] {
  const spacing = options.spacing ?? 14;
  if (!(spacing > 0) || !(bottom - top > spacing)) return [];
  const speed = options.speed ?? 60;
  const shift = options.flowing === true ? ((((options.nowMs ?? 0) / 1000) * speed) % spacing) + spacing : spacing;
  const phase = shift % spacing;
  const rungs: number[] = [];
  for (let y = top + spacing / 2 + phase; y < bottom - spacing / 2; y += spacing) rungs.push(y);
  return rungs;
}

/**
 * A back-spin scratch's chevron: a hollow `^` pointing back up the lane, centred over the tail cap of a long note in
 * the lane run `x`..`x + w` whose tail cap's bottom edge is at `y` and which is `capHeight` tall. Returned as a closed
 * polygon `[x0, y0, x1, y1, …]` (six points) to fill.
 */
export function backSpinChevron(x: number, w: number, y: number, capHeight: number): number[] {
  const centre = x + w / 2;
  const half = Math.max(3, Math.min(w * 0.3, 12));
  const height = half * 0.8;
  const thickness = Math.max(2, half * 0.4);
  // The chevron sits inside the cap when the cap is tall enough, otherwise just above it.
  const base = capHeight >= height + 2 ? y - (capHeight - height) / 2 : y - capHeight - 1;
  const apex = base - height;
  return [
    centre - half,
    base,
    centre,
    apex,
    centre + half,
    base,
    centre + half - thickness,
    base,
    centre,
    apex + thickness * 1.2,
    centre - half + thickness,
    base,
  ];
}
