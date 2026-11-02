/**
 * Telling the long-note kinds apart by shape (#940): an LN, a charge note (CN), a hell charge note (HCN) and a
 * back-spin scratch (BSS) all share the lane's colour, so a skin marks the difference with shapes that read without
 * colour:
 *
 * - **LN**: only the head is judged, so the tail cap is drawn faint — where to let go, not a note to hit.
 * - **CN**: the release is judged too, so the tail keeps a full cap.
 * - **HCN**: the gauge drains while it is not held, so the centre line every long note carries zigzags
 *   ({@link hellChargeZigzag}) where the other kinds keep it straight. How it stands ({@link resolveHellChargeLook})
 *   pairs a colour with a glow strength and the zigzag's motion, so none of it rests on colour alone: a HELL colour
 *   with a still zigzag before it is reached, a bright orange glow with the zigzag flowing into the judgement line
 *   while it fills the gauge, a dim red with the zigzag flowing back up while it drains (let go), and the glow again
 *   once pressed back.
 * - **BSS**: a charge note on a scratch lane, whose tail is judged on a spin the other way, so a chevron pointing back
 *   up the lane sits on the tail cap ({@link backSpinChevron}). A hell-charge BSS carries both marks.
 */
import type { BeMusicLaneKind, BeMusicLongNote, BeMusicLongNoteMode, BeMusicLongNoteState } from './types.ts';

/** The marks a long note carries: see the module comment. */
export interface BeMusicLongNoteMarks {
  /** The tail is judged (CN / HCN / BSS): draw the full tail cap. An LN's tail is drawn faint. */
  judgedTail: boolean;
  /** Hell charge: the centre line zigzags. */
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
   * The zigzag centre line's colour as `0xRRGGBB` ({@link hellChargeZigzag}): white-hot while charging, a light tint of
   * {@link color} otherwise, so it stands out of the body.
   */
  lineColor: number;
  /**
   * How strongly the note glows, 0..1: steady and low on standby, bright and pulsing while charging, dim and throbbing
   * while draining, none once spent. A skin scales its halo and its body's opacity by it.
   */
  glow: number;
  /**
   * The zigzag's motion ({@link HellChargeZigzagOptions.flow}): `1` flowing down into the judgement line while
   * charging, `-1` flowing back up while draining, `0` still otherwise.
   */
  flow: -1 | 0 | 1;
}

/** The HELL colour: a hell charge note not yet reached, or over. */
const HELL_CHARGE_STANDBY_COLOR = 0xa65cff;
/** The HELL colour's light tint, for the zigzag centre line. */
const HELL_CHARGE_STANDBY_LINE_COLOR = 0xd9bcff;
/** A hell charge note filling the gauge. */
const HELL_CHARGE_CHARGING_COLOR = 0xff9a1f;
/** A hell charge note emptying the gauge. */
const HELL_CHARGE_DRAINING_COLOR = 0xff2e3e;

/**
 * The look of a hell charge note in `state` at play time `nowMs` (see {@link BeMusicHellChargeLook}). Each phase
 * differs in colour, glow and zigzag motion together, so the phases read apart without colour.
 */
export function resolveHellChargeLook(state: BeMusicLongNoteState | undefined, nowMs = 0): BeMusicHellChargeLook {
  const seconds = nowMs / 1000;
  switch (state) {
    case 'held':
      // Bright, breathing twice a second.
      return {
        phase: 'charging',
        color: HELL_CHARGE_CHARGING_COLOR,
        lineColor: 0xfff4dc,
        glow: 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(seconds * Math.PI * 4)),
        flow: 1,
      };
    case 'draining':
      // Dim, throbbing three times a second like a warning.
      return {
        phase: 'draining',
        color: HELL_CHARGE_DRAINING_COLOR,
        lineColor: 0xff9aa2,
        glow: 0.15 + 0.15 * (0.5 + 0.5 * Math.sin(seconds * Math.PI * 6)),
        flow: -1,
      };
    case 'done':
    case 'dropped':
      return {
        phase: 'spent',
        color: HELL_CHARGE_STANDBY_COLOR,
        lineColor: HELL_CHARGE_STANDBY_LINE_COLOR,
        glow: 0,
        flow: 0,
      };
    default:
      return {
        phase: 'standby',
        color: HELL_CHARGE_STANDBY_COLOR,
        lineColor: HELL_CHARGE_STANDBY_LINE_COLOR,
        glow: 0.3,
        flow: 0,
      };
  }
}

export interface HellChargeZigzagOptions {
  /** How far the zigzag swings to each side of the centre, in pixels. Default: about a fifth of the lane, 2..6 px. */
  amplitude?: number;
  /** Length of one full swing (left, right, left) along the lane, in pixels. Default 14. */
  wavelength?: number;
  /** Play time, for the flow. */
  nowMs?: number;
  /**
   * Which way the zigzag flows: `1` down toward the judgement line, `-1` back up the lane, `0` still (the default).
   * {@link BeMusicHellChargeLook.flow} gives it.
   */
  flow?: -1 | 0 | 1;
  /** Flow speed in pixels per second. Default 60. */
  speed?: number;
}

/**
 * A hell charge note's centre line: a zigzag down the middle of the lane run `x`..`x + w`, from `top` (the tail, upper)
 * to `bottom` (the head, lower), as a polyline `[x0, y0, x1, y1, …]` to stroke, top to bottom. It starts at `top` and ends at `bottom`, with a corner
 * every half {@link HellChargeZigzagOptions.wavelength} between. While it flows it moves by `speed` px/s and wraps, so
 * a held note reads as charging and a draining one as leaking; otherwise it stands still. Empty when the span is
 * empty.
 */
export function hellChargeZigzag(
  x: number,
  w: number,
  top: number,
  bottom: number,
  options: HellChargeZigzagOptions = {},
): number[] {
  const wavelength = options.wavelength ?? 14;
  const amplitude = options.amplitude ?? Math.max(2, Math.min(6, w * 0.18));
  const centre = x + w / 2;
  if (!(wavelength > 0) || !(bottom > top)) return [];
  const half = wavelength / 2;
  const travel = (options.flow ?? 0) * ((((options.nowMs ?? 0) / 1000) * (options.speed ?? 60)) % wavelength);
  const phase = ((travel % wavelength) + wavelength) % wavelength;
  // A triangle wave: at the left edge where (y - top - phase) is a whole number of wavelengths, at the right half a
  // wavelength later.
  const at = (y: number): number => {
    const u = (((y - top - phase) % wavelength) + wavelength) % wavelength;
    return u < half
      ? centre - amplitude + (4 * amplitude * u) / wavelength
      : centre + amplitude - (4 * amplitude * (u - half)) / wavelength;
  };
  const points = [at(top), top];
  for (let corner = top + phase - wavelength; corner < bottom; corner += half) {
    if (corner > top) points.push(at(corner), corner);
  }
  points.push(at(bottom), bottom);
  return points;
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
