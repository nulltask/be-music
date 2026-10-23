/**
 * Seeking an AUTO play or replay: a command to the running engine (`{ kind: 'seek' }`, ADR 0016), which moves the play to the
 * chart second sought without starting it again. The engine answers with a `seek` UI command — what it rebuilt there,
 * which the session takes its state from (`applyEngineSeek` in `play-engine.ts`) — and frames of the next seek
 * generation, which the chart's clock runs on from. Manual seeking requires the host's practice opt-in.
 */

import type { PlayerInputSignalBus } from '@be-music/player-engine/signals';
import type { PlaySessionOptions } from './play-options.ts';

/** The play's members a seek reads and writes: the play session's members of these names. */
export interface PlaySeekContext {
  readonly options: Readonly<Pick<PlaySessionOptions, 'autoPlay' | 'replay' | 'allowSeek'>>;
  readonly disposed: boolean;
  readonly exiting: boolean;
  readonly sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  readonly seekWaiters: Array<{ seconds: number; resolve: () => void }>;
}

/** Whether `play` can seek now: an AUTO play, replay or opted-in practice play whose engine is prepared and is not leaving. Intro seeks choose its starting position. */
export function canSeekPlay(play: PlaySeekContext): boolean {
  return (
    (play.options.autoPlay === true || play.options.replay !== undefined || play.options.allowSeek === 'practice') &&
    !play.disposed &&
    !play.exiting &&
    play.sharedEngineInputSignals !== undefined
  );
}

/**
 * Asks the engine to move `play` to chart second `seconds`; it clamps the second to the chart and applies the last seek
 * asked for by its next tick. A paused play stays paused there. Resolves once the engine has applied this seek or a
 * later one (`resolveSeekWaiters`), or at once when the play cannot seek.
 */
export function seekPlay(play: PlaySeekContext, seconds: number): Promise<void> {
  const input = play.sharedEngineInputSignals;
  if (!canSeekPlay(play) || input === undefined || !Number.isFinite(seconds)) return Promise.resolve();
  return new Promise((resolve) => {
    play.seekWaiters.push({ seconds, resolve });
    input.pushCommand({ kind: 'seek', seconds });
  });
}

/**
 * The engine applied a seek to chart second `seconds`: it settles the waiters up to the last one that asked for that
 * second (the earlier ones were coalesced into it), or — when none asked for it, as the engine clamped the second — every
 * waiter.
 */
export function resolveSeekWaiters(play: Pick<PlaySeekContext, 'seekWaiters'>, seconds: number): void {
  const waiters = play.seekWaiters;
  let last = -1;
  for (let index = 0; index < waiters.length; index += 1) {
    if (Math.abs(waiters[index]!.seconds - seconds) < 1e-9) last = index;
  }
  for (const waiter of waiters.splice(0, last >= 0 ? last + 1 : waiters.length)) waiter.resolve();
}

/** The engine is gone (the play ended or was disposed): every seek still waiting settles. */
export function settleSeekWaiters(play: Pick<PlaySeekContext, 'seekWaiters'>): void {
  for (const waiter of play.seekWaiters.splice(0)) waiter.resolve();
}
