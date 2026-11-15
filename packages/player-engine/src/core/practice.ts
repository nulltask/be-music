import { createBeatAtSecondsResolverFromTimingResolver, type ResolvedChart } from '@be-music/chart-model';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import type { BeatorajaGaugeCategory } from '../ruleset/definitions.ts';
import type { PracticeGaugePick } from '../ruleset/practice-gauge.ts';
import type { RulesetNoteCounts } from '../ruleset/facts.ts';
import { moveNotesToBackground } from './background-notes.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

/**
 * PRACTICE, beatoraja 0.8.9's mode (`PracticeConfiguration.PracticeProperty`), under every judge ruleset (#933): the
 * range played and the play rules set for it, read under the judge ruleset (`PracticeRules`). Its frequency is the
 * play's tempo and its lane options are the play's own.
 */
export interface PlayPractice {
  /** Where the range starts (beatoraja's `START TIME`), in chart milliseconds: the Be-Music player's first bar picked. */
  startMs: number;
  /**
   * Where the range ends (beatoraja's `END TIME`), in chart milliseconds: the line closing the last bar picked; absent
   * is the source default, the chart's last timeline + 1000.
   */
  endMs?: number;
  /**
   * `GAUGE TYPE`: one of the judge ruleset's `resolvePracticeGaugeTypes`, or another source's qualified with it
   * (`beatoraja:ASSIST-EASY`), which plays on that source's gauge and TOTAL reading.
   */
  gauge: PracticeGaugePick;
  /** `GAUGE CATEGORY` (beatoraja only); absent uses the play mode's. */
  gaugeCategory?: BeatorajaGaugeCategory;
  /** `GAUGE VALUE`. */
  startGauge: number;
  /** `JUDGERANK`, a judgerank percent read on the ruleset's own table; absent keeps the chart's. */
  judgeRank?: number;
  /** `TOTAL`; absent keeps the chart's. */
  total?: number;
  /**
   * How many bars before the range the play starts, as a rest before its first note (0 starts at the range's head):
   * the bars are played with no judged note. Absent is 1, as it was before it was a setting.
   */
  restBarsBefore?: number;
  /** How many bars after the range the play ends, as a rest after its last note (0 ends at the range's end); absent is 1. */
  restBarsAfter?: number;
  /**
   * Keeps a long note that started before the range and ends in it, instead of moving it to the background with the
   * rest of what lies outside (`applyPracticeRange`): the play starts early enough to play it from its head
   * (`resolvePracticePlayWindow`). A Be-Music extension: beatoraja's `PracticeModifier` drops it. Absent is `false`.
   */
  carriedLongNotes?: boolean;
  /**
   * Plays the range again in place each time it ends, until the play is interrupted (#949): once the play's end (the
   * head of the bar after the one `END TIME` lies in, `resolvePracticePlayWindow`) is reached and judged, or its gauge
   * empties, the play goes back to its start (the head of the bar before the range's) with the score, combo and gauge of the practice settings, as a seek there does (`restartPractice`).
   * With an `END TIME` the loop is seamless: the play goes back the moment it reaches its end, carrying the time it
   * overshot, without waiting for the last notes' judgment, and the next round's notes come down the lane before it
   * (`resolvePracticeLoopShift`), as if the chart went on that way.
   * Absent, the play ends there as any other does.
   */
  loop?: boolean;
}

/** The range `PracticeModifier` keeps, in milliseconds, after the source's limits on the two times. */
export function resolvePracticeRange(practice: PlayPractice, chartEndMs: number): { startMs: number; endMs: number } {
  const startMs = Math.max(0, Math.trunc(practice.startMs));
  const endMs = Math.max(startMs + 1000, Math.trunc(practice.endMs ?? chartEndMs + 1000));
  return { startMs, endMs };
}

/** The most bars {@link resolvePracticePlayWindow} walks, against a chart whose bar heads stop moving forwards. */
const MAX_PRACTICE_BARS = 100_000;

/**
 * The chart millisecond bar `measure` starts at, whole as PRACTICE's times are (the bars picked start there): the
 * resolved chart's bar line there (its `#xxx02` measure lengths or bmson lines), timed through its BPM changes and the
 * stops before it. A bar past the chart's last measure is a 4/4 bar.
 */
function barHeadMs(chart: Pick<ResolvedChart, 'beatResolver' | 'timing'>, measure: number): number {
  const seconds = chart.timing.beatToSeconds(chart.beatResolver.measureToBeat(measure, 0));
  return Math.max(0, Math.floor(seconds * 1000 + 1e-6));
}

