/**
 * `@be-music/player-engine/display`: what a host shows; nothing here changes a judgment. The notes of a play as the engine
 * times them, the scroll-distance mapper, the BGA cue on screen, the chart facts a chart screen shows, time and key
 * labels, and the TUI's note-height and BGA resize options.
 *
 * The chart-side types these read (`LongNoteMode`, `ScrollTimelinePoint`, `SpeedTimelinePoint`, `BGACue`, the BGA
 * timeline builders) come from `@be-music/chart-model`.
 */
export {
  extractInvisiblePlayableNotes,
  extractLandmineNotes,
  extractPlayableNotes,
  extractTimedNotes,
  toTimedInvisibleNote,
  toTimedLandmineNote,
  toTimedPlayableNote,
  type ExtractPlayableNotesOptions,
  type ExtractTimedNotesOptions,
  type ExtractTimedNotesResult,
  type TimedLandmineNote,
  type TimedPlayableNote,
} from './playable-notes.ts';
export {
  createScrollDistanceMapper,
  createLR2ConstantScrollMapper,
  ScrollDistanceMapper,
  type ScrollDistanceMapperLike,
  type ScrollDistanceMapperOptions,
} from './core/scroll-distance.ts';
export { DEFAULT_POOR_BGA_DISPLAY_SECONDS, pickActiveBGACue, pickActiveBGAKey } from './core/bga-timeline.ts';
export {
  formatSeconds,
  resolveAltModifierLabel,
  resolveDisplayedDifficultyValue,
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from './utils.ts';
export {
  DEFAULT_TUI_NOTE_HEIGHT,
  MAX_TUI_NOTE_HEIGHT,
  MIN_TUI_NOTE_HEIGHT,
  TUI_NOTE_HEIGHT_HALF,
  type TUINoteHeight,
} from './core/ui-options.ts';
export {
  DEFAULT_IMAGE_RESIZE_ALGORITHM,
  IMAGE_RESIZE_ALGORITHMS,
  isImageResizeAlgorithm,
  type ImageResizeAlgorithm,
} from './image-resize-algorithm.ts';

export {
  adjustBeatorajaJudgeTiming,
  isLR2JudgeTimingAutoAdjust,
  JUDGE_TIMING_AUTO_ADJUST_MODES,
  resolveJudgeTimingAutoAdjust,
  type JudgeTimingAutoAdjust,
} from './core/judge-timing.ts';
