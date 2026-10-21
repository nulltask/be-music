import type {
  BeMusicDOMGameplayFrame,
  BeMusicGameplayRuntime,
  GaugeHistorySample,
  BeMusicJudgmentTiming,
} from '@be-music/player-skin-sdk';

export interface BeMusicScoreData {
  readonly exScore: number;
  readonly maximum: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly rank?: string;
  readonly score: number;
  readonly totalNotes: number;
  readonly judgedNotes: number;
  readonly missCount: number;
  readonly courseCombo?: { combo: number; maxCombo: number };
}
export interface BeMusicJudgmentData {
  readonly perfect: number;
  readonly great: number;
  readonly good: number;
  readonly bad: number;
  readonly poor: number;
  readonly emptyPoor: number;
  readonly fast: number;
  readonly slow: number;
  readonly earlyLate: BeMusicDOMGameplayFrame['state']['earlyLate'];
  readonly lastJudge?: string;
  readonly lastDeltaMs?: number;
}
export interface BeMusicGaugeData {
  readonly value: number;
  readonly label?: string;
  readonly cleared: boolean;
  readonly threshold?: number;
  readonly survival?: boolean;
  readonly history: readonly GaugeHistorySample[];
}
export interface BeMusicTimingData {
  readonly timings: readonly BeMusicJudgmentTiming[];
}
export interface BeMusicSettingsData {
  readonly options: BeMusicDOMGameplayFrame['playOptions'];
  readonly view: BeMusicDOMGameplayFrame['state']['view'];
  readonly runtime: Pick<
    BeMusicGameplayRuntime,
    'greenNumber' | 'visibleMs' | 'minBPM' | 'maxBPM' | 'mainBPM' | 'rulesetLabel'
  >;
}
