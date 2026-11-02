/**
 * The ghost as a second playfield (the first {@link GhostPresentation}): the recorded play's notes scroll on the 2P side
 * of a single-play chart, laid out like the two sides of a double-play chart (`ghost-side.ts`), and go as its replay
 * settled them. Its key beams, bombs and judgment plate follow its recorded inputs and judgments, and its score, combo
 * and gauge show as the second player's HUD. Its notes scroll with the live play's hi-speed, so a note of the ghost
 * and the live note it matches cross their judgment lines together.
 *
 * It writes its lane effects into the play's own maps under its 2P lanes (which a single-play chart never uses), and
 * gives the view a playfield that adds its lanes, notes and HUD to the live play's ({@link SidePlayfieldGhost.present}).
 * The live play's arrays and state are never touched, so the engine judges and records only the live notes.
 */

import type { TimingResolver } from '@be-music/chart-model';
import type { TimedLandmineNote, TimedPlayableNote } from '@be-music/player-engine/display';
import { createEmptyScore, type ScoreSummary } from '@be-music/player-engine/ruleset';
import { createPlayState, type PlayState } from '@be-music/player-scene-model';
import type { BeMusicJudgmentKind } from '../../../skin/be-music/types.ts';
import type { PlayfieldRuntime, RuntimeMineNote, RuntimeNote } from '../../../view/shared/playfield/context.ts';
import type { PlayJudgeSideState } from '../play-presentation.ts';
import type { GhostPresentation } from './ghost.ts';
import { toGhostChannel, type GhostSide } from './ghost-side.ts';
import { findGhostStepAt, type GhostTimeline } from './ghost-timeline.ts';
import { PresentedPlayfield } from './presented-playfield.ts';

/** How long a judgment plate stays up, in chart seconds (as the live play's). */
const PLATE_SECONDS = 0.6;
/** A step further behind the playhead than this is caught up silently: no bomb, no key beam for it. */
const EFFECT_WINDOW_SECONDS = 0.25;

/** The play's lane effects and plates the ghost writes into, under its own lanes. */
export interface SidePlayfieldGhostTarget {
  readonly keyBeamStartedAt: Map<string, number>;
  readonly keyBeamFadeStartedAt: Map<string, number>;
  readonly bombStartedAt: Map<string, number>;
  readonly bombJudge: Map<string, BeMusicJudgmentKind>;
  readonly lanePressedAt: Map<string, number>;
  readonly laneReleasedAt: Map<string, number>;
  judgeSideState: Record<'1P' | '2P', PlayJudgeSideState>;
}

/** The live chart the ghost's notes are placed on: its notes (for their beats) and its timing. */
export interface GhostFieldChart {
  readonly notes: readonly TimedPlayableNote[];
  readonly mineNotes: readonly TimedLandmineNote[];
  readonly timingResolver: Pick<TimingResolver, 'beatToSeconds'> | undefined;
}

/**
 * Chart second → beat on the live chart: a second a live note sits at gives that note's beat; any other second is
 * found on the chart's timing (the first beat at or after it), or spread between the known notes without one.
 */
export function createSecondsToBeat(
  points: readonly { readonly seconds: number; readonly beat: number }[],
  timing?: Pick<TimingResolver, 'beatToSeconds'>,
): (seconds: number) => number {
  const exact = new Map<number, number>();
  for (const point of points) {
    const key = Math.round(point.seconds * 1_000_000);
    if (!exact.has(key)) exact.set(key, point.beat);
  }
  const sorted = [...points].sort((left, right) => left.seconds - right.seconds || left.beat - right.beat);
  return (seconds) => {
    const hit = exact.get(Math.round(seconds * 1_000_000));
    if (hit !== undefined) return hit;
    if (timing !== undefined) return invertBeatToSeconds(timing, seconds);
    return interpolateBeat(sorted, seconds);
  };
}

function invertBeatToSeconds(timing: Pick<TimingResolver, 'beatToSeconds'>, seconds: number): number {
  if (seconds <= timing.beatToSeconds(0)) return 0;
  let high = 1;
  while (timing.beatToSeconds(high) < seconds && high < 1e7) high *= 2;
  let low = 0;
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (timing.beatToSeconds(middle) < seconds) low = middle;
    else high = middle;
  }
  return high;
}

function interpolateBeat(sorted: readonly { seconds: number; beat: number }[], seconds: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!.beat;
  const index = Math.min(Math.max(1, findGhostStepAt(sorted, seconds) + 1), sorted.length - 1);
  const left = sorted[index - 1]!;
  const right = sorted[index]!;
  const span = right.seconds - left.seconds;
  return span > 0 ? left.beat + ((seconds - left.seconds) / span) * (right.beat - left.beat) : left.beat;
}

