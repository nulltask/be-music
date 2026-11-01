import { resolveAutoScratchSides } from '../core/auto-scratch.ts';
import { PLAY_MODE_LAYOUTS, type PlayModeLayoutId } from '@be-music/chart-model';
import { resolve____RankLabel } from '../ruleset/score.ts';
import type { BeMusicReplay, ReplayInputEvent, ReplayRulesetResult } from './format.ts';
import {
  classifyRulesetJudge,
  ignoresLateLongNoteHeadBad,
  noteLateReachUs,
  addHCNPassing,
  judgeWindowLateReachUs,
  longNoteOwesTailMiss,
  pgreatWindowReachUs,
  preferJudgeCandidate,
  resolveEffectiveLongNoteMode,
  HCNTickCounter,
  resolveLNEarlyRelease,
  RULESET_JUDGE_NONE,
  RulesetGauge,
  resolveGaugeEndOnFailure,
  selectJudgeWindowSet,
  type GaugeJudgeIndex,
  type JudgeSelectionCandidate,
  type LNJudgeIndex,
  type RulesetJudgeIndex,
} from '../ruleset/index.ts';
import {
  courseStageCarryCombo,
  resolveRulesetConfig,
  type JudgeWindowSetUs,
  type RulesetId,
  type ResolveRulesetOptions,
  type RulesetConfig,
  type RulesetWindowTables,
} from './rulesets.ts';

export type { RulesetId, BeatorajaJudgeAlgorithm, ResolveRulesetOptions } from './rulesets.ts';
export {
  resolveRulesetConfig,
  resolveLR2DefaultTotal,
  resolveBeatorajaDefaultTotal,
  resolve____GaugeUnit,
  resolveLR2HardDamageMultiplier,
  resolveBeatorajaHardRecoverMultiplier,
} from './rulesets.ts';

export interface SimulateReplayOptions extends ResolveRulesetOptions {
  ruleset: RulesetId;
  /** Side of a recorded two-player play; defaults to player 1. Player 2 uses its recorded gauge. */
  player?: 1 | 2;
  /** Overrides the log's `play.endOnFailure`: whether judging stops the moment a survival gauge empties. */
  endOnFailure?: boolean;
  /**
   * Hears every judgment as the simulation scores it, in the order it scores them (`judgment-timeline.ts` builds a
   * replay's judgment timeline from them). Observing changes nothing the simulation derives.
   */
  onJudgment?: ReplayJudgmentObserver;
}

/** A judgment's kind in a {@link ReplayJudgmentEvent}: a scored window, a missed POOR, or an empty POOR. */
export type ReplayJudgmentKind = 'pgreat' | 'great' | 'good' | 'bad' | 'poor' | 'empty-poor';

/** One judgment a replay simulation scored, with the running totals just after it. */
export interface ReplayJudgmentEvent {
  /** Chart µs the judgment happened at: the press or release that made it, or the deadline that settled it. */
  readonly atUs: number;
  readonly judgment: ReplayJudgmentKind;
  /** The lane judged; absent for an empty POOR no lane is known for. */
  readonly channel?: string;
  /** The judged note's head time (µs); absent for an empty POOR, which takes no note. */
  readonly noteTimeUs?: number;
  /** Whether the note is done with this judgment (a tap, a long note's last judgment); false for a charge head. */
  readonly settlesNote: boolean;
  /** Note time minus input time (µs) for a timed judgment: positive is early (FAST). */
  readonly deltaUs?: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly exScore: number;
  /** The gauge after the judgment, in percent of its maximum. */
  readonly gauge: number;
}

/** Hears a replay simulation's judgments ({@link SimulateReplayOptions.onJudgment}). */
export type ReplayJudgmentObserver = (event: ReplayJudgmentEvent) => void;

const JUDGMENT_KINDS: readonly ReplayJudgmentKind[] = ['pgreat', 'great', 'good', 'bad', 'poor', 'empty-poor'];

/** The rulesets `simulateReplay` scores under, in display order. */
export const REPLAY_SIMULATOR_RULESETS: readonly ['lr2', 'beatoraja', '____'] = ['lr2', 'beatoraja', '____'];

/**
 * Re-derives one ruleset's judgments / EX-SCORE / combo / gauge from a replay's canonical data (resolved chart +
 * raw input stream + play settings). Pure function — never mutates the replay.
 *
 * The LR2 simulation follows lr2oraja / OpenLR2 semantics, the beatoraja simulation the current beatoraja master,
 * and the That-Which-Must-Not-Be-Named simulation the community-measured behavior of recent arcade versions (with documented stand-ins
 * where no measurement exists — see `rulesets.ts`).
 */
export function simulateReplay(replay: BeMusicReplay, options: SimulateReplayOptions): ReplayRulesetResult {
  const twoPlayer = replay.play.battleMode === 'TWO-PLAYER' || replay.play.battleMode === 'COUPLE';
  if (options.player === 2 && !twoPlayer) throw new RangeError('Player 2 requires a recorded two-player play.');
  if (twoPlayer) {
    const player = options.player ?? 1;
    const own = (channel: string): boolean => channel.startsWith(String(player));
    const notes = replay.chart.notes.filter((note) => own(note.channel));
    replay = {
      ...replay,
      chart: {
        ...replay.chart,
        notes,
        noteCount: notes.filter((note) => note.type === 'normal' || note.type === 'long').length,
      },
      play: { ...replay.play, ...(player === 2 ? { gauge: replay.play.gauge2P ?? replay.play.gauge } : {}) },
      inputs: replay.inputs
        .map((input) => ({ ...input, channels: input.channels.filter(own) }))
        .filter((input) => input.channels.length > 0),
    };
  }
  const config = resolveRulesetConfig(replay, options.ruleset, options);
  const endOnFailure =
    options.endOnFailure ??
    resolveGaugeEndOnFailure(
      options.ruleset === 'beatoraja' ? replay.play.gaugeAutoShift : undefined,
      options.ruleset,
      replay.play.endOnFailure === true,
    );
  return new ReplaySimulation(replay, config, endOnFailure, options.onJudgment).run();
}

