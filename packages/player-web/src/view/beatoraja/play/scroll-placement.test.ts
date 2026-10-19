import { describe, expect, it } from 'vite-plus/test';
import { parseBms } from '@be-music/parser';
import {
  createBeatorajaLaneTimelines,
  createBeatorajaScrollMapper,
  resolveBeatorajaScrollPlacement,
} from './scroll-placement.ts';

const SCROLL_CHART = parseBms(
  ['#BPM 120', '#WAV01 a.wav', '#SCROLL01 0.5', '#00111:01', '#001SC:01', '#00211:01'].join('\n'),
);

describe('createBeatorajaScrollMapper', () => {
  it('builds a distance mapper from the chart #SCROLL', () => {
    const mapper = createBeatorajaScrollMapper(SCROLL_CHART);
    expect(mapper).toBeDefined();
    // Measure 1 (beats 4..8) scrolls at half speed.
    expect(mapper!.distanceBetween(0, 4)).toBeCloseTo(4, 9);
    expect(mapper!.distanceBetween(4, 8)).toBeCloseTo(2, 9);
  });

  it('is undefined for a chart without #SCROLL or #SPEED, so plain charts keep the beat-difference path', () => {
    expect(createBeatorajaScrollMapper(parseBms(['#BPM 120', '#00111:01'].join('\n')))).toBeUndefined();
  });

  it('is undefined when every #SCROLL / #SPEED point is 1, so the chart keeps LR2 drawing rules', () => {
    const chart = parseBms(
      ['#BPM 120', '#WAV01 a.wav', '#SCROLL01 1', '#SPEED01 1', '#00111:01', '#001SC:01', '#001SP:01'].join('\n'),
    );
    expect(createBeatorajaScrollMapper(chart)).toBeUndefined();
  });
});

describe('createBeatorajaLaneTimelines', () => {
  it('lists the beats of the notes, bar lines and #SCROLL points, and times them', () => {
    const timelines = createBeatorajaLaneTimelines(SCROLL_CHART);
    expect([...timelines.beats]).toEqual([0, 4, 8]);
    // 120 BPM: two beats a second.
    expect(timelines.beatToSeconds(4)).toBeCloseTo(2, 9);
  });
});

describe('resolveBeatorajaScrollPlacement', () => {
  it('without a mapper places objects by beat difference and draws by LR2 rules', () => {
    const placement = resolveBeatorajaScrollPlacement({
      currentBeat: 2,
      nowSeconds: 1,
      mapper: undefined,
      laneBeats: 4,
      stageBottomY: 720,
    });
    // A beatoraja skin is a display choice, not a ruleset: a chart that does not scroll draws as in the other skins.
    expect(placement.window).toMatchObject({ rules: 'lr2', currentBeat: 2, nowSeconds: 1, stageBottomY: 720 });
    expect(placement.distance(5)).toBe(3);
  });

  it('with a mapper follows SCROLL and walks the lane by beatoraja LaneRenderer rules', () => {
    const placement = resolveBeatorajaScrollPlacement({
      currentBeat: 4,
      nowSeconds: 2,
      mapper: createBeatorajaScrollMapper(SCROLL_CHART),
      laneBeats: 2,
      stageBottomY: 720,
    });
    expect(placement.distance(6)).toBeCloseTo(1, 9);
    // Two beats of lane distance reach four chart beats ahead at half speed.
    expect(placement.window).toMatchObject({ rules: 'beatoraja', currentBeat: 4, nowSeconds: 2, stageBottomY: 720 });
    expect(placement.window.lastBeat).toBeGreaterThanOrEqual(8);
  });

  it('takes in the first timeline past the lane top', () => {
    const placement = resolveBeatorajaScrollPlacement({
      currentBeat: 0,
      nowSeconds: 0,
      mapper: createBeatorajaScrollMapper(SCROLL_CHART),
      laneBeats: 2,
      timelineBeats: createBeatorajaLaneTimelines(SCROLL_CHART).beats,
      stageBottomY: 720,
    });
    // The lane is overrun at beat 2; the next timeline is the measure-1 note and #SCROLL point at beat 4.
    expect(placement.window.lastBeat).toBe(4);
  });
});

describe('resolveBeatorajaScrollPlacement past an LR2 negative-BPM reversal', () => {
  it('draws against the mirrored judge clock and keeps the reversal as the furthest beat reached', () => {
    const placement = resolveBeatorajaScrollPlacement({
      currentBeat: 14,
      nowSeconds: 9,
      reversal: { beat: 16, seconds: 8 },
      mapper: undefined,
      laneBeats: 4,
      stageBottomY: 720,
    });
    expect(placement.window).toMatchObject({ rules: 'lr2', currentBeat: 14, nowSeconds: 7, reachedBeat: 16 });
    // Objects scroll from the mirrored display beat: one ahead of the reversal sits further up the lane.
    expect(placement.distance(17)).toBe(3);
  });
});
