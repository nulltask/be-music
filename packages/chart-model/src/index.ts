export { MAX_GENERIC_BMSON_KEYS, resolveGenericBmsonKeyCount, type GenericBmsonPlayVariant } from './generic-bmson.ts';

export {
  BMSON_MODE_HINT_LAYOUTS,
  PLAY_MODE_LAYOUTS,
  findPlayModeLane,
  getPlayModeLayouts,
  resolveBmsonModeHintLayout,
  resolvePlayLaneChannels,
  type BmsonModeHint,
  type BmsonModeHintLayout,
  type PlayFreeZone,
  type PlayKeyTone,
  type PlayLane,
  type PlayLaneChannels,
  type PlayLaneKind,
  type PlayModeLayout,
  type PlayModeLayoutId,
  type PlaySide,
} from './play-modes.ts';

export {
  drawRandomOutcomes,
  evaluateControlFlow,
  hasControlFlow,
  type ActiveControlFlowEntry,
  type ControlFlowSource,
  type RandomDraw,
  type RandomDrawCommand,
  type RandomDraws,
} from './control-flow.ts';

export {
  createTimingBuildContext,
  createTimingResolver,
  createTimingResolverWithContext,
  firesBeforeTempoReversal,
  mirrorBeatAtTempoReversal,
  type StopPoint,
  type TempoPoint,
  type TempoReversalPoint,
  type TimingBuildContext,
  type TimingResolver,
} from './timing.ts';

export {
  collectSampleTriggers,
  collectSampleTriggersWithContext,
  createBmsonSamplePlaybackMap,
  type CollectSampleTriggersOptions,
  type TimedSampleTrigger,
} from './sample-triggers.ts';

export {
  createBeatAtSecondsResolver,
  createBeatAtSecondsResolverFromTimingResolver,
  createBPMTimeline,
  createMeasureBoundariesBeats,
  createMeasureTimeline,
  createScrollTimeline,
  createSpeedTimeline,
  createStopBeatWindows,
  type BPMTimelinePoint,
  type MeasureTimelinePoint,
  type ScrollTimelinePoint,
  type SpeedTimelinePoint,
  type StopBeatWindow,
} from './timelines.ts';

export {
  resolvePoorBGAMode,
  type PoorBGAMode,
  buildBGATimelines,
  buildBmsBGATimeline,
  type BGACue,
  type BGATimelines,
  type BGATimingResolver,
} from './bga.ts';

export {
  DEFAULT_LANDMINE_DAMAGE,
  DEFAULT_LONG_NOTE_MODE,
  resolveChartLongNoteMode,
  resolveLandmineDamage,
  type LongNoteMode,
} from './note-rules.ts';

export {
  countScoredNotes,
  resolveChart,
  type ResolveChartOptions,
  type ScoredNoteCount,
  type ResolvedChart,
  type ResolvedJudgeRank,
  type ResolvedTotal,
  type ResolvedVolumeChange,
} from './resolved-chart.ts';

export { isInvisibleNoteChannel, type ResolvedNote, type ResolvedNoteKind } from './resolved-notes.ts';

export {
  canonicalizeFingerprintDocument,
  computeChartFingerprint,
  computeFingerprintOfDocument,
  computePlayFingerprint,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
  type BeMusicChartFingerprintDocument,
  type BeMusicFingerprintDocument,
  type BeMusicFingerprintOptions,
  type BeMusicPlayFingerprintDocument,
  type FingerprintBranch,
  type FingerprintControlFlowNode,
  type FingerprintDeltaLists,
  type FingerprintHeaderChange,
  type FingerprintJudge,
  type FingerprintLaneModeInputs,
  type FingerprintLength,
  type FingerprintMeasures,
  type FingerprintMine,
  type FingerprintNote,
  type FingerprintOpaqueNode,
  type FingerprintRandomNode,
  type FingerprintTime,
  type FingerprintTimelineEvent,
  type FingerprintTimelineType,
  type FingerprintTotal,
} from './fingerprint.ts';
export { resolveChartMainBPM, type MainBPMChart } from './main-bpm.ts';
export { canonicalizeJSONValue } from './fingerprint-document.ts';
export { sha256Hex } from '@be-music/shared-utils/hash';

export {
  compareEvents,
  createBeatResolver,
  eventToBeat,
  getMeasureBeats,
  measureToBeat,
  sortEvents,
  type BeatResolver,
} from './beats.ts';

export { resolveChartPlayVariant, type ChartPlayVariant, type ChartPlayVariantInput } from './play-variant.ts';

export {
  isBmsBGMVolumeChangeChannel,
  isBMSDynamicVolumeChangeChannel,
  isBMSKeyVolumeChangeChannel,
  isBMSLongNoteChannel,
  isLandmineChannel,
  isPlayableChannel,
  isPlayLaneSoundChannel,
  isSampleTriggerChannel,
  isScrollChannel,
  isStopChannel,
  isTempoChannel,
  mapBMSLongNoteChannelToPlayable,
  parseBMSDynamicVolumeGain,
  parseBPMFrom03Token,
} from './channels.ts';

export { resolveChartReferenceBPM } from './reference-bpm.ts';
export {
  buildBGAOpacityTimelines,
  pickBGAOpacity,
  pickBGATint,
  type BGAOpacityCue,
  type BGAOpacityTimelines,
} from './bga-opacity.ts';

export {
  collectBMSExWAVVolumeMultipliers,
  collectBmsWAVCmdVolumeMultipliers,
  exWAVVolumeCentibelsToLinearGain,
  parseBMSExWAV,
  parseBmsWAVCmd,
  resolveBMSWAVResources,
  usesMonophonicWAVPlayback,
  volWAVToLinearGain,
  wavCmdVolumeByteToLinearGain,
  wavCmdVolumePercentToLinearGain,
  type BMSExWAV,
  type BmsWAVCmdEntry,
  type BmsWAVCmdParam,
} from './wav-directives.ts';

export {
  parseBmsARGB,
  parseBmsBGA,
  parseBMSExBMP,
  parseBMSSwBGA,
  pickSwitchingBGAFrame,
  resolveBmsBmpARGB,
  type BmsARGB,
  type BMSExBMP,
  type BMSSubRegionBGA,
  type BMSSwitchingBGA,
} from './bmp-directives.ts';

export {
  collectLNOBJEndEvents,
  resolveBMSLongNotes,
  resolveLNOBJLongNotes,
  type BMSLongNote,
  type BMSLongNoteResolution,
  type LNOBJLongNoteResolution,
  type ResolveBMSLongNotesOptions,
} from './long-notes.ts';

export { applyBMSColorKey, resolveBmsExBMPColorKey } from './bga-color-key.ts';

export {
  parseBMSKeyBoundBGA,
  buildKeyBoundBGATimeline,
  pickKeyBoundBGAFrame,
  type BMSKeyBoundBGA,
  type KeyBoundBGACue,
} from './key-bound-bga.ts';

export {
  buildBmsonBGAEventTimeline,
  pickBmsonBGASequenceFrame,
  type BmsonBGAEventCue,
  type ResolvedBmsonBGASequence,
  type ResolvedBmsonBGASequenceFrame,
} from './bmson-bga-sequences.ts';