/** Runs {@link simulateReplay} for each requested ruleset (default: LR2, beatoraja, That-Which-Must-Not-Be-Named). */
export function simulateReplayRulesets(
  replay: BeMusicReplay,
  rulesets: readonly RulesetId[] = REPLAY_SIMULATOR_RULESETS,
  options: ResolveRulesetOptions = {},
): Record<string, ReplayRulesetResult> {
  const results: Record<string, ReplayRulesetResult> = {};
  for (const ruleset of rulesets) {
    results[ruleset] = simulateReplay(replay, { ...options, ruleset });
  }
  return results;
}

/** At one instant: tails, then auto notes, then misses, then mines (see `advanceTime`). */
const TIMED_EVENT_ORDER = {
  'ln-complete': 0,
  'hold-deadline': 0,
  'release-settle': 0,
  'hcn-tick': 0.5,
  auto: 1,
  miss: 2,
  'mine-enter': 3,
  mine: 3,
  'mine-settle': 3,
} as const;

// Judgment indices follow beatoraja: 0 PG / 1 GR / 2 GD / 3 BD / 4 missed POOR / 5 empty POOR.
const JUDGE_PGREAT = 0;
const JUDGE_GREAT = 1;
const JUDGE_GOOD = 2;
const JUDGE_BAD = 3;
const JUDGE_MISS_POOR = 4;
const JUDGE_EMPTY_POOR = 5;
/** Selection-time marker: no window matched. Never reaches the gauge. */
const JUDGE_NONE = 6;

/**
 * A classification result: a {@link GaugeJudgeIndex} or {@link JUDGE_NONE}. Selection works in this wider space
 * because "no window matched" is a real outcome there; only scored judgments reach the gauge.
 */
type JudgeClassification = GaugeJudgeIndex | typeof JUDGE_NONE;

type SimLongStyle = 1 | 2 | 3;

interface SimHCNPassing {
  note: SimNote;
  endUs: number;
  counter: HCNTickCounter;
  tailGood: boolean;
  /** The lane's next Hell Charge note, judged before this one has passed. */
  next?: SimHCNPassing;
}

interface SimNote {
  timeUs: number;
  endTimeUs?: number;
  scratch: boolean;
  isLong: boolean;
  /** Resolved long-note style for this ruleset (1 LN / 2 CN / 3 HCN). */
  longStyle?: SimLongStyle;
  judged: boolean;
  holding: boolean;
  /** AUTO: a charge note's head was cleared; its tail clears at the tail. */
  autoHeadDone?: boolean;
  /** Miss-sweep deadline (input time past which the head can no longer be judged). */
  missDeadlineUs: number;
}

interface SimMine {
  timeUs: number;
  damage: number;
  /** Settled: detonated, or past the point where it no longer can (see {@link ReplaySimulation.mineSettleUs}). */
  applied: boolean;
  /** Its PGREAT reach, worked out on first use (the windows at a fixed time never change during a run). */
  reachUs?: readonly [number, number];
}

interface ActiveHold {
  note: SimNote;
  /** Deferred LN head judge (style 1). */
  headJudge?: GaugeJudgeIndex;
  headDmUs?: number;
  /** That-Which-Must-Not-Be-Named charge heads that BAD/POOR'd skip the tail — such notes never become holds. */
  /** Held-past-end deadline for charge tails. */
  tailMissDeadlineUs: number;
  /**
   * A release waiting out the ruleset's long-note release margin: settled with `judge` at `atUs` unless the lane is
   * pressed again first, which resumes the hold.
   */
  pendingRelease?: { atUs: number; judge: GaugeJudgeIndex; dmUs: number };
}

interface SimLane {
  channel: string;
  scratch: boolean;
  notes: SimNote[];
  mines: SimMine[];
  sweepCursor: number;
  mineCursor: number;
  held: boolean;
  /**
   * The keys holding the lane down now (`''` for an input recorded without tokens). Mines ask whether ANY key on the
   * lane is down, so a second key keeps the lane down while the first is released, as the engine's lane history does.
   */
  downTokens: Set<string>;
  /** The Hell Charge notes passing the lane, in tail order, while their gauge ticks run (see `HCNTickCounter`). */
  passing?: SimHCNPassing;
  hold?: ActiveHold;
  /** Auto-played lane (AUTO mode or AUTO SCRATCH): every note resolves PGREAT on schedule. */
  auto: boolean;
  autoCursor: number;
}

interface SelectionCandidate {
  lane: SimLane;
  note: SimNote;
  dmUs: number;
  /** 0..3 scoreable, 4 pending-in-MS-window, 5 judged-in-MS-window. */
  judge: GaugeJudgeIndex;
}

class ReplaySimulation {
  private readonly lanes = new Map<string, SimLane>();
  /** {@link lanes} in insertion order, for the per-advance sweeps (an array walk instead of a map iterator). */
  private readonly laneList: SimLane[] = [];
  private readonly counts = [0, 0, 0, 0, 0, 0];
  private readonly gauge: RulesetGauge;
  private combo = 0;
  private maxCombo = 0;
  private minePoor = 0;
  /** The course-wide combo and max combo, for a course stage (carried in from the previous stage). */
  private readonly course: { combo: number; maxCombo: number } | undefined;
  /** Judging stops the moment the survival gauge empties (`play.endOnFailure`). */
  private readonly endOnFailure: boolean;
  private fast = 0;
  private slow = 0;
  private exScore = 0;
  private lastAdvanceUs = Number.NEGATIVE_INFINITY;
  private readonly replay: BeMusicReplay;
  private readonly config: RulesetConfig;
  /** The scratch lanes of the play mode the log was played in (none in PMS and the keyboard modes). */
  private readonly scratchChannels: ReadonlySet<string>;
  private readonly observer: ReplayJudgmentObserver | undefined;
  /** Where the next judgment happens, for the {@link observer}: its time, and the lane and note it judges. */
  private judgeAtUs = 0;
  private judgeLane: SimLane | undefined;
  private judgeNote: SimNote | undefined;

