import type { BeMusicLaneFrame, BeMusicLongNote } from '@be-music/player-skin-sdk';

/**
 * Fills each held lane's `holdTop`: the top of the long note held in it this frame (the note in the `'held'` state over
 * the lane, the one nearest the judgement line if two are), no higher than the lane's own top. A held lane with no such
 * note this frame keeps `holdTop` unset. Pure apart from writing the lanes it is given.
 */
export function resolveHoldTops(lanes: readonly BeMusicLaneFrame[], longNotes: readonly BeMusicLongNote[]): void {
  for (const lane of lanes) {
    if (lane.holding !== true) continue;
    let held: BeMusicLongNote | undefined;
    for (const note of longNotes) {
      if (note.state !== 'held') continue;
      const centre = note.x + note.w / 2;
      if (centre < lane.x || centre > lane.x + lane.w) continue;
      if (held === undefined || note.bottom > held.bottom) held = note;
    }
    if (held !== undefined) lane.holdTop = Math.max(lane.top, held.top);
  }
}
