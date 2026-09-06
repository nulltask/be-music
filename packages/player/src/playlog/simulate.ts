import { resolveIidxRankLabel } from '../core/scoring.ts';
import type { BeMusicPlaylog, PlaylogInputEvent, PlaylogRulesetResult } from './format.ts';
import {
  classifyRulesetJudge,
  judgeWindowLateReachUs,
  preferJudgeCandidate,
  RULESET_JUDGE_NONE,
  RulesetGauge,
  selectJudgeWindowSet,
  type GaugeJudgeIndex,
  type JudgeSelectionCandidate,
  type RulesetJudgeIndex,
} from '../ruleset/index.ts';
import {
  resolveRulesetConfig,
  type JudgeWindowSetUs,
  type PlaylogRulesetId,
  type ResolveRulesetOptions,
  type RulesetConfig,
  type RulesetWindowTables,
} from './rulesets.ts';

export type { PlaylogRulesetId, BeatorajaJudgeAlgorithm, ResolveRulesetOptions } from './rulesets.ts';
export {
  resolveRulesetConfig,
  resolveLr2DefaultTotal,
  resolveBeatorajaDefaultTotal,
  resolveIidxGaugeUnit,
  resolveLr2HardDamageMultiplier,
  resolveBeatorajaHardRecoverMultiplier,
} from './rulesets.ts';

export interface SimulatePlaylogOptions extends ResolveRulesetOptions {
  ruleset: PlaylogRulesetId;
}

export const PLAYLOG_SIMULATOR_RULESETS: readonly PlaylogRulesetId[] = ['lr2', 'beatoraja', 'iidx'];

/**
 * Re-derives one ruleset's judgments / EX-SCORE / combo / gauge from a playlog's canonical data (resolved chart +
 * raw input stream + play settings). Pure function — never mutates the playlog.
 *
 * The LR2 simulation follows lr2oraja / OpenLR2 semantics, the beatoraja simulation the current beatoraja master,
 * and the IIDX simulation the community-measured behavior of recent arcade versions (with documented stand-ins
 * where no measurement exists — see `rulesets.ts`).
 */
export function simulatePlaylog(playlog: BeMusicPlaylog, options: SimulatePlaylogOptions): PlaylogRulesetResult {
  const config = resolveRulesetConfig(playlog, options.ruleset, options);
  return new PlaylogSimulation(playlog, config).run();
}

/** Runs {@link simulatePlaylog} for each requested ruleset (default: LR2, beatoraja, IIDX). */
export function simulatePlaylogRulesets(
  playlog: BeMusicPlaylog,
  rulesets: readonly PlaylogRulesetId[] = PLAYLOG_SIMULATOR_RULESETS,
  options: ResolveRulesetOptions = {},
): Record<string, PlaylogRulesetResult> {
  const results: Record<string, PlaylogRulesetResult> = {};
  for (const ruleset of rulesets) {
    results[ruleset] = simulatePlaylog(playlog, { ...options, ruleset });
  }
  return results;
}

// Judge indices follow beatoraja: 0 PG / 1 GR / 2 GD / 3 BD / 4 missed POOR / 5 empty POOR.
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

interface SimNote {
  timeUs: number;
  endTimeUs?: number;
  scratch: boolean;
  isLong: boolean;
  /** Resolved long-note style for this ruleset (1 LN / 2 CN / 3 HCN). */
  longStyle?: SimLongStyle;
  judged: boolean;
  holding: boolean;
  /** Miss-sweep deadline (input time past which the head can no longer be judged). */
  missDeadlineUs: number;
}

interface SimMine {
  timeUs: number;
  damage: number;
  applied: boolean;
}

interface ActiveHold {
  note: SimNote;
  /** Deferred LN head judge (style 1). */
  headJudge?: GaugeJudgeIndex;
  headDmUs?: number;
  /** IIDX charge heads that BAD/POOR'd skip the tail — such notes never become holds. */
  /** Held-past-end deadline for charge tails. */
  tailMissDeadlineUs: number;
  /** Signed HCN tick accumulator (µs). */
  hcnCounterUs: number;
}