  constructor(replay: BeMusicReplay, config: RulesetConfig, endOnFailure: boolean, observer?: ReplayJudgmentObserver) {
    this.replay = replay;
    this.config = config;
    this.endOnFailure = endOnFailure;
    this.observer = observer;
    this.course = replay.play.course === undefined ? undefined : courseStageCarryCombo(replay.play.course);
    this.scratchChannels = resolveScratchChannels(replay.chart.laneMode);
    this.gauge = new RulesetGauge(config.gauge, config.gaugeFallback, config.gaugeBank);
    this.buildLanes();
  }

  run(): ReplayRulesetResult {
    const reversalUs = this.replay.chart.reversalTimeUs;
    const inputs = [...this.replay.inputs].sort((left, right) => left.timeUs - right.timeUs || left.seq - right.seq);
    for (const input of inputs) {
      this.advanceTime(input.timeUs);
      // LR2 negative-BPM reversal (#134): past the reversal R presses and releases are judged on the mirrored clock
      // t' = 2R - now (OpenLR2 `LR2f.cpp:12624,12931`), exactly as the engine does. `advanceTime` stays clamped to R,
      // so nothing past it is ever swept into a miss.
      const judged =
        reversalUs !== undefined && input.timeUs > reversalUs
          ? { ...input, timeUs: 2 * reversalUs - input.timeUs }
          : input;
      if (input.action === 'down') {
        // The engine's mine press leg is dead past the reversal too (`processLandminePassage`).
        this.handleDown(judged, judged === input);
      } else {
        this.handleUp(judged);
      }
    }
    // An ESC abort stops judging where the engine stopped: nothing left in the chart is missed, and the end-of-play
    // rules (the reversal's HP = 0 included) never run.
    const abortedAtUs = this.replay.play.aborted === true ? this.replay.play.abortedAtUs : undefined;
    this.advanceTime(abortedAtUs ?? Number.POSITIVE_INFINITY);
    if (reversalUs !== undefined && abortedAtUs === undefined && !this.closed() && this.hasOutstandingNotes()) {
      // LR2 zeroes HP when a play ends with notes unjudged (OpenLR2 `LR2f.cpp:12980-12982`): a reversed run that
      // leaves notes past the reversal behind — open holds included — is always FAILED.
      this.gauge.drainToZero();
    }

    const result: ReplayRulesetResult = {
      ruleset: this.config.id,
      judge: {
        pgreat: this.counts[JUDGE_PGREAT]!,
        great: this.counts[JUDGE_GREAT]!,
        good: this.counts[JUDGE_GOOD]!,
        bad: this.counts[JUDGE_BAD]!,
        poor: this.counts[JUDGE_MISS_POOR]!,
        emptyPoor: this.counts[JUDGE_EMPTY_POOR]!,
      },
      fast: this.fast,
      slow: this.slow,
      exScore: this.exScore,
      noteCount: this.config.noteCount,
      maxCombo: this.maxCombo,
      djLevel: resolve____RankLabel(this.exScore, this.config.noteCount),
      gauge: {
        type: this.gauge.spec.id,
        ...(this.gauge.values ? { values: this.gauge.values } : {}),
        final:
          this.gauge.spec.max === 100
            ? this.gauge.value
            : this.gauge.spec.max > 0
              ? (this.gauge.value / this.gauge.spec.max) * 100
              : 0,
        cleared: this.gauge.cleared(),
      },
    };
    if (this.minePoor > 0) result.minePoor = this.minePoor;
    if (this.config.comboBreaksOnEmptyPoor && this.counts[JUDGE_EMPTY_POOR]! > 0) {
      result.fullCombo = this.config.noteCount > 0 && this.combo === this.config.noteCount;
    }

    if (this.gauge.failedMidPlay) {
      result.gauge.failedMidPlay = true;
    }
    if (this.course !== undefined) {
      result.course = { combo: this.course.combo, maxCombo: this.course.maxCombo };
    }
    if (this.config.moneyScore) {
      const notes = Math.max(1, this.config.noteCount);
      result.score = Math.floor(
        ((4 * this.counts[JUDGE_PGREAT]! + 2 * this.counts[JUDGE_GREAT]! + this.counts[JUDGE_GOOD]!) * 50000) / notes,
      );
    }
    return result;
  }

  private hasOutstandingNotes(): boolean {
    for (const lane of this.laneList) {
      if (lane.notes.some((note) => !note.judged)) {
        return true;
      }
    }
    return false;
  }

  private buildLanes(): void {
    const autoPlay = this.replay.play.mode === 'auto';
    const autoScratch = resolveAutoScratchSides(this.replay.play);
    for (const note of this.replay.chart.notes) {
      if (note.type === 'invisible' || note.type === 'freezone') {
        continue;
      }
      const lane = this.laneFor(note.channel, autoPlay, autoScratch);
      if (note.type === 'mine') {
        lane.mines.push({ timeUs: note.timeUs, damage: note.damage ?? 0, applied: false });
        continue;
      }
      const isLong =
        note.type === 'long' && typeof note.endTimeUs === 'number' && note.endTimeUs > note.timeUs ? true : false;
      const longStyle = isLong ? this.resolveLongStyle(note.lnMode ?? this.replay.chart.lnMode) : undefined;
      const windows = this.config.windowsAt(note.timeUs);
      const noteWindows = selectJudgeWindowSet(windows, { scratch: lane.scratch });
      const simNote: SimNote = {
        timeUs: note.timeUs,
        scratch: lane.scratch,
        isLong,
        judged: false,
        holding: false,
        missDeadlineUs: note.timeUs + noteLateReachUs(this.config, noteWindows, longStyle),
      };
      if (isLong) {
        simNote.endTimeUs = note.endTimeUs;
        simNote.longStyle = longStyle;
      }
      lane.notes.push(simNote);
    }
    for (const lane of this.laneList) {
      lane.notes.sort((left, right) => left.timeUs - right.timeUs);
      lane.mines.sort((left, right) => left.timeUs - right.timeUs);
    }
  }

