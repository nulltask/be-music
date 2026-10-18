/**
 * The key beams of the shared playfield's own lanes (a skin that does not own its lanes, as the built-in skins): how
 * bright each lane's beam is, read off the play's key beams by channel (`PlayfieldRuntime.keyBeamStartedAt` and
 * `keyBeamFadeStartedAt`).
 */

import type { ChartPlayVariant } from '@be-music/chart';
import { resolveSideRelativeLaneIndex } from '@be-music/player/lanes';

/** The play's key beams, by channel (`PlayfieldRuntime`'s members of these names). */
export interface KeyBeamState {
  readonly pressedChannels: ReadonlySet<string>;
  readonly keyBeamStartedAt: Map<string, number>;
  readonly keyBeamFadeStartedAt: Map<string, number>;
}

/**
 * Whether the playfield lights `channel`'s key beam: the scratch and the first 7 keys of a side, every key on 9 KEY.
 * These are the lanes the beams covered while the play kept them by LR2's key-on ids (100 + lane on 1P, 110 + lane
 * on 2P), so a keyboard mode's keys past the seventh and its wheel still light none.
 */
export function hasKeyBeam(channel: string, playVariant: ChartPlayVariant): boolean {
  return resolveSideRelativeLaneIndex(channel, playVariant) <= (playVariant === '9' ? 9 : 7);
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
