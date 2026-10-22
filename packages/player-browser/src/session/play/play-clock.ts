/**
 * The play's chart clock, run on from the engine's frames: every frame carries the chart second it shows and the clock
 * that second holds at (`PlayerUIFramePayload.clock`: the audio clock's reading then, the tempo, whether the play is
 * paused), so the view needs no anchor of its own — a seek, a tempo change or a pause shows in the next frame.
 */

import type { PlayerUIFrameClock } from '@be-music/player-engine/signals';

/**
 * The chart second the play is at when the audio clock reads `outputSeconds`, run on from `frame`: the frame's second,
 * plus the audio time since at the frame's tempo, unless the play is paused. `undefined` for a frame without a clock.
 */
export function chartSecondsFromFrame(
  frame: { readonly currentSeconds: number; readonly clock?: PlayerUIFrameClock },
  outputSeconds: number,
): number | undefined {
  const clock = frame.clock;
  if (clock === undefined) return undefined;
  if (clock.paused) return frame.currentSeconds;
  return frame.currentSeconds + (outputSeconds - clock.outputSeconds) * clock.tempo;
}
