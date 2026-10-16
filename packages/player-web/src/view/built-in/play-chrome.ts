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
export function resolveLaneGeometry(ctx: LaneGeometryContext): ReturnType<typeof resolveGameplayLaneGeometry> {
  // Asked several times a frame (lanes, BGA, notes); it changes only with its inputs, so it is kept until one does. The
  // stage is one of the skin's own stage objects, so a rotation that switches stages shows up as a new one.
  const stage = ctx.beMusicStage;
  const cached = ctx.laneGeometryCache;
  if (
    cached !== undefined &&
    cached.laneChannels === ctx.laneChannels &&
    cached.laneCount === ctx.laneChannels.length &&
    cached.playVariant === ctx.chartPlayVariant &&
    cached.layoutMode === ctx.layoutMode &&
    cached.stage === stage
  ) {
    return cached.geometry;
  }
  const geometry = resolveGameplayLaneGeometry(
    ctx.laneChannels,
    ctx.laneChannels.length,
    ctx.chartPlayVariant,
    ctx.layoutMode,
    stage,
  );
  ctx.laneGeometryCache = {
    laneChannels: ctx.laneChannels,
    laneCount: ctx.laneChannels.length,
    playVariant: ctx.chartPlayVariant,
    layoutMode: ctx.layoutMode,
    stage,
    geometry,
  };
  return geometry;
}

export function resolveSkinlessGameplayChromeRuntime(ctx: PlayChromeContext): SkinlessGameplayChromeRuntime {
  const total = ctx.score.total > 0 ? ctx.score.total : 0;
  const seconds = ctx.currentSeconds();
  const songLengthSeconds = ctx.resolveSongDurationSeconds();
  const usesPlayer2 = ctx.chartPlayVariant !== '9' && ctx.laneChannels.some((channel) => channel.startsWith('2'));
  const judgeSides: SkinlessGameplayJudgeState[] = [];
  for (const side of ['1P', '2P'] as const) {
    if (side === '2P' && !usesPlayer2) {
      continue;
    }
    const state = ctx.judgeSideState[side];
    if (state.judge && seconds <= state.until) {
      judgeSides.push({ side, judge: state.judge, combo: state.combo });
    }
  }
  const currentBeat = ctx.currentBeat(seconds);
  // The BPM readout freezes at the reversal value (LR2's frozen pump holds |BPM| there) instead of following the
  // mirrored scroll back through earlier tempo points — see `nowBpm`.
  const bpm = ctx.nowBpm(seconds) ?? ctx.song?.bpm;
  const laneCovers = ctx.resolveLaneCovers();
  const visibleMs = ctx.resolveVisibleMs(laneCovers[0], bpm, ctx.scrollMapper?.rateAt?.(currentBeat) ?? 1);
  return {
    songTitle: ctx.song?.title,
    songArtist: ctx.song?.artist,
    songGenre: ctx.song?.genre,
    // The scroll above runs on the chart's tempo; a NONSTOP readout shows the stage's own BPM — see `displayBpm`.
    bpm: ctx.displayBpm(seconds) ?? bpm,
    // The player's hi-speed, as the select panel and the host show it (HS-FIX scales only the scroll).
    hiSpeed: ctx.playerHiSpeed,
    score: ctx.score.score,
    exScore: ctx.score.exScore,
    exScoreMax: total * 2,
    combo: ctx.tracker.combo,
    maxCombo: ctx.maxCombo,
    perfect: ctx.score.perfect,
    great: ctx.score.great,
    good: ctx.score.good,
    bad: ctx.score.bad,
    poor: ctx.score.poor,
    gauge: ctx.gaugeState.current,
    clearThreshold: ctx.gaugeState.clearThreshold,
    laneCount: ctx.laneChannels.length,
    laneChannels: ctx.laneChannels,
    playVariant: ctx.chartPlayVariant,
    lastJudge: seconds <= ctx.lastJudgeUntil ? ctx.lastJudge : undefined,
    judgeSides,
    rank: total <= 0 ? undefined : resolveIidxRankLabel(ctx.score.exScore, total),
    autoplay: ctx.options.autoPlay === true,
    hasBga: ctx.hasBga,
    nowMs: ctx.playClock(),
    progressRatio: songLengthSeconds > 0 ? Math.max(0, Math.min(1, seconds / songLengthSeconds)) : 0,
    // The beat this frame already worked out for the same `seconds`.
    beatPhase: currentBeat - Math.floor(currentBeat),
    rulesetLabel: ctx.resolveJudgeRuleset(),
    gaugeLabel: ctx.gaugeState.type ?? 'GROOVE',
    gaugeSurvival: ctx.gaugeState.survival === true,
    fast: ctx.fastCount,
    slow: ctx.slowCount,
    totalNotes: total,
    // While assets load the count-in waits: the skin shows NOW LOADING instead.
    chartMs: ctx.assetsLoading ? undefined : ctx.resolveChartMs(),
    loading: ctx.assetsLoading,
    judgeAtMs: ctx.lastJudgeAt,
    impulseAtMs: ctx.lastImpulseAt,
    impulseKind: ctx.lastImpulseKind,
    effects: ctx.options.beMusicEffects ?? 'full',
    audio: ctx.audioFrame,
    song: ctx.song,
    lastJudgeDeltaMs: ctx.judgeTimings.lastDeltaMs,
    judgeTimings: ctx.judgeTimings.recent,
    minBpm: ctx.chartBpmRange?.minBpm,
    maxBpm: ctx.chartBpmRange?.maxBpm,
    mainBpm: ctx.chartBpmRange?.mainBpm,
    songLengthMs: ctx.song ? songLengthSeconds * 1000 : undefined,
    // Clamped to the length so the remaining time never runs negative through the audio tail.
    songElapsedMs: ctx.song ? Math.min(seconds, songLengthSeconds) * 1000 : undefined,
    failedAtMs: ctx.playMoments.failedAtMs,
    allNotesDoneAtMs: ctx.playMoments.allNotesDoneAtMs,
    outroAtMs: ctx.playMoments.outroAtMs,
    gaugeRiseAtMs: ctx.playMoments.gaugeRiseAtMs,
    gaugeMaxAtMs: ctx.playMoments.gaugeMaxAtMs,
    // Shared by reference: the arrays only grow during a play, and skins are told not to mutate them.
    scoreHistory: ctx.scoreHistory,
    gaugeHistory: ctx.gaugeHistory,
    judgeWindows: ctx.judgeWindows,
    laneCovers,
    visibleMs,
    greenNumber: visibleMs === undefined ? undefined : resolveGreenNumber(visibleMs),
  };
}
