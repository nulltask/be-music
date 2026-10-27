import type { CourseStageFigures } from '../courses/figures.ts';
import { courseKindLabel, type CourseCardData, type CourseCardStage } from './course-card-data.ts';
import { chartTitle, djLevel, formatGauge, formatScoreRate, lampStyle, rulesetName } from './format.ts';

/** The figures of one ruleset a course run's card shows (`course_score_result`). */
export interface CourseCardResult {
  ruleset: string;
  exScore: number;
  noteCount: number;
  clearLamp: number;
  missCount: number;
  maxCombo: number;
  stagesPlayed: number;
  trophy: string | null;
  gaugeType: string;
  gaugeFinal: number;
  judges: Record<string, number>;
  stages: CourseStageFigures[] | null;
}

/**
 * The stages as the card lists them: each chart's title, and the run's rate on it and whether its gauge cleared. A run
 * stored before per-stage figures were kept knows only how many stages it reached.
 */
export function courseCardStages(
  stages: ReadonlyArray<{ chartFingerprint: string; title: string | null }>,
  figures: readonly CourseStageFigures[] | null,
  stagesPlayed: number,
): CourseCardStage[] {
  return stages.map((stage, i) => {
    const title = chartTitle(stage.title, stage.chartFingerprint);
    const own = figures?.[i];
    if (own !== undefined) {
      return {
        title,
        rate: formatScoreRate(own.exScore, own.noteCount),
        state: own.cleared ? 'cleared' : 'failed',
      };
    }
    return { title, rate: null, state: figures === null && i < stagesPlayed ? 'played' : 'unreached' };
  });
}

/** The card's content: the run under the ruleset it was played with. */
export function courseCardData(input: {
  course: { name: string; kind: string; stages: ReadonlyArray<{ chartFingerprint: string; title: string | null }> };
  played: CourseCardResult;
  player: { displayName: string; handle: string; avatarUrl: string };
  playedAt: number;
}): CourseCardData {
  const { played } = input;
  const lamp = lampStyle(played.clearLamp);
  return {
    kindLabel: courseKindLabel(input.course.kind),
    courseName: input.course.name,
    trophy: played.trophy,
    stagesPlayed: played.stagesPlayed,
    stages: courseCardStages(input.course.stages, played.stages, played.stagesPlayed),
    playerName: input.player.displayName,
    handle: input.player.handle,
    avatarUrl: input.player.avatarUrl,
    rulesetLabel: rulesetName(played.ruleset),
    lamp: { label: lamp.label, color: lamp.color },
    exScore: played.exScore,
    maxExScore: played.noteCount * 2,
    rate: formatScoreRate(played.exScore, played.noteCount),
    djRank: djLevel(played.exScore, played.noteCount),
    bp: played.missCount,
    maxCombo: played.maxCombo,
    judges: {
      pgreat: played.judges.pgreat ?? 0,
      great: played.judges.great ?? 0,
      good: played.judges.good ?? 0,
      bad: played.judges.bad ?? 0,
      poor: (played.judges.poor ?? 0) + (played.judges.emptyPoor ?? 0),
    },
    gauge: formatGauge(played.gaugeType, played.gaugeFinal),
    playedAt: input.playedAt,
  };
}