/** The bar chart millisecond `ms` lies in: the last bar starting at or before it. */
function barIndexAt(chart: Pick<ResolvedChart, 'beatResolver' | 'timing'>, ms: number): number {
  let measure = 0;
  let next = barHeadMs(chart, 1);
  while (measure < MAX_PRACTICE_BARS && next <= ms) {
    const after = barHeadMs(chart, measure + 2);
    measure += 1;
    // A bar head that stops moving forwards (a zero tempo) ends the walk.
    if (after <= next) break;
    next = after;
  }
  return measure;
}

/** `bars` as a whole number of rest bars: 1 when absent, never negative. */
function restBarCount(bars: number | undefined): number {
  return bars === undefined || !Number.isFinite(bars) ? 1 : Math.max(0, Math.trunc(bars));
}

/**
 * Where a PRACTICE play starts and ends, in chart seconds, measured in bars (#954): it starts `restBarsBefore` bars
 * (1 by default) before the one the range starts in (the chart's start when that reaches past the first bar), and ends
 * at the head of the bar `restBarsAfter` bars after the one its `END TIME` lies in, so a range snapped to bar lines
 * plays that many whole bars on either side; 0 starts and ends at the range itself. The first round
 * (`firstStartSeconds`) starts a bar before the range even with no rest before it. Without an `END TIME` (to the
 * chart's end) one bar of rest ends 1000 ms past the range's end, as before. beatoraja starts 1000 ms before the range
 * and ends 1000 ms past it instead. With `carriedFromMs` (a long note kept from before the range) the bars before are
 * counted from the bar that long note starts in.
 */
export function resolvePracticePlayWindow(
  chart: Pick<ResolvedChart, 'beatResolver' | 'timing'>,
  practice: Pick<PlayPractice, 'endMs' | 'restBarsBefore' | 'restBarsAfter'>,
  range: { startMs: number; endMs: number },
  carriedFromMs?: number,
): { startSeconds: number; endSeconds: number; firstStartSeconds: number } {
  const before = restBarCount(practice.restBarsBefore);
  const after = restBarCount(practice.restBarsAfter);
  // A long note kept from before the range (`carriedLongNotes`) is played from its head: the bar it starts in leads.
  const leadMs =
    carriedFromMs !== undefined && carriedFromMs < range.startMs ? Math.max(0, carriedFromMs) : range.startMs;
  const startBar = barIndexAt(chart, leadMs);
  const startSeconds =
    before === 0
      ? leadMs === range.startMs
        ? range.startMs / 1000
        : barHeadMs(chart, startBar) / 1000
      : barHeadMs(chart, Math.max(0, startBar - before)) / 1000;
  let endMs: number;
  if (after === 0) endMs = range.endMs;
  else if (practice.endMs === undefined) {
    endMs = range.endMs + 1000;
    if (after > 1) endMs = Math.max(endMs, barHeadMs(chart, barIndexAt(chart, range.endMs) + after));
  } else endMs = Math.max(range.endMs, barHeadMs(chart, barIndexAt(chart, range.endMs) + after));
  // The first round starts a bar before the range at least, so its notes come down the lane instead of starting on the
  // judgement line; the loop goes back to `startSeconds`.
  const firstStartSeconds = before >= 1 ? startSeconds : barHeadMs(chart, Math.max(0, startBar - 1)) / 1000;
  return {
    startSeconds: Math.min(startSeconds, range.startMs / 1000),
    endSeconds: endMs / 1000,
    firstStartSeconds: Math.min(firstStartSeconds, range.startMs / 1000),
  };
}

/**
 * How far a seamless PRACTICE loop (a looping play of picked bars, whatever its rest bars) moves the play back each
 * time, in chart seconds and beats: from the loop's start to the play's end (the range's end, or the end of the rest
 * bars after it). `undefined` when the loop is not seamless (no loop, or the whole chart to its end).
 */
export function resolvePracticeLoopShift(
  chart: Pick<ResolvedChart, 'timing'>,
  practice: Pick<PlayPractice, 'loop' | 'endMs' | 'restBarsAfter'>,
  window: { startSeconds: number; endSeconds: number },
): { seconds: number; beats: number } | undefined {
  if (!isSeamlessPracticeLoop(practice)) return undefined;
  const seconds = window.endSeconds - window.startSeconds;
  if (!(seconds > 0)) return undefined;
  const beatAt = createBeatAtSecondsResolverFromTimingResolver(chart.timing);
  return { seconds, beats: beatAt(window.endSeconds) - beatAt(window.startSeconds) };
}

