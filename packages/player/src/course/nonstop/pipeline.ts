import type { RandomDraws } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import { resolveChartRulesetFacts, resolvePlayChart } from '../../core/play-chart.ts';
import { createCoursePlaylog, type BeMusicCoursePlaylog, type PlaylogCourseStageEntry } from '../../playlog/course.ts';
import type { BeMusicPlaylog, PlaylogRecorderInfo } from '../../playlog/format.ts';
import {
  resolveNonstopNoteStages,
  resolveNonstopPlaylogStages,
  splitNonstopPlaylog,
  type NonstopStageChartFacts,
  type PlaylogNonstopRun,
} from '../../playlog/nonstop.ts';
import { computeStageChartFingerprint, resolvePlaylogCourseInfo } from '../course-playlog.ts';
import type { CourseConstraint, CourseDefinition, NonstopConnection } from '../definition.ts';
import { applyCourseLongNoteConstraint } from '../long-note.ts';
import {
  NONSTOP_STITCH_VERSION,
  stitchNonstopCourse,
  type NonstopStitchMap,
  type StitchNonstopOptions,
  type StitchNonstopResult,
} from './compose.ts';

/*
 * The one NONSTOP pipeline: a host stitches a course to play it with these steps, and the Leaderboard rebuilds a run's
 * stitched chart with the same ones, so the two always agree on the chart that was played.
 */

/** One stage of a NONSTOP course: its chart as loaded and what its cut-out play log names it by. */
export interface NonstopCourseStage {
  /** The stage chart as loaded (`#RANDOM` / `#SWITCH` still in). */
  chart: BeMusicJson;
  /** The chart's path, or only its extension: the lane-mode input (a `.pms` stage stitches and counts as 9 KEY). */
  chartPath?: string;
  /**
   * The `#RANDOM` / `#SWITCH` draws to resolve the chart with, e.g. the ones a run recorded
   * (`nonstop.stages[].randomDraws`). Without them the outcomes are drawn with `options.random`.
   */
  randomDraws?: RandomDraws;
  /** What the stage's cut-out log names its chart by (title, file hashes); its chart fingerprint is computed. */
  facts?: Omit<NonstopStageChartFacts, 'chartFingerprint'>;
}

export interface PrepareNonstopCourseOptions {
  /** The course's constraints: its long-note constraint applies to every stage chart. */
  constraints: readonly CourseConstraint[];
  /** The connection after each stage but the last (`CourseDefinition.connections`). */
  connections: readonly NonstopConnection[];
  /** `'intended'` (default) or `'lr2'` (`planNonstopCourse`). */
  placement?: 'intended' | 'lr2';
  /** The stitching rules to follow ({@link NONSTOP_STITCH_VERSION} by default; a rebuild passes the run's). */
  stitch?: number;
  /** The stitched chart's title, e.g. the course name. */
  title?: string;
  /** Draws a stage's outcomes when it has no `randomDraws`, in `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
  /**
   * The host's asset plumbing: given every stage chart as played, the path each stitched WAV / BMP loads from
   * (`StitchNonstopOptions.assetPath`). Without it a resource keeps the path its stage chart names.
   */
  assetPath?: (stageCharts: readonly BeMusicJson[]) => StitchNonstopOptions['assetPath'];
}

/** A NONSTOP course stitched into one chart, ready to play. */
export interface PreparedNonstopCourse {
  /** The stitched chart. */
  chart: BeMusicJson;
  map: NonstopStitchMap;
  connections: NonstopConnection[];
  placement: 'intended' | 'lr2';
  /** The stitching rules the chart was built by. */
  stitch: number;
  /** The stages as given. */
  stages: NonstopCourseStage[];
  /** Each stage chart as played: control flow resolved, the course's long-note constraint applied. */
  stageCharts: BeMusicJson[];
  /** The `#RANDOM` / `#SWITCH` draws each stage chart was resolved with. */
  stageDraws: RandomDraws[];
}

/**
 * Why a NONSTOP course cannot be stitched: a stage chart that does not resolve (`stage-chart`, e.g. draws that do not
 * fit it) or one of {@link stitchNonstopCourse}'s reasons.
 */
export type NonstopPrepareFailure = 'stage-chart' | Extract<StitchNonstopResult, { ok: false }>['reason'];

export type PrepareNonstopCourseResult =
  | { ok: true; course: PreparedNonstopCourse }
  | { ok: false; reason: NonstopPrepareFailure; stage?: number };

/**
 * Stitches a NONSTOP course into one chart: resolves each stage chart's control flow (with its recorded draws, else
 * drawn with `options.random`), applies the course's long-note constraint to it, and stitches the stages with the
 * course's connections, placement and stitching rules ({@link stitchNonstopCourse}). Deterministic given the draws.
 */