  private laneFor(
    channel: string,
    autoPlay: boolean,
    autoScratch: ReturnType<typeof resolveAutoScratchSides>,
  ): SimLane {
    let lane = this.lanes.get(channel);
    if (!lane) {
      const scratch = this.scratchChannels.has(channel);
      lane = {
        channel,
        scratch,
        notes: [],
        mines: [],
        sweepCursor: 0,
        mineCursor: 0,
        held: false,
        downTokens: new Set(),
        auto:
          autoPlay || (scratch && (channel.startsWith('2') ? autoScratch.autoScratch2P : autoScratch.autoScratch1P)),
        autoCursor: 0,
      };
      this.lanes.set(channel, lane);
      this.laneList.push(lane);
    }
    return lane;
  }

  private resolveLongStyle(chartMode: SimLongStyle): SimLongStyle {
    return resolveEffectiveLongNoteMode(this.config.longNoteStyle, chartMode);
  }

  // ---- time advancement --------------------------------------------------------------------------------------

  private advanceTime(untilUs: number): void {
    const reversalUs = this.replay.chart.reversalTimeUs;
    if (reversalUs !== undefined && untilUs > reversalUs) {
      // The LR2 event pump froze at the reversal and the mirrored judge clock never passes it: misses, mines, hold
      // deadlines, and auto judgements past it never happen.
      untilUs = reversalUs;
    }
    interface TimedEvent {
      timeUs: number;
      kind:
        | 'ln-complete'
        | 'hold-deadline'
        | 'release-settle'
        | 'hcn-tick'
        | 'auto'
        | 'miss'
        | 'mine-enter'
        | 'mine'
        | 'mine-settle';
      lane: SimLane;
      note?: SimNote;
      mine?: SimMine;
      gain?: boolean;
    }
    const events: TimedEvent[] = [];
    for (const lane of this.laneList) {
      if (lane.auto) {
        for (let index = lane.autoCursor; index < lane.notes.length; index += 1) {
          const note = lane.notes[index]!;
          if (note.timeUs >= untilUs) break;
          // LN-style longs score once at the tail; a charge note scores its head at the head and its tail at the tail
          // (beatoraja's autoplay); a tap at its time.
          if (note.isLong && note.longStyle !== 1 && !note.autoHeadDone) {
            events.push({ timeUs: note.timeUs, kind: 'auto', lane, note });
          }
          const autoAt = note.isLong ? note.endTimeUs! : note.timeUs;
          if (autoAt >= untilUs) continue;
          events.push({ timeUs: autoAt, kind: 'auto', lane, note });
        }
      } else {
        for (let index = lane.sweepCursor; index < lane.notes.length; index += 1) {
          const note = lane.notes[index]!;
          // Deadlines are not monotonic along a lane (an LR2 LN head reaches only its GOOD leg), so the scan runs on
          // note times and tests each deadline.
          if (note.timeUs >= untilUs) break;
          if (!note.judged && !note.holding && note.missDeadlineUs < untilUs) {
            events.push({ timeUs: note.missDeadlineUs, kind: 'miss', lane, note });
          }
        }
        if (lane.hold && lane.hold.tailMissDeadlineUs < untilUs) {
          events.push({ timeUs: lane.hold.tailMissDeadlineUs, kind: 'hold-deadline', lane, note: lane.hold.note });
        }
        const pending = lane.hold?.pendingRelease;
        if (lane.hold && pending && pending.atUs < untilUs) {
          events.push({ timeUs: pending.atUs, kind: 'release-settle', lane, note: lane.hold.note });
        }
        if (lane.hold && lane.hold.note.longStyle === 1 && lane.hold.note.endTimeUs! < untilUs) {
          // An LN held to its tail confirms its deferred head judgment there, in time order with everything else.
          events.push({ timeUs: lane.hold.note.endTimeUs!, kind: 'ln-complete', lane, note: lane.hold.note });
        }
      }
      for (let index = lane.mineCursor; index < lane.mines.length; index += 1) {
        const mine = lane.mines[index]!;
        // Mines at or behind the reversal are frozen with the pump: not even LR2's early PGREAT reach detonates them.
        if (reversalUs !== undefined && mine.timeUs >= reversalUs) break;
        const [lateUs, earlyUs] = this.minePgreatReachUs(mine);
        if (mine.timeUs - earlyUs >= untilUs) break;
        if (mine.applied) continue;
        // Each point is visited once: in the advance whose span [lastAdvanceUs, untilUs) holds it.
        const fromUs = this.lastAdvanceUs;
        const enterUs = mine.timeUs - earlyUs;
        if (this.config.mineTrigger === 'press-or-hold' && enterUs >= fromUs && enterUs < untilUs) {
          // The provisional That-Which-Must-Not-Be-Named model also detonates on held PGREAT entry.
          events.push({ timeUs: enterUs, kind: 'mine-enter', lane, mine });
        }
        if (mine.timeUs >= fromUs && mine.timeUs < untilUs) {
          events.push({ timeUs: mine.timeUs, kind: 'mine', lane, mine });
        }
        const settleUs = this.config.mineTrigger === 'press-or-hold' ? mine.timeUs + lateUs : mine.timeUs;
        if (settleUs >= fromUs && settleUs < untilUs)
          events.push({ timeUs: settleUs, kind: 'mine-settle', lane, mine });
      }
    }
    // Hell Charge ticks, including those of a head missed in this span: no input falls inside it, so the miss is
    // certain and its ticks run from the deadline on.
    for (const lane of this.laneList) {
      if (lane.auto) continue;
      for (let index = lane.sweepCursor; index < lane.notes.length; index += 1) {
        const note = lane.notes[index]!;
        if (note.timeUs >= untilUs) break;
        if (
          note.isLong &&
          note.longStyle === 3 &&
          !note.judged &&
          !note.holding &&
          note.missDeadlineUs >= this.lastAdvanceUs &&
          note.missDeadlineUs < untilUs
        ) {
          this.startHCNPassing(lane, note, note.missDeadlineUs);
        }
      }
      for (let passing = lane.passing; passing !== undefined; passing = passing.next) {
        passing.counter.advance(Math.min(untilUs, passing.endUs), (gain, atUs) =>
          events.push({ timeUs: atUs, kind: 'hcn-tick', lane, gain }),
        );
        lane.passing = passing.endUs >= untilUs ? passing : passing.next;
        if (passing.endUs >= untilUs) break;
      }
    }

    // One instant settles tails first, then auto notes, then misses, then mines, each in channel order — the order the
    // engine's judge core settles them in.
    if (events.length > 1)
      events.sort(
        (left, right) =>
          left.timeUs - right.timeUs ||
          TIMED_EVENT_ORDER[left.kind] - TIMED_EVENT_ORDER[right.kind] ||
          (left.lane.channel < right.lane.channel ? -1 : left.lane.channel > right.lane.channel ? 1 : 0),
      );

    for (const event of events) {
      this.judgingAt(event.timeUs, event.lane, event.note);
      if (event.kind === 'auto') {
        const note = event.note!;
        if (note.judged) continue;
        if (note.isLong && note.longStyle !== 1 && !note.autoHeadDone) {
          note.autoHeadDone = true;
          this.applyJudge(JUDGE_PGREAT, undefined);
          continue;
        }
        note.judged = true;
        this.applyJudge(JUDGE_PGREAT, undefined);
      } else if (event.kind === 'miss') {
        const note = event.note!;
        if (note.judged || note.holding) continue;
        note.judged = true;
        this.applyJudge(JUDGE_MISS_POOR, undefined);
        if (longNoteOwesTailMiss(this.config, note.isLong ? note.longStyle : undefined)) {
          // beatoraja: a missed CN/HCN head also POORs the tail. That-Which-Must-Not-Be-Named (headBadSkipsTail) skips it.
          this.applyJudge(JUDGE_MISS_POOR, undefined);
        }
      } else if (event.kind === 'mine' || event.kind === 'mine-enter') {
        // Held as it enters the window (LR2) or as it crosses the line (every ruleset).
        if (event.lane.downTokens.size > 0) this.detonateMine(event.mine!);
      } else if (event.kind === 'mine-settle') {
        event.mine!.applied = true;
      } else if (event.kind === 'hcn-tick') {
        this.applyHCNTick(event.gain!);
      } else if (event.kind === 'release-settle') {
        const lane = event.lane;
        const hold = lane.hold;
        if (!hold || hold.note !== event.note || !hold.pendingRelease) continue;
        lane.hold = undefined;
        hold.note.holding = false;
        hold.note.judged = true;
        this.applyJudge(hold.pendingRelease.judge, hold.pendingRelease.dmUs);
      } else if (event.kind === 'ln-complete') {
        const lane = event.lane;
        const hold = lane.hold;
        if (!hold || hold.note !== event.note) continue;
        lane.hold = undefined;
        hold.note.holding = false;
        hold.note.judged = true;
        this.applyJudge(hold.headJudge ?? JUDGE_BAD, hold.headDmUs);
      } else {
        // Charge tail held past its late window — the tail resolves as a missed POOR (beatoraja / That-Which-Must-Not-Be-Named).
        const lane = event.lane;
        const hold = lane.hold;
        if (!hold || hold.note !== event.note) continue;
        lane.hold = undefined;
        hold.note.holding = false;
        hold.note.judged = true;
        this.applyJudge(JUDGE_MISS_POOR, undefined);
      }
    }

    // Advance sweep cursors past settled notes.
    for (const lane of this.laneList) {
      while (lane.sweepCursor < lane.notes.length) {
        const note = lane.notes[lane.sweepCursor]!;
        if (note.judged || (note.missDeadlineUs < untilUs && !note.holding)) {
          lane.sweepCursor += 1;
        } else {
          break;
        }
      }
      while (lane.autoCursor < lane.notes.length && lane.notes[lane.autoCursor]!.judged) {
        lane.autoCursor += 1;
      }
      while (lane.mineCursor < lane.mines.length && lane.mines[lane.mineCursor]!.applied) {
        lane.mineCursor += 1;
      }
    }
    this.lastAdvanceUs = untilUs;
  }

