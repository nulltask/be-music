/**
 * The built-in play screen's chrome inputs (`CoreGameplayView`): the lane geometry of the built-in playfield for the
 * loaded chart and the stage, and the runtime the skinless chrome (`skinlessChromeRenderer`, or a be-music skin's
 * `gameplay.renderChrome`) draws from each frame.
 *
 * The functions read the scene's state through {@link LaneGeometryContext} and {@link PlayChromeContext}; the scene
 * passes itself.
 */

import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import type { ScoreTracker } from '@be-music/player/core/scoring';
import { resolveIidxRankLabel, type JudgeKind, type ScoreSummary } from '@be-music/player/ruleset';
import type { PlayerGaugeSummary } from '@be-music/player/core/ui-signal-bus';
import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import {
  resolveGameplayLaneGeometry,
  type BeMusicJudgeWindows,
  type BeMusicLaneKind,
  type GameplayLayoutMode,
} from '@be-music/skin-sdk';
import type { BrowserSongEntry } from '../../collection/types.ts';
import type { AudioFeatures } from '../../runtime/audio-analysis.ts';
import type { ChartBpmRange } from '../../scene/core/gameplay-bpm-range.ts';
import type { CoreGameplayViewOptions } from '../../scene/core/gameplay.ts';
import type { JudgeTimingLog } from '../../scene/core/judge-timing-log.ts';
import { resolveGreenNumber } from '../../scene/core/lane-cover.ts';
import type { SkinlessGameplayChromeRuntime, SkinlessGameplayJudgeState } from '../../scene/gameplay-chrome.ts';
import type { BeMusicLaneCover, BeMusicStage } from '../../skin/be-music/types.ts';

/** What {@link resolveLaneGeometry} lays the lanes out from, and its cache: `CoreGameplayView`'s members of these names. */
export interface LaneGeometryContext {
  readonly laneChannels: string[];
  readonly chartPlayVariant: ChartPlayVariant;
  readonly layoutMode: GameplayLayoutMode;
  readonly beMusicStage: BeMusicStage | undefined;
  laneGeometryCache:
    | {
        laneChannels: readonly string[];
        laneCount: number;
        playVariant: unknown;
        layoutMode: unknown;
        stage: BeMusicStage | undefined;
        geometry: ReturnType<typeof resolveGameplayLaneGeometry>;
      }
    | undefined;
}

/** What the skinless chrome's runtime is made from each frame: `CoreGameplayView`'s members of these names. */
export interface PlayChromeContext {
  readonly options: Readonly<Pick<CoreGameplayViewOptions, 'autoPlay' | 'beMusicEffects'>>;
  readonly song: BrowserSongEntry | undefined;
  readonly laneChannels: string[];
  readonly chartPlayVariant: ChartPlayVariant;
  readonly scrollMapper: ScrollDistanceMapperLike | undefined;
  readonly score: ScoreSummary;
  readonly tracker: ScoreTracker;
  readonly maxCombo: number;
  readonly gaugeState: PlayerGaugeSummary;
  readonly lastJudge: string;
  readonly lastJudgeUntil: number;
  readonly judgeSideState: Record<
    '1P' | '2P',
    { judge: JudgeKind | ''; until: number; combo: number; courseCombo?: number }
  >;
  readonly hasBga: boolean;
  readonly playerHiSpeed: number;
  readonly fastCount: number;
  readonly slowCount: number;
  readonly assetsLoading: boolean;
  readonly lastJudgeAt: number | undefined;
  readonly lastImpulseAt: number | undefined;
  readonly lastImpulseKind: BeMusicLaneKind | undefined;
  readonly audioFrame: AudioFeatures | undefined;
  readonly judgeTimings: JudgeTimingLog;
  readonly chartBpmRange: ChartBpmRange | undefined;
  readonly playMoments: {
    failedAtMs?: number;
    allNotesDoneAtMs?: number;
    outroAtMs?: number;
    gaugeRiseAtMs?: number;
    gaugeMaxAtMs?: number;
  };
  readonly scoreHistory: Array<{ progress: number; exScore: number }>;
  readonly gaugeHistory: Array<{ progress: number; value: number }>;
  readonly judgeWindows: BeMusicJudgeWindows | undefined;
  currentSeconds(): number;
  currentBeat(seconds: number): number;
  nowBpm(seconds: number): number | undefined;
  displayBpm(seconds: number): number | undefined;
  playClock(): number;
  resolveSongDurationSeconds(): number;
  resolveLaneCovers(): readonly BeMusicLaneCover[];
  resolveVisibleMs(
    cover: BeMusicLaneCover | undefined,
    bpm: number | undefined,
    scrollRate: number,
  ): number | undefined;
  resolveJudgeRuleset(): string;
  resolveChartMs(): number | undefined;
}

/** Lane rects, playfield bounds, and judgement line of the built-in playfield for the loaded chart. */
export function resolveLaneGeometry(this: LaneGeometryContext): ReturnType<typeof resolveGameplayLaneGeometry> {
  // Asked several times a frame (lanes, BGA, notes); it changes only with its inputs, so it is kept until one does. The
  // stage is one of the skin's own stage objects, so a rotation that switches stages shows up as a new one.
  const stage = this.beMusicStage;
  const cached = this.laneGeometryCache;
  if (
    cached !== undefined &&
    cached.laneChannels === this.laneChannels &&
    cached.laneCount === this.laneChannels.length &&
    cached.playVariant === this.chartPlayVariant &&
    cached.layoutMode === this.layoutMode &&
    cached.stage === stage
  ) {
    return cached.geometry;
  }
  const geometry = resolveGameplayLaneGeometry(
    this.laneChannels,
    this.laneChannels.length,
    this.chartPlayVariant,
    this.layoutMode,
    stage,
  );
  this.laneGeometryCache = {
    laneChannels: this.laneChannels,
    laneCount: this.laneChannels.length,
    playVariant: this.chartPlayVariant,
    layoutMode: this.layoutMode,
    stage,
    geometry,
  };
  return geometry;
}