/** The ghost's notes and mines, ready to draw on its lanes: copies on the 2P channels, none judged yet. */
export interface GhostField {
  /** In beat order, like the live notes. */
  readonly notes: readonly RuntimeNote[];
  readonly mines: readonly RuntimeMineNote[];
  /** `notes` indices in the order the replay settled them (unsettled notes left out). */
  readonly settleOrder: readonly number[];
  /** When each of `notes` was settled, by index. */
  readonly settledAt: readonly number[];
}

/** Places `timeline`'s notes and mines on the ghost's lanes of the live chart `chart`. */
export function buildGhostField(timeline: GhostTimeline, chart: GhostFieldChart): GhostField {
  const points: { seconds: number; beat: number }[] = [];
  for (const note of chart.notes) {
    points.push({ seconds: note.seconds, beat: note.beat });
    if (note.endSeconds !== undefined && note.endBeat !== undefined)
      points.push({ seconds: note.endSeconds, beat: note.endBeat });
  }
  for (const mine of chart.mineNotes) points.push({ seconds: mine.seconds, beat: mine.beat });
  const beatAt = createSecondsToBeat(points, chart.timingResolver);
  // The view reads nothing of a note's source event; any of the chart's keeps the type whole.
  const event = chart.notes[0]?.event ?? chart.mineNotes[0]?.event;
  const placed = timeline.notes.map((timing) => ({
    timing,
    note: {
      event: event!,
      channel: toGhostChannel(timing.channel),
      beat: beatAt(timing.seconds),
      seconds: timing.seconds,
      judged: false,
      ...(timing.endSeconds !== undefined ? { endSeconds: timing.endSeconds, endBeat: beatAt(timing.endSeconds) } : {}),
      ...(timing.longNoteMode !== undefined ? { longNoteMode: timing.longNoteMode } : {}),
    } satisfies RuntimeNote,
  }));
  placed.sort((left, right) => left.note.beat - right.note.beat || left.note.seconds - right.note.seconds);
  const notes = placed.map((entry) => entry.note);
  const settledAt = placed.map((entry) => entry.timing.settledAtSeconds ?? Number.POSITIVE_INFINITY);
  const settleOrder = settledAt
    .map((_, index) => index)
    .filter((index) => Number.isFinite(settledAt[index]!))
    .sort((left, right) => settledAt[left]! - settledAt[right]! || left - right);
  const mines = timeline.mines
    .map((mine): RuntimeMineNote => ({
      event: event!,
      channel: toGhostChannel(mine.channel),
      beat: beatAt(mine.seconds),
      seconds: mine.seconds,
      judged: false,
      mine: true,
    }))
    .sort((left, right) => left.beat - right.beat);
  return { notes, mines, settleOrder, settledAt };
}

/** Merges two beat-ordered note arrays into one, `left` first on equal beats. */
export function mergeByBeat<T extends { readonly beat: number }>(left: readonly T[], right: readonly T[]): T[] {
  const merged: T[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (j >= right.length || (i < left.length && left[i]!.beat <= right[j]!.beat)) merged.push(left[i++]!);
    else merged.push(right[j++]!);
  }
  return merged;
}

/** The second playfield. See the module comment. */
export class SidePlayfieldGhost implements GhostPresentation {
  public readonly drawsOnPlayfield = true;
  private readonly timeline: GhostTimeline;
  private readonly side: GhostSide;
  private readonly field: GhostField;
  private readonly target: SidePlayfieldGhostTarget;
  private seconds = Number.NEGATIVE_INFINITY;
  private settleCursor = 0;
  private judgmentCursor = 0;
  private inputCursor = 0;
  private secondPlayer: { score: ScoreSummary; playState: PlayState } | undefined;
  private merged: { notes: RuntimeNote[]; liveNotes: readonly RuntimeNote[] } | undefined;
  private mergedMines: { mines: RuntimeMineNote[]; liveMines: readonly RuntimeMineNote[] } | undefined;
  private readonly presented = new PresentedPlayfield();

  public constructor(timeline: GhostTimeline, side: GhostSide, field: GhostField, target: SidePlayfieldGhostTarget) {
    this.timeline = timeline;
    this.side = side;
    this.field = field;
    this.target = target;
    this.secondPlayer = this.resolveSecondPlayer(-1);
  }

