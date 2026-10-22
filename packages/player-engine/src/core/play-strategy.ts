import type { ReplayPlay } from '../replay/format.ts';
import type { PlayerInputCommand } from './input-signal-bus.ts';
import type { PlaySession } from './play-session.ts';

/**
 * Judgment strategies: what differs between manual, replay and AUTO play. The play loop (`play-loop.ts`) owns the clock,
 * the lead-in, audio, input commands, the horizon and the hold after the chart; a strategy decides how the notes are
 * judged on each tick, which input it takes and how the judging ends.
 */

/** One tick of the play loop. */
export interface PlayTick {
  /** Play-clock milliseconds: what is audible now. */
  nowMs: number;
  /** Chart seconds at `nowMs`. */
  nowSec: number;
  /** Chart seconds at the audio write head (`nowSec` or later): realtime audio is queued against it. */
  scheduledSec: number;
}

/** A lane command a strategy may take (`lane-input`, `kitty-state`); the play loop handles every other command. */
export type PlayLaneCommand = Extract<PlayerInputCommand, { kind: 'lane-input' | 'kitty-state' }>;

/** The judge of one play, as the play loop drives it. */
export interface PlayJudge {
  /** Judges up to the tick before its realtime audio is queued (a replay re-drives its recorded inputs here). */
  beforeAudio?(tick: PlayTick): void;
  /** Judges the tick, after its realtime audio was queued. */
  judge(tick: PlayTick): void;
  /**
   * Judges everything before `seconds` without its effects, and starts the keysounds that still ring there partway, for
   * a play that starts at `seconds` (`PlayerOptions.startAtSeconds`). Absent: the strategy cannot start partway.
   */
  fastForward?(seconds: number): void;
  /** A key command from the input runtime. Absent: the strategy ignores live key input. */
  handleLaneCommand?(command: PlayLaneCommand): void;
  /** The chart second the judge has settled through on this tick. */
  judgedThroughSeconds(tick: PlayTick): number;
  /** Nothing is left to judge. */
  isSettled(): boolean;
  /** Judging stopped for good: a survival gauge emptied under `endOnFailure`. */
  isClosed(): boolean;
  /** Runs once the loop is over and before `finish`, when the play was not interrupted. */
  beforeFinish?(): void;
  /** Applies the end-of-play rules. */
  finish(): void;
  /** The chart second the judge had settled through, recorded when the play is aborted. */
  settledThroughSeconds(): number;
}

/** How a play is judged: manual play from live input, a replay of a recorded input stream, or AUTO play. */
export interface JudgeStrategy {
  /** The replay's `play.mode`, and the mode the input runtime and the audio session are created for. */
  readonly mode: ReplayPlay['mode'];
  /** Whether the play shows the active-audio debug readout from a chart estimate when the session reports none. */
  readonly estimatesActiveAudio: boolean;
  /** Writes the no-TUI introduction (mode, lane map, keys). */
  writeIntro(session: PlaySession): void;
  /** Creates the judge of a play once its session is up. */
  createJudge(session: PlaySession): PlayJudge;
}
