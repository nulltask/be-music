import { resolveLR2MoneyScore } from '@be-music/player/ruleset';
import type { BeMusicCourseReplay, ReplayCourseResult } from '@be-music/player/replay';
import { resolveCourseView } from '../course-view/course-view.ts';
import type { LibraryCourse } from '../library/entries.ts';
import type { GaugeHistorySample, ScoreHistorySample } from '../play-state/types.ts';
import type { PlayResult } from './result.ts';

/** A stage's gauge and EX-score graphs (`progress` 0..1 over the stage), as its result shows them. */
export interface CourseStageHistory {
  gaugeHistory: readonly GaugeHistorySample[];
  scoreHistory: readonly ScoreHistorySample[];
  /** The stage's play time in seconds (its result's `playSeconds`), when known. */
  playSeconds?: number;
}

/** A stage without graphs (given up, or played without them). */
export const EMPTY_COURSE_STAGE_HISTORY: CourseStageHistory = { gaugeHistory: [], scoreHistory: [] };

/**
 * Every stage's graphs joined into one over the whole course, as beatoraja's course result draws its graphs
 * (`CourseResult.create`): each stage takes a share of the width by its `weights` (its length), the EX score runs on
 * from the stages before it, and a stage the run never reached reads a gauge of 0 (beatoraja fills it with zeros) with
 * the EX score where the run left it.
 */
export function joinCourseStageHistories(
  stages: readonly CourseStageHistory[],
  weights: readonly number[],
): CourseStageHistory {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const share = (index: number): number =>
    total > 0 ? Math.max(0, weights[index] ?? 0) / total : 1 / Math.max(1, weights.length);
  const gaugeHistory: GaugeHistorySample[] = [];
  const scoreHistory: ScoreHistorySample[] = [];
  let start = 0;
  let exScore = 0;
  weights.forEach((_weight, index) => {
    const width = share(index);
    const stage = stages[index];
    if (stage === undefined) {
      gaugeHistory.push({ progress: start, value: 0 }, { progress: start + width, value: 0 });
      scoreHistory.push({ progress: start, exScore }, { progress: start + width, exScore });
    } else {
      for (const sample of stage.gaugeHistory) {
        gaugeHistory.push({ progress: start + sample.progress * width, value: sample.value });
      }
      for (const sample of stage.scoreHistory) {
        scoreHistory.push({ progress: start + sample.progress * width, exScore: exScore + sample.exScore });
      }
      exScore += stage.scoreHistory.at(-1)?.exScore ?? 0;
    }
    start += width;
  });
  return { gaugeHistory, scoreHistory };
}

/**
 * The result of a course run as one play: the course's summed judgments, BP, course max combo and final gauge, under
 * the course's name (the first stage's chart supplies the song images), with each stage's graphs. `history` is the
 * graph the result itself draws: LR2 shows the last stage's (its result clears the graph at each stage start, OpenLR2
 * L24151); `stageHistories` are every stage's, for beatoraja's joined course graph.
 *
 * SCORE reads on the stage results' scale: LR2's money score over the course's notes (out of 200000, as LR2 keeps a
 * course's best), else the EX score. PLAY TIME is `playSeconds` (the stages' play time, `CourseRun.playSeconds`), else
 * `history.playSeconds` (a NONSTOP run passes its stitched play's result). An EXPERT / GRADE run is a `course` run (its
 * verdict reads COURSE CLEAR / COURSE FAILED); a NONSTOP run is a `nonstop` one, shown as one play on the result skin.
 */
export function playResultFromCourseRun(
  course: LibraryCourse,
  result: ReplayCourseResult,
  courseLog: BeMusicCourseReplay,
  history: CourseStageHistory = EMPTY_COURSE_STAGE_HISTORY,
  options: { playSeconds?: number; stageHistories?: readonly CourseStageHistory[] } = {},
): PlayResult {
  const first = course.stages[0]!.chart!;
  const lastStage = [...courseLog.stages].reverse().find((entry) => entry.played);
  const judgeRuleset = lastStage?.played === true ? (lastStage.replay.play.judgeRuleset ?? 'lr2') : 'lr2';
  const score =
    judgeRuleset === 'lr2'
      ? resolveLR2MoneyScore({
          total: result.noteCount,
          perfect: result.judge.pgreat,
          great: result.judge.great,
          good: result.judge.good,
        })
      : result.exScore;
  return {
    score: {
      total: result.noteCount,
      perfect: result.judge.pgreat,
      great: result.judge.great,
      good: result.judge.good,
      bad: result.judge.bad,
      poor: result.judge.poor,
      emptyPoor: result.judge.emptyPoor,
      exScore: result.exScore,
      score,
    },
    maxCombo: result.maxCombo,
    gauge: result.gauge.final,
    cleared: result.gauge.cleared,
    playSeconds: options.playSeconds ?? history.playSeconds ?? 0,
    chart: {
      ...first,
      id: `course:${course.id}`,
      title: course.definition.name,
      subtitle: `${result.stagesPlayed} / ${course.stages.length} STAGES${result.trophy !== undefined ? ` · ${result.trophy}` : ''}`,
      totalNotes: result.noteCount,
    },
    gaugeHistory: [...history.gaugeHistory],
    scoreHistory: [...history.scoreHistory],
    lamp: result.lamp,
    gaugeType: result.gauge.type,
    run: course.definition.kind === 'nonstop' ? 'nonstop' : 'course',
    course: resolveCourseView(course),
    courseRun: {
      stagesPlayed: result.stagesPlayed,
      ...(result.trophy !== undefined ? { trophy: result.trophy } : {}),
      ...(options.stageHistories !== undefined ? { stageHistories: options.stageHistories } : {}),
    },
    judgeRuleset,
    fast: result.fast,
    slow: result.slow,
  };
}
