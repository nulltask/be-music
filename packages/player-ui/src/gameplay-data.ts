import type { BeMusicDOMGameplayFrame } from '@be-music/player-skin-sdk';
import type { BeMusicGaugeData, BeMusicJudgmentData, BeMusicScoreData } from './models.ts';

/** The panel data and chart facts a gameplay frame shows, shared by the gameplay HUDs. */
export interface BeMusicGameplayPanels {
  readonly score: BeMusicScoreData;
  readonly gauge: BeMusicGaugeData;
  readonly judgments: BeMusicJudgmentData;
  /** The title with its subtitle. */
  readonly title: string;
  /** Genre, key mode and level, joined. */
  readonly facts: string;
  readonly totalNotes: number;
  /** Chart seconds played so far, within the chart. */
  readonly seconds: number;
}

/** Reads the score, gauge and judgment panels and the chart facts out of a gameplay frame. */
export function resolveGameplayPanels(frame: BeMusicDOMGameplayFrame): BeMusicGameplayPanels {
  const { state: s, runtime: r, chart } = frame;
  const total = r.totalNotes ?? chart?.totalNotes ?? 0;
  const judged = (r.perfect ?? 0) + (r.great ?? 0) + (r.good ?? 0) + (r.bad ?? 0) + (r.poor ?? 0);
  return {
    score: {
      exScore: s.exScore,
      maximum: r.exScoreMax ?? total * 2,
      combo: s.combo,
      maxCombo: s.maxCombo,
      rank: r.rank,
      score: r.score ?? 0,
      totalNotes: total,
      judgedNotes: judged,
      missCount: (r.bad ?? 0) + (r.poor ?? 0) + frame.emptyPoor,
      courseCombo: s.courseCombo,
    },
    gauge: {
      value: s.gauge,
      label: r.gaugeLabel ?? s.gaugeType,
      cleared: s.cleared,
      threshold: r.clearThreshold,
      survival: r.gaugeSurvival,
      history: s.gaugeHistory,
    },
    judgments: {
      perfect: r.perfect ?? 0,
      great: r.great ?? 0,
      good: r.good ?? 0,
      bad: r.bad ?? 0,
      poor: r.poor ?? 0,
      emptyPoor: frame.emptyPoor,
      fast: r.fast ?? 0,
      slow: r.slow ?? 0,
      earlyLate: s.earlyLate,
      lastJudge: r.lastJudge,
      lastDeltaMs: s.lastJudgeDeltaMs,
    },
    title: [chart?.title ?? 'Preparing chart', chart?.subtitle].filter(Boolean).join(' '),
    facts: [
      chart?.genre,
      r.playVariant ? `${r.playVariant} KEY` : undefined,
      chart?.playLevel !== undefined ? `Lv. ${chart.playLevel}` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
    totalNotes: total,
    seconds: Math.max(0, Math.min(s.totalSeconds, frame.seconds)),
  };
}