interface SimLane {
  channel: string;
  scratch: boolean;
  notes: SimNote[];
  mines: SimMine[];
  sweepCursor: number;
  mineCursor: number;
  held: boolean;
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

class PlaylogSimulation {
  private readonly lanes = new Map<string, SimLane>();
  private readonly counts = [0, 0, 0, 0, 0, 0];
  private readonly gauge: RulesetGauge;
  private combo = 0;
  private maxCombo = 0;
  private fast = 0;
  private slow = 0;
  private exScore = 0;
  private lastAdvanceUs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly playlog: BeMusicPlaylog,
    private readonly config: RulesetConfig,
  ) {
    this.gauge = new RulesetGauge(config.gauge);
    this.buildLanes();
  }

  run(): PlaylogRulesetResult {
    const reversalUs = this.playlog.chart.reversalTimeUs;
    const inputs = [...this.playlog.inputs].sort((left, right) => left.timeUs - right.timeUs || left.seq - right.seq);
    for (const input of inputs) {
      if (reversalUs !== undefined && input.timeUs >= reversalUs) {
        // LR2 negative-BPM reversal (#134): the judge clock died here during the recorded run — later inputs only
        // replayed keysounds. `advanceTime` is clamped to the same point, so the remaining chart stays unjudged.
        continue;
      }
      this.advanceTime(input.timeUs);
      if (input.action === 'down') {
        this.handleDown(input);
      } else {
        this.handleUp(input);
      }
    }
    this.advanceTime(Number.POSITIVE_INFINITY);

    const result: PlaylogRulesetResult = {
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
      djLevel: resolveIidxRankLabel(this.exScore, this.config.noteCount),
      gauge: {
        type: this.config.gauge.id,
        final: Math.round(this.gauge.value * 100) / 100,
        cleared: this.gauge.cleared(),
      },
    };
    if (this.gauge.failedMidPlay) {
      result.gauge.failedMidPlay = true;
    }
    if (this.config.moneyScore) {
      const notes = Math.max(1, this.config.noteCount);
      result.score = Math.floor(
        ((4 * this.counts[JUDGE_PGREAT]! + 2 * this.counts[JUDGE_GREAT]! + this.counts[JUDGE_GOOD]!) * 50000) / notes,
      );
    }
    return result;
  }

  private buildLanes(): void {
    const autoPlay = this.playlog.play.mode === 'auto';
    const autoScratch = this.playlog.play.autoScratch;
    for (const note of this.playlog.chart.notes) {
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
      const longStyle = isLong ? this.resolveLongStyle(note.lnMode ?? this.playlog.chart.lnMode) : undefined;
      const windows = this.config.windowsAt(note.timeUs);
      const noteWindows = selectJudgeWindowSet(windows, { scratch: lane.scratch });
      const simNote: SimNote = {
        timeUs: note.timeUs,
        scratch: lane.scratch,
        isLong,
        judged: false,
        holding: false,
        missDeadlineUs: note.timeUs + judgeWindowLateReachUs(noteWindows),
      };
      if (isLong) {
        simNote.endTimeUs = note.endTimeUs;
        simNote.longStyle = longStyle;
      }
      lane.notes.push(simNote);
    }
    for (const lane of this.lanes.values()) {
      lane.notes.sort((left, right) => left.timeUs - right.timeUs);
      lane.mines.sort((left, right) => left.timeUs - right.timeUs);
    }
  }

  private laneFor(channel: string, autoPlay: boolean, autoScratch: boolean): SimLane {
    let lane = this.lanes.get(channel);
    if (!lane) {
      const scratch = channel === '16' || channel === '26';
      lane = {
        channel,
        scratch,
        notes: [],
        mines: [],
        sweepCursor: 0,
        mineCursor: 0,
        held: false,
        auto: autoPlay || (autoScratch && scratch),
        autoCursor: 0,
      };
      this.lanes.set(channel, lane);
    }
    return lane;
  }

  private resolveLongStyle(chartMode: SimLongStyle): SimLongStyle {
    switch (this.config.longNoteStyle) {
      case 'ln':
        return 1;
      case 'charge':
        return chartMode === 3 ? 3 : 2;
      default:
        return chartMode;
    }
  }

  // ---- time advancement --------------------------------------------------------------------------------------