  /** The PGREAT window's `[late, early]` reach (µs) around a mine, which bounds LR2's press-or-hold detonation. */
  private minePgreatReachUs(mine: SimMine): readonly [number, number] {
    return (mine.reachUs ??= pgreatWindowReachUs(this.config.windowsAt(mine.timeUs).note));
  }

  private detonateMine(mine: SimMine): void {
    if (mine.applied) return;
    mine.applied = true;
    if (this.closed()) return;
    // Applied even at 0 damage, as the engine does: the raw path still settles a gauge sitting on its floor.
    if (this.config.mineTrigger === 'press-ahead-or-hold') {
      this.counts[JUDGE_MISS_POOR]! += 1;
      this.minePoor += 1;
    }
    this.gauge.applyRawDelta(-mine.damage);
  }

  /** LR2beta3 uses strict ahead-only GREAT; the provisional That-Which-Must-Not-Be-Named model keeps symmetric PGREAT. */
  private detonateMinesOnPress(lanes: readonly SimLane[], timeUs: number): void {
    if (this.config.mineTrigger === 'hold') return;
    const reversalUs = this.replay.chart.reversalTimeUs;
    for (const lane of lanes) {
      for (let index = lane.mineCursor; index < lane.mines.length; index += 1) {
        const mine = lane.mines[index]!;
        if (reversalUs !== undefined && mine.timeUs >= reversalUs) break;
        // Mines further ahead than any PGREAT reach cannot be hit.
        if (mine.timeUs - timeUs > 1_000_000) break;
        // Read the window at the press, including a dynamic LR2 rank.
        const [lateUs, earlyUs] = pgreatWindowReachUs(this.config.windowsAt(timeUs).note);
        const hit =
          this.config.mineTrigger === 'press-ahead-or-hold'
            ? mine.timeUs >= timeUs && mine.timeUs - timeUs < this.config.windowsAt(timeUs).note.judges[1][1]
            : mine.timeUs - earlyUs <= timeUs && timeUs - mine.timeUs <= lateUs;
        if (!mine.applied && hit) this.detonateMine(mine);
      }
    }
  }

