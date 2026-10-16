import type { LaneCoverState } from '@be-music/scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { ZERO_BEATORAJA_OFFSET, type BeatorajaSkinOffsetValue } from '../elements/destination.ts';
import { BEATORAJA_GAUGE_MODE } from '../elements/gauge.ts';
import {
  OFFSET_ALL,
  OFFSET_HIDDEN_COVER,
  OFFSET_LIFT,
  SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_1P,
  SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_2P,
} from '../runtime-ids.ts';
import {
  BEATORAJA_LANE_JUDGE_WINDOW_MS,
  beatorajaGaugePercent,
  beatorajaJudgeCountBars,
  beatorajaJudgeStateSlot,
  beatorajaLaneJudgeImage,
  beatorajaLaneJudgeRef,
  beatorajaNoteBreakdownBars,
  beatorajaTimingHistogram,
  createBeatorajaJudgeStateGraph,
  resolveBeatorajaGaugePolyline,
  resolveBeatorajaGaugeState,
  resolveBeatorajaJudgeStateMove,
  resolveBeatorajaPlayGraphValue,
  resolveBeatorajaPlayJudgeGraph,
  resolveBeatorajaPlaySliderValue,
  resolveBeatorajaScorePolyline,
  writeBeatorajaPlayOffset,
  type BeatorajaPlayOffsetInput,
} from './play-graphs.ts';

const SCORE = { total: 10, perfect: 5, great: 2, good: 1, bad: 1, poor: 1, exScore: 12, score: 12 };

function cover(overrides: Partial<LaneCoverState>): LaneCoverState {
  return { side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0, ...overrides };
}

describe('resolveBeatorajaGaugeState', () => {
  it("names the gauge's mode and keeps its border", () => {
    expect(resolveBeatorajaGaugeState({ current: 64, max: 100, clearThreshold: 80, type: 'CLASS' })).toEqual({
      value: 64,
      max: 100,
      border: 80,
      mode: BEATORAJA_GAUGE_MODE.CLASS,
    });
    expect(resolveBeatorajaGaugeState({ current: 64, max: 100, type: 'GRADE-HARD' })).toMatchObject({
      border: 0,
      mode: BEATORAJA_GAUGE_MODE.EXCLASS,
    });
    expect(resolveBeatorajaGaugeState({ current: 0, max: 0 })).toBeUndefined();
    expect(resolveBeatorajaGaugeState(undefined)).toBeUndefined();
    expect(beatorajaGaugePercent({ current: 30, max: 120 })).toBe(25);
    expect(beatorajaGaugePercent(undefined)).toBe(0);
  });
});

describe('resolveBeatorajaPlayGraphValue / resolveBeatorajaPlaySliderValue', () => {
  const clock = { currentSeconds: 30, totalSeconds: 120 };

  it('fills the gauge and progress bars once a frame arrived', () => {
    const graph = { clock, gauge: { current: 40, max: 80 } };
    expect(resolveBeatorajaPlayGraphValue(1, graph)).toBe(0.5);
    expect(resolveBeatorajaPlayGraphValue(6, graph)).toBe(0.5);
    expect(resolveBeatorajaPlayGraphValue(2, graph)).toBe(0.25);
    expect(resolveBeatorajaPlayGraphValue(102, graph)).toBe(1);
    expect(resolveBeatorajaPlayGraphValue(3, graph)).toBeUndefined();
    expect(resolveBeatorajaPlayGraphValue(1, { clock })).toBe(0);
    expect(resolveBeatorajaPlayGraphValue(2, { clock: { currentSeconds: 1, totalSeconds: 0 } })).toBe(0);
    expect(resolveBeatorajaPlayGraphValue(1, {})).toBeUndefined();
  });

  it('moves the lane cover and progress sliders', () => {
    const sliders = { clock, cover: cover({ sudden: 0.4, suddenOn: true }) };
    expect(resolveBeatorajaPlaySliderValue(4, sliders)).toBe(0.4);
    expect(resolveBeatorajaPlaySliderValue(5, sliders)).toBe(0.4);
    expect(resolveBeatorajaPlaySliderValue(6, sliders)).toBe(0.25);
    expect(resolveBeatorajaPlaySliderValue(6, { clock: { currentSeconds: 200, totalSeconds: 120 } })).toBe(1);
    expect(resolveBeatorajaPlaySliderValue(6, {})).toBe(0);
    expect(resolveBeatorajaPlaySliderValue(4, {})).toBe(0);
    expect(resolveBeatorajaPlaySliderValue(17, sliders)).toBeUndefined();
  });
});