  public update(seconds: number, nowMs: number): void {
    if (seconds < this.seconds) this.rewind();
    this.seconds = seconds;
    const { notes } = this.field;
    const { settleOrder, settledAt } = this.field;
    while (this.settleCursor < settleOrder.length && settledAt[settleOrder[this.settleCursor]!]! <= seconds) {
      notes[settleOrder[this.settleCursor]!]!.judged = true;
      this.settleCursor += 1;
    }
    const { inputs, judgments } = this.timeline;
    while (this.inputCursor < inputs.length && inputs[this.inputCursor]!.seconds <= seconds) {
      const input = inputs[this.inputCursor]!;
      this.inputCursor += 1;
      const channel = toGhostChannel(input.channel);
      if (!this.side.ghostChannels.has(channel)) continue;
      const recent = seconds - input.seconds <= EFFECT_WINDOW_SECONDS;
      if (input.pressed) {
        if (!recent) continue;
        this.target.lanePressedAt.set(channel, nowMs);
        this.target.keyBeamStartedAt.set(channel, nowMs);
        this.target.keyBeamFadeStartedAt.delete(channel);
      } else {
        this.target.laneReleasedAt.set(channel, nowMs);
        if (this.target.keyBeamStartedAt.has(channel)) this.target.keyBeamFadeStartedAt.set(channel, nowMs);
      }
    }
    const before = this.judgmentCursor;
    while (this.judgmentCursor < judgments.length && judgments[this.judgmentCursor]!.seconds <= seconds) {
      const step = judgments[this.judgmentCursor]!;
      this.judgmentCursor += 1;
      if (seconds - step.seconds > EFFECT_WINDOW_SECONDS) continue;
      this.target.judgeSideState['2P'] = {
        judge: step.judgment,
        until: step.seconds + PLATE_SECONDS,
        combo: step.combo,
      };
      if (step.channel !== undefined && (step.judgment === 'PERFECT' || step.judgment === 'GREAT')) {
        const channel = toGhostChannel(step.channel);
        this.target.bombStartedAt.set(channel, nowMs);
        this.target.bombJudge.set(channel, step.judgment);
      }
    }
    if (this.judgmentCursor !== before) this.secondPlayer = this.resolveSecondPlayer(this.judgmentCursor - 1);
  }

  public present(play: PlayfieldRuntime): PlayfieldRuntime {
    if (this.merged?.liveNotes !== play.notes)
      this.merged = { notes: mergeByBeat(play.notes, this.field.notes), liveNotes: play.notes };
    if (this.mergedMines?.liveMines !== play.mineNotes)
      this.mergedMines = { mines: mergeByBeat(play.mineNotes, this.field.mines), liveMines: play.mineNotes };
    return this.presented.present(play, {
      laneChannels: this.side.laneChannels,
      chartPlayVariant: this.side.playVariant,
      notes: this.merged.notes,
      mineNotes: this.mergedMines.mines,
      secondPlayer: this.secondPlayer,
    });
  }

  /** Back to the chart's start: no note settled, no effect of the ghost's left on its lanes. */
  private rewind(): void {
    for (const note of this.field.notes) note.judged = false;
    this.settleCursor = 0;
    this.judgmentCursor = 0;
    this.inputCursor = 0;
    for (const channel of this.side.ghostChannels) {
      this.target.keyBeamStartedAt.delete(channel);
      this.target.keyBeamFadeStartedAt.delete(channel);
      this.target.bombStartedAt.delete(channel);
      this.target.bombJudge.delete(channel);
      this.target.lanePressedAt.delete(channel);
      this.target.laneReleasedAt.delete(channel);
    }
    this.target.judgeSideState['2P'] = { judge: '', until: 0, combo: 0 };
    this.secondPlayer = this.resolveSecondPlayer(-1);
  }

  private resolveSecondPlayer(index: number): { score: ScoreSummary; playState: PlayState } {
    const step = index >= 0 ? this.timeline.judgments[index] : undefined;
    const counts = step?.counts;
    const score: ScoreSummary = {
      ...createEmptyScore(this.timeline.noteCount),
      ...(counts !== undefined
        ? {
            perfect: counts.perfect,
            great: counts.great,
            good: counts.good,
            bad: counts.bad,
            poor: counts.poor,
            emptyPoor: counts.emptyPoor,
          }
        : {}),
      exScore: step?.exScore ?? 0,
    };
    const playState: PlayState = {
      ...createPlayState(),
      gaugeType: this.timeline.gaugeType,
      gauge: step?.gauge ?? this.timeline.judgments[0]?.gauge ?? 0,
      exScore: score.exScore,
      combo: step?.combo ?? 0,
      maxCombo: step?.maxCombo ?? 0,
    };
    return { score, playState };
  }
}
