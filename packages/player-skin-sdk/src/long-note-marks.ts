/**
 * Telling the long-note kinds apart by shape (#940): an LN, a charge note (CN), a hell charge note (HCN) and a
 * back-spin scratch (BSS) all share the lane's colour, so a skin marks the difference with shapes that read without
 * colour:
 *
 * - **LN**: only the head is judged, so the tail cap is drawn faint — where to let go, not a note to hit.
 * - **CN**: the release is judged too, so the tail keeps a full cap.
 * - **HCN**: the gauge drains while it is not held, so rungs cross the body ({@link hellChargeRungs}). How it stands
 *   ({@link resolveHellChargeLook}) pairs a colour with a glow strength and the rungs' motion, so none of it rests on
 *   colour alone: a HELL colour with still rungs before it is reached, a bright orange glow with rungs flowing into
 *   the judgement line while it fills the gauge, a dim red with rungs flowing back up while it drains (let go), and
 *   the glow again once pressed back.
 * - **BSS**: a charge note on a scratch lane, whose tail is judged on a spin the other way, so a chevron pointing back
 *   up the lane sits on the tail cap ({@link backSpinChevron}). A hell-charge BSS carries both marks.
 */
import type { BeMusicLaneKind, BeMusicLongNote, BeMusicLongNoteMode, BeMusicLongNoteState } from './types.ts';

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

/**
 * How a hell charge note stands: `'standby'` before it is reached, `'charging'` while it fills the gauge (held),
 * `'draining'` while it empties it (let go, or missed at the head: a press brings it back to `'charging'`), `'spent'`
 * once it is over (completed, or dropped for good).
 */
export type BeMusicHellChargePhase = 'standby' | 'charging' | 'draining' | 'spent';

/** What a hell charge note looks like this frame ({@link resolveHellChargeLook}). */
export interface BeMusicHellChargeLook {
  phase: BeMusicHellChargePhase;
  /**
   * The phase's colour as `0xRRGGBB`: violet (the HELL colour) on standby, orange while charging, red while draining.
   * A spent note keeps the HELL colour without glow.
   */
  color: number;
  /**
   * How strongly the note glows, 0..1: steady and low on standby, bright and pulsing while charging, dim and throbbing
   * while draining, none once spent. A skin scales its halo and its body's opacity by it.
   */
  glow: number;
  /**
   * The rungs' motion ({@link HellChargeRungOptions.flow}): `1` flowing down into the judgement line while charging,
   * `-1` flowing back up while draining, `0` still otherwise.
   */
  flow: -1 | 0 | 1;
}

/** The HELL colour: a hell charge note not yet reached, or over. */
const HELL_CHARGE_STANDBY_COLOR = 0xa65cff;
/** A hell charge note filling the gauge. */
const HELL_CHARGE_CHARGING_COLOR = 0xff9a1f;
/** A hell charge note emptying the gauge. */
const HELL_CHARGE_DRAINING_COLOR = 0xff2e3e;

/**
 * The look of a hell charge note in `state` at play time `nowMs` (see {@link BeMusicHellChargeLook}). Each phase
 * differs in colour, glow and rung motion together, so the phases read apart without colour.
 */
export function resolveHellChargeLook(state: BeMusicLongNoteState | undefined, nowMs = 0): BeMusicHellChargeLook {
  const seconds = nowMs / 1000;
  switch (state) {
    case 'held':
      // Bright, breathing twice a second.
      return {
        phase: 'charging',
        color: HELL_CHARGE_CHARGING_COLOR,
        glow: 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(seconds * Math.PI * 4)),
        flow: 1,
      };
    case 'draining':
      // Dim, throbbing three times a second like a warning.
      return {
        phase: 'draining',
        color: HELL_CHARGE_DRAINING_COLOR,
        glow: 0.15 + 0.15 * (0.5 + 0.5 * Math.sin(seconds * Math.PI * 6)),
        flow: -1,
      };
    case 'done':
    case 'dropped':
      return { phase: 'spent', color: HELL_CHARGE_STANDBY_COLOR, glow: 0, flow: 0 };
    default:
      return { phase: 'standby', color: HELL_CHARGE_STANDBY_COLOR, glow: 0.3, flow: 0 };
  }
}

export interface HellChargeRungOptions {
  /** Distance between rungs in pixels. Default 14. */
  spacing?: number;
  /** Play time, for the flow while {@link flowing} or {@link flow}. */
  nowMs?: number;
  /** The note is held (charging): the rungs flow down toward the judgement line. Default false. */
  flowing?: boolean;
  /**
   * Which way the rungs flow, over {@link flowing}: `1` down toward the judgement line, `-1` back up the lane, `0`
   * still. {@link BeMusicHellChargeLook.flow} gives it.
   */
  flow?: -1 | 0 | 1;
  /** Flow speed in pixels per second. Default 60. */
  speed?: number;
}

/**
 * The y of each rung across a hell charge note's body between `top` (the tail, upper) and `bottom` (the head, lower),
 * `spacing` apart and inset half a spacing from both ends, top to bottom. While they flow
 * ({@link HellChargeRungOptions.flow}, or {@link HellChargeRungOptions.flowing} for down) they move by `speed` px/s and
 * wrap, so a held note reads as charging and a draining one as leaking; otherwise they stand still.
 */
export function hellChargeRungs(top: number, bottom: number, options: HellChargeRungOptions = {}): number[] {
  const spacing = options.spacing ?? 14;
  if (!(spacing > 0) || !(bottom - top > spacing)) return [];
  const speed = options.speed ?? 60;
  const flow = options.flow ?? (options.flowing === true ? 1 : 0);
  const travel = flow * ((((options.nowMs ?? 0) / 1000) * speed) % spacing);
  const phase = ((travel % spacing) + spacing) % spacing;
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
