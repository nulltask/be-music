/**
 * A ghost's timeline: what a recorded play does over chart time, re-derived from its replay for a ghost to play back
 * beside a live play. Its notes as the replay played them (its own lane options), each with the second the replay
 * simulation settled it; its judgments in order with the running totals (`resolveReplayJudgmentTimeline`); and its key
 * presses and releases. Pure: the same replay gives the same timeline, whatever presents it.
 */

import type { LongNoteMode } from '@be-music/chart-model';
import {
  resolveReplayJudgmentTimeline,
  type BeMusicReplay,
  type ReplayJudgmentKind,
  type RulesetId,
} from '@be-music/player-engine/replay';
import type { JudgmentKind } from '@be-music/player-engine/ruleset';

/** One of the replay's notes: its lane and times (chart seconds), and when the replay settled it. */
export interface GhostNoteTiming {
  /** The lane the replay played it on (after its lane options). */
  readonly channel: string;
  readonly seconds: number;
  /** A long note's tail. */
  readonly endSeconds?: number;
  readonly longNoteMode?: LongNoteMode;
  /** When the replay settled it (hit, released or missed); absent for a note it never settled. */
  readonly settledAtSeconds?: number;
}

/** The judgment counts so far, as a score readout shows them. */
export interface GhostJudgmentCounts {
  readonly perfect: number;
  readonly great: number;
  readonly good: number;
  readonly bad: number;
  readonly poor: number;
  readonly emptyPoor: number;
}

/** One judgment of the replay, with the running totals just after it. */
export interface GhostJudgmentStep {
  readonly seconds: number;
  /** The judgment as a plate shows it; an empty POOR shows as POOR. */
  readonly judgment: JudgmentKind;
  readonly emptyPoor: boolean;
  readonly channel?: string;
  readonly combo: number;
  readonly maxCombo: number;
  readonly exScore: number;
  /** The gauge in percent. */
  readonly gauge: number;
  readonly counts: GhostJudgmentCounts;
}

/** A key of the replay going down or up on a lane. */
export interface GhostInputStep {
  readonly seconds: number;
  readonly channel: string;
  readonly pressed: boolean;
}

/** A ghost's timeline. See the module comment. */
export interface GhostTimeline {
  /** The replay's playable notes in chart order. */
  readonly notes: readonly GhostNoteTiming[];
  /** The replay's mines (lane and time). */
  readonly mines: readonly { readonly channel: string; readonly seconds: number }[];
  /** Every judgment in the order the simulation scored them (non-decreasing seconds). */
  readonly judgments: readonly GhostJudgmentStep[];
  /** Every press and release, in time order. */
  readonly inputs: readonly GhostInputStep[];
  /** The replay's judged notes: the EX score's denominator over two. */
  readonly noteCount: number;
  /** The gauge the replay played on. */
  readonly gaugeType: string;
  /** The ruleset it was re-simulated under. */
  readonly ruleset: RulesetId;
}

const PLATE: Readonly<Record<ReplayJudgmentKind, JudgmentKind>> = {
  pgreat: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  bad: 'BAD',
  poor: 'POOR',
  'empty-poor': 'POOR',
};

const COUNT_KEY: Readonly<Record<ReplayJudgmentKind, keyof GhostJudgmentCounts>> = {
  pgreat: 'perfect',
  great: 'great',
  good: 'good',
  bad: 'bad',
  poor: 'poor',
  'empty-poor': 'emptyPoor',
};

const NO_COUNTS: GhostJudgmentCounts = { perfect: 0, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 };

const noteKey = (channel: string, timeUs: number): string => `${channel}@${timeUs}`;

/**
 * Builds the timeline of `replay`, re-simulated under `ruleset` (the replay's own ruleset by default, so the ghost
 * scores as the recorded play did).
 */
export function buildGhostTimeline(replay: BeMusicReplay, ruleset?: RulesetId): GhostTimeline {
  const rulesetId = ruleset ?? replay.play.judgeRuleset ?? 'lr2';
  const { events, result } = resolveReplayJudgmentTimeline(replay, { ruleset: rulesetId });
  // The first judgment that settles each note is when the note goes.
  const settledAtUs = new Map<string, number>();
  let counts = NO_COUNTS;
  const judgments: GhostJudgmentStep[] = [];
  for (const event of events) {
    if (event.settlesNote && event.channel !== undefined && event.noteTimeUs !== undefined) {
      const key = noteKey(event.channel, event.noteTimeUs);
      if (!settledAtUs.has(key)) settledAtUs.set(key, event.atUs);
    }
    const countKey = COUNT_KEY[event.judgment];
    counts = { ...counts, [countKey]: counts[countKey] + 1 };
    judgments.push({
      seconds: event.atUs / 1_000_000,
      judgment: PLATE[event.judgment],
      emptyPoor: event.judgment === 'empty-poor',
      ...(event.channel !== undefined ? { channel: event.channel } : {}),
      combo: event.combo,
      maxCombo: event.maxCombo,
      exScore: event.exScore,
      gauge: event.gauge,
      counts,
    });
  }
  const notes: GhostNoteTiming[] = [];
  const mines: { channel: string; seconds: number }[] = [];
  for (const note of replay.chart.notes) {
    if (note.type === 'mine') {
      mines.push({ channel: note.channel, seconds: note.timeUs / 1_000_000 });
      continue;
    }
    if (note.type !== 'normal' && note.type !== 'long') continue;
    const settled = settledAtUs.get(noteKey(note.channel, note.timeUs));
    const long = note.type === 'long' && note.endTimeUs !== undefined && note.endTimeUs > note.timeUs;
    notes.push({
      channel: note.channel,
      seconds: note.timeUs / 1_000_000,
      ...(long ? { endSeconds: note.endTimeUs! / 1_000_000 } : {}),
      ...(long && note.lnMode !== undefined ? { longNoteMode: note.lnMode } : {}),
      ...(settled !== undefined ? { settledAtSeconds: settled / 1_000_000 } : {}),
    });
  }
  const inputs: GhostInputStep[] = [];
  const sorted = [...replay.inputs].sort((left, right) => left.timeUs - right.timeUs || left.seq - right.seq);
  for (const input of sorted) {
    for (const channel of input.channels)
      inputs.push({ seconds: input.timeUs / 1_000_000, channel, pressed: input.action === 'down' });
  }
  return {
    notes,
    mines,
    judgments,
    inputs,
    noteCount: replay.chart.noteCount,
    gaugeType: result.gauge.type,
    ruleset: rulesetId,
  };
}

/**
 * The index of the last of `steps` at or before chart second `seconds` (`-1` before the first). `steps` are in
 * non-decreasing time order.
 */
export function findGhostStepAt(steps: readonly { readonly seconds: number }[], seconds: number): number {
  let low = 0;
  let high = steps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (steps[middle]!.seconds <= seconds) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** Whether every note of `replay` is on a 1P lane: a single-play replay a ghost field can show on the 2P side. */
export function isSinglePlayReplay(replay: BeMusicReplay): boolean {
  return replay.chart.notes.every(
    (note) => note.channel.startsWith('1') || (note.type !== 'normal' && note.type !== 'long' && note.type !== 'mine'),
  );
}
