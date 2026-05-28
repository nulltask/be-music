import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { resolveSideKeySlot as resolveCoreSideKeySlot } from '@be-music/player/core/lane-layout';

export {
  isPlayableInputChannel,
  isScratch,
  resolveKeyChannel,
  resolveLaneChannels,
  resolveLr2LaneIndex,
  resolveSideKeySlot,
  resolveSideRelativeLaneIndex,
} from '@be-music/player/core/lane-layout';

const FALLBACK_LANE_GAP = 2;
const FALLBACK_SCRATCH_LANE_WEIGHT = 1.55;

export interface FallbackLaneLayoutRect {
  channel: string | undefined;
  x: number;
  w: number;
  isScratch: boolean;
}

export interface ResolveFallbackLaneLayoutOptions {
  channels?: readonly string[];
  laneCount?: number;
  playVariant?: ChartPlayVariant;
  x: number;
  w: number;
  gap?: number;
  /**
   * Keep one side at the requested width and let additional DP-side lanes extend the fallback playfield horizontally.
   */
  preserveSideWidth?: boolean;
}

export function isScratchLaneForVariant(channel: string, playVariant?: ChartPlayVariant): boolean {
  return resolveCoreSideKeySlot(channel, playVariant) === 0;
}

export function shouldPreserveFallbackSideWidth(
  channels: readonly string[] | undefined,
  playVariant?: ChartPlayVariant,
): boolean {
  if (playVariant === '10' || playVariant === '14') {
    return true;
  }
  return playVariant !== '9' && channels?.some((channel) => channel.startsWith('2')) === true;
}

export function resolveFallbackLaneLayout(options: ResolveFallbackLaneLayoutOptions): FallbackLaneLayoutRect[] {
  const fallbackLaneCount = Math.max(1, Math.trunc(options.laneCount ?? 8));
  const channels =
    options.channels && options.channels.length > 0
      ? [...options.channels]
      : (Array.from({ length: fallbackLaneCount }) as Array<string | undefined>);
  const gap = Math.max(0, options.gap ?? FALLBACK_LANE_GAP);
  const scratchFlags = channels.map((channel) =>
    channel === undefined ? false : isScratchLaneForVariant(channel, options.playVariant),
  );
  const laneWeights = scratchFlags.map((isScratch) => (isScratch ? FALLBACK_SCRATCH_LANE_WEIGHT : 1));
  const referenceLaneCount = options.preserveSideWidth ? Math.max(1, Math.ceil(channels.length / 2)) : channels.length;
  const referenceWeights = laneWeights.slice(0, referenceLaneCount);
  const referenceWeight = referenceWeights.reduce((sum, weight) => sum + weight, 0);
  const availableWidth = Math.max(0, options.w - gap * Math.max(0, referenceLaneCount - 1));
  const unit = referenceWeight > 0 ? availableWidth / referenceWeight : 0;
  const rects: FallbackLaneLayoutRect[] = Array.from({ length: channels.length });
  const displayOrder = resolveFallbackLaneDisplayOrder(channels, scratchFlags, options.playVariant);
  let x = options.x;

  for (const index of displayOrder) {
    const w = unit * laneWeights[index]!;
    rects[index] = { channel: channels[index], x, w, isScratch: scratchFlags[index]! };
    x += w + gap;
  }
  return rects;
}

function resolveFallbackLaneDisplayOrder(
  channels: ReadonlyArray<string | undefined>,
  scratchFlags: ReadonlyArray<boolean>,
  playVariant?: ChartPlayVariant,
): number[] {
  if (playVariant === '9') {
    return channels.map((_, index) => index);
  }
  return channels
    .map((channel, index) => ({
      index,
      side: channel?.startsWith('2') === true ? 1 : 0,
      scratchOrder: scratchFlags[index] ? (channel?.startsWith('2') === true ? 1 : -1) : 0,
      slot: channel === undefined ? index : resolveCoreSideKeySlot(channel, playVariant),
    }))
    .sort((a, b) => {
      if (a.side !== b.side) return a.side - b.side;
      if (a.scratchOrder !== b.scratchOrder) return a.scratchOrder - b.scratchOrder;
      if (a.slot !== b.slot) return a.slot - b.slot;
      return a.index - b.index;
    })
    .map((entry) => entry.index);
}