  private advanceTime(untilUs: number): void {
    const reversalUs = this.playlog.chart.reversalTimeUs;
    if (reversalUs !== undefined && untilUs > reversalUs) {
      // Judging froze at the LR2 reversal: misses, mines, holds, and auto judgements past it never happen.
      untilUs = reversalUs;
    }
    interface TimedEvent {
      timeUs: number;
      kind: 'miss' | 'mine' | 'hold-deadline' | 'auto';
      lane: SimLane;
      note?: SimNote;
      mine?: SimMine;
    }
    const events: TimedEvent[] = [];
    for (const lane of this.lanes.values()) {
      if (lane.auto) {
        for (let index = lane.autoCursor; index < lane.notes.length; index += 1) {
          const note = lane.notes[index]!;
          if (note.timeUs >= untilUs) break;
          // LN-style longs score once at the tail; everything else at the head. (Charge-style auto applies the
          // head and tail PGREATs together at the head — a simplification that only shifts gauge gain earlier.)
          const autoAt = note.isLong && note.longStyle === 1 ? note.endTimeUs! : note.timeUs;
          if (autoAt >= untilUs) continue;
          events.push({ timeUs: autoAt, kind: 'auto', lane, note });
        }
      } else {
        for (let index = lane.sweepCursor; index < lane.notes.length; index += 1) {
          const note = lane.notes[index]!;
          if (note.missDeadlineUs >= untilUs) break;
          if (!note.judged && !note.holding) {
            events.push({ timeUs: note.missDeadlineUs, kind: 'miss', lane, note });
          }
        }
        if (lane.hold && lane.hold.tailMissDeadlineUs < untilUs) {
          events.push({ timeUs: lane.hold.tailMissDeadlineUs, kind: 'hold-deadline', lane, note: lane.hold.note });
        }
      }
      for (let index = lane.mineCursor; index < lane.mines.length; index += 1) {
        const mine = lane.mines[index]!;
        if (mine.timeUs >= untilUs) break;
        events.push({ timeUs: mine.timeUs, kind: 'mine', lane, mine });
      }
    }
    events.sort((left, right) => left.timeUs - right.timeUs);

    for (const event of events) {
      if (event.kind === 'auto') {
        const note = event.note!;
        if (note.judged) continue;
        note.judged = true;
        this.applyJudge(JUDGE_PGREAT, undefined);
        if (note.isLong && note.longStyle !== 1) {
          // Charge styles judge head and tail; auto play scores both as PGREAT.
          this.applyJudge(JUDGE_PGREAT, undefined);
        }
      } else if (event.kind === 'miss') {
        const note = event.note!;
        if (note.judged || note.holding) continue;
        note.judged = true;
        this.applyJudge(JUDGE_MISS_POOR, undefined);
        if (note.isLong && note.longStyle !== 1 && !this.config.headBadSkipsTail) {
          // beatoraja: a missed CN/HCN head also POORs the tail. IIDX (headBadSkipsTail) skips it.
          this.applyJudge(JUDGE_MISS_POOR, undefined);
        }
      } else if (event.kind === 'mine') {
        const mine = event.mine!;
        if (mine.applied) continue;
        mine.applied = true;
        if (event.lane.held && mine.damage > 0) {
          this.gauge.applyRawDelta(-mine.damage);
        }
      } else {
        // Charge tail held past its late window — the tail resolves as a missed POOR (beatoraja / IIDX).
        const lane = event.lane;
        const hold = lane.hold;
        if (!hold || hold.note !== event.note) continue;
        this.integrateHcn(lane, event.timeUs);
        lane.hold = undefined;
        hold.note.holding = false;
        hold.note.judged = true;
        this.applyJudge(JUDGE_MISS_POOR, undefined);
      }
    }

    // LN (style 1) holds confirm their deferred head judgment once the tail time is reached while still held.
    for (const lane of this.lanes.values()) {
      const hold = lane.hold;
      if (hold && hold.note.longStyle === 1 && hold.note.endTimeUs! < untilUs) {
        this.integrateHcn(lane, hold.note.endTimeUs!);
        lane.hold = undefined;
        hold.note.holding = false;
        hold.note.judged = true;
        this.applyJudge(hold.headJudge ?? JUDGE_BAD, hold.headDmUs);
      }
      this.integrateHcn(lane, untilUs);
    }

    // Advance sweep cursors past settled notes.
    for (const lane of this.lanes.values()) {
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

  /** Integrates the beatoraja-model HCN hold ticks for a lane up to `untilUs`. */
  private integrateHcn(lane: SimLane, untilUs: number): void {
    const hold = lane.hold;
    if (!hold || hold.note.longStyle !== 3) return;
    const from = Math.max(hold.note.timeUs, this.lastAdvanceUs === Number.NEGATIVE_INFINITY ? 0 : this.lastAdvanceUs);
    const to = Math.min(untilUs, hold.note.endTimeUs!);
    if (!(to > from)) return;
    let dt = to - from;
    const tick = this.config.hcnTickUs;
    if (lane.held) {
      hold.hcnCounterUs += dt;
      while (hold.hcnCounterUs > tick) {
        this.gauge.applyJudge(this.config.hcnTick.heldJudge as GaugeJudgeIndex, this.config.hcnTick.heldRate);
        hold.hcnCounterUs -= tick;
      }
    } else {
      hold.hcnCounterUs -= dt;
      while (hold.hcnCounterUs < -tick) {
        this.gauge.applyJudge(this.config.hcnTick.releasedJudge as GaugeJudgeIndex, this.config.hcnTick.releasedRate);
        hold.hcnCounterUs += tick;
      }
    }
  }

  // ---- input handling ----------------------------------------------------------------------------------------

  private handleDown(input: PlaylogInputEvent): void {
    const timeUs = input.timeUs;
    const windows = this.config.windowsAt(timeUs);
    const lanes = this.resolveInputLanes(input);
    for (const lane of lanes) {
      lane.held = true;
    }
    if (lanes.length === 0) {
      return;
    }

    const selected = this.selectCandidate(lanes, timeUs, windows);
    if (!selected) {
      return;
    }
    if (selected.judge >= JUDGE_MISS_POOR) {
      // Empty POOR — the note is never consumed.
      this.applyJudge(JUDGE_EMPTY_POOR, undefined);
      return;
    }

    const { note, lane, dmUs } = selected;
    if (note.isLong) {
      this.startLongNote(lane, note, selected.judge, dmUs);
    } else {
      note.judged = true;
      this.applyJudge(selected.judge, dmUs);
    }
    if (this.config.multiBad) {
      this.applyMultiBad(lanes, timeUs, windows, note, selected.judge);
    }
  }

  private handleUp(input: PlaylogInputEvent): void {
    const timeUs = input.timeUs;
    for (const lane of this.resolveInputLanes(input)) {
      lane.held = false;
      const hold = lane.hold;
      if (!hold) continue;
      this.integrateHcn(lane, timeUs);
      const note = hold.note;
      const endWindows = selectJudgeWindowSet(this.config.windowsAt(timeUs), {
        scratch: note.scratch,
        longNoteEnd: true,
      });
      const dmUs = note.endTimeUs! - timeUs;
      const endJudge = classifyJudge(dmUs, endWindows);
      lane.hold = undefined;
      note.holding = false;
      note.judged = true;
      if (note.longStyle === 1) {
        // LN: worse of head and tail; an early release outside the GOOD reach is a BAD.
        const tailJudge: GaugeJudgeIndex = endJudge === JUDGE_NONE ? JUDGE_MISS_POOR : endJudge;
        const headJudge: GaugeJudgeIndex = hold.headJudge ?? JUDGE_BAD;
        let judge: GaugeJudgeIndex = worseJudge(tailJudge, headJudge);
        if (judge >= JUDGE_BAD && dmUs > 0) {
          judge = JUDGE_BAD;
        }
        const worseDm = hold.headDmUs !== undefined && Math.abs(hold.headDmUs) > Math.abs(dmUs) ? hold.headDmUs : dmUs;
        this.applyJudge(judge > JUDGE_MISS_POOR ? JUDGE_MISS_POOR : judge, worseDm);
      } else {
        // CN / HCN tail: judged by the release timing; early releases beyond the windows are POOR.
        const judge = endJudge === JUDGE_NONE ? JUDGE_MISS_POOR : endJudge;
        this.applyJudge(judge, dmUs);
      }
    }
  }

  private resolveInputLanes(input: PlaylogInputEvent): SimLane[] {
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
        hcnCounterUs: 0,
      };
      return;
    }
    // Charge styles score the head immediately.
    this.applyJudge(judge, dmUs);
    if (this.config.headBadSkipsTail && judge >= JUDGE_BAD) {
      // IIDX: a BAD head cancels the tail judgment entirely.
      note.judged = true;
      return;
    }
    note.holding = true;
    const endWindows = selectJudgeWindowSet(this.config.windows, { scratch: note.scratch, longNoteEnd: true });
    lane.hold = {
      note,
      tailMissDeadlineUs: note.endTimeUs! + judgeWindowLateReachUs(endWindows),
      hcnCounterUs: 0,
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
      for (const note of lane.notes) {
        const dmUs = note.timeUs - timeUs;
        if (dmUs < scanLate) continue;
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
            this.config.ignoreLateBadOnLnHead &&
            judge === JUDGE_BAD &&
            dmUs < 0 &&
            note.isLong &&
            (note.longStyle ?? 1) === 1
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

  /**
   * lr2oraja `MultiBadCollector`: after the press consumed `tnote`, every other unjudged note inside the BAD
   * window but outside the GOOD window also resolves as a BAD — with the collector's own pruning rules.
   */
  private applyMultiBad(
    lanes: readonly SimLane[],
    timeUs: number,
    windows: RulesetWindowTables,
    tnote: SimNote,
    tnoteJudge: number,
  ): void {
    const extras: Array<{ note: SimNote }> = [];
    for (const lane of lanes) {
      const set = selectJudgeWindowSet(windows, { scratch: lane.scratch });
      const badWindow = set.judges[JUDGE_BAD]!;
      const goodWindow = set.judges[JUDGE_GOOD]!;
      for (const note of lane.notes) {
        const dmUs = note.timeUs - timeUs;
        if (dmUs < badWindow[0]) continue;
        if (dmUs > badWindow[1]) break;
        if (note.judged || note.holding || note === tnote) continue;
        if (dmUs >= goodWindow[0] && dmUs <= goodWindow[1]) continue;
        extras.push({ note });
      }
    }
    if (extras.length === 0) return;
    extras.sort((left, right) => left.note.timeUs - right.note.timeUs);
    const tnoteIsBad = tnoteJudge === JUDGE_BAD;
    const filtered = extras.filter(({ note }) => {
      if ((!tnoteIsBad || tnote.isLong) && note.timeUs > tnote.timeUs) return false;
      if (note.isLong && note.timeUs < tnote.timeUs) return false;
      return true;
    });
    for (const { note } of filtered) {
      note.judged = true;
      this.applyJudge(JUDGE_BAD, undefined);
      if (note.isLong && (note.longStyle ?? 1) !== 1 && !this.config.headBadSkipsTail) {
        this.applyJudge(JUDGE_MISS_POOR, undefined);
      }
    }
  }

  private applyJudge(judgeIndex: GaugeJudgeIndex, dmUs: number | undefined): void {
    this.counts[judgeIndex]! += 1;
    if (judgeIndex === JUDGE_PGREAT) {
      this.exScore += 2;
    } else if (judgeIndex === JUDGE_GREAT) {
      this.exScore += 1;
    }
    if (judgeIndex <= JUDGE_GOOD) {
      this.combo += 1;
      if (this.combo > this.maxCombo) {
        this.maxCombo = this.combo;
      }
    } else if (judgeIndex === JUDGE_BAD || judgeIndex === JUDGE_MISS_POOR) {
      this.combo = 0;
    } else if (judgeIndex === JUDGE_EMPTY_POOR && this.config.comboBreaksOnEmptyPoor) {
      this.combo = 0;
    }
    if (dmUs !== undefined && (judgeIndex === JUDGE_GREAT || judgeIndex === JUDGE_GOOD)) {
      if (dmUs > 0) {
        this.fast += 1;
      } else {
        this.slow += 1;
      }
    }
    this.gauge.applyJudge(judgeIndex);
  }
}

function classifyJudge(dmUs: number, set: JudgeWindowSetUs): JudgeClassification {
  const judge = classifyRulesetJudge(dmUs, set);
  return judge === RULESET_JUDGE_NONE ? JUDGE_NONE : judge;
}

/** The worse (numerically larger) of two judgments — the judge indices are ordered best-to-worst. */
function worseJudge(left: GaugeJudgeIndex, right: GaugeJudgeIndex): GaugeJudgeIndex {
  return left >= right ? left : right;
}

function windowSetFor(candidate: SelectionCandidate, windows: RulesetWindowTables): JudgeWindowSetUs {
  return selectJudgeWindowSet(windows, { scratch: candidate.lane.scratch });
}