describe('polylines', () => {
  it('scales the EX-score graph to its maximum and keeps the points while the samples stay', () => {
    const history = [
      { progress: 0.1, exScore: 5 },
      { progress: 1.2, exScore: 30 },
    ];
    const points = resolveBeatorajaScorePolyline(history, 10);
    expect(points).toEqual([
      { x: 0.1, y: 0.25 },
      { x: 1, y: 1 },
    ]);
    expect(resolveBeatorajaScorePolyline(history, 10)).toBe(points);
    history.push({ progress: 1, exScore: 20 });
    expect(resolveBeatorajaScorePolyline(history, 10)).toHaveLength(3);
    expect(resolveBeatorajaScorePolyline([], 10)).toBeUndefined();
    expect(resolveBeatorajaScorePolyline(history, 0)).toBeUndefined();
  });

  it('draws the gauge graph in percent', () => {
    expect(
      resolveBeatorajaGaugePolyline([
        { progress: 0.5, value: 150 },
        { progress: 1, value: 40 },
      ]),
    ).toEqual([
      { x: 0.5, y: 1 },
      { x: 1, y: 0.4 },
    ]);
    expect(resolveBeatorajaGaugePolyline([])).toBeUndefined();
  });
});

describe('judge graphs', () => {
  const breakdown = { normal: 100, ln: 20, scratch: 15, bss: 2 };

  it('draws the note kinds, the counts so far and the timing histogram', () => {
    const bars = beatorajaNoteBreakdownBars(breakdown);
    expect(bars).toEqual([100, 20, 15, 2]);
    expect(beatorajaNoteBreakdownBars(breakdown)).toBe(bars);
    expect(beatorajaJudgeCountBars(SCORE)).toEqual([5, 2, 1, 1, 1]);
    const input = { breakdown, score: SCORE, recentTimings: [{ deltaMs: -100 }, { deltaMs: 4 }, { deltaMs: 250 }] };
    expect(resolveBeatorajaPlayJudgeGraph(0, input)).toBe(bars);
    expect(resolveBeatorajaPlayJudgeGraph(1, input)).toEqual([5, 2, 1, 1, 1]);
    const histogram = resolveBeatorajaPlayJudgeGraph(2, input)!;
    expect(histogram).toHaveLength(21);
    expect(histogram[0]).toBe(1);
    expect(histogram[10]).toBe(1);
    expect(histogram[20]).toBe(1);
    expect(resolveBeatorajaPlayJudgeGraph(1, { breakdown, recentTimings: [] })).toBeUndefined();
    expect(resolveBeatorajaPlayJudgeGraph(0, { score: SCORE, recentTimings: [] })).toBeUndefined();
    expect(resolveBeatorajaPlayJudgeGraph(3, input)).toBeUndefined();
  });

  it('bins offsets by 10 ms around 0, saturating the outer bins', () => {
    const bins = beatorajaTimingHistogram([{ deltaMs: -95 }, { deltaMs: -500 }, { deltaMs: 99.9 }, { deltaMs: -0.5 }]);
    expect(bins).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
    expect(beatorajaTimingHistogram([])).toBeUndefined();
  });
});

describe('judge-state graph', () => {
  const distribution = {
    // [scratch LN end, scratch LN body, scratch, key LN end, key LN body, key, mine] per second.
    buckets: [
      [1, 5, 2, 1, 9, 6, 4],
      [0, 0, 0, 0, 0, 3, 0],
    ],
    totalMs: 2000,
  };

  it('starts with every judged note unjudged in its second, scaled to the busiest second', () => {
    expect(createBeatorajaJudgeStateGraph(distribution)).toEqual({
      buckets: [
        [10, 0, 0, 0, 0, 0],
        [3, 0, 0, 0, 0, 0],
      ],
      maxCount: 20,
      totalMs: 2000,
    });
    expect(createBeatorajaJudgeStateGraph({ buckets: [[0, 0, 0, 0, 0, 95, 0]], totalMs: 1000 })?.maxCount).toBe(100);
    expect(createBeatorajaJudgeStateGraph({ buckets: [[0, 0, 0, 0, 0, 35, 0]], totalMs: 1000 })?.maxCount).toBe(40);
    expect(createBeatorajaJudgeStateGraph({ buckets: [], totalMs: 0 })).toBeUndefined();
  });

  it("moves a judged note from its second's unjudged slot to the judgment's", () => {
    const graph = createBeatorajaJudgeStateGraph(distribution)!;
    expect(resolveBeatorajaJudgeStateMove(graph, 'GREAT', 1_400)).toEqual({ bucket: 1, slot: 2 });
    expect(resolveBeatorajaJudgeStateMove(graph, 'POOR', 0)).toEqual({ bucket: 0, slot: 5 });
    expect(resolveBeatorajaJudgeStateMove(graph, 'READY', 0)).toBeUndefined();
    expect(resolveBeatorajaJudgeStateMove(graph, 'PERFECT', 5_000)).toBeUndefined();
    expect(resolveBeatorajaJudgeStateMove(graph, 'PERFECT', -1)).toBeUndefined();
    const emptied = { ...graph, buckets: [[0, 10, 0, 0, 0, 0]] };
    expect(resolveBeatorajaJudgeStateMove(emptied, 'PERFECT', 10)).toBeUndefined();
    expect(['PERFECT', 'GREAT', 'GOOD', 'BAD', 'POOR', 'MISS', 'READY'].map(beatorajaJudgeStateSlot)).toEqual([
      1, 2, 3, 4, 5, 5, 0,
    ]);
  });
});

