import type { ChartPlayOptionProgram, ChartPlayOptions } from '@be-music/chart-model';
import { applyCourseJudgeConstraint } from './course.ts';
import type { JudgeWindowSetUs, RulesetWindowTables } from './definitions.ts';

/** The judgment-related chart-authored CRAZY options a ruleset applies (#844). */
export type ChartJudgeModifiers = Pick<ChartPlayOptions, 'judge' | 'hellJudge'>;

function halve(set: JudgeWindowSetUs): JudgeWindowSetUs {
  const half = ([early, late]: readonly [number, number]): readonly [number, number] => [
    Math.round(early / 2),
    Math.round(late / 2),
  ];
  return {
    ...set,
    judges: [half(set.judges[0]), half(set.judges[1]), half(set.judges[2]), half(set.judges[3])],
  };
}

/**
 * Applies a chart's judgment CRAZY options to every window table of the play's ruleset (Be-Music readings; the sources
 * give no algorithm, docs/adr/0033-chart-authored-gameplay-options.md):
 *
 * - `HELLJUDGE` halves every judge window (PGREAT to BAD, notes and long-note ends alike), rounded to whole
 *   microseconds; the empty-POOR window stays.
 * - `GOOD2BAD` gives GOOD the GREAT window, so a hit that would have been GOOD falls to BAD, as beatoraja's `NO_GOOD`
 *   does; `GREAT2BAD` gives GREAT and GOOD the PGREAT window (`NO_GREAT`).
 *
 * Halving comes first, so the collapse uses the halved windows. A course's own judge constraint applies too: the
 * collapses compose, the stricter one winning.
 */
export function applyChartJudgeModifiers(
  tables: RulesetWindowTables,
  modifiers: ChartJudgeModifiers | undefined,
): RulesetWindowTables {
  if (modifiers === undefined || (modifiers.judge === undefined && modifiers.hellJudge !== true)) return tables;
  const halved: RulesetWindowTables =
    modifiers.hellJudge === true
      ? {
          note: halve(tables.note),
          scratch: halve(tables.scratch),
          longNoteEnd: halve(tables.longNoteEnd),
          longScratchEnd: halve(tables.longScratchEnd),
        }
      : tables;
  return applyCourseJudgeConstraint(
    halved,
    modifiers.judge === 'GREAT2BAD' ? 'no-great' : modifiers.judge === 'GOOD2BAD' ? 'no-good' : undefined,
  );
}

/** The `chartJudge` ruleset option of a chart play program: `{}` when it forces no judge modifier. */
export function resolveChartJudgeOption(program: ChartPlayOptionProgram | undefined): {
  chartJudge?: ChartJudgeModifiers;
} {
  const options = program?.options;
  if (options === undefined || (options.judge === undefined && options.hellJudge !== true)) return {};
  return {
    chartJudge: {
      ...(options.judge !== undefined ? { judge: options.judge } : {}),
      ...(options.hellJudge === true ? { hellJudge: true as const } : {}),
    },
  };
}
