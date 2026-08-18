import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import type { Container } from 'pixi.js';
import type { ChildPool } from './pixi-utils.ts';

/**
 * One side's recent judgement state for skinless chrome renderers.
 */
export interface SkinlessGameplayJudgeState {
  side: '1P' | '2P';
  /** PERFECT / GREAT / GOOD / BAD / POOR. Empty when no recent judge. */
  judge?: string;
  combo?: number;
}

/**
 * Live gameplay values a skinless chrome renderer can paint without reaching into the LR2 scene internals.
 */
export interface SkinlessGameplayChromeRuntime {
  songTitle?: string;
  songArtist?: string;
  bpm?: number;
  hiSpeed?: number;
  score?: number;
  exScore?: number;
  exScoreMax?: number;
  combo?: number;
  maxCombo?: number;
  perfect?: number;
  great?: number;
  good?: number;
  bad?: number;
  poor?: number;
  gauge?: number;
  clearThreshold?: number;
  laneCount?: number;
  laneChannels?: readonly string[];
  playVariant?: ChartPlayVariant;
  /** PERFECT / GREAT / GOOD / BAD / POOR. Empty when no recent judge. */
  lastJudge?: string;
  /** Per-side judgement snapshots. DP renderers can paint 1P / 2P independently from these values. */
  judgeSides?: readonly SkinlessGameplayJudgeState[];
  /** AAA / AA / A / B / C / D / E / F. */
  rank?: string;
  autoplay?: boolean;
  hasBga?: boolean;
  /** Monotonic play clock (ms) for chrome-side animation (gauge hot-tip flicker, subtle pulses). */
  nowMs?: number;
  /**
   * Milliseconds since `PixiGameplayView.start()`. Drives the default family's per-piece intro and wipe-open.
   * Omit (or leave undefined) for a settled HUD — benches and still frames use that path.
   */
  sceneElapsedMs?: number;
  /** Song progress in [0, 1] — drives the chrome's progress track. */
  progressRatio?: number;
  /** Fractional beat position in [0, 1) — drives beat-synced pulses (judge-line glow, accent trim). */
  beatPhase?: number;
  /** Active compat ruleset id (`lr2` / `beatoraja` / `iidx`) — shown as a chip in the header HUD. */
  rulesetLabel?: string;
  /** Ruleset-scoped gauge id (`GROOVE` / `HARD` / `HAZARD` / ...) labelling the gauge housing. */
  gaugeLabel?: string;
  /** True for survival gauges — the chrome runs the all-red scheme and drops the clear notch. */
  gaugeSurvival?: boolean;
  /** FAST (early GREAT/GOOD) count. */
  fast?: number;
  /** SLOW (late GREAT/GOOD) count. */
  slow?: number;
}

export interface SkinlessGameplayChromeRenderContext {
  layer: Container;
  overlayLayer: Container;
  layerPool: ChildPool;
  overlayLayerPool: ChildPool;
  runtime: SkinlessGameplayChromeRuntime;
}

export type SkinlessGameplayChromeRenderer = (context: SkinlessGameplayChromeRenderContext) => void;
