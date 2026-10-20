/**
 * `@be-music/player-engine/lanes`: the lanes of a play mode — which channels a chart plays on and how they lay out (slots,
 * the LR2 lane order, scratch and wheel lanes), the keyboard bindings with FREE ZONE input, and the lanes the lane
 * options permute. `ChartPlayVariant` comes from `@be-music/chart-model`.
 */
export {
  appendFreeZoneInputChannels,
  createInputTokenToChannelsMap,
  createLaneBindings,
  isPlayableInputChannel,
  isScratch,
  resolveKeyChannel,
  resolveLaneChannels,
  resolveLaneDisplayMode,
  resolveLaneOptionChannels,
  resolveLR2LaneIndex,
  resolvePlayVariantLaneChannels,
  resolveSideKeySlot,
  resolveSideRelativeLaneIndex,
  resolveWheelLaneDirection,
  type ChannelLike,
  type KeyboardCodeLike,
  type LaneBinding,
  type LaneModeOptions,
} from './core/lane-layout.ts';
