/**
 * Where a ghost's playfield goes beside a single-play chart: on the 2P side, as the second field of the matching
 * double-play variant (5 KEY → 10 KEY, 7 KEY → 14 KEY), so the built-in skins lay the two fields out as they lay out a
 * double-play chart's two sides. The ghost's lanes are the live lanes moved to the 2P channels (`11`..`19` → `21`..`29`).
 * A chart with no 2P side to borrow (a double-play chart, 9 KEY, the keyboard modes) has no room for one.
 */

import type { ChartPlayVariant } from '@be-music/chart-model';
import { resolvePlayVariantLaneChannels } from '@be-music/player-engine/lanes';

/** A ghost field's side: the double-play layout the two fields take, and how a live lane maps onto the ghost's. */
export interface GhostSide {
  /** The double-play variant the two fields are laid out as. */
  readonly playVariant: Extract<ChartPlayVariant, '10' | '14'>;
  /** The live lanes and the ghost's, in the double-play variant's lane order. */
  readonly laneChannels: readonly string[];
  /** The ghost's lanes. */
  readonly ghostChannels: ReadonlySet<string>;
}

const DOUBLE_PLAY_VARIANTS: Partial<Record<ChartPlayVariant, GhostSide['playVariant']>> = { '5': '10', '7': '14' };

/** The ghost's lane for a live 1P lane (`11`..`19` → `21`..`29`); other channels stay as they are. */
export function toGhostChannel(channel: string): string {
  return channel.length === 2 && channel.startsWith('1') ? `2${channel[1]}` : channel;
}

/**
 * The side a ghost field takes beside a play of `playVariant` on `laneChannels`, or `undefined` when there is no room:
 * the play is not a single-play 5 / 7 KEY one, or it already uses a 2P lane.
 */
export function resolveGhostSide(
  laneChannels: readonly string[],
  playVariant: ChartPlayVariant,
): GhostSide | undefined {
  const doubleVariant = DOUBLE_PLAY_VARIANTS[playVariant];
  if (doubleVariant === undefined || laneChannels.length === 0) return undefined;
  if (laneChannels.some((channel) => !channel.startsWith('1'))) return undefined;
  const ghostChannels = new Set(laneChannels.map(toGhostChannel));
  return {
    playVariant: doubleVariant,
    laneChannels: resolvePlayVariantLaneChannels(
      [...laneChannels, ...ghostChannels].map((channel) => ({ channel })),
      doubleVariant,
    ),
    ghostChannels,
  };
}
