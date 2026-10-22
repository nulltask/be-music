import type {
  BeMusicBGAFrame,
  BeMusicBomb,
  BeMusicDOMGameplayFrame,
  BeMusicGameplayRuntime,
  BeMusicLaneFrame,
  BeMusicLongNote,
  BeMusicMeasureLine,
  BeMusicMine,
  BeMusicNote,
  BeMusicRect,
  GaugeHistorySample,
  BeMusicJudgmentTiming,
  LaneRun,
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

/** Lane backgrounds, key beams and held long-note markers, in stage design pixels. */
export interface BeMusicLanesData {
  readonly lanes: readonly BeMusicLaneFrame[];
}
/** Everything that scrolls down the lanes, in stage design pixels. */
export interface BeMusicNotesData {
  readonly notes: readonly BeMusicNote[];
  readonly longNotes: readonly BeMusicLongNote[];
  readonly mines: readonly BeMusicMine[];
  readonly measureLines: readonly BeMusicMeasureLine[];
}
/** One play side's lane area with its SUDDEN (top) and HIDDEN (bottom) cover fractions. */
export interface BeMusicLaneCoverArea {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly sudden: number;
  readonly hidden: number;
}
export interface BeMusicLaneCoversData {
  readonly areas: readonly BeMusicLaneCoverArea[];
}
/** The judge line, drawn once per lane run so it never crosses the gap between double-play sides. */
export interface BeMusicJudgeLineData {
  readonly runs: readonly LaneRun[];
  readonly y: number;
}
export interface BeMusicBombsData {
  readonly bombs: readonly BeMusicBomb[];
}
/** One side's judgment word, centered on `x`. `combo` is the count under it when the judgment keeps the combo. */
export interface BeMusicJudgmentWord {
  readonly x: number;
  readonly text: string;
  /** Colour this frame. A PGREAT's GREAT cycles; the other words stay put. */
  readonly color: string;
  readonly combo?: number;
}
/** The judgment words showing this frame, on the text baseline `y`. */
export interface BeMusicJudgmentDisplayData {
  readonly words: readonly BeMusicJudgmentWord[];
  readonly y: number;
}
/** The BGA layers showing this frame; `shown` is false when the chart has no BGA, leaving the rect empty. */
export interface BeMusicBGAData {
  readonly frame: BeMusicBGAFrame | undefined;
  readonly shown: boolean;
}
/** One canvas component of the playfield: the stage rect it covers and what it draws there. */
export interface BeMusicPlayfieldPart<Data> {
  readonly rect: BeMusicRect;
  readonly data: Data;
}
/** The playfield split into its canvas components, in drawing order. */
export interface BeMusicPlayfieldParts {
  readonly stage: { readonly width: number; readonly height: number };
  readonly bga: BeMusicPlayfieldPart<BeMusicBGAData>;
  readonly lanes: BeMusicPlayfieldPart<BeMusicLanesData>;
  readonly notes: BeMusicPlayfieldPart<BeMusicNotesData>;
  readonly laneCovers: BeMusicPlayfieldPart<BeMusicLaneCoversData>;
  readonly judgeLine: BeMusicPlayfieldPart<BeMusicJudgeLineData>;
  readonly bombs: BeMusicPlayfieldPart<BeMusicBombsData>;
  readonly judgmentDisplay: BeMusicPlayfieldPart<BeMusicJudgmentDisplayData>;
}
/** What the playback controls show: the position and length in chart seconds, and the player's own controls. */
export interface BeMusicPlaybackData {
  readonly currentSeconds: number;
  readonly durationSeconds: number;
  readonly playing: boolean;
  /** Whether the seek bar moves the play now. */
  readonly seekable: boolean;
  /** 0..1. */
  readonly volume: number;
  readonly muted: boolean;
  readonly fullscreen: boolean;
}
