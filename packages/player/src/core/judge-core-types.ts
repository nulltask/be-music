import type { BeMusicEvent, BeMusicSourceFormat } from '@be-music/json';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import type { PlaylogInputEvent } from '../playlog/format.ts';
import type { RulesetConfig } from '../ruleset/definitions.ts';
import type { GaugeJudgeIndex } from '../ruleset/gauge.ts';
import type { HcnTickCounter } from '../ruleset/long-note.ts';
import type { GrooveGaugeJudgeKind } from './groove-gauge.ts';
import type { LaneHoldHistory } from './lane-hold.ts';
import { type PendingAutoLongNoteState, type TimedManualJudge } from './judge-rules.ts';
import { type ScoreSummary, type ScoreTracker } from './scoring.ts';
import type { PlayerGaugeSummary, PlayerUiCommand } from './ui-signal-bus.ts';

/**
 * The judge core's state, inputs, effects and tuning constants (see `judge-core.ts`).
 */

/** Slack added to "has chart time reached X" checks so float noise never holds an event back by one step. */
export const JUDGE_TIME_EPSILON_SECONDS = 1e-6;
/** `#WAV00` — the sample a mine explosion plays, when the chart defines one. */
export const LANDMINE_EXPLOSION_SAMPLE_KEY = '00';

/** Everything about the play that stays fixed while it runs. */
export interface JudgeCoreConfig {
  ruleset: RulesetConfig;
  /** Judged notes, sorted by time. The core marks them `judged` (and sets `visibleUntilBeat` on long notes). */
  scorableNotes: TimedPlayableNote[];
  landmineNotes: TimedLandmineNote[];
  invisibleNotes: TimedPlayableNote[];
  /** Notes whose keysound a note-less press plays (LR2 lane-sound hold). */
  laneSoundNotes: readonly TimedPlayableNote[];
  /** Scratch lanes (`16` / `26` and their mapped equivalents) — they read the scratch window tables. */
  scratchChannels: ReadonlySet<string>;
  /** AUTO SCRATCH: the core plays the scratch lanes itself and ignores input on them. */
  autoScratch: boolean;
  /**
   * Scale of the millisecond domain (`nowMs`, release-margin deadlines, lane press / release stamps) per chart second.
   * Live play runs it on the playback clock (`1000 / speed`, wall-clock milliseconds); a replay runs it on chart time
   * (`1000`).
   */
  judgeMsPerChartSecond: number;
  /** `#WAVxx` table, for the mine explosion sample. */
  wavResources: Readonly<Record<string, string>>;
  /** Object-id radix, for reading mine damage values. */
  idBase: 36 | 62;
  sourceFormat: BeMusicSourceFormat;
  /**
   * Chart second of the LR2 negative-BPM reversal (`ResolvedChart.reversal`), when the chart has one. LR2's event pump
   * freezes there: nothing at or past it is missed, auto-played or detonated, and presses and releases past it are
   * judged on the mirrored clock `t' = 2R - now` (OpenLR2 `LR2f.cpp:12624,12931`). Chart data, not a clock — the
   * judgments stay a pure function of the inputs' chart times. See docs/bms-spec.md "Negative BPM".
   */
  reversalSeconds?: number;
  /**
   * The play ends the moment a survival gauge empties (`PlayerOptions.endOnFailure`): from the judgment that emptied
   * it on, nothing is scored (see `isJudgingClosed`).
   */
  endOnFailure: boolean;
}

/** The play's running result — the same shape as the engine's public `PlayerSummary`. */
export interface JudgeCoreSummary extends ScoreSummary {
  fast: number;
  slow: number;
  gauge?: PlayerGaugeSummary;
}

/** The score side of the state: the summary the host shows, and the gauge it is updated through. */
export interface JudgeCoreScore {
  summary: JudgeCoreSummary;
  scoreTracker: ScoreTracker;
  applyGaugeJudge: (judge: GrooveGaugeJudgeKind) => void;
  applyGaugeDelta: (delta: number) => void;
  /** One Hell Charge tick: a judge-table entry at a rate (beatoraja's `gauge.update(judge, rate)`). */
  applyGaugeTick: (judge: GaugeJudgeIndex, rate: number) => void;
  /** Empties the gauge for good (LR2's `HP = 0` when a reversed play ends with notes outstanding). */
  drainGaugeToZero: () => void;
}

