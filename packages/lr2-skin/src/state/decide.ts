import type { CourseView, LibraryChart } from '@be-music/scene-model';
import { LR2_OP } from '../ids/index.ts';
import { resolveLr2ChartText, resolveLr2DifficultyOp, resolveLr2KeyModeOp } from './chart.ts';
import { resolveLr2CourseNumber, resolveLr2CourseOps, resolveLr2CourseText } from './course.ts';
import type { Lr2SceneState } from './scene-state.ts';

/** What the LR2 decide screen shows: the chart about to be played, and the course it is a stage of. */
export interface Lr2DecideInput {
  /** The chart about to be played. */
  readonly chart: LibraryChart;
  /** The course the chart is a stage of (with the stage being played): the course ops, numbers and texts. */
  readonly course?: CourseView;
  /** The skin's `#CUSTOMOPTION` choices: their ops (900-999). */
  readonly customOps?: Iterable<number>;
}

/** Ops the decide screen always lights: no internet ranking, and the chart is ready. */
const DECIDE_BASE_OPS: readonly number[] = [LR2_OP.OFFLINE, LR2_OP.LOADED];

/**
 * The LR2 decide screen's state: the base ops, the chart's difficulty (150-155; the generic plate for none) and key
 * mode (160-164) ops, the chart's texts (10-28) and, for a course stage, the course ops, numbers and texts. It draws
 * no slider.
 */
export function resolveLr2DecideState(input: Lr2DecideInput): Lr2SceneState {
  const { chart, course } = input;
  const ops = new Set<number>(DECIDE_BASE_OPS);
  for (const op of input.customOps ?? []) ops.add(op);
  ops.add(resolveLr2DifficultyOp(chart.chart.metadata.difficulty));
  ops.add(resolveLr2KeyModeOp(chart));
  if (course !== undefined) for (const op of resolveLr2CourseOps(course)) ops.add(op);
  return {
    ops,
    number: (num) => (course !== undefined ? resolveLr2CourseNumber(num, course) : undefined),
    text: (st) =>
      (course !== undefined ? resolveLr2CourseText(st, course) : undefined) ?? resolveLr2ChartText(st, chart),
    slider: () => undefined,
  };
}