export function prepareNonstopCourse(
  stages: readonly NonstopCourseStage[],
  options: PrepareNonstopCourseOptions,
): PrepareNonstopCourseResult {
  const stageCharts: BeMusicJson[] = [];
  const stageDraws: RandomDraws[] = [];
  for (const [index, stage] of stages.entries()) {
    try {
      const { chart, randomDraws } = resolvePlayChart(stage.chart, {
        ...(stage.randomDraws !== undefined ? { randomDraws: stage.randomDraws } : {}),
        ...(options.random !== undefined ? { random: options.random } : {}),
      });
      stageCharts.push(applyCourseLongNoteConstraint(chart, options.constraints));
      stageDraws.push(randomDraws);
    } catch {
      return { ok: false, reason: 'stage-chart', stage: index };
    }
  }
  const connections = [...options.connections];
  const placement = options.placement ?? 'intended';
  const stitch = options.stitch ?? NONSTOP_STITCH_VERSION;
  const assetPath = options.assetPath?.(stageCharts);
  const stitched = stitchNonstopCourse(
    stageCharts.map((chart, index) => ({ chart, pms: isPmsPath(stages[index]!.chartPath) })),
    {
      connections,
      placement,
      stitch,
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(assetPath !== undefined ? { assetPath } : {}),
    },
  );
  if (!stitched.ok) return stitched;
  return {
    ok: true,
    course: {
      chart: stitched.chart,
      map: stitched.map,
      connections,
      placement,
      stitch,
      stages: [...stages],
      stageCharts,
      stageDraws,
    },
  };
}

/**
 * The NONSTOP run of a play of the stitched chart (`BeMusicCoursePlaylog.nonstop`): how the chart was stitched, where
 * each stage sat in the play with the draws its chart was resolved with ({@link resolveNonstopPlaylogStages}), and the
 * stage of every note ({@link resolveNonstopNoteStages}).
 */
export function resolveNonstopRun(course: PreparedNonstopCourse, playlog: BeMusicPlaylog): PlaylogNonstopRun {
  return {
    connections: [...course.connections],
    placement: course.placement,
    stitch: course.stitch,
    playlog,
    stages: resolveNonstopPlaylogStages(course.map, course.stageDraws),
    noteStages: resolveNonstopNoteStages(course.chart, course.map, playlog.chart.notes),
  };
}

/**
 * The course play log of a NONSTOP run: the stitched play ({@link resolveNonstopRun}), each reached stage cut out of it
 * ({@link splitNonstopPlaylog}, named by its facts and chart fingerprint), and every stage the run never reached with the
 * facts of its chart as played (`resolveChartRulesetFacts`), its file hashes and its chart fingerprint.
 */
export function buildNonstopCoursePlaylog(
  definition: Pick<CourseDefinition, 'name' | 'kind' | 'constraints' | 'trophies' | 'release'>,
  course: PreparedNonstopCourse,
  playlog: BeMusicPlaylog,
  options: { createdAt?: string; recorder?: PlaylogRecorderInfo } = {},
): BeMusicCoursePlaylog {
  const nonstop = resolveNonstopRun(course, playlog);
  const stageFacts = course.stages.map(resolveStageChartFacts);
  const cut = splitNonstopPlaylog(nonstop, stageFacts, { ruleset: playlog.play.judgeRuleset ?? 'lr2' });
  const stages = course.stageCharts.map((chart, index): PlaylogCourseStageEntry => {
    const stageLog = cut[index];
    if (stageLog !== undefined) return { played: true, playlog: stageLog };
    const facts = stageFacts[index];
    return {
      played: false,
      facts: resolveChartRulesetFacts(chart, { laneModeExtension: course.stages[index]?.chartPath }),
      ...(facts?.sha256 !== undefined ? { sha256: facts.sha256 } : {}),
      ...(facts?.md5 !== undefined ? { md5: facts.md5 } : {}),
      ...(facts?.chartFingerprint !== undefined ? { chartFingerprint: facts.chartFingerprint } : {}),
    };
  });
  return createCoursePlaylog({
    course: resolvePlaylogCourseInfo(definition),
    stages,
    nonstop,
    ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    ...(options.recorder !== undefined ? { recorder: options.recorder } : {}),
  });
}

/** What a stage's cut-out log names its chart by: the host's facts and the fingerprint of the chart as loaded. */
function resolveStageChartFacts(stage: NonstopCourseStage): NonstopStageChartFacts {
  const { title, ...rest } = stage.facts ?? {};
  const chartFingerprint = computeStageChartFingerprint(stage.chart, stage.chartPath);
  return {
    ...(title !== undefined ? { title } : {}),
    ...(chartFingerprint !== undefined ? { chartFingerprint } : {}),
    ...rest,
  };
}

function isPmsPath(chartPath: string | undefined): boolean {
  return chartPath?.toLowerCase().endsWith('.pms') === true;
}