/** A Hell Charge note passing the judge line: its gauge ticks run from its judged head until its tail passes. */
export interface HcnPassingState {
  note: TimedPlayableNote;
  /** The tail's microsecond: the counter stops there. */
  endUs: number;
  counter: HcnTickCounter;
  /** The tail was released at GOOD or better: the lane gains until the tail passes, held or not. */
  tailGood: boolean;
  /** The lane's next Hell Charge note, judged before this one has passed: it ticks once this one's tail passes. */
  next?: HcnPassingState;
}

/** A long note whose head was hit and whose tail is not resolved yet. */
export interface ActiveLongNoteState {
  endSeconds: number;
  note: TimedPlayableNote;
  mode: 1 | 2 | 3;
  headJudge: TimedManualJudge;
  audioStopped: boolean;
  /**
   * True when `headJudge` has ALREADY been applied to the score (charge modes judge the head on the press). The
   * tail then stands alone; LN mode instead defers, and resolves head and tail into one combined judgment.
   */
  headScored: boolean;
}

/** The judge state of one manual play. Owned by the core: drivers read it, only {@link runJudgeCoreStep} writes it. */
export interface JudgeCoreState {
  readonly config: JudgeCoreConfig;
  readonly summary: JudgeCoreScore['summary'];
  readonly scoreTracker: ScoreTracker;
  readonly applyGaugeJudge: (judge: GrooveGaugeJudgeKind) => void;
  readonly applyGaugeDelta: (delta: number) => void;
  readonly applyGaugeTick: (judge: GaugeJudgeIndex, rate: number) => void;
  readonly drainGaugeToZero: () => void;
  combo: number;
  /**
   * Lanes whose key is down: between a `hold` and a `release`. The core takes key-state input only — a driver whose
   * input reports no releases infers them first (`play-key-inference.ts`) — so a press never holds a lane by itself.
   */
  readonly heldChannels: Set<string>;
  readonly activeLongNotes: Map<string, ActiveLongNoteState>;
  /**
   * Millisecond each let-go long note settles at: at once (`-Infinity`), or once the ruleset's release margin has run
   * out (beatoraja's `longnoteMargin`), until when pressing the lane again resumes the hold.
   */
  readonly longNoteSettleMs: Map<string, number>;
  /** Chart second each held long note was released at — its tail is judged against the release, not the tick. */
  readonly longHoldReleaseSeconds: Map<string, number>;
  /** Each lane's press and release instants, for asking whether it was down when a mine crossed the line. */
  readonly laneHolds: Map<string, LaneHoldHistory>;
  /** The latest instant (true clock, seconds) the timed judgments were advanced to — an ESC abort stops there. */
  advancedThroughSeconds: number;
  readonly pendingAutoScratchLongNotes: PendingAutoLongNoteState[];
  readonly autoScratchNotes: readonly TimedPlayableNote[];
  /** Per-lane sorted note times — the reference notes a phantom press is measured against for an empty POOR. */
  readonly scorableNoteSecondsByChannel: ReadonlyMap<string, number[]>;
  autoScratchCursor: number;
  scorableMissCursor: number;
  landmineExpireCursor: number;
  /**
   * How far each unsettled mine has been checked: 1 once its LR2 PGREAT-window entry, 2 once its crossing of the judge
   * line. A mine is settled (judged) after its last check.
   */
  readonly landminePhases: Map<TimedLandmineNote, number>;
  /** The Hell Charge note passing each lane, while its gauge ticks run. */
  readonly hcnPassing: Map<string, HcnPassingState>;
  invisibleExpireCursor: number;
  remainingScorableNotes: number;
  remainingLandmineNotes: number;
  remainingInvisibleNotes: number;
}

