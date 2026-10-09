/** Lane geometry shared with the be-music skins lives in `@be-music/skin-sdk`; re-exported for the player's scenes. */
export {
  IIDX_DP_SIDE_GAP,
  IIDX_LANE_WIDTHS,
  isScratchLaneForVariant,
  resolveFallbackLaneLayout,
  resolveFallbackPlayfieldSpan,
  resolveSkinlessLaneLayout,
  shouldPreserveFallbackSideWidth,
  usesIidxLaneWidths,
  type FallbackLaneLayoutRect,
  type FixedLaneWidths,
  type ResolveFallbackLaneLayoutOptions,
  type SkinlessLaneLayout,
} from '@be-music/skin-sdk';
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
