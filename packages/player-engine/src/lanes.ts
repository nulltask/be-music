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

export {
  randomizeHRandomNotes,
  randomizeAllScratchNotes,
  randomizePMSConvergeNotes,
  randomizePMSPlayableNotes,
  clampHRandomThresholdBPM,
  randomizeSpiralNotes,
  randomizeSRandomNotes,
  type SRandomNote,
  type SRandomOptions,
} from './lane-random.ts';

export { resolveAutoScratchSides, resolveAutoScratchChannels, type AutoScratchOptions } from './core/auto-scratch.ts';

export { randomizeLR2ConvergeNotes } from './lane-converge.ts';

export { randomizePMSPlayableLanes } from './lane-pms-random.ts';

export {
  createBeatorajaLaneRandom,
  parseLaneRandomSeed,
  drawLaneRandomIndex,
  type LaneRandomSource,
} from './lane-random-source.ts';
