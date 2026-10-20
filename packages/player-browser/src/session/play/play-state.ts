/**
 * The play's one `PlayState` (`@be-music/player-scene-model`): every change to it — the engine's frames, judgments and empty
 * POORs, the final summary, the player's and the host's hi-speed, the lane covers a replay shows — goes through
 * {@link applyPlayEvent}, which reduces it with `reducePlayState` and glides the note scroll to a new drawn hi-speed.
 */

import { reducePlayState, type HiSpeedTransition, type PlayEvent, type PlayState } from '@be-music/player-scene-model';

/** The play's state and the scroll that follows its hi-speed: the play session's members of these names. */
export interface PlayStateContext {
  playState: PlayState;
  readonly scrollHiSpeed: HiSpeedTransition;
}

/**
 * Applies `event` to the play's state. A new drawn hi-speed glides the note scroll to it from `nowMs` (the wall clock,
 * as the scroll reads it). Returns the state before the event, so a caller can tell what changed.
 */
export function applyPlayEvent(ctx: PlayStateContext, event: PlayEvent, nowMs: number = performance.now()): PlayState {
  const previous = ctx.playState;
  const next = reducePlayState(previous, event);
  if (next === previous) return previous;
  ctx.playState = next;
  const drawn = next.view.hiSpeed.drawn;
  if (drawn !== previous.view.hiSpeed.drawn) ctx.scrollHiSpeed.retarget(drawn, nowMs);
  return previous;
}
