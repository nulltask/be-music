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
  /** Song progress in [0, 1] — drives the chrome's progress track. */
  progressRatio?: number;
}

export interface SkinlessGameplayChromeRenderContext {
  layer: Container;
  overlayLayer: Container;
  layerPool: ChildPool;
  overlayLayerPool: ChildPool;
  runtime: SkinlessGameplayChromeRuntime;
}

export type SkinlessGameplayChromeRenderer = (context: SkinlessGameplayChromeRenderContext) => void;
