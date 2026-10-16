import type { PlaylogPlay } from '../playlog/format.ts';
import type { PlayerInputCommand } from './input-signal-bus.ts';
import type { PlaySession } from './play-session.ts';
import type { InputWakeUp } from './input-wakeup.ts';

/**
 * Judge strategies: what differs between manual, replay and AUTO play. The play loop (`play-loop.ts`) owns the clock,
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
  /** A key command from the input runtime. Absent: the strategy ignores live key input. */
  handleLaneCommand?(command: PlayLaneCommand): void;
  /** The chart second the judge has settled through on this tick. */
  judgedThroughSeconds(tick: PlayTick): number;
  /** Nothing is left to judge. */
  isSettled(): boolean;
  /** Judging stopped for good: a survival gauge emptied under `endOnFailure`. */
  isClosed(): boolean;
  /** Runs once the loop is over and before `finish`, when the play was not interrupted. */
  beforeFinish?(wakeUp: InputWakeUp): Promise<void> | void;
  /** Applies the end-of-play rules. */
  finish(): void;
  /** The chart second the judge had settled through, recorded when the play is aborted. */
  settledThroughSeconds(): number;
}

/**
 * Where a strategy still behaves the way its old driver did. Each one is a known drift between the manual and the
 * auto driver (`characterization/driver-drift.test.ts`), kept as it was so the one play loop changes no behaviour;
 * they are removed one by one.
 */
export interface StrategyDrifts {
  /** Plays as if `holdAfterChart` were not set. */
  readonly ignoresHoldAfterChart: boolean;
  /** Resolves its ruleset without the chart's `#EXRANK` changes, and traces their windows without `judgeWindowMs`. */
  readonly ignoresJudgeRankChanges: boolean;
  /** Records the play clock's chart time as `abortedAtUs` of an ESC, not where its judge had settled. */
  readonly abortsAtClockTime: boolean;
  /** Its no-TUI trace reports an ESC as `complete`. */
  readonly tracesEscapeAsComplete: boolean;
  /** Starts the chart after the lead-in whatever was sent during it, stopping only at its first tick. */
  readonly startsChartAfterLeadInEscape: boolean;
  /** Starts the input runtime once the lead-in is over. */
  readonly startsInputRuntimeAfterLeadIn: boolean;
  /**
   * Where the play ends: `lead-in-and-reach` runs to the chart's end plus the lead-in, the widest reach and a second
   * (ending early only without an audio session or a hold); `chart-end` ends as soon as the chart is over and judged,
   * and caps the play at the chart's end plus a second.
   */
  readonly horizon: 'lead-in-and-reach' | 'chart-end';
  /** Publishes a closing frame at the chart's end after `finish`. */
  readonly closingFrame: boolean;
  /** Queues the play lanes' keysounds as realtime audio as well as its own note keysounds. */
  readonly queuesLaneKeysoundsAsRealtimeAudio: boolean;
  /** Leaves `endOnFailure` out of its play log. */
  readonly omitsEndOnFailure: boolean;
  /** Records `tempo` and `tempoChanges` in a replay too. */
  readonly recordsTempoInReplay: boolean;
  /** Follows `replayTempoChanges` outside a replay too. */
  readonly followsReplayTempoChangesAlways: boolean;
}

/** How a play is judged: manual play from live input, a replay of a recorded input stream, or AUTO play. */
export interface JudgeStrategy {
  /** The play log's `play.mode`, and the mode the input runtime and the audio session are created for. */
  readonly mode: PlaylogPlay['mode'];
  readonly drifts: StrategyDrifts;
  /** Whether the play shows the active-audio debug readout from a chart estimate when the session reports none. */
  readonly estimatesActiveAudio: boolean;
  /** Writes the no-TUI introduction (mode, lane map, keys). */
  writeIntro(session: PlaySession): void;
  /** Creates the judge of a play once its session is up. */
  createJudge(session: PlaySession): PlayJudge;
}
