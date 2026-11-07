import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  DECIDE_FADE_OUT_MS,
  LAUNCH_HANDOFF_WINDOW_MS,
  LAUNCH_WARP_MS,
  SELECT_LAUNCH_OUTRO_MS,
  SYNESTHESIA_DECIDE_MS,
  WARP_SPEEDUP,
  acceptsLaunchHandoff,
  HANDOFF_LEVEL_DECAY_MS,
  fitInside,
  resolveHandoffLevel,
  recordLaunchHandoff,
  resolveDecideLayout,
  resolveLaunchWarp,
  resolveTitleLockBox,
  resolveWarpStarSpeed,
  takeLaunchHandoff,
  type LaunchHandoff,
} from './launch-warp.ts';

describe('resolveLaunchWarp', () => {
  it('starts with the title wide-tracked and unlit, the reticle wide open and the panels still there', () => {
    const pose = resolveLaunchWarp(0, 'full');
    expect(pose.warp).toBe(0);
    expect(pose.away).toBe(1);
    expect(pose.titleAlpha).toBe(0);
    expect(pose.titleTracking).toBe(16);
    expect(pose.lock).toBe(0);
    expect(pose.artistAlpha).toBe(0);
    expect(pose.genreAlpha).toBe(0);
    expect(pose.detailAlpha).toBe(0);
    expect(pose.detailRise).toBe(10);
    expect(pose.dark).toBe(0);
  });

  it('has the panels gone and the camera straight by the time the select screen hands the warp over', () => {
    const pose = resolveLaunchWarp(SELECT_LAUNCH_OUTRO_MS, 'full');
    expect(pose.away).toBe(0);
    expect(pose.settle).toBe(1);
    expect(pose.titleAlpha).toBe(1);
    // The title is still condensing: the decide screen carries the zoom on.
    expect(pose.titleTracking).toBeGreaterThan(2);
    expect(pose.lock).toBeLessThan(1);
  });

  it('keeps the select outro curves of the original 700 ms warp', () => {
    const pose = resolveLaunchWarp(LAUNCH_WARP_MS * 0.2, 'full');
    expect(pose.warp).toBeCloseTo(0.2);
    expect(pose.titleAlpha).toBeCloseTo(0.8);
    expect(pose.artistAlpha).toBeCloseTo(0.25);
    expect(pose.titleTracking).toBeCloseTo(2 + 14 * (1 - (1 - 0.5 ** 3)));
  });

  it('settles every line once the warp has run', () => {
    const pose = resolveLaunchWarp(LAUNCH_WARP_MS + 200, 'full');
    expect(pose).toMatchObject({
      warp: 1,
      titleAlpha: 1,
      titleTracking: 2,
      lock: 1,
      artistAlpha: 1,
      genreAlpha: 1,
      detailAlpha: 1,
      detailRise: 0,
    });
  });

  it('falls to black over the decide screen’s last moments only', () => {
    const at = (elapsedMs: number) =>
      resolveLaunchWarp(elapsedMs, 'full', { elapsedMs, durationMs: SYNESTHESIA_DECIDE_MS }).dark;
    expect(at(SYNESTHESIA_DECIDE_MS - DECIDE_FADE_OUT_MS)).toBe(0);
    expect(at(SYNESTHESIA_DECIDE_MS - DECIDE_FADE_OUT_MS / 2)).toBeCloseTo(0.5);
    expect(at(SYNESTHESIA_DECIDE_MS)).toBe(1);
    expect(resolveLaunchWarp(SYNESTHESIA_DECIDE_MS, 'full').dark).toBe(0);
  });

  it('drops the moves with effects reduced, keeping the fades', () => {
    const pose = resolveLaunchWarp(50, 'reduced');
    expect(pose.titleTracking).toBe(2);
    expect(pose.lock).toBe(1);
    expect(pose.detailRise).toBe(0);
    expect(pose.titleAlpha).toBeGreaterThan(0);
    expect(pose.titleAlpha).toBeLessThan(1);
  });

  it('shows the settled screen at once with effects off, with no fall to black', () => {
    const pose = resolveLaunchWarp(0, 'off', { elapsedMs: SYNESTHESIA_DECIDE_MS, durationMs: SYNESTHESIA_DECIDE_MS });
    expect(pose).toMatchObject({ titleAlpha: 1, titleTracking: 2, lock: 1, detailAlpha: 1, away: 0, dark: 0 });
  });
});

describe('resolveWarpStarSpeed', () => {
  it('streams with the tempo and opens up over the warp', () => {
    expect(resolveWarpStarSpeed(120, 0, 'full')).toBe(80 + 2 * 55);
    expect(resolveWarpStarSpeed(120, 1, 'full')).toBe((80 + 2 * 55) * (1 + WARP_SPEEDUP));
  });

  it('takes 120 BPM without a tempo and caps a fast one at 300', () => {
    expect(resolveWarpStarSpeed(undefined, 0, 'full')).toBe(resolveWarpStarSpeed(120, 0, 'full'));
    expect(resolveWarpStarSpeed(Number.NaN, 0, 'full')).toBe(resolveWarpStarSpeed(120, 0, 'full'));
    expect(resolveWarpStarSpeed(999, 0, 'full')).toBe(resolveWarpStarSpeed(300, 0, 'full'));
  });

  it('opens up less with effects reduced, and quickens with the music', () => {
    expect(resolveWarpStarSpeed(120, 1, 'reduced')).toBeLessThan(resolveWarpStarSpeed(120, 1, 'full'));
    expect(resolveWarpStarSpeed(120, 0, 'full', 0.5)).toBeCloseTo(190 * 1.6);
  });
});

