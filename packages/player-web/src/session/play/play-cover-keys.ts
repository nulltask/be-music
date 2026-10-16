/**
 * The lane cover keys of a play that takes them (`PlaySessionOptions.coverKeys`, the beatoraja play screen's): PageUp /
 * PageDown move SUDDEN+, Home / End the LIFT, H switches HIDDEN+ and J / K move it. A step is 1 % of the lane, 5 % with
 * Shift. They change the play state's covers like any cover command, so a course that locks the hi-speed locks them
 * too.
 */

import type { LaneCoverCommand } from '@be-music/scene-model';
import type { PlayViewSetting } from '../../view/types.ts';

/** What a cover key does: the cover command, and the view setting it changes (for the view's feedback). */
export interface PlayCoverKey {
  readonly command: LaneCoverCommand;
  readonly setting: PlayViewSetting;
}

/** A cover key's step: 1 % of the lane, 5 % with Shift. */
function coverStep(shiftKey: boolean): number {
  return shiftKey ? 0.05 : 0.01;
}

/**
 * What a key does to the lane covers, or `undefined` for a key that is not a cover key: PageUp raises SUDDEN+ (less of
 * the lane covered) and PageDown lowers it; End raises the LIFT and Home lowers it; H switches HIDDEN+ on (at a quarter
 * of the lane without a height) or off; K raises HIDDEN+ and J lowers it.
 */
export function resolvePlayCoverKey(event: {
  readonly key: string;
  readonly shiftKey: boolean;
}): PlayCoverKey | undefined {
  const step = coverStep(event.shiftKey);
  switch (event.key) {
    case 'PageUp':
      return { command: { type: 'cover-adjust', part: 'sudden', delta: -step }, setting: 'sudden' };
    case 'PageDown':
      return { command: { type: 'cover-adjust', part: 'sudden', delta: step }, setting: 'sudden' };
    case 'Home':
      return { command: { type: 'cover-adjust', part: 'lift', delta: -step }, setting: 'lift' };
    case 'End':
      return { command: { type: 'cover-adjust', part: 'lift', delta: step }, setting: 'lift' };
    case 'h':
    case 'H':
      return { command: { type: 'cover-toggle', part: 'hidden' }, setting: 'hidden-toggle' };
    case 'j':
    case 'J':
      return { command: { type: 'cover-adjust', part: 'hidden', delta: -step }, setting: 'hidden' };
    case 'k':
    case 'K':
      return { command: { type: 'cover-adjust', part: 'hidden', delta: step }, setting: 'hidden' };
    default:
      return undefined;
  }
}
