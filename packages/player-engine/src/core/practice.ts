import type { ResolvedChart } from '@be-music/chart-model';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import type { BeatorajaGaugeCategory, BEATORAJA_PRACTICE_GAUGE_TYPES } from '../ruleset/definitions.ts';
import type { RulesetNoteCounts } from '../ruleset/facts.ts';
import { moveNotesToBackground } from './background-notes.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

/**
 * beatoraja 0.8.9 PRACTICE (`PracticeConfiguration.PracticeProperty`): the range played and the play rules set for it.
 * Its frequency is the play's tempo and its lane options are the play's own.
 */
export interface BeatorajaPractice {
  /** `START TIME` in chart milliseconds. */
  startMs: number;
  /** `END TIME` in chart milliseconds; absent is the source default, the chart's last timeline + 1000. */
  endMs?: number;
  /** `GAUGE TYPE`. */
  gauge: (typeof BEATORAJA_PRACTICE_GAUGE_TYPES)[number];
  /** `GAUGE CATEGORY`; absent uses the play mode's. */
  gaugeCategory?: BeatorajaGaugeCategory;
  /** `GAUGE VALUE`. */
  startGauge: number;
  /** `JUDGERANK`; absent keeps the chart's. */
  judgeRank?: number;
  /** `TOTAL`; absent keeps the chart's. */
  total?: number;
}

/** The range `PracticeModifier` keeps, in milliseconds, after the source's limits on the two times. */
export function resolvePracticeRange(
  practice: BeatorajaPractice,
  chartEndMs: number,
): { startMs: number; endMs: number } {
  const startMs = Math.max(0, Math.trunc(practice.startMs));
  const endMs = Math.max(startMs + 1000, Math.trunc(practice.endMs ?? chartEndMs + 1000));
  return { startMs, endMs };
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
