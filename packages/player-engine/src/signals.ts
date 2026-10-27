/**
 * `@be-music/player-engine/signals`: what a host's input and UI runtimes exchange with a running play — the input bus and the
 * commands it carries, the UI bus with its frames and commands, the judge / combo / high-speed state signals, and the
 * high-speed range with the actions that step it.
 *
 * Kept apart from the package root so a UI worker can hold the buses without loading the play loop.
 */
export {
  createPlayerInputSignalBus,
  type PlayerInputCommand,
  type PlayerInputSignalBus,
} from './core/input-signal-bus.ts';
export {
  createPlayerUISignalBus,
  type PlayerGaugeSummary,
  type PlayerHCNLaneState,
  type PlayerUICommand,
  type PlayerUIFrameClock,
  type PlayerUIFrameNote,
  type PlayerUIFramePayload,
  type PlayerUIFrameSummary,
  type PlayerUILongNoteMode,
  type PlayerUILongNoteOutcome,
  type PlayerUISeekJudgment,
  type PlayerUISeekSnapshot,
  type PlayerUISignalBus,
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