  /**
   * Starts the gauge ticks of a Hell Charge note whose head was judged at `judgedUs` (pressed, or missed at its
   * deadline), as the engine does: from the later of the head and that instant until the tail passes.
   */
  private startHCNPassing(lane: SimLane, note: SimNote, judgedUs: number): void {
    if (lane.auto || !note.isLong || note.longStyle !== 3) return;
    for (let passing = lane.passing; passing !== undefined; passing = passing.next) {
      if (passing.note === note) return;
    }
    const startUs = Math.max(note.timeUs, judgedUs);
    const counter = new HCNTickCounter(startUs);
    counter.setGaining(lane.downTokens.size > 0, startUs, () => undefined);
    lane.passing = addHCNPassing(lane.passing, { note, endUs: note.endTimeUs!, counter, tailGood: false }, startUs);
  }

  /** Re-reads whether a lane's passing Hell Charge note gains: a key on it is down, or its tail went well. */
  private setHCNGaining(lane: SimLane, atUs: number): void {
    for (let passing = lane.passing; passing !== undefined; passing = passing.next) {
      passing.counter.setGaining(passing.tailGood || lane.downTokens.size > 0, Math.min(atUs, passing.endUs), (gain) =>
        this.applyHCNTick(gain),
      );
    }
  }

  private applyHCNTick(gain: boolean): void {
    if (this.closed()) return;
    const tick = this.config.hcnTick;
    this.gauge.applyJudge(
      (gain ? tick.heldJudge : tick.releasedJudge) as GaugeJudgeIndex,
      gain ? tick.heldRate : tick.releasedRate,
    );
  }

  // ---- input handling ----------------------------------------------------------------------------------------

  private handleDown(input: ReplayInputEvent, minePressLegLive: boolean): void {
    const timeUs = input.timeUs;
    const windows = this.config.windowsAt(timeUs);
    const pressed = this.resolveInputLanes(input);
    for (const lane of pressed) {
      lane.held = true;
      if (input.tokens === undefined || input.tokens.length === 0) {
        lane.downTokens.add('');
      } else {
        for (const token of input.tokens) lane.downTokens.add(token);
      }
      this.setHCNGaining(lane, timeUs);
    }
    // Pressing a lane whose release is waiting out the margin resumes its hold: that press judges nothing else. A lane
    // whose long note is held (pressed by another key bound to it) judges no other note either: its current note is
    // the long note, and the ruleset says what the press does instead.
    const lanes = pressed.filter((lane) => {
      if (lane.hold === undefined) return true;
      if (lane.hold.pendingRelease !== undefined) {
        lane.hold.pendingRelease = undefined;
      } else {
        this.applyPressDuringLongNote(lane, lane.hold, timeUs);
      }
      return false;
    });
    if (lanes.length === 0) {
      return;
    }
    if (minePressLegLive) {
      // Every pressed lane's key goes down, whatever the press then judges.
      this.detonateMinesOnPress(pressed, timeUs);
    }

    const selected = this.selectCandidate(lanes, timeUs, windows);
    if (!selected) {
      return;
    }
    if (selected.judge >= JUDGE_MISS_POOR) {
      // Empty POOR — the note is never consumed.
      this.judgingAt(timeUs, selected.lane, undefined);
      this.applyJudge(JUDGE_EMPTY_POOR, undefined);
      return;
    }

    const { note, lane, dmUs } = selected;
    this.judgingAt(timeUs, lane, note);
    if (note.isLong) {
      this.startLongNote(lane, note, selected.judge, dmUs);
      this.startHCNPassing(lane, note, timeUs);
    } else {
      note.judged = true;
      this.applyJudge(selected.judge, dmUs);
    }
    if (this.config.multiBad) {
      // Only scoreable judgments (PGREAT..BAD) consume a note, so the judge is a real window index here.
      this.applyLR2RejudgeChain(lane, timeUs, windows, note, selected.judge as RulesetJudgeIndex);
    }
  }

  /** The ruleset's {@link RulesetConfig.pressDuringLongNote}: LR2 re-judges the LN head or charges an empty POOR. */
  private applyPressDuringLongNote(lane: SimLane, hold: ActiveHold, timeUs: number): void {
    if (this.config.pressDuringLongNote === 'ignore') {
      return;
    }
    if (hold.note.longStyle === 1) {
      const dmUs = hold.note.timeUs - timeUs;
      const judge = classifyJudge(dmUs, selectJudgeWindowSet(this.config.windowsAt(timeUs), { scratch: lane.scratch }));
      if (judge !== JUDGE_NONE) {
        hold.headJudge = judge;
        hold.headDmUs = dmUs;
        return;
      }
    }
    this.judgingAt(timeUs, lane, undefined);
    this.applyJudge(JUDGE_EMPTY_POOR, undefined);
  }

  private handleUp(input: ReplayInputEvent): void {
    const timeUs = input.timeUs;
    for (const lane of this.resolveInputLanes(input)) {
      lane.held = false;
      if (input.tokens === undefined || input.tokens.length === 0) {
        lane.downTokens.clear();
      } else {
        for (const token of input.tokens) lane.downTokens.delete(token);
        // An unnamed press is released by any release of the lane.
        lane.downTokens.delete('');
      }
      const hold = lane.hold;
      if (!hold) {
        this.setHCNGaining(lane, timeUs);
        continue;
      }
      const note = hold.note;
      const endWindows = selectJudgeWindowSet(this.config.windowsAt(timeUs), {
        scratch: note.scratch,
        longNoteEnd: true,
      });
      const dmUs = note.endTimeUs! - timeUs;
      let released: { judge: GaugeJudgeIndex; dmUs: number };
      if (note.longStyle === 1) {
        // LN: the ruleset decides how a release before the tail combines with the deferred head judgment.
        const headJudge = hold.headJudge ?? JUDGE_BAD;
        released = resolveLNEarlyRelease(
          this.config,
          {
            judge: (headJudge > JUDGE_MISS_POOR ? JUDGE_MISS_POOR : headJudge) as LNJudgeIndex,
            dmUs: hold.headDmUs ?? 0,
          },
          dmUs,
          endWindows,
        );
      } else {
        // CN / HCN tail: judged by the release timing; early releases beyond the windows are POOR.
        const endJudge = classifyJudge(dmUs, endWindows);
        released = { judge: endJudge === JUDGE_NONE ? JUDGE_MISS_POOR : endJudge, dmUs };
      }
      const marginUs = note.scratch
        ? this.config.longNoteReleaseMarginUs.scratch
        : this.config.longNoteReleaseMarginUs.note;
      if (marginUs > 0 && released.judge >= JUDGE_BAD && released.dmUs > 0) {
        // beatoraja: a release that would score BAD or worse before the tail waits out the margin (`releasetime`).
        hold.pendingRelease = { atUs: timeUs + marginUs, ...released };
        this.setHCNGaining(lane, timeUs);
        continue;
      }
      lane.hold = undefined;
      note.holding = false;
      note.judged = true;
      this.judgingAt(timeUs, lane, note);
      this.applyJudge(released.judge, released.dmUs);
      for (let passing = lane.passing; passing !== undefined; passing = passing.next) {
        if (passing.note === note && released.judge <= JUDGE_GOOD) {
          // A Hell Charge tail released at GOOD or better keeps its lane gaining until the tail passes.
          passing.tailGood = true;
        }
      }
      this.setHCNGaining(lane, timeUs);
    }
  }

