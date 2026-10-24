/**
 * The built-in play screen's chrome inputs (`BuiltInPlayView`): the lane geometry of the built-in playfield for the
 * loaded chart and the stage, and the runtime the skinless chrome (`skinlessChromeRenderer`, or a be-music skin's
 * `gameplay.renderChrome`) draws from each frame.
 *
 * The functions read the scene's state through {@link LaneGeometryContext} and {@link PlayChromeContext}; the scene
 * passes itself.
 */

import type { ChartPlayVariant } from '@be-music/chart-model';
import { resolve____RankLabel } from '@be-music/player-engine/ruleset';
import { resolveGameplayLaneGeometry, resolveGameplayLayout, type GameplayLayoutMode } from '@be-music/player-skin-sdk';
import { recentJudgeTimings, resolveGreenNumber } from '@be-music/player-scene-model';
import type { AudioFeatures } from '../../runtime/audio-analysis.ts';
import type { PlaySessionOptions } from '../../session/play/play-options.ts';
import type { Container } from 'pixi.js';
import type { ChildPool } from '../../stage/pixi-utils.ts';
import type { BeMusicGameplayBinding } from '../../skin/be-music/binding.ts';
import type { PlayfieldRuntime } from '../shared/playfield/context.ts';
import type {
  BeMusicGameplayLayout,
  BeMusicGameplayRuntime,
  BeMusicJudgmentState,
  BeMusicStage,
} from '../../skin/be-music/types.ts';
import type { PlayfieldBGATarget, PlayfieldStage } from '../types.ts';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../stage/design.ts';
import { BGA } from '../shared/play-constants.ts';

/** One side's recent judgement state for skinless chrome renderers (the be-music skin type). */
export type SkinlessGameplayJudgeState = BeMusicJudgmentState;

/** Live gameplay values a skinless chrome renderer can paint (the be-music skin type). */
export type SkinlessGameplayChromeRuntime = BeMusicGameplayRuntime;

export interface SkinlessGameplayChromeRenderContext {
  layer: Container;
  overlayLayer: Container;
  layerPool: ChildPool;
  overlayLayerPool: ChildPool;
  runtime: SkinlessGameplayChromeRuntime;
}

export type SkinlessGameplayChromeRenderer = (context: SkinlessGameplayChromeRenderContext) => void;

/** Default-family BGA rect: the fixed {@link BGA} square, drawn opaque and untinted. */
const DEFAULT_BGA_TARGET: PlayfieldBGATarget = createDefaultBGATarget(BGA);

function createDefaultBGATarget(rect: { x: number; y: number; w: number; h: number }): PlayfieldBGATarget {
  return {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    noBase: false,
    noLayer: false,
    noPoor: false,
    applyToSprite: (sprite) => {
      sprite.alpha = 1;
      sprite.tint = 0xffffff;
      sprite.blendMode = 'normal';
    },
  };
}

/** The LR2-compatible 640x480 canvas. */
export const LEGACY_STAGE_SIZE: PlayfieldStage = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
/** The 640x480 stage with the fixed default-family BGA square, for skins that declare no stage of their own. */
const LEGACY_STAGE: BeMusicStage = { ...LEGACY_STAGE_SIZE, resolveBGARect: () => ({ ...BGA }) };