/** One thing that happens to the judge state, stamped with chart seconds (and the millisecond domain). */
export type JudgeCoreInput =
  /** Time passes: long-note holds and tails, HCN ticks, auto-scratch, misses, mines and invisible notes resolve. */
  | { kind: 'advance'; nowSec: number; nowMs: number }
  /** A lane press on `channels` (already mapped from key tokens; `tokens` are only recorded). */
  | { kind: 'press'; channels: ReadonlySet<string>; tokens: readonly string[]; nowSec: number; nowMs: number }
  /**
   * Keys went down and stay down (key-state input): the lanes count as held until released. `inferred`: the driver
   * inferred it from input without releases, so no lane cue shows it.
   */
  | { kind: 'hold'; channels: ReadonlySet<string>; inferred?: boolean }
  /**
   * Keys came up. `recordSec` is the instant the play log records for the release. `inferred`: the driver inferred it
   * from input without releases (the play log marks it), so no lane cue shows it.
   */
  | {
      kind: 'release';
      channels: ReadonlySet<string>;
      tokens: readonly string[];
      nowSec: number;
      nowMs: number;
      recordSec: number;
      inferred?: boolean;
    }
  /**
   * The play ended: anything still unjudged is charged as POOR at `totalSeconds` — except, past an LR2 negative-BPM
   * reversal, the notes the frozen pump never reached, which empty the gauge instead.
   */
  | { kind: 'finish'; totalSeconds: number };

/** A `name value` field of a no-TUI trace line (the time field is added from the effect's `seconds`). */
export type JudgeTraceField = readonly [key: string, value: string | number | boolean | undefined];

/** Where a keysound the core triggered came from. */
export type JudgeSoundSource = 'auto-scratch' | 'manual-note' | 'lane-fallback' | 'mine-hit';

/** What a step produced, in order. Drivers map these onto audio, the UI buses, the play log and the no-TUI trace. */
export type JudgeCoreEffect =
  /**
   * Record a raw input in the play log (before it is judged). `channels` is only valid during dispatch. `inferred`
   * marks a release the driver inferred from input without releases.
   */
  | {
      kind: 'record-input';
      action: PlaylogInputEvent['action'];
      seconds: number;
      tokens: readonly string[];
      channels: ReadonlySet<string>;
      inferred?: boolean;
    }
  /** Count an empty POOR in the play log's native result. */
  | { kind: 'record-empty-poor' }
  /** An input is about to be judged at `seconds` (replay): flush time-scheduled trace output up to it first. */
  | { kind: 'input-time'; seconds: number }
  /** Play a keysound / explosion sample. */
  | { kind: 'sound'; source: JudgeSoundSource; event: BeMusicEvent; seconds: number; channel: string }
  /** Cut a lane's sounding keysound (a long note released or broken). */
  | {
      kind: 'stop-sound';
      channel: string;
      seconds: number;
      reason: 'long-note-release' | 'long-note-break';
      event: BeMusicEvent;
    }
  /** The gauge moved (`judge` absent for raw deltas). `delta` is the applied change, after clamping. */
  | { kind: 'gauge'; seconds: number; reason: string; judge?: GrooveGaugeJudgeKind; delta?: number }
  /** The combo was set to `value`. */
  | { kind: 'combo'; seconds: number; value: number; reason: string; judge?: string; channel?: string }
  /** A long note changed state. */
  | {
      kind: 'long-note';
      seconds: number;
      channel: string;
      state: 'start' | 'release' | 'break' | 'complete';
      mode: 1 | 2 | 3;
      event: BeMusicEvent;
      endSeconds: number;
    }
  /** A presentation cue for the gameplay UI (lane flashes, holds, long-note bars). */
  | { kind: 'ui'; command: PlayerUiCommand }
  /** The POOR BGA was triggered / cleared — delivered to every host, UI or not. */
  | { kind: 'poor-bga'; action: 'trigger' | 'clear'; seconds: number }
  /** The no-TUI trace's POOR BGA marker at this point of the output. */
  | { kind: 'poor-trace'; action: 'trigger' | 'clear'; seconds: number }
  /** The judge readout: what the UI's judge / combo display shows. */
  | { kind: 'judge-combo'; judge: string; combo: number; channel?: string; signedDeltaMs?: number }
  /** A no-TUI trace line. */
  | { kind: 'trace'; name: string; seconds: number; fields: readonly JudgeTraceField[] }
  /** The play state changed outside a frame tick: republish the frame (at `beat`, or the beat of `seconds`). */
  | { kind: 'frame'; seconds: number; beat?: number };

export type JudgeCoreEffectSink = (effect: JudgeCoreEffect) => void;
