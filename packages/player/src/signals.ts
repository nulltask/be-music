/**
 * `@be-music/player/signals`: what a host's input and UI runtimes exchange with a running play — the input bus and the
 * commands it carries, the UI bus with its frames and commands, the judge / combo / high-speed state signals, and the
 * high-speed range with the actions that step it.
 *
 * Kept apart from the package root so a UI worker can hold the buses without loading the play loop and the audio
 * renderer.
 */
export {
  createPlayerInputSignalBus,
  type PlayerInputCommand,
  type PlayerInputSignalBus,
} from './core/input-signal-bus.ts';
export {
  createPlayerUiSignalBus,
  type PlayerGaugeSummary,
  type PlayerUiCommand,
  type PlayerUiFrameNote,
  type PlayerUiFramePayload,
  type PlayerUiFrameSummary,
  type PlayerUiLongNoteMode,
  type PlayerUiLongNoteOutcome,
  type PlayerUiSignalBus,
} from './core/ui-signal-bus.ts';
export {
  createPlayerStateSignals,
  type PlayerJudgeComboSignalState,
  type PlayerStateSignals,
} from './state-signals.ts';
export {
  applyHighSpeedControlAction,
  DEFAULT_HIGH_SPEED,
  HIGH_SPEED_STEP,
  MAX_HIGH_SPEED,
  MIN_HIGH_SPEED,
  resolveHighSpeedControlActionFromLaneChannels,
  resolveHighSpeedMultiplier,
  type HighSpeedControlAction,
} from './core/high-speed-control.ts';
