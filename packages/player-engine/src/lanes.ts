/**
 * `@be-music/player-engine/lanes`: the lanes of a play mode — which channels a chart plays on and how they lay out (slots,
 * the LR2 lane order, scratch and wheel lanes), the keyboard bindings with FREE ZONE input, the scratch spin a press
 * gives (the odd-even rule over a scratch lane's keys), and the lanes the lane options permute. `ChartPlayVariant` comes from `@be-music/chart-model`.
 */
export {
  appendFreeZoneInputChannels,
  createInputTokenToChannelsMap,
  createLaneBindings,
  isPlayableInputChannel,
  LANE_KEY_CONFIG,
  laneKeyLabel,
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
  type LaneKeyConfigLane,
  type LaneKeyGroup,
  type LaneKeyOverrides,
  type LaneModeOptions,
} from './core/lane-layout.ts';

export {
  createInputSourceTable,
  endsBackSpinScratch,
  hasScratchCounterpart,
  inputSourceKey,
  isSameInputSource,
  keyboardInputSource,
  releasesScratchHold,
  type IdentifiedInputSource,
  type InputSource,
  type InputSourceDevice,
  type InputSourceKind,
  type InputSourceTable,
  type TurntableDirection,
} from './core/input-source.ts';

export {
  createScratchSpinByToken,
  isScratchSpin,
  resolveScratchSpin,
  type ScratchSpin,
  type ScratchSpinBinding,
} from './core/scratch-spin.ts';

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

export { prepareMineModifier, type MineModifier, type MinePlacement } from './core/mine-modifier.ts';

export {
  addLongNotes,
  clampLongNoteRate,
  type LongNoteModifier,
  type LongNotePlacement,
} from './core/long-note-modifier.ts';

export { randomizeLR2ScatterNotes } from './lane-scatter.ts';

export { clampScrollSection, clampScrollRate, type ScrollModifier } from './core/scroll-modifier.ts';
export type { LR2ManiaChartRates } from './core/lr2-mania-chart.ts';

export { clampExtraNoteDepth } from './core/extra-note-modifier.ts';

export type { LR2ExtraLevel } from './core/lr2-extra-lanes.ts';

export {
  isOnePlayerBattleMode,
  isSPToDPBattleMode,
  resolveEffectiveBattleMode,
  type BattleMode,
  type EffectiveBattleMode,
} from './core/battle-mode.ts';

export {
  applySevenToNine,
  type SevenToNineOptions,
  type SevenToNinePattern,
  type SevenToNineType,
} from './core/seven-to-nine.ts';