/**
 * Whether a PRACTICE play loops seamlessly ({@link PlayPractice.loop}): it loops a range with an `END TIME`, and goes
 * back the moment it reaches its end, the time it overshot carried over.
 */
export function isSeamlessPracticeLoop(practice: Pick<PlayPractice, 'loop' | 'endMs'> | undefined): boolean {
  return practice?.loop === true && practice.endMs !== undefined;
}

/**
 * What a seamless PRACTICE loop shows past the range's end: the range's notes once more, `shift` later, as the next
 * round brings them down the lane, so they do not appear out of nowhere when the play goes back. They are drawn only:
 * the judge never sees them. Each stands for its note (its lane follows any later change to the note's channel) and
 * keeps its own judged and visibility marks.
 */
export function createPracticeLoopPreviewNotes(
  notes: readonly TimedPlayableNote[],
  shift: { seconds: number; beats: number },
): TimedPlayableNote[] {
  return notes.map((note) => {
    const preview = Object.create(note) as TimedPlayableNote;
    Object.defineProperties(preview, {
      beat: { value: note.beat + shift.beats, enumerable: true },
      seconds: { value: note.seconds + shift.seconds, enumerable: true },
      ...(note.endBeat !== undefined ? { endBeat: { value: note.endBeat + shift.beats, enumerable: true } } : {}),
      ...(note.endSeconds !== undefined
        ? { endSeconds: { value: note.endSeconds + shift.seconds, enumerable: true } }
        : {}),
      judged: { value: false, writable: true, enumerable: true },
      visibleUntilBeat: { value: undefined, writable: true, enumerable: true },
    });
    return preview;
  });
}

/**
 * `PracticeModifier`: move every judged object outside `[start, end)` to the background. A long note leaves with
 * either end outside, since moving one end moves its pair, unless `carriedLongNotes` keeps one held into the range from
 * before it (its head before `start`, its end in the range). Returns the scorable note counts from before, which the
 * PRACTICE TOTAL scales against.
 */
export function applyPracticeRange(
  source: ResolvedChart,
  notes: TimedPlayableNote[],
  mines: TimedLandmineNote[],
  range: { startMs: number; endMs: number },
  carriedLongNotes = false,
): {
  chart: ResolvedChart;
  sourceNotes: RulesetNoteCounts;
  changedObjectCount: number;
  /** Where the earliest long note kept from before the range starts (`carriedLongNotes`), in chart milliseconds. */
  carriedFromMs?: number;
} {
  const long = { 1: 0, 2: 0, 3: 0 };
  let normal = 0;
  for (const note of notes) {
    if (note.endSeconds !== undefined && note.endSeconds > note.seconds) long[note.longNoteMode ?? source.lnMode] += 1;
    else normal += 1;
  }
  const sourceNotes: RulesetNoteCounts = { normal, long };
  const before = notes.length + mines.length;
  // TimeLine times are whole milliseconds.
  const msOf = (seconds: number): number => Math.floor(seconds * 1000 + 1e-6);
  const outside = (seconds: number): boolean => {
    const ms = msOf(seconds);
    return ms < range.startMs || ms >= range.endMs;
  };
  // A long note held into the range from before it: its head before the range's start, its end in the range.
  const carried = (object: TimedPlayableNote | TimedLandmineNote): boolean =>
    carriedLongNotes &&
    'endSeconds' in object &&
    object.endSeconds !== undefined &&
    object.endSeconds > object.seconds &&
    msOf(object.seconds) < range.startMs &&
    !outside(object.endSeconds);
  let carriedFromMs: number | undefined;
  const sampleTriggers = moveNotesToBackground(source, notes, mines, (object) => {
    if (carried(object)) {
      carriedFromMs = Math.min(carriedFromMs ?? Number.POSITIVE_INFINITY, msOf(object.seconds));
      return false;
    }
    return (
      outside(object.seconds) ||
      ('endSeconds' in object && object.endSeconds !== undefined && outside(object.endSeconds))
    );
  });
  return {
    chart: withChartOverrides(source, { sampleTriggers }),
    sourceNotes,
    changedObjectCount: before - notes.length - mines.length,
    ...(carriedFromMs !== undefined ? { carriedFromMs } : {}),
  };
}
