import { computeChartFingerprint, computePlayFingerprint } from '@be-music/chart';
import {
  normalizeCourseConstraints,
  NONSTOP_STITCH_VERSIONS,
  prepareNonstopCourse,
  resolveNonstopRun,
  type PrepareNonstopCourseResult,
} from '@be-music/player/course';
import {
  resolveChartRulesetFacts,
  resolveCourseStageChartFingerprints,
  splitNonstopPlaylog,
  type BeMusicCoursePlaylog,
  type PlaylogNonstopStage,
  type PlaylogRulesetId,
  type RulesetChartFacts,
} from '@be-music/player/playlog';

type ChartJson = Parameters<typeof computeChartFingerprint>[0];

/** A course stage's chart as the client loaded it (`#RANDOM` / `#SWITCH` still in), sent for the server to rebuild. */
export interface StageChartInput {
  /** The course stage, zero-based. */
  stage: number;
  /** The parsed chart (`BeMusicJson`). Never stored. */
  chart: unknown;
  /** Whether the chart is a `.pms` file: the one lane-mode input that is not in the chart itself. */
  pms?: boolean;
}

/** Why the stage charts of a course run do not back up its log. */
export type StageChartRejection =
  /** A stage the server must rebuild came without its chart. */
  | 'stage-chart-required'
  /** A stage chart is not a chart the engine can read. */
  | 'stage-chart-invalid'
  /** A stage chart does not hash to the chart fingerprint the log names for the stage. */
  | 'stage-chart-fingerprint-mismatch'
  /** An unreached stage's facts are not the stage chart's (its note count would be wrong). */
  | 'course-stage-facts-mismatch'
  /** The NONSTOP run was stitched by rules (`nonstop.stitch`) this server cannot rebuild. */
  | 'nonstop-stitch-unsupported'
  /** The stage charts, stitched again, are not the chart the NONSTOP play was recorded on. */
  | 'nonstop-chart-mismatch'
  /** The NONSTOP run's stage map (placements, note stages, stages reached) is not what the stitched chart gives. */
  | 'nonstop-stage-mismatch';

export type StageChartCheck = { ok: true } | { ok: false; reason: StageChartRejection; stage?: number };

interface LoadedChart {
  json: ChartJson;
  /** The lane-mode input the fingerprints and facts read: `.pms` or none. */
  chartPath: '.pms' | undefined;
}

type Loaded = { ok: true; charts: Map<number, LoadedChart> } | Extract<StageChartCheck, { ok: false }>;

function isChartJson(value: unknown): value is ChartJson {
  if (typeof value !== 'object' || value === null) return false;
  const chart = value as Record<string, unknown>;
  return (
    (chart.sourceFormat === 'bms' || chart.sourceFormat === 'bmson') &&
    typeof chart.metadata === 'object' &&
    chart.metadata !== null &&
    typeof chart.resources === 'object' &&
    chart.resources !== null &&
    Array.isArray(chart.events)
  );
}

/**
 * The charts of `stages`, each checked against the chart fingerprint the course log names for it: a stage's chart is
 * the same chart the client loaded only when it hashes to that fingerprint.
 */
function loadStageCharts(
  courseLog: BeMusicCoursePlaylog,
  inputs: readonly StageChartInput[],
  stages: readonly number[],
): Loaded {
  const byStage = new Map(inputs.map((input) => [input.stage, input]));
  const fingerprints = resolveCourseStageChartFingerprints(courseLog);
  const charts = new Map<number, LoadedChart>();
  for (const stage of stages) {
    const input = byStage.get(stage);
    if (input === undefined) return { ok: false, reason: 'stage-chart-required', stage };
    if (!isChartJson(input.chart)) return { ok: false, reason: 'stage-chart-invalid', stage };
    const chartPath = input.pms === true ? '.pms' : undefined;
    let fingerprint: string;
    try {
      fingerprint = computeChartFingerprint(input.chart, { chartPath });
    } catch {
      return { ok: false, reason: 'stage-chart-invalid', stage };
    }
    if (fingerprint !== fingerprints[stage]) return { ok: false, reason: 'stage-chart-fingerprint-mismatch', stage };
    charts.set(stage, { json: input.chart, chartPath });
  }
  return { ok: true, charts };
}

/** The facts a ruleset counts an unreached stage's notes from. The rest (judge rank, TOTAL) never reaches the result. */
function noteCountFacts(facts: RulesetChartFacts) {
  return {
    sourceFormat: facts.sourceFormat,
    laneMode: facts.laneMode,
    lnMode: facts.lnMode,
    notes: { normal: facts.notes.normal, long: { ...facts.notes.long } },
  };
}

/**
 * The unreached stages of a course run (one played stage by stage) come with their charts: each must hash to the chart
 * fingerprint the log names for the stage, and the stage's facts — what its notes count as BP — must be the ones the
 * client's own helper (`resolveChartRulesetFacts`) derives from that chart. Without this a failed run could lower its BP
 * by understating the notes it never reached.
 */