export function resolveSkinlessGameplayChromeRuntime(this: PlayChromeContext): SkinlessGameplayChromeRuntime {
  const total = this.score.total > 0 ? this.score.total : 0;
  const seconds = this.currentSeconds();
  const songLengthSeconds = this.resolveSongDurationSeconds();
  const usesPlayer2 = this.chartPlayVariant !== '9' && this.laneChannels.some((channel) => channel.startsWith('2'));
  const judgeSides: SkinlessGameplayJudgeState[] = [];
  for (const side of ['1P', '2P'] as const) {
    if (side === '2P' && !usesPlayer2) {
      continue;
    }
    const state = this.judgeSideState[side];
    if (state.judge && seconds <= state.until) {
      judgeSides.push({ side, judge: state.judge, combo: state.combo });
    }
  }
  const currentBeat = this.currentBeat(seconds);
  // The BPM readout freezes at the reversal value (LR2's frozen pump holds |BPM| there) instead of following the
  // mirrored scroll back through earlier tempo points — see `nowBpm`.
  const bpm = this.nowBpm(seconds) ?? this.song?.bpm;
  const laneCovers = this.resolveLaneCovers();
  const visibleMs = this.resolveVisibleMs(laneCovers[0], bpm, this.scrollMapper?.rateAt?.(currentBeat) ?? 1);
  return {
    songTitle: this.song?.title,
    songArtist: this.song?.artist,
    songGenre: this.song?.genre,
    // The scroll above runs on the chart's tempo; a NONSTOP readout shows the stage's own BPM — see `displayBpm`.
    bpm: this.displayBpm(seconds) ?? bpm,
    // The player's hi-speed, as the select panel and the host show it (HS-FIX scales only the scroll).
    hiSpeed: this.playerHiSpeed,
    score: this.score.score,
    exScore: this.score.exScore,
    exScoreMax: total * 2,
    combo: this.tracker.combo,
    maxCombo: this.maxCombo,
    perfect: this.score.perfect,
    great: this.score.great,
    good: this.score.good,
    bad: this.score.bad,
    poor: this.score.poor,
    gauge: this.gaugeState.current,
    clearThreshold: this.gaugeState.clearThreshold,
    laneCount: this.laneChannels.length,
    laneChannels: this.laneChannels,
    playVariant: this.chartPlayVariant,
    lastJudge: seconds <= this.lastJudgeUntil ? this.lastJudge : undefined,
    judgeSides,
    rank: total <= 0 ? undefined : resolveIidxRankLabel(this.score.exScore, total),
    autoplay: this.options.autoPlay === true,
    hasBga: this.hasBga,
    nowMs: this.playClock(),
    progressRatio: songLengthSeconds > 0 ? Math.max(0, Math.min(1, seconds / songLengthSeconds)) : 0,
    // The beat this frame already worked out for the same `seconds`.
    beatPhase: currentBeat - Math.floor(currentBeat),
    rulesetLabel: this.resolveJudgeRuleset(),
    gaugeLabel: this.gaugeState.type ?? 'GROOVE',
    gaugeSurvival: this.gaugeState.survival === true,
    fast: this.fastCount,
    slow: this.slowCount,
    totalNotes: total,
    // While assets load the count-in waits: the skin shows NOW LOADING instead.
    chartMs: this.assetsLoading ? undefined : this.resolveChartMs(),
    loading: this.assetsLoading,
    judgeAtMs: this.lastJudgeAt,
    impulseAtMs: this.lastImpulseAt,
    impulseKind: this.lastImpulseKind,
    effects: this.options.beMusicEffects ?? 'full',
    audio: this.audioFrame,
    song: this.song,
    lastJudgeDeltaMs: this.judgeTimings.lastDeltaMs,
    judgeTimings: this.judgeTimings.recent,
    minBpm: this.chartBpmRange?.minBpm,
    maxBpm: this.chartBpmRange?.maxBpm,
    mainBpm: this.chartBpmRange?.mainBpm,
    songLengthMs: this.song ? songLengthSeconds * 1000 : undefined,
    // Clamped to the length so the remaining time never runs negative through the audio tail.
    songElapsedMs: this.song ? Math.min(seconds, songLengthSeconds) * 1000 : undefined,
    failedAtMs: this.playMoments.failedAtMs,
    allNotesDoneAtMs: this.playMoments.allNotesDoneAtMs,
    outroAtMs: this.playMoments.outroAtMs,
    gaugeRiseAtMs: this.playMoments.gaugeRiseAtMs,
    gaugeMaxAtMs: this.playMoments.gaugeMaxAtMs,
    // Shared by reference: the arrays only grow during a play, and skins are told not to mutate them.
    scoreHistory: this.scoreHistory,
    gaugeHistory: this.gaugeHistory,
    judgeWindows: this.judgeWindows,
    laneCovers,
    visibleMs,
    greenNumber: visibleMs === undefined ? undefined : resolveGreenNumber(visibleMs),
  };
}
