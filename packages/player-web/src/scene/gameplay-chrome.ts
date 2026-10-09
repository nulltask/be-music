import type { Container } from 'pixi.js';
import type { BeMusicGameplayRuntime, BeMusicJudgeState } from '../skin/be-music/types.ts';
import type { ChildPool } from './pixi-utils.ts';

/** One side's recent judgement state for skinless chrome renderers (the be-music skin type). */
export type SkinlessGameplayJudgeState = BeMusicJudgeState;

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
