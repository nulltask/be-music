/**
 * The key beams of the shared playfield's own lanes (a skin that does not own its lanes, as the built-in skins): how
 * bright each lane's beam is, read off the play's key beams by channel (`PlayfieldRuntime.keyBeamStartedAt` and
 * `keyBeamFadeStartedAt`). Every lane has one, the 24 / 48 KEY keys past the seventh and their wheel included; only
 * the LR2 view maps the beams onto LR2's key-on timers, which stop at the seventh key.
 */

/** The play's key beams, by channel (`PlayfieldRuntime`'s members of these names). */
export interface KeyBeamState {
  readonly pressedChannels: ReadonlySet<string>;
  readonly keyBeamStartedAt: Map<string, number>;
  readonly keyBeamFadeStartedAt: Map<string, number>;
}

/**
 * How bright `channel`'s key beam is at `nowMs` (the play clock), 0 to 1: fully on while its key is down or before
 * its fade starts, then tapering to 0 over `fadeMs` from when the key went up. A beam whose fade has played out is
 * retired here (both entries deleted), rather than waiting for the play's deferred cleanup, which a throttled
 * `setTimeout` may never run.
 */
export function resolveKeyBeamAlpha(play: KeyBeamState, channel: string, fadeMs: number, nowMs: number): number {
  if (play.pressedChannels.has(channel)) return 1;
  if (!play.keyBeamStartedAt.has(channel)) return 0;
  const fadeStart = play.keyBeamFadeStartedAt.get(channel);
  if (fadeStart === undefined) return 1;
  const elapsed = Math.max(0, nowMs - fadeStart);
  if (elapsed >= fadeMs) {
    play.keyBeamFadeStartedAt.delete(channel);
    play.keyBeamStartedAt.delete(channel);
    return 0;
  }
  return Math.max(0, 1 - elapsed / fadeMs);
}
