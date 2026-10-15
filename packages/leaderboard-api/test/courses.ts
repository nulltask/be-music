import { gzipSync } from 'node:zlib';
import {
  createCoursePlaylog,
  resolveChartRulesetFacts,
  simulatePlaylog,
  type BeMusicCoursePlaylog,
  type BeMusicPlaylog,
  type PlaylogCourseInfo,
  type PlaylogCourseStageEntry,
  type RulesetChartFacts,
} from '@be-music/player/playlog';
import { makeChart, makePlaylog, type TestChart } from './support.ts';

/** The grade course the course tests run, unless a run names its own. */
export const TEST_COURSE: PlaylogCourseInfo = {
  name: 'Test Dan',
  kind: 'grade',
  constraints: ['grade_mirror', 'gauge_lr2'],
  trophies: [],
};
const STAGE_COURSE = { kind: 'grade' as const, gaugeSet: 'lr2' as const };

/** Ten notes on lane 11, told apart by `lane` (where the last two fall). */
export function stageChart(lane: string): TestChart {
  return makeChart(['#00111:01010101', '#00211:01010101', `#003${lane}:0101`]);
}

/** An unreached stage's facts, as the client derives them from the stage chart. */
const factsOf = (chart: TestChart): RulesetChartFacts => resolveChartRulesetFacts(chart.json);

export interface CourseRunOptions {
  gauge?: BeMusicPlaylog['play']['gauge'];
  play?: Partial<BeMusicPlaylog['play']>;
  /** The course definition (name, trophies, ...); {@link TEST_COURSE} by default. */
  course?: Partial<PlaylogCourseInfo>;
  /** Changes a stage log after its carry-in is set. */
  tamper?: (stage: BeMusicPlaylog, index: number) => void;
}

/**
 * A course run over `charts`: stage `i` hits `hits[i]` of its ten notes, carrying in what the previous stage left as the
 * LR2 simulation sees it (as the engine would have); the charts past `hits` are unreached.
 */
export function courseRun(
  charts: readonly TestChart[],
  hits: readonly number[],
  options: CourseRunOptions = {},
): BeMusicCoursePlaylog {
  const stages: PlaylogCourseStageEntry[] = [];
  let previous: ReturnType<typeof simulatePlaylog> | undefined;
  for (const [index, chart] of charts.entries()) {
    if (index >= hits.length) {
      stages.push({ played: false, facts: factsOf(chart), chartFingerprint: chart.chartFingerprint });
      continue;
    }
    const carryIn =
      previous === undefined
        ? undefined
        : { gauge: previous.gauge.final, combo: previous.course!.combo, maxCombo: previous.course!.maxCombo };
    const playlog = makePlaylog(chart, {
      noteCount: 10,
      hits: hits[index]!,
      play: {
        gauge: options.gauge ?? 'GROOVE',
        course: { ...STAGE_COURSE, ...(carryIn !== undefined ? { carryIn } : {}) },
        ...options.play,
      },
    });
    previous = simulatePlaylog(playlog, { ruleset: 'lr2' });
    options.tamper?.(playlog, index);
    stages.push({ played: true, playlog });
  }
  return createCoursePlaylog({
    course: { ...TEST_COURSE, ...options.course },
    stages,
    createdAt: '2026-10-15T00:00:00.000Z',
  });
}

export function gzipBody(body: unknown): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(gzipSync(JSON.stringify(body)));
}

/**
 * The body of a course run over `charts`: the documents of each played stage, and the chart of each unreached one
 * (`stageCharts` overrides them).
 */
export function courseBody(
  log: BeMusicCoursePlaylog,
  charts: readonly TestChart[],
  withChartDocuments = true,
  stageCharts?: ReadonlyArray<{ stage: number; chart: unknown }>,
): Uint8Array<ArrayBuffer> {
  const played = log.stages.filter((entry) => entry.played).length;
  return gzipBody({
    coursePlaylog: log,
    stages: charts.slice(0, played).map((chart) => ({
      playDocument: chart.playDocument,
      ...(withChartDocuments ? { chartDocument: chart.chartDocument } : {}),
    })),
    stageCharts:
      stageCharts ?? charts.flatMap((chart, stage) => (stage >= played ? [{ stage, chart: chart.json }] : [])),
  });
}

/** Posts a course run body to `POST /api/v0/course-scores`. */
export function submitCourse(
  fetchApp: (path: string, init?: RequestInit) => Promise<Response>,
  cookie: string | undefined,
  body: Uint8Array<ArrayBuffer>,
): Promise<Response> {
  return fetchApp('/api/v0/course-scores', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body,
  });
}

/** What `POST /api/v0/course-scores` answers. */
export interface CourseOutcome {
  courseScoreId: string;
  courseFingerprint: string;
  results: Array<{
    ruleset: string;
    exScore: number;
    noteCount: number;
    clearLamp: number;
    missCount: number;
    stagesPlayed: number;
    trophy: string | null;
    rank: number;
    players: number;
    improved: { exScore: boolean; lamp: boolean; missCount: boolean; trophy: boolean };
  }>;
}
