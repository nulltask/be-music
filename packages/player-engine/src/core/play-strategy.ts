import type { ReplayPlay } from '../replay/format.ts';
import type { PlayerInputCommand } from './input-signal-bus.ts';
import type { PlayerUILongNoteMode, PlayerUISeekJudgment } from './ui-signal-bus.ts';
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
   * Seeks to chart second `seconds`, backwards or forwards: the judge state becomes the one a play from the start
   * reaches there (the loop resets the score and the notes' marks first, `play-seek.ts`), and the keysounds the judge plays that
   * still ring there start partway. Returns the judgments it rebuilt and the long notes held across `seconds`. Absent:
   * the strategy cannot seek.
   */
  seek?(seconds: number): PlayJudgeSeek;
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

/** What a judge rebuilt when it sought ({@link PlayJudge.seek}). */
export interface PlayJudgeSeek {
  /** The judgments before the second sought, in the order a play from the start made them. */
  judgments: PlayerUISeekJudgment[];
  /** The long notes held across the second sought: their lane, head beat, end beat and the mode they play in. */
  heldLongNotes: Array<{ channel: string; beat: number; endBeat: number | undefined; mode: PlayerUILongNoteMode }>;
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
