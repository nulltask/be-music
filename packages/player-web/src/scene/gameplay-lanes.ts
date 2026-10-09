import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { resolveSideKeySlot as resolveCoreSideKeySlot } from '@be-music/player/core/lane-layout';

export {
  isPlayableInputChannel,
  isScratch,
  resolveKeyChannel,
  resolveLaneChannels,
  resolveLr2LaneIndex,
  resolvePlayVariantLaneChannels,
  resolveSideKeySlot,
  resolveSideRelativeLaneIndex,
} from '@be-music/player/core/lane-layout';

/** Lanes sit edge to edge, and in double play the 2P bank butts straight onto the 1P bank. */
const FALLBACK_LANE_GAP = 0;
const FALLBACK_DP_SIDE_GAP = 0;
const FALLBACK_SCRATCH_LANE_WEIGHT = 1.55;

/**
 * Fixed lane widths for the IIDX families (5 / 7 / 10 / 14 KEY), in design px. The proportions follow the arcade
 * cabinet — the scratch lane about 1.7x a white key, black keys about 0.8x — scaled so a 7K side is exactly the 194 px
 * span. Every mode uses the same widths, so a 5K or DP chart never stretches its lanes sideways; the playfield just
 * gets narrower or wider.
 */
export const IIDX_LANE_WIDTHS = { scratch: 41, white: 24, black: 19 } as const;

/**
 * Gap between the 1P and 2P banks in IIDX double play (10 / 14 KEY), in design px. The arcade cabinet splits the two
 * sides by about 0.31 of a side's width (the turntable housings sit between them); on the 194 px 7K side that is 60 px.
 * Keyboard double play (48 KEY) keeps its banks together.
 */
export const IIDX_DP_SIDE_GAP = 60;

export interface FixedLaneWidths {
  scratch: number;
  /** Odd-numbered keys (1 / 3 / 5 / 7). */
  white: number;
  /** Even-numbered keys (2 / 4 / 6). */
  black: number;
}

/** Left edge and per-side width of the skinless playfield, mirroring LR2's default 7K skin. */
const FALLBACK_PLAYFIELD_SPAN = { x: 33, w: 194 } as const;
/**
 * Keyboard modes run 24 lanes per side, which the 7K span squeezes to 8 px each. Like the keyboard cabinet, they take
 * the screen width instead: 24 KEY fills the column left of the BGA monitor (its frame still clears the rails), and
 * 48 KEY spreads both banks across the whole page.
 */
const KEYBOARD_PLAYFIELD_SPANS: Record<'24' | '48', { x: number; w: number }> = {
  '24': { x: 12, w: 252 },
  '48': { x: 12, w: 308 },
};

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
  /**
   * Give every lane a fixed width by kind (scratch / white key / black key) instead of sharing `w` out. `w` and
   * `preserveSideWidth` are then ignored: the playfield is as wide as its lanes.
   */
  fixedWidths?: FixedLaneWidths;
}

/**
 * Left edge and per-side width the skinless playfield uses for a chart's play variant (see
 * {@link resolveSkinlessLaneLayout}).
 */
export function resolveFallbackPlayfieldSpan(playVariant?: ChartPlayVariant): { x: number; w: number } {
  return playVariant === '24' || playVariant === '48' ? KEYBOARD_PLAYFIELD_SPANS[playVariant] : FALLBACK_PLAYFIELD_SPAN;
}

export interface SkinlessLaneLayout {
  lanes: FallbackLaneLayoutRect[];
  /** Left edge of the leftmost lane. */
  left: number;
  /** Right edge of the rightmost lane (never left of one side's span). */
  right: number;
}

/**
 * Lane rects for the skinless / built-in playfield: the variant's span, with double play extending one side's width to
 * the right. Every built-in skin and the core lane renderer share this, so chrome and notes line up.
 */
export function resolveSkinlessLaneLayout(
  channels: readonly string[] | undefined,
  laneCount: number | undefined,
  playVariant?: ChartPlayVariant,
): SkinlessLaneLayout {
  const span = resolveFallbackPlayfieldSpan(playVariant);
  const fixedWidths = usesIidxLaneWidths(playVariant) ? IIDX_LANE_WIDTHS : undefined;
  const lanes = resolveFallbackLaneLayout({
    channels,
    laneCount,
    playVariant,
    x: span.x,
    w: span.w,
    preserveSideWidth: shouldPreserveFallbackSideWidth(channels, playVariant),
    fixedWidths,
    sideGap: fixedWidths ? IIDX_DP_SIDE_GAP : undefined,
  });
  const lanesRight = Math.max(span.x, ...lanes.map((lane) => lane.x + lane.w));
  // Fixed-width lanes define the playfield; shared-out lanes keep at least one side's span.
  const right = fixedWidths ? lanesRight : Math.max(span.x + span.w, lanesRight);
  return { lanes, left: span.x, right };
}

/** Whether `playVariant` is an IIDX family (5 / 7 / 10 / 14 KEY), whose lanes use {@link IIDX_LANE_WIDTHS}. */
export function usesIidxLaneWidths(playVariant?: ChartPlayVariant): boolean {
  return playVariant === '5' || playVariant === '7' || playVariant === '10' || playVariant === '14';
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

  const fixedWidths = options.fixedWidths;
  for (const index of displayOrder) {
    const side = sideFlags[index]!;
    if (priorSide !== undefined) {
      x += priorSide === side ? gap : sideGap;
    }
    const w = fixedWidths
      ? resolveFixedLaneWidth(fixedWidths, channels[index], scratchFlags[index]!, options.playVariant)
      : unit * laneWeights[index]!;
    rects[index] = { channel: channels[index], x, w, isScratch: scratchFlags[index]!, side };
    x += w;
    priorSide = side;
  }
  return rects;
}

function resolveFixedLaneWidth(
  widths: FixedLaneWidths,
  channel: string | undefined,
  isScratch: boolean,
  playVariant: ChartPlayVariant | undefined,
): number {
  if (isScratch) return widths.scratch;
  const slot = channel === undefined ? -1 : resolveCoreSideKeySlot(channel, playVariant);
  return slot > 0 && slot % 2 === 0 ? widths.black : widths.white;
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