/** What {@link resolveLaneGeometry} lays the lanes out from, and its cache: a play view's members of these names. */
export interface LaneGeometryContext {
  readonly play: PlayfieldRuntime;
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

/** What the skinless chrome's runtime is made from each frame: a play view's members of these names. */
export interface PlayChromeContext {
  readonly play: PlayfieldRuntime;
  readonly options: Readonly<Pick<PlaySessionOptions, 'autoPlay' | 'beMusicEffects'>>;
  readonly audioFrame: AudioFeatures | undefined;
}

/** Lane rects, playfield bounds, and judgement line of the built-in playfield for the loaded chart. */
export function resolveLaneGeometry(ctx: LaneGeometryContext): ReturnType<typeof resolveGameplayLaneGeometry> {
  // Asked several times a frame (lanes, BGA, notes); it changes only with its inputs, so it is kept until one does. The
  // stage is one of the skin's own stage objects, so a rotation that switches stages shows up as a new one.
  const stage = ctx.beMusicStage;
  const cached = ctx.laneGeometryCache;
  if (
    cached !== undefined &&
    cached.laneChannels === ctx.play.laneChannels &&
    cached.laneCount === ctx.play.laneChannels.length &&
    cached.playVariant === ctx.play.chartPlayVariant &&
    cached.layoutMode === ctx.layoutMode &&
    cached.stage === stage
  ) {
    return cached.geometry;
  }
  const geometry = resolveGameplayLaneGeometry(
    ctx.play.laneChannels,
    ctx.play.laneChannels.length,
    ctx.play.chartPlayVariant,
    ctx.layoutMode,
    stage,
  );
  ctx.laneGeometryCache = {
    laneChannels: ctx.play.laneChannels,
    laneCount: ctx.play.laneChannels.length,
    playVariant: ctx.play.chartPlayVariant,
    layoutMode: ctx.layoutMode,
    stage,
    geometry,
  };
  return geometry;
}

export function resolveSkinlessGameplayChromeRuntime(ctx: PlayChromeContext): SkinlessGameplayChromeRuntime {
  const total = ctx.play.score.total > 0 ? ctx.play.score.total : 0;
  const play = ctx.play.playState;
  const seconds = ctx.play.currentSeconds();
  const chartLengthSeconds = ctx.play.resolveChartDurationSeconds();
  const usesPlayer2 =
    ctx.play.chartPlayVariant !== '9' && ctx.play.laneChannels.some((channel) => channel.startsWith('2'));
  const judgeSides: SkinlessGameplayJudgeState[] = [];
  for (const side of ['1P', '2P'] as const) {
    if (side === '2P' && !usesPlayer2) {
      continue;
    }
    const state = ctx.play.judgeSideState[side];
    if (state.judge && seconds <= state.until) {
      judgeSides.push({ side, judge: state.judge, combo: state.combo });
    }
  }
  const currentBeat = ctx.play.currentBeat(seconds);
  // The BPM readout freezes at the reversal value (LR2's frozen pump holds |BPM| there) instead of following the
  // mirrored scroll back through earlier tempo points — see `nowBPM`.
  const bpm = ctx.play.nowBPM(seconds) ?? ctx.play.chart?.bpm;
  const laneCovers = ctx.play.resolveLaneCovers();
  const visibleMs = ctx.play.resolveVisibleMs(laneCovers[0], bpm, ctx.play.scrollMapper?.rateAt?.(currentBeat) ?? 1);
  return {
    chartTitle: ctx.play.chart?.title,
    chartArtist: ctx.play.chart?.artist,
    chartGenre: ctx.play.chart?.genre,
    // The scroll above runs on the chart's tempo; a NONSTOP readout shows the stage's own BPM — see `displayBPM`.
    bpm: ctx.play.displayBPM(seconds) ?? bpm,
    // The player's hi-speed, as the select panel and the host show it (HS-FIX scales only the scroll).
    hiSpeed: play.view.hiSpeed.player,
    ...(play.view.hiSpeed.floating ? { floatingHiSpeed: true as const } : {}),
    score: ctx.play.score.score,
    exScore: ctx.play.score.exScore,
    exScoreMax: total * 2,
    combo: play.combo,
    maxCombo: play.maxCombo,
    perfect: ctx.play.score.perfect,
    great: ctx.play.score.great,
    good: ctx.play.score.good,
    bad: ctx.play.score.bad,
    poor: ctx.play.score.poor,
    gauge: ctx.play.gaugeState.current,
    clearThreshold: ctx.play.gaugeState.clearThreshold,
    laneCount: ctx.play.laneChannels.length,
    laneChannels: ctx.play.laneChannels,
    playVariant: ctx.play.chartPlayVariant,
    lastJudge: seconds <= ctx.play.lastJudgeUntil ? ctx.play.lastJudge : undefined,
    judgeSides,
    rank: total <= 0 ? undefined : resolve____RankLabel(ctx.play.score.exScore, total),
    autoplay: ctx.options.autoPlay === true,
    hasBGA: ctx.play.hasBGA,
    nowMs: ctx.play.playClock(),
    progressRatio: chartLengthSeconds > 0 ? Math.max(0, Math.min(1, seconds / chartLengthSeconds)) : 0,
    // The beat this frame already worked out for the same `seconds`.
    beatPhase: currentBeat - Math.floor(currentBeat),
    rulesetLabel: ctx.play.resolveJudgeRuleset(),
    gaugeLabel: ctx.play.gaugeState.type ?? 'GROOVE',
    gaugeSurvival: ctx.play.gaugeState.survival === true,
    fast: ctx.play.fastCount,
    slow: ctx.play.slowCount,
    totalNotes: total,
    // While assets load the count-in waits: the skin shows NOW LOADING instead.
    chartMs: ctx.play.assetsLoading ? undefined : ctx.play.resolveChartMs(),
    loading: ctx.play.assetsLoading,
    judgeAtMs: ctx.play.lastJudgeAt,
    impulseAtMs: ctx.play.lastImpulseAt,
    impulseKind: ctx.play.lastImpulseKind,
    effects: ctx.options.beMusicEffects ?? 'full',
    audio: ctx.audioFrame,
    chart: ctx.play.chart,
    lastJudgeDeltaMs: play.lastJudgeDeltaMs,
    judgeTimings: recentJudgeTimings(play),
    minBPM: ctx.play.chartBPMRange?.minBPM,
    maxBPM: ctx.play.chartBPMRange?.maxBPM,
    mainBPM: ctx.play.chartBPMRange?.mainBPM,
    songLengthMs: ctx.play.chart ? chartLengthSeconds * 1000 : undefined,
    // Clamped to the length so the remaining time never runs negative through the audio tail.
    songElapsedMs: ctx.play.chart ? Math.min(seconds, chartLengthSeconds) * 1000 : undefined,
    failedAtMs: ctx.play.playMoments.failedAtMs,
    allNotesDoneAtMs: ctx.play.playMoments.allNotesDoneAtMs,
    outroAtMs: ctx.play.playMoments.outroAtMs,
    gaugeRiseAtMs: ctx.play.playMoments.gaugeRiseAtMs,
    gaugeMaxAtMs: ctx.play.playMoments.gaugeMaxAtMs,
    // The play state's own arrays, shared by reference: skins are told not to mutate them.
    scoreHistory: play.scoreHistory,
    gaugeHistory: play.gaugeHistory,
    judgeWindows: ctx.play.judgeWindows,
    laneCovers,
    visibleMs,
    greenNumber: visibleMs === undefined ? undefined : resolveGreenNumber(visibleMs),
  };
}

/** Keep the base layout/BGA fixed and publish each side's actual line for the skin's chrome. */
function withLiftLines(ctx: BeMusicLayoutContext, layout: BeMusicGameplayLayout): BeMusicGameplayLayout {
  if (!ctx.drawsLift) return layout;
  const sides = { ...layout.playfield.sides };
  for (const cover of ctx.play.resolveLaneCovers()) {
    const bounds = sides[cover.side];
    if (!bounds) continue;
    const judgementY = layout.playfield.judgementY - (layout.playfield.judgementY - layout.playfield.top) * cover.lift;
    sides[cover.side] = { ...bounds, judgementY };
  }
  return { ...layout, playfield: { ...layout.playfield, sides } };
}

/** What the built-in BGA rect is worked out from: a play view's members of these names. */
export interface BGATargetsContext extends LaneGeometryContext {
  stageBGATarget: PlayfieldBGATarget | undefined;
}

/** What the be-music chrome's layout is worked out from, and its cache: a play view's members of these names. */
export interface BeMusicLayoutContext extends LaneGeometryContext {
  readonly drawsLift?: boolean;
  beMusicLayout:
    | {
        channels: readonly string[];
        variant: ChartPlayVariant | undefined;
        stage: BeMusicStage;
        layout: BeMusicGameplayLayout;
      }
    | undefined;
}

/** The built-in BGA rect (`PlayfieldSkin.bgaTargets` of the built-in view). */
export function collectBGATargets(ctx: BGATargetsContext, out: PlayfieldBGATarget[]): void {
  const stage = ctx.beMusicStage;
  if (!stage) {
    out.push(DEFAULT_BGA_TARGET);
    return;
  }
  const geometry = resolveLaneGeometry(ctx);
  // The landscape touch layout gives the BGA's room to the lanes.
  if (geometry.mode === 'touch' && geometry.orientation === 'landscape') return;
  const rect = stage.resolveBGARect(geometry.right);
  const cached = ctx.stageBGATarget;
  if (cached && cached.x === rect.x && cached.y === rect.y && cached.w === rect.w && cached.h === rect.h) {
    out.push(cached);
    return;
  }
  ctx.stageBGATarget = createDefaultBGATarget(rect);
  out.push(ctx.stageBGATarget);
}

/**
 * The gameplay layout handed to the be-music skin's chrome: stage, lanes, playfield bounds, judgement line, and BGA
 * rect. Lane geometry only changes with the chart and the stage, so it is rebuilt when the lane channels, the play
 * variant, or the stage (a rotation) change.
 */
export function resolveBeMusicLayout(ctx: BeMusicLayoutContext): BeMusicGameplayLayout {
  const stage = ctx.beMusicStage ?? LEGACY_STAGE;
  const cached = ctx.beMusicLayout;
  if (
    cached &&
    cached.channels === ctx.play.laneChannels &&
    cached.variant === ctx.play.chartPlayVariant &&
    cached.stage === stage
  ) {
    return withLiftLines(ctx, cached.layout);
  }
  const layout = resolveGameplayLayout(
    { laneChannels: ctx.play.laneChannels, playVariant: ctx.play.chartPlayVariant, layoutMode: ctx.layoutMode },
    stage,
  );
  ctx.beMusicLayout = { channels: ctx.play.laneChannels, variant: ctx.play.chartPlayVariant, stage, layout };
  return withLiftLines(ctx, layout);
}

/** What {@link renderBuiltInChrome} draws into: the chrome layers and pools, the BGA layer and the be-music binding. */
export interface BuiltInChromeContext extends PlayChromeContext, BeMusicLayoutContext {
  readonly skinLayer: Container;
  readonly overlayLayer: Container;
  readonly bgaLayer: Container;
  readonly skinLayerPool: ChildPool;
  readonly overlayLayerPool: ChildPool;
  readonly skinBinding: BeMusicGameplayBinding | undefined;
}

/**
 * Paints the built-in chrome layers (`skinLayer` / `overlayLayer`) for this frame and resets their transforms together
 * with the BGA layer's: the skinless chrome through a host's `skinlessChromeRenderer`, else the be-music skin's
 * `gameplay.renderChrome`, in raw design coordinates.
 */
export function renderBuiltInChrome(
  ctx: BuiltInChromeContext,
  skinlessChromeRenderer: SkinlessGameplayChromeRenderer | undefined,
  runtime: SkinlessGameplayChromeRuntime = resolveSkinlessGameplayChromeRuntime(ctx),
): void {
  ctx.skinLayerPool.begin();
  ctx.overlayLayerPool.begin();
  try {
    ctx.skinLayer.scale.set(1);
    ctx.skinLayer.position.set(0, 0);
    ctx.overlayLayer.scale.set(1);
    ctx.overlayLayer.position.set(0, 0);
    ctx.bgaLayer.scale.set(1);
    ctx.bgaLayer.position.set(0, 0);
    const context = {
      layer: ctx.skinLayer,
      overlayLayer: ctx.overlayLayer,
      layerPool: ctx.skinLayerPool,
      overlayLayerPool: ctx.overlayLayerPool,
      runtime,
    };
    if (skinlessChromeRenderer) {
      skinlessChromeRenderer(context);
    } else {
      ctx.skinBinding?.renderChrome({ ...context, layout: resolveBeMusicLayout(ctx) });
    }
  } finally {
    ctx.skinLayerPool.end();
    ctx.overlayLayerPool.end();
  }
}