  private resolveInputLanes(input: ReplayInputEvent): SimLane[] {
    const lanes: SimLane[] = [];
    for (const channel of input.channels) {
      const lane = this.lanes.get(channel);
      if (lane && !lane.auto) {
        lanes.push(lane);
      }
    }
    return lanes;
  }

  private startLongNote(lane: SimLane, note: SimNote, judge: GaugeJudgeIndex, dmUs: number): void {
    const style = note.longStyle ?? 1;
    if (style === 1) {
      note.holding = true;
      lane.hold = {
        note,
        headJudge: judge,
        headDmUs: dmUs,
        tailMissDeadlineUs: Number.POSITIVE_INFINITY,
      };
      return;
    }
    // Charge styles score the head immediately. That-Which-Must-Not-Be-Named: a BAD head cancels the tail judgment
    // entirely, so the head settles the note.
    const skipsTail = this.config.headBadSkipsTail && judge >= JUDGE_BAD;
    if (skipsTail) note.judged = true;
    this.applyJudge(judge, dmUs);
    if (skipsTail) return;
    note.holding = true;
    // The tail's late window as it stands at the tail, like a note's miss deadline at the note.
    const endWindows = selectJudgeWindowSet(this.config.windowsAt(note.endTimeUs!), {
      scratch: note.scratch,
      longNoteEnd: true,
    });
    lane.hold = {
      note,
      tailMissDeadlineUs: note.endTimeUs! + judgeWindowLateReachUs(endWindows),
    };
  }

  private selectCandidate(
    lanes: readonly SimLane[],
    timeUs: number,
    windows: RulesetWindowTables,
  ): SelectionCandidate | undefined {
    const candidates: SelectionCandidate[] = [];
    for (const lane of lanes) {
      const set = selectJudgeWindowSet(windows, { scratch: lane.scratch });
      const scanLate = Math.min(set.judges[JUDGE_BAD]![0], set.ms?.[0] ?? 0);
      const scanEarly = Math.max(set.judges[JUDGE_BAD]![1], set.ms?.[1] ?? 0);
      for (let index = firstNoteInReach(lane.notes, timeUs, scanLate); index < lane.notes.length; index += 1) {
        const note = lane.notes[index]!;
        const dmUs = note.timeUs - timeUs;
        if (dmUs > scanEarly) break;
        if (note.holding) continue;
        let judge: JudgeClassification;
        if (note.judged) {
          judge = set.ms && dmUs >= set.ms[0] && dmUs <= set.ms[1] ? JUDGE_EMPTY_POOR : JUDGE_NONE;
        } else {
          judge = classifyJudge(dmUs, set);
          if (judge === JUDGE_NONE && set.ms && dmUs >= set.ms[0] && dmUs <= set.ms[1]) {
            judge = JUDGE_MISS_POOR;
          }
          if (
            ignoresLateLongNoteHeadBad(this.config, judge, dmUs < 0, note.isLong ? (note.longStyle ?? 1) : undefined)
          ) {
            // LR2: long-note heads have no late BAD — the press falls through.
            judge = JUDGE_NONE;
          }
        }
        if (judge === JUDGE_NONE) continue;
        candidates.push({ lane, note, dmUs, judge });
      }
    }
    if (candidates.length === 0) {
      return undefined;
    }
    candidates.sort((left, right) => left.note.timeUs - right.note.timeUs);

    let best: SelectionCandidate | undefined;
    for (const candidate of candidates) {
      if (!best) {
        best = candidate;
        continue;
      }
      const bestScoreable = best.judge < JUDGE_MISS_POOR;
      const candScoreable = candidate.judge < JUDGE_MISS_POOR;
      if (!bestScoreable) {
        if (candScoreable) {
          best = candidate;
        } else if (Math.abs(candidate.dmUs) < Math.abs(best.dmUs)) {
          best = candidate;
        }
        continue;
      }
      if (!candScoreable) {
        continue;
      }
      if (this.shouldSwitchCandidate(best, candidate, timeUs, windows)) {
        best = candidate;
      }
    }
    return best;
  }

  private shouldSwitchCandidate(
    best: SelectionCandidate,
    candidate: SelectionCandidate,
    timeUs: number,
    windows: RulesetWindowTables,
  ): boolean {
    const toSelection = (entry: SelectionCandidate): JudgeSelectionCandidate => ({
      noteTimeUs: entry.note.timeUs,
      dmUs: entry.dmUs,
      // Only scoreable candidates reach this comparison, so the classification is a real judge index.
      judge: entry.judge as RulesetJudgeIndex,
      windows: windowSetFor(entry, windows),
    });
    return preferJudgeCandidate(this.config.selection, toSelection(best), toSelection(candidate), timeUs);
  }

