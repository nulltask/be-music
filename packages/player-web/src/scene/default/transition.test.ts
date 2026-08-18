import { describe, expect, it } from 'vitest';
import {
  coverAmount,
  decideCloseCover,
  decideCover,
  DECIDE_TIMELINE,
  fallbackSceneElapsed,
  GAMEPLAY_TIMELINE,
  pieceT,
  readyAlpha,
  resultJudgeT,
  selectRowT,
} from './transition.ts';

describe('coverAmount', () => {
  it('opens from covered to revealed', () => {
    expect(coverAmount(0, 0, 400, 'open')).toBe(1);
    expect(coverAmount(400, 0, 400, 'open')).toBe(0);
    expect(coverAmount(200, 0, 400, 'open')).toBeGreaterThan(0);
    expect(coverAmount(200, 0, 400, 'open')).toBeLessThan(1);
  });

  it('closes from revealed to covered', () => {
    expect(coverAmount(0, 0, 400, 'close')).toBe(0);
    expect(coverAmount(400, 0, 400, 'close')).toBe(1);
  });
});

describe('per-piece stagger', () => {
  it('keeps later select rows behind earlier ones', () => {
    expect(selectRowT(250, 0)).toBeGreaterThan(selectRowT(250, 4));
    expect(selectRowT(2000, 8)).toBe(1);
  });

  it('keeps later result judge rows behind earlier ones', () => {
    expect(resultJudgeT(400, 0)).toBeGreaterThan(resultJudgeT(400, 4));
  });

  it('leaves header pieces at 0 until their delay', () => {
    expect(pieceT(100, GAMEPLAY_TIMELINE.header)).toBe(0);
    expect(pieceT(2000, GAMEPLAY_TIMELINE.header)).toBe(1);
  });
});

describe('decide / ready handoff', () => {
  it('stays open through the hold, then closes into gameplay', () => {
    expect(decideCloseCover(DECIDE_TIMELINE.closeDelay - 1)).toBe(0);
    expect(decideCloseCover(DECIDE_TIMELINE.total)).toBe(1);
  });

  it('covers the first and last frames so neighbouring scenes can iris through void', () => {
    expect(decideCover(0)).toBe(1);
    expect(decideCover(700)).toBeLessThan(0.05);
    expect(decideCover(DECIDE_TIMELINE.total)).toBe(1);
  });

  it('fades READY out before the fallback intro delay ends', () => {
    expect(readyAlpha(0)).toBe(0);
    expect(readyAlpha(800)).toBeGreaterThan(0.5);
    expect(readyAlpha(GAMEPLAY_TIMELINE.readyHoldUntil + GAMEPLAY_TIMELINE.readyFade)).toBe(0);
  });
});

describe('fallbackSceneElapsed', () => {
  it('uses the live clock when provided and settles the HUD when omitted', () => {
    expect(fallbackSceneElapsed(0)).toBe(0);
    expect(fallbackSceneElapsed(240)).toBe(240);
    expect(fallbackSceneElapsed(undefined)).toBe(10_000);
    expect(fallbackSceneElapsed(Number.NaN)).toBe(10_000);
  });
});