describe('resolveTitleLockBox', () => {
  it('closes from wide open to the title with a margin', () => {
    expect(resolveTitleLockBox(200, 854, 0)).toEqual({ width: 408, height: 124 });
    expect(resolveTitleLockBox(200, 854, 1)).toEqual({ width: 248, height: 64 });
  });

  it('keeps a long title’s locked box inside the stage', () => {
    expect(resolveTitleLockBox(2000, 854, 1).width).toBe(854 - 80);
    expect(resolveTitleLockBox(2000, 480, 1).width).toBe(480 - 80);
  });
});

describe('resolveDecideLayout', () => {
  it('centres the title where the select screen’s warp sets it', () => {
    const layout = resolveDecideLayout(854, 480);
    expect(layout.centerX).toBe(427);
    expect(layout.titleY).toBe(234);
    expect(layout.titleMaxWidth).toBe(734);
  });

  it('orders genre, title, artist, details and banner down the stage, clear of the reticle', () => {
    for (const [width, height] of [
      [854, 480],
      [480, 854],
    ] as const) {
      const layout = resolveDecideLayout(width, height);
      const lockTop = layout.centerY - 64 / 2 + 4;
      const lockBottom = lockTop + 64;
      expect(layout.genreY).toBeLessThan(lockTop);
      expect(layout.titleY).toBeLessThan(layout.artistY);
      expect(layout.artistY).toBeLessThan(lockBottom);
      expect(layout.detailY).toBeGreaterThan(lockBottom);
      expect(layout.bannerTop).toBeGreaterThan(layout.detailY);
      expect(layout.bannerTop + layout.bannerMaxHeight).toBeLessThanOrEqual(height);
      expect(layout.bannerMaxWidth).toBeLessThanOrEqual(width - 80);
      expect(layout.lineMaxWidth).toBeLessThan(width);
    }
  });

  it('gives the banner no room on a stage too short for it', () => {
    expect(resolveDecideLayout(854, 200).bannerMaxHeight).toBe(0);
  });
});

describe('fitInside', () => {
  it('scales down to the box, keeping the aspect', () => {
    expect(fitInside(600, 160, 300, 80)).toEqual({ width: 300, height: 80 });
    expect(fitInside(300, 300, 300, 80)).toEqual({ width: 80, height: 80 });
  });

  it('never scales a small image up, and gives nothing for an empty one or box', () => {
    expect(fitInside(120, 40, 300, 80)).toEqual({ width: 120, height: 40 });
    expect(fitInside(0, 40, 300, 80)).toEqual({ width: 0, height: 0 });
    expect(fitInside(120, 40, 300, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('launch handoff', () => {
  const handoff: LaunchHandoff = { chartId: 'a', launchAtMs: 1000, lastFrameMs: 1210, travel: 42, level: 0.3 };

  afterEach(() => {
    takeLaunchHandoff('', 0);
  });

  it('carries the same chart’s warp on soon after the select outro', () => {
    expect(acceptsLaunchHandoff(handoff, 'a', 1240)).toBe(true);
    expect(acceptsLaunchHandoff(handoff, 'a', 1210 + LAUNCH_HANDOFF_WINDOW_MS)).toBe(true);
  });

  it('starts afresh for another chart, a stale outro, or a clock that went back', () => {
    expect(acceptsLaunchHandoff(undefined, 'a', 1240)).toBe(false);
    expect(acceptsLaunchHandoff(handoff, 'b', 1240)).toBe(false);
    expect(acceptsLaunchHandoff(handoff, 'a', 1211 + LAUNCH_HANDOFF_WINDOW_MS)).toBe(false);
    expect(acceptsLaunchHandoff(handoff, 'a', 1200)).toBe(false);
  });

  it('hands a recorded outro over once', () => {
    recordLaunchHandoff(handoff);
    expect(takeLaunchHandoff('a', 1240)).toEqual(handoff);
    expect(takeLaunchHandoff('a', 1250)).toBeUndefined();
  });

  it('drops a recorded outro the decide screen cannot take', () => {
    recordLaunchHandoff(handoff);
    expect(takeLaunchHandoff('b', 1240)).toBeUndefined();
    expect(takeLaunchHandoff('a', 1240)).toBeUndefined();
  });
});

describe('resolveHandoffLevel', () => {
  it('lets the select screen’s music level die away', () => {
    expect(resolveHandoffLevel(0.5, 0)).toBe(0.5);
    expect(resolveHandoffLevel(0.5, HANDOFF_LEVEL_DECAY_MS / 2)).toBeCloseTo(0.125);
    expect(resolveHandoffLevel(0.5, HANDOFF_LEVEL_DECAY_MS)).toBe(0);
    expect(resolveHandoffLevel(-1, 0)).toBe(0);
  });
});
