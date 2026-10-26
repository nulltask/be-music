import { isCourseStageFailed } from '../ruleset/course.ts';
import type { BeMusicCourseReplay } from './course.ts';
import type { BeMusicReplay } from './format.ts';

/*
 * Playing a course replay back as a course: which chart each stage needs, and which stage replays play in order and
 * where the run stops. A host plays each stage replay with its recorded carry-in (`play.course`), as LR2 and beatoraja
 * replay a course stage by stage; a NONSTOP run plays its one stitched replay (`BeMusicCourseReplay.nonstop`) instead.
 */

/** The chart a course replay's stage was played on (or, for a stage the run never reached, the course names). */
export interface CourseReplayStageChart {
  /** Zero-based stage index. */
  index: number;
  /** Whether the run reached the stage. */
  played: boolean;
  /** The chart's title and artist, as a played stage's replay records them. */
  title?: string;
  artist?: string;
  /** The chart file's hashes, lower-case hex. */
  sha256?: string;
  md5?: string;
  /** The Be-Music chart fingerprint (`bmfp0:…`). */
  chartFingerprint?: string;
}

/** What a loaded chart is known by, to match it against a stage ({@link matchesCourseReplayStageChart}). */
export interface CourseReplayChartKeys {
  sha256?: string;
  md5?: string;
  chartFingerprint?: string;
}

/** Every stage's chart, in order: a played stage's from its replay, an unreached one's from the course log. */
export function listCourseReplayStageCharts(courseLog: Pick<BeMusicCourseReplay, 'stages'>): CourseReplayStageChart[] {
  return courseLog.stages.map((entry, index): CourseReplayStageChart => {
    const chart = entry.played ? entry.replay.chart : entry;
    // An unreached stage is listed by its hashes and chart facts only: the course log does not name it.
    const title = entry.played ? entry.replay.chart.title : undefined;
    const artist = entry.played ? entry.replay.chart.artist : undefined;
    return {
      index,
      played: entry.played,
      ...(title !== undefined ? { title } : {}),
      ...(artist !== undefined ? { artist } : {}),
      ...(chart.sha256 !== undefined ? { sha256: chart.sha256.toLowerCase() } : {}),
      ...(chart.md5 !== undefined ? { md5: chart.md5.toLowerCase() } : {}),
      ...(chart.chartFingerprint !== undefined ? { chartFingerprint: chart.chartFingerprint } : {}),
    };
  });
}

/**
 * Whether a loaded chart is a stage's: by SHA-256 when the stage names one, else by MD5, else by chart fingerprint. A
 * stage that names none matches no chart, so a course replay that cannot name its charts never starts on guesses.
 */
export function matchesCourseReplayStageChart(stage: CourseReplayStageChart, chart: CourseReplayChartKeys): boolean {
  if (stage.sha256 !== undefined) return chart.sha256?.toLowerCase() === stage.sha256;
  if (stage.md5 !== undefined) return chart.md5?.toLowerCase() === stage.md5;
  if (stage.chartFingerprint !== undefined) return chart.chartFingerprint === stage.chartFingerprint;
  return false;
}

/** How a replayed stage ends the run, or that it goes on. */
export type CourseReplayStageEnd = 'next' | 'cleared' | 'failed' | 'given-up';

/** One stage a course replay plays back: its own replay, which carries the state carried in, and how it ends. */
export interface CourseReplayStagePlayback {
  index: number;
  replay: BeMusicReplay;
  end: CourseReplayStageEnd;
}

/**
 * The stage replays a course replay plays back, in order, up to where the recorded run stopped: the first stage given
 * up (`play.aborted`) or failed (its recorded gauge, `isCourseStageFailed`), else the last stage played. The last entry
 * says how the run ended; every other one is `next`. A stage without a recorded result (`results` is a regenerable
 * cache) goes on unless it is the last stage played.
 */
export function planCourseReplayPlayback(courseLog: Pick<BeMusicCourseReplay, 'stages'>): CourseReplayStagePlayback[] {
  const plan: CourseReplayStagePlayback[] = [];
  for (const [index, entry] of courseLog.stages.entries()) {
    if (!entry.played) break;
    const { replay } = entry;
    const native = replay.results?.native;
    const end: CourseReplayStageEnd =
      replay.play.aborted === true
        ? 'given-up'
        : native !== undefined && isCourseStageFailed(replay.play.judgeRuleset ?? 'lr2', native.gauge)
          ? 'failed'
          : 'next';
    plan.push({ index, replay, end });
    if (end !== 'next') return plan;
  }
  const last = plan.at(-1);
  if (last !== undefined) last.end = last.index + 1 < courseLog.stages.length ? 'failed' : 'cleared';
  return plan;
}
