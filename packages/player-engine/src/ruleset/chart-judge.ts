import {
  isLegacyChartPlayOptionProgram,
  type ChartPlayOptionProgram,
  type ChartPlayOptions,
} from '@be-music/chart-model';
import { applyCourseJudgeConstraint } from './course.ts';
import type { GaugeSpec, JudgeWindowSetUs, RulesetWindowTables } from './definitions.ts';

/**
 * The judgment-related chart-authored CRAZY options a ruleset applies (#844). `legacy` marks a program recorded before
 * version 3, whose options keep their earlier readings: HELLJUDGE halves every window, and GOOD2BAD / GREAT2BAD collapse
 * the windows as beatoraja's `NO_GOOD` / `NO_GREAT`, without touching the gauge.
 */
export type ChartJudgeModifiers = Pick<ChartPlayOptions, 'judge' | 'hellJudge'> & { legacy?: true };

/**
 * HELLJUDGE's narrowing of each judgment, `[PGREAT, GREAT, GOOD, BAD]`: nanasigroove 1.552 swaps its judge table for one
 * whose COOL and GREAT boundaries are 3/8 of the normal ones, its GOOD boundary 1/3 and its BAD boundary 1/4. Be-Music
 * keeps each ruleset's own windows and narrows them by those ratios (nanasigroove's COOL is PGREAT here).
 */
export const HELLJUDGE_WINDOW_RATIOS: readonly [number, number, number, number] = [3 / 8, 3 / 8, 1 / 3, 1 / 4];

function halve(set: JudgeWindowSetUs): JudgeWindowSetUs {
  const half = ([late, early]: readonly [number, number]): readonly [number, number] => [
    Math.round(late / 2),
    Math.round(early / 2),
  ];
  return { ...set, judges: [half(set.judges[0]), half(set.judges[1]), half(set.judges[2]), half(set.judges[3])] };
}

function narrow(set: JudgeWindowSetUs): JudgeWindowSetUs {
  const scale = (index: number): readonly [number, number] => {
    const [late, early] = set.judges[index]!;
    const ratio = HELLJUDGE_WINDOW_RATIOS[index]!;
    return [Math.round(late * ratio), Math.round(early * ratio)];
  };
  return { ...set, judges: [scale(0), scale(1), scale(2), scale(3)] };
}

/**
 * Applies a chart's HELLJUDGE to every window table of the play's ruleset: each judgment's window narrows by
 * {@link HELLJUDGE_WINDOW_RATIOS}, notes and long-note ends alike, rounded to whole microseconds. The empty-POOR window
 * stays. GOOD2BAD and GREAT2BAD leave the windows alone: they change the gauge ({@link applyChartGaugeModifiers}).
 */
export function applyChartJudgeModifiers(
  tables: RulesetWindowTables,
  modifiers: ChartJudgeModifiers | undefined,
): RulesetWindowTables {
  if (modifiers === undefined) return tables;
  if (modifiers.legacy === true) return applyLegacyChartJudgeModifiers(tables, modifiers);
  if (modifiers.hellJudge !== true) return tables;
  return {
    note: narrow(tables.note),
    scratch: narrow(tables.scratch),
    longNoteEnd: narrow(tables.longNoteEnd),
    longScratchEnd: narrow(tables.longScratchEnd),
  };
}

/** The earlier readings a program before version 3 keeps (see {@link ChartJudgeModifiers}). */
function applyLegacyChartJudgeModifiers(
  tables: RulesetWindowTables,
  modifiers: ChartJudgeModifiers,
): RulesetWindowTables {
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

/**
 * Applies a chart's GOOD2BAD or GREAT2BAD to a gauge, as nanasigroove does: the judgments stay what they are, but a GOOD
 * (GOOD2BAD), or a GREAT and a GOOD (GREAT2BAD), moves the gauge as a BAD does. The gauge is the ruleset's own, so the
 * BAD delta is that gauge's.
 */
export function applyChartGaugeModifiers(spec: GaugeSpec, modifiers: ChartJudgeModifiers | undefined): GaugeSpec {
  const judge = modifiers?.judge;
  if (judge === undefined || modifiers?.legacy === true) return spec;
  const [pgreat, great, , bad, poor, emptyPoor] = spec.values;
  return {
    ...spec,
    values: [pgreat, judge === 'GREAT2BAD' ? bad : great, bad, bad, poor, emptyPoor],
  };
}

/** The `chartJudge` ruleset option of a chart play program: `{}` when it forces no judge modifier. */
export function resolveChartJudgeOption(program: ChartPlayOptionProgram | undefined): {
  chartJudge?: ChartJudgeModifiers;
} {
  const options = program?.options;
  if (program === undefined || options === undefined || (options.judge === undefined && options.hellJudge !== true))
    return {};
  return {
    chartJudge: {
      ...(options.judge !== undefined ? { judge: options.judge } : {}),
      ...(options.hellJudge === true ? { hellJudge: true as const } : {}),
      ...(isLegacyChartPlayOptionProgram(program) ? { legacy: true as const } : {}),
    },
  };
}