export function checkUnreachedStageCharts(
  courseLog: BeMusicCoursePlaylog,
  inputs: readonly StageChartInput[],
): StageChartCheck {
  const unreached = courseLog.stages.flatMap((entry, index) => (entry.played ? [] : [index]));
  const loaded = loadStageCharts(courseLog, inputs, unreached);
  if (!loaded.ok) return loaded;
  for (const index of unreached) {
    const entry = courseLog.stages[index]!;
    if (entry.played) continue;
    const { json, chartPath } = loaded.charts.get(index)!;
    let facts: RulesetChartFacts;
    try {
      facts = resolveChartRulesetFacts(json, { laneModeExtension: chartPath });
    } catch {
      return { ok: false, reason: 'stage-chart-invalid', stage: index };
    }
    if (JSON.stringify(noteCountFacts(facts)) !== JSON.stringify(noteCountFacts(entry.facts))) {
      return { ok: false, reason: 'course-stage-facts-mismatch', stage: index };
    }
  }
  return { ok: true };
}

const sameStage = (left: PlaylogNonstopStage, right: PlaylogNonstopStage): boolean =>
  left.offsetUs === right.offsetUs &&
  left.windowStartUs === right.windowStartUs &&
  left.windowEndUs === right.windowEndUs &&
  left.rate === right.rate;

/**
 * Rebuilds a NONSTOP run's stitched chart from its stage charts with the pipeline the host stitched it with
 * (`prepareNonstopCourse` in `@be-music/player/course`, which is deterministic): each stage chart (checked against its
 * chart fingerprint) resolved with the `#RANDOM` draws its stage recorded, the course's long-note constraint applied,
 * and the stages stitched with the recorded connections, placement and stitching rules (rules this server does not know
 * are refused). The stitched play (`nonstop.playlog`) must have been recorded on that chart — its play fingerprint must
 * be the rebuilt chart's — and the run's stage map must be the one the rebuilt chart gives (`resolveNonstopRun`): the
 * stage placements, which stage each note belongs to, and how many stages the play reached (the cut-out stages the log
 * lists).
 */
export function checkNonstopStageCharts(
  courseLog: BeMusicCoursePlaylog,
  inputs: readonly StageChartInput[],
  options: { playFingerprint: string; ruleset: PlaylogRulesetId },
): StageChartCheck {
  const run = courseLog.nonstop!;
  // A log from before the version was recorded was stitched by the first rules.
  const stitch = run.stitch ?? 1;
  if (!NONSTOP_STITCH_VERSIONS.includes(stitch)) return { ok: false, reason: 'nonstop-stitch-unsupported' };
  const loaded = loadStageCharts(
    courseLog,
    inputs,
    courseLog.stages.map((_entry, index) => index),
  );
  if (!loaded.ok) return loaded;
  let prepared: PrepareNonstopCourseResult;
  try {
    prepared = prepareNonstopCourse(
      run.stages.map((stage, index) => {
        const { json, chartPath } = loaded.charts.get(index)!;
        return { chart: json, chartPath, randomDraws: stage.randomDraws ?? [] };
      }),
      {
        constraints: normalizeCourseConstraints(courseLog.course.constraints),
        connections: run.connections,
        placement: run.placement,
        stitch,
      },
    );
  } catch {
    return { ok: false, reason: 'nonstop-chart-mismatch' };
  }
  if (!prepared.ok) return { ok: false, reason: 'nonstop-chart-mismatch', ...stageOf(prepared.stage) };
  const { course } = prepared;
  // The stitched chart is played as `nonstop.bms`: no lane-mode extension, unless its stages are `.pms` charts.
  const pms = course.stages.some((stage) => stage.chartPath === '.pms');
  const fingerprints = [computePlayFingerprint(course.chart, { chartPath: undefined })];
  if (pms) fingerprints.push(computePlayFingerprint(course.chart, { chartPath: '.pms' }));
  if (!fingerprints.includes(options.playFingerprint)) return { ok: false, reason: 'nonstop-chart-mismatch' };

  const rebuilt = resolveNonstopRun(course, run.playlog);
  const misplaced = rebuilt.stages.findIndex((stage, index) => !sameStage(stage, run.stages[index]!));
  if (misplaced >= 0) return { ok: false, reason: 'nonstop-stage-mismatch', stage: misplaced };
  if (rebuilt.noteStages.some((stage, index) => stage !== run.noteStages[index])) {
    return { ok: false, reason: 'nonstop-stage-mismatch' };
  }
  const reached = splitNonstopPlaylog(run, [], { ruleset: options.ruleset }).length;
  if (reached !== courseLog.stages.filter((entry) => entry.played).length) {
    return { ok: false, reason: 'nonstop-stage-mismatch' };
  }
  return { ok: true };
}

function stageOf(stage: number | undefined): { stage?: number } {
  return stage === undefined ? {} : { stage };
}
