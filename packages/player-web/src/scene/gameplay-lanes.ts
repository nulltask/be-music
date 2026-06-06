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
const FALLBACK_DP_SIDE_GAP = 14;
const FALLBACK_SCRATCH_LANE_WEIGHT = 1.55;

export interface FallbackLaneLayoutRect {
  channel: string | undefined;
  x: number;
  w: number;
  isScratch: boolean;
  side: '1P' | '2P';
}

export interface ResolveFallbackLaneLayoutOptions {
  channels?: readonly string[];
  laneCount?: number;
  playVariant?: ChartPlayVariant;
  x: number;
  w: number;
  gap?: number;
  sideGap?: number;
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
  const sideFlags = channels.map((channel) => resolveFallbackLaneSide(channel, options.playVariant));
  const displayOrder = resolveFallbackLaneDisplayOrder(channels, scratchFlags, options.playVariant);
  const hasBothSides = sideFlags.includes('1P') && sideFlags.includes('2P');
  const sideGap = Math.max(0, options.sideGap ?? (hasBothSides ? FALLBACK_DP_SIDE_GAP : 0));
  const laneWeights = scratchFlags.map((isScratch) => (isScratch ? FALLBACK_SCRATCH_LANE_WEIGHT : 1));
  const referenceLaneCount = options.preserveSideWidth ? Math.max(1, Math.ceil(channels.length / 2)) : channels.length;
  const referenceWeights = laneWeights.slice(0, referenceLaneCount);
  const referenceWeight = referenceWeights.reduce((sum, weight) => sum + weight, 0);
  const totalInterLaneGap = resolveTotalInterLaneGap(displayOrder, sideFlags, gap, sideGap);
  const referenceInterLaneGap = options.preserveSideWidth
    ? gap * Math.max(0, referenceLaneCount - 1)
    : totalInterLaneGap;
  const availableWidth = Math.max(0, options.w - referenceInterLaneGap);
  const unit = referenceWeight > 0 ? availableWidth / referenceWeight : 0;
  const rects: FallbackLaneLayoutRect[] = Array.from({ length: channels.length });
  let x = options.x;
  let priorSide: '1P' | '2P' | undefined;

  for (const index of displayOrder) {
    const side = sideFlags[index]!;
    if (priorSide !== undefined) {
      x += priorSide === side ? gap : sideGap;
    }
    const w = unit * laneWeights[index]!;
    rects[index] = { channel: channels[index], x, w, isScratch: scratchFlags[index]!, side };
    x += w;
    priorSide = side;
  }
  return rects;
}

function resolveFallbackLaneSide(channel: string | undefined, playVariant?: ChartPlayVariant): '1P' | '2P' {
  return playVariant !== '9' && channel?.startsWith('2') === true ? '2P' : '1P';
}

function resolveTotalInterLaneGap(
  displayOrder: readonly number[],
  sideFlags: ReadonlyArray<'1P' | '2P'>,
  gap: number,
  sideGap: number,
): number {
  let total = 0;
  for (let i = 1; i < displayOrder.length; i += 1) {
    const previous = sideFlags[displayOrder[i - 1]!]!;
    const next = sideFlags[displayOrder[i]!]!;
    total += previous === next ? gap : sideGap;
  }
  return total;
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