  /** LR2's forward tap chain: every BAD reuses this press for the next tap, until a non-BAD stops it. */
  private applyLR2RejudgeChain(
    lane: SimLane,
    timeUs: number,
    windows: RulesetWindowTables,
    consumed: SimNote,
    consumedJudge: RulesetJudgeIndex,
  ): void {
    if (consumedJudge !== JUDGE_BAD || consumed.isLong || this.closed()) return;
    const set = selectJudgeWindowSet(windows, { scratch: lane.scratch });
    const bad = set.judges[JUDGE_BAD]!;
    for (let index = lane.notes.indexOf(consumed) + 1; index < lane.notes.length; index += 1) {
      const note = lane.notes[index]!;
      if (note.judged || note.holding) continue;
      if (note.isLong) break;
      const deltaUs = note.timeUs - timeUs;
      if (deltaUs < bad[0] || deltaUs > bad[1]) break;
      const judge = classifyRulesetJudge(deltaUs, set);
      if (judge === RULESET_JUDGE_NONE || judge > JUDGE_BAD) break;
      note.judged = true;
      this.judgingAt(timeUs, lane, note);
      this.applyJudge(judge, deltaUs);
      if (judge !== JUDGE_BAD || this.closed()) break;
    }
  }

  /**
   * Judging has stopped: the survival gauge emptied in a play that ends on failure. Nothing after the judgment that
   * emptied it counts, as in the engine (`isJudgingClosed`).
   */
  private closed(): boolean {
    return this.endOnFailure && this.gauge.failedMidPlay;
  }

  /** Where the next judgment happens, for the {@link observer}. */
  private judgingAt(atUs: number, lane: SimLane | undefined, note: SimNote | undefined): void {
    this.judgeAtUs = atUs;
    this.judgeLane = lane;
    this.judgeNote = note;
  }

  private applyJudge(judgeIndex: GaugeJudgeIndex, dmUs: number | undefined): void {
    if (this.closed()) return;
    this.counts[judgeIndex]! += 1;
    if (judgeIndex === JUDGE_PGREAT) {
      this.exScore += 2;
    } else if (judgeIndex === JUDGE_GREAT) {
      this.exScore += 1;
    }
    const course = this.course;
    if (judgeIndex <= JUDGE_GOOD) {
      this.combo += 1;
      if (this.combo > this.maxCombo) {
        this.maxCombo = this.combo;
      }
      if (course !== undefined) {
        course.combo += 1;
        course.maxCombo = Math.max(course.maxCombo, course.combo);
      }
    } else if (
      judgeIndex === JUDGE_BAD ||
      judgeIndex === JUDGE_MISS_POOR ||
      (judgeIndex === JUDGE_EMPTY_POOR && this.config.comboBreaksOnEmptyPoor)
    ) {
      this.combo = 0;
      if (course !== undefined) course.combo = 0;
    }
    if (dmUs !== undefined && (judgeIndex === JUDGE_GREAT || judgeIndex === JUDGE_GOOD)) {
      // A delta of exactly 0 is neither, as in the engine (it is always inside PGREAT, so this is only consistency).
      if (dmUs > 0) {
        this.fast += 1;
      } else if (dmUs < 0) {
        this.slow += 1;
      }
    }
    this.gauge.applyJudge(judgeIndex);
    if (this.observer !== undefined) this.notifyJudgment(judgeIndex, dmUs);
  }

  private notifyJudgment(judgeIndex: GaugeJudgeIndex, dmUs: number | undefined): void {
    const note = judgeIndex === JUDGE_EMPTY_POOR ? undefined : this.judgeNote;
    const max = this.gauge.spec.max;
    this.observer!({
      atUs: this.judgeAtUs,
      judgment: JUDGMENT_KINDS[judgeIndex]!,
      ...(this.judgeLane !== undefined ? { channel: this.judgeLane.channel } : {}),
      ...(note !== undefined ? { noteTimeUs: note.timeUs } : {}),
      settlesNote: note?.judged === true,
      ...(dmUs !== undefined ? { deltaUs: dmUs } : {}),
      combo: this.combo,
      maxCombo: this.maxCombo,
      exScore: this.exScore,
      gauge: max === 100 ? this.gauge.value : max > 0 ? (this.gauge.value / max) * 100 : 0,
    });
  }
}

function classifyJudge(dmUs: number, set: JudgeWindowSetUs): JudgeClassification {
  const judge = classifyRulesetJudge(dmUs, set);
  return judge === RULESET_JUDGE_NONE ? JUDGE_NONE : judge;
}

function windowSetFor(candidate: SelectionCandidate, windows: RulesetWindowTables): JudgeWindowSetUs {
  return selectJudgeWindowSet(windows, { scratch: candidate.lane.scratch });
}

/** Play-mode layout per leading key count, for lane-mode strings that are not a layout label (`'7keys'`, `'14K'`). */
const LAYOUT_BY_KEY_COUNT: Readonly<Record<string, PlayModeLayoutId>> = {
  '5': '5',
  '7': '7',
  '9': '9-pms',
  '10': '10',
  '14': '14',
  '24': '24',
  '48': '48',
};

/**
 * The scratch lanes of a recorded lane mode: the lanes the play-mode table marks `scratch` in the layout the engine
 * played (`ReplayChart.laneMode` is its label), the same set the engine binds as scratch. Other spellings resolve by
 * their leading key count, as the ruleset reads the lane mode, with 7 KEY for anything else.
 */
function resolveScratchChannels(laneMode: string): ReadonlySet<string> {
  const layout =
    Object.values(PLAY_MODE_LAYOUTS).find((candidate) => candidate.label === laneMode) ??
    PLAY_MODE_LAYOUTS[LAYOUT_BY_KEY_COUNT[/^\d+/.exec(laneMode)?.[0] ?? ''] ?? '7'];
  return new Set(layout.lanes.filter((lane) => lane.kind === 'scratch').map((lane) => lane.channel));
}

/**
 * Index of a lane's first note a press at `timeUs` can reach: the first whose `timeUs - pressUs` is not below `lateUs`
 * (the window's late edge, negative). A lane's notes are sorted by time, so a binary search finds it where a walk from
 * the lane's start would cost every note already passed, on every press.
 */
function firstNoteInReach(notes: readonly SimNote[], pressUs: number, lateUs: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (notes[middle]!.timeUs - pressUs < lateUs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
