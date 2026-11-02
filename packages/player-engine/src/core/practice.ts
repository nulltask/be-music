import type { ResolvedChart } from '@be-music/chart-model';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import type { BeatorajaGaugeCategory } from '../ruleset/definitions.ts';
import type { PracticeGaugeType } from '../ruleset/practice-gauge.ts';
import type { RulesetNoteCounts } from '../ruleset/facts.ts';
import { moveNotesToBackground } from './background-notes.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

/**
 * PRACTICE, beatoraja 0.8.9's mode (`PracticeConfiguration.PracticeProperty`), under every judge ruleset (#933): the
 * range played and the play rules set for it, read under the judge ruleset (`PracticeRules`). Its frequency is the
 * play's tempo and its lane options are the play's own.
 */
export interface PlayPractice {
  /** `START TIME` in chart milliseconds. */
  startMs: number;
  /** `END TIME` in chart milliseconds; absent is the source default, the chart's last timeline + 1000. */
  endMs?: number;
  /** `GAUGE TYPE`: one of the judge ruleset's `resolvePracticeGaugeTypes`. */
  gauge: PracticeGaugeType;
  /** `GAUGE CATEGORY` (beatoraja only); absent uses the play mode's. */
  gaugeCategory?: BeatorajaGaugeCategory;
  /** `GAUGE VALUE`. */
  startGauge: number;
  /** `JUDGERANK`, a judgerank percent read on the ruleset's own table; absent keeps the chart's. */
  judgeRank?: number;
  /** `TOTAL`; absent keeps the chart's. */
  total?: number;
  /**
   * Plays the range again in place each time it ends, until the play is interrupted (#949): once the play's end (the
   * head of the bar after the one `END TIME` lies in, `resolvePracticePlayWindow`) is reached and judged, or its gauge
   * empties, the play goes back to its start (the head of the bar before the range's) with the score, combo and gauge of the practice settings, as a seek there does (`restartPractice`).
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
 * The chart millisecond bar `measure` starts at, whole as PRACTICE's times are (the range picker snaps to it): the
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

/**
 * Where a PRACTICE play starts and ends, in chart seconds, measured in bars (#954): it starts at the head of the bar
 * before the one the range starts in (the chart's start when that is the first bar), and ends at the head of the bar
 * after the one its `END TIME` lies in, so a range snapped to bar lines plays one whole bar on either side. Without an
 * `END TIME` (to the chart's end) it ends 1000 ms past the range's end, as before. beatoraja starts 1000 ms before the
 * range and ends 1000 ms past it instead.
 */
export function resolvePracticePlayWindow(
  chart: Pick<ResolvedChart, 'beatResolver' | 'timing'>,
  practice: Pick<PlayPractice, 'endMs'>,
  range: { startMs: number; endMs: number },
): { startSeconds: number; endSeconds: number } {
  const startBar = barIndexAt(chart, range.startMs);
  const startSeconds = startBar > 0 ? barHeadMs(chart, startBar - 1) / 1000 : 0;
  const endSeconds =
    practice.endMs === undefined
      ? (range.endMs + 1000) / 1000
      : Math.max(range.endMs, barHeadMs(chart, barIndexAt(chart, range.endMs) + 1)) / 1000;
  return { startSeconds: Math.min(startSeconds, range.startMs / 1000), endSeconds };
}

/**
 * `PracticeModifier`: move every judged object outside `[start, end)` to the background. A long note leaves with
 * either end outside, since moving one end moves its pair. Returns the scorable note counts from before, which the
 * PRACTICE TOTAL scales against.
 */
export function applyPracticeRange(
  source: ResolvedChart,
  notes: TimedPlayableNote[],
  mines: TimedLandmineNote[],
  range: { startMs: number; endMs: number },
): { chart: ResolvedChart; sourceNotes: RulesetNoteCounts; changedObjectCount: number } {
  const long = { 1: 0, 2: 0, 3: 0 };
  let normal = 0;
  for (const note of notes) {
    if (note.endSeconds !== undefined && note.endSeconds > note.seconds) long[note.longNoteMode ?? source.lnMode] += 1;
    else normal += 1;
  }
  const sourceNotes: RulesetNoteCounts = { normal, long };
  const before = notes.length + mines.length;
  // TimeLine times are whole milliseconds.
  const outside = (seconds: number): boolean => {
    const ms = Math.floor(seconds * 1000 + 1e-6);
    return ms < range.startMs || ms >= range.endMs;
  };
  const sampleTriggers = moveNotesToBackground(
    source,
    notes,
    mines,
    (object) =>
      outside(object.seconds) ||
      ('endSeconds' in object && object.endSeconds !== undefined && outside(object.endSeconds)),
  );
  return {
    chart: withChartOverrides(source, { sampleTriggers }),
    sourceNotes,
    changedObjectCount: before - notes.length - mines.length,
  };
}
