import { SHUTTER_DEFAULT } from '../play-options/choices.ts';
import type { HiddenSuddenMode, PlayOptions } from '../play-options/options.ts';
import type { LaneCover, PlaySide } from './types.ts';

/**
 * One play side's lane covers as the player set them: the SUDDEN+ cover over the top of the lanes, the HIDDEN+ cover
 * above the judgement line and the LIFT that raises the line, each with its height kept while it is switched off, so
 * switching it back on needs no redial. Heights are fractions (0..1) of the lane: SUDDEN+ and LIFT of the whole lane,
 * HIDDEN+ of the part above the LIFT (beatoraja's `LaneRenderer` cover).
 */
export interface LaneCoverState {
  readonly side: PlaySide;
  readonly sudden: number;
  readonly suddenOn: boolean;
  readonly hidden: number;
  readonly hiddenOn: boolean;
  readonly lift: number;
}

function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/**
 * Each side's covers as the select screen's play options set them (LR2's HIDDEN / SUDDEN buttons): the side's mode
 * picks which ends are covered, the one lane cover height (`shutter`, a quarter by default) covers both, and the LANE
 * COVER switch shows them or not. No LIFT: LR2 has none.
 */
export function laneCoversFromPlayOptions(
  options: Pick<PlayOptions, 'hiddenSudden1P' | 'hiddenSudden2P' | 'shutter' | 'laneCover'>,
  sides: readonly PlaySide[],
): LaneCoverState[] {
  const height = clampFraction(options.shutter ?? SHUTTER_DEFAULT);
  return sides.map((side): LaneCoverState => {
    const mode: HiddenSuddenMode = (side === '1P' ? options.hiddenSudden1P : options.hiddenSudden2P) ?? 'OFF';
    const shown = options.laneCover !== false;
    return {
      side,
      sudden: height,
      suddenOn: shown && (mode === 'SUDDEN' || mode === 'HID+SUD'),
      hidden: height,
      hiddenOn: shown && (mode === 'HIDDEN' || mode === 'HID+SUD'),
      lift: 0,
    };
  });
}

/**
 * One side's covers as drawn, as fractions of the whole lane: SUDDEN+ while it is on, HIDDEN+ while it is on scaled
 * to the part of the lane above the LIFT, and the LIFT.
 */
export function resolveLaneCover(cover: LaneCoverState): LaneCover {
  const lift = clampFraction(cover.lift);
  return {
    side: cover.side,
    sudden: cover.suddenOn ? clampFraction(cover.sudden) : 0,
    hidden: cover.hiddenOn ? clampFraction(cover.hidden) * (1 - lift) : 0,
    lift,
  };
}

/** The part of a lane cover a command changes. */
export type LaneCoverPart = 'sudden' | 'hidden' | 'lift';

/** A change of the lane covers during a play; `side` limits it to one side, else it changes every side. */
export type LaneCoverCommand =
  /**
   * Raise or lower a cover by `delta` of the lane (the lane cover keys, the mouse wheel, a skin's cover button). A
   * cover switched off comes on when raised, keeping its height; one lowered to nothing goes off.
   */
  | { type: 'cover-adjust'; part: LaneCoverPart; delta: number; side?: PlaySide }
  /**
   * Switch SUDDEN+ or HIDDEN+ on or off, keeping its height; one switched on without a height comes on at a quarter of
   * the lane.
   */
  | { type: 'cover-toggle'; part: 'sudden' | 'hidden'; side?: PlaySide }
  /** Set the covers outright: what a replay recorded, or a host's setting. */
  | { type: 'cover-set'; covers: readonly Partial<LaneCoverState>[]; side?: PlaySide };

function onKey(part: 'sudden' | 'hidden'): 'suddenOn' | 'hiddenOn' {
  return part === 'sudden' ? 'suddenOn' : 'hiddenOn';
}

/**
 * A cover height after a step, on the 1/10000 grid of the play log (so repeated 0.05 or 0.005 steps land on round
 * values instead of drifting through float rounding), clamped to the lane.
 */
function stepHeight(height: number, delta: number): number {
  return clampFraction(Math.round((height + delta) * 10_000) / 10_000);
}

function adjust(cover: LaneCoverState, part: LaneCoverPart, delta: number): LaneCoverState {
  const height = stepHeight(cover[part], delta);
  if (part === 'lift') return height === cover.lift ? cover : { ...cover, lift: height };
  const on = onKey(part);
  const next = height <= 0 ? false : delta > 0 ? true : cover[on];
  if (height === cover[part] && next === cover[on]) return cover;
  return { ...cover, [part]: height, [on]: next };
}

function toggle(cover: LaneCoverState, part: 'sudden' | 'hidden'): LaneCoverState {
  const on = onKey(part);
  if (cover[on]) return { ...cover, [on]: false };
  return { ...cover, [on]: true, [part]: cover[part] > 0 ? cover[part] : SHUTTER_DEFAULT };
}

/**
 * Applies a lane cover change to every side it names. Returns the same array when nothing changes. A course that locks
 * the hi-speed locks the covers too: the caller passes `locked` and every change is ignored.
 */
export function reduceLaneCovers(
  covers: readonly LaneCoverState[],
  command: LaneCoverCommand,
  locked = false,
): readonly LaneCoverState[] {
  if (locked || (command.type === 'cover-adjust' && !Number.isFinite(command.delta))) return covers;
  let changed = false;
  const next = covers.map((cover, index) => {
    if (command.side !== undefined && cover.side !== command.side) return cover;
    let updated: LaneCoverState;
    switch (command.type) {
      case 'cover-adjust':
        updated = adjust(cover, command.part, command.delta);
        break;
      case 'cover-toggle':
        updated = toggle(cover, command.part);
        break;
      case 'cover-set': {
        // An entry that names a side sets that side; one that names none sets the side at its index.
        const set =
          command.covers.find((entry) => entry.side === cover.side) ??
          (command.covers[index]?.side === undefined ? command.covers[index] : undefined);
        updated = set === undefined ? cover : { ...cover, ...set, side: cover.side };
        break;
      }
    }
    if (updated !== cover) changed = true;
    return updated;
  });
  return changed ? next : covers;
}