describe('lane judgments', () => {
  it('names the side and lane of a lane-judgment ref', () => {
    expect(beatorajaLaneJudgeRef(500)).toEqual({ side: 1, lane: 0 });
    expect(beatorajaLaneJudgeRef(509)).toEqual({ side: 1, lane: 9 });
    expect(beatorajaLaneJudgeRef(513)).toEqual({ side: 2, lane: 3 });
    expect(beatorajaLaneJudgeRef(520)).toBeUndefined();
    expect(beatorajaLaneJudgeRef(11)).toBeUndefined();
  });

  it('shows the latest judgment for a moment after it', () => {
    expect(beatorajaLaneJudgeImage(0, 0)).toBe(1);
    expect(beatorajaLaneJudgeImage(1, BEATORAJA_LANE_JUDGE_WINDOW_MS)).toBe(2);
    expect(beatorajaLaneJudgeImage(1, BEATORAJA_LANE_JUDGE_WINDOW_MS + 1)).toBe(0);
    expect(beatorajaLaneJudgeImage(1, -1)).toBe(0);
    expect(beatorajaLaneJudgeImage(-1, 0)).toBe(0);
  });
});

describe('writeBeatorajaPlayOffset', () => {
  const offsets = (overrides: Partial<BeatorajaPlayOffsetInput> = {}): BeatorajaPlayOffsetInput => ({
    laneHeight: 580,
    maxCombo: 0,
    comboDigits: { 1: { width: 40, space: 0 }, 2: { width: 30, space: 6 } },
    ...overrides,
  });
  const write = (id: number, input: BeatorajaPlayOffsetInput): BeatorajaSkinOffsetValue | undefined => {
    const out = { ...ZERO_BEATORAJA_OFFSET };
    return writeBeatorajaPlayOffset(id, input, out) ? out : undefined;
  };

  it('raises the lane by the LIFT and leaves the offset to the skin without one', () => {
    expect(write(OFFSET_LIFT, offsets({ cover: cover({ lift: 0.25 }) }))).toMatchObject({ x: 0, y: -145, a: 0 });
    expect(write(OFFSET_LIFT, offsets({ cover: cover({}) }))).toBeUndefined();
    expect(write(OFFSET_LIFT, offsets())).toBeUndefined();
  });

  it('hides HIDDEN+ while off and lowers it within the lane above the LIFT', () => {
    expect(write(OFFSET_HIDDEN_COVER, offsets({ cover: cover({ hidden: 0.5 }) }))).toMatchObject({ a: -255 });
    expect(write(OFFSET_HIDDEN_COVER, offsets())).toMatchObject({ a: -255 });
    expect(write(OFFSET_HIDDEN_COVER, offsets({ cover: cover({ hidden: 0.5, hiddenOn: true }) }))).toMatchObject({
      y: -290,
      a: 0,
    });
    expect(
      write(OFFSET_HIDDEN_COVER, offsets({ cover: cover({ hidden: 0.5, hiddenOn: true, lift: 0.5 }) })),
    ).toMatchObject({ y: -145, a: 0 });
  });

  it("shifts the judge word left by half its combo digits' width", () => {
    expect(write(SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_1P, offsets({ maxCombo: 0 }))?.x).toBe(-20);
    expect(write(SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_1P, offsets({ maxCombo: 123 }))?.x).toBe(-60);
    expect(write(SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_2P, offsets({ maxCombo: 45 }))?.x).toBe(-36);
  });

  it('sets no other offset', () => {
    expect(write(OFFSET_ALL, offsets())).toBeUndefined();
  });
});
