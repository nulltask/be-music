import type { PlaySide } from '@be-music/scene-model';

/**
 * Returns whether a BMS channel string belongs to the given play-side. Used by per-side gameplay overlays (LANE COVER /
 * HIDDEN / SUDDEN masks) so each side can render an independent shutter without leaking onto the other side's lanes on
 * a DP chart.
 *
 * Channel layout (LR2 convention): - 1P keyboard: `11..15` + `18` + `19`; scratch: `16` - 2P keyboard: `21..25` + `28`
 * + `29`; scratch: `26`
 *
 * Anything else (BGM, BGA, BPM, etc.) returns `false` for BOTH sides — those don't appear in `laneX` anyway.
 */
export function isChannelOnSide(channel: string, side: PlaySide): boolean {
  if (channel.length !== 2) return false;
  const head = channel[0];
  if (side === '1P') return head === '1';
  return head === '2';
}

/** The play sides with a lane among `channels`, 1P first: the sides a play keeps lane covers for. */
export function resolveLaneSides(channels: readonly string[]): PlaySide[] {
  return (['1P', '2P'] as const).filter((side) => channels.some((channel) => isChannelOnSide(channel, side)));
}
