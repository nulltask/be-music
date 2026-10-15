import { describe, expect, test } from 'vite-plus/test';
import type { NonstopStagePlacement } from './plan.ts';
import { nonstopBpmAt, resolveNonstopTempo } from './readouts.ts';

const placement = (offsetSeconds: number, boundarySeconds: number, rate = 1): NonstopStagePlacement => ({
  measureOffset: 0,
  offsetSeconds,
  rate,
  cut: 0,
  boundaryMeasure: 0,
  boundarySeconds,
});

/** Stage 1 hands over at 20 s; stage 2 starts (its time zero) at 16 s, cut 4 s before the boundary, at FIT 1.5. */
const placements = [placement(0, 20), placement(16, 50, 1.5)];
const stages = [
  {
    tempo: [
      { seconds: 0, bpm: 120 },
      { seconds: 10, bpm: 140 },
      { seconds: 21, bpm: 200 },
    ],
    headerBpm: 120,
  },
  {
    tempo: [
      { seconds: 0, bpm: 100 },
      { seconds: 3, bpm: 110 },
      { seconds: 30, bpm: 90 },
    ],
    headerBpm: 100,
  },
];

describe('resolveNonstopTempo', () => {
  test("shows each stage's FIT-scaled BPM over its own window", () => {
    expect(resolveNonstopTempo(stages, placements)).toEqual([
      { seconds: 0, bpm: 120 },
      { seconds: 10, bpm: 140 },
      { seconds: 20, bpm: 165 },
      { seconds: 36, bpm: 135 },
    ]);
  });

  test("follows LR2's event order with the lr2 placement", () => {
    expect(resolveNonstopTempo(stages, placements, { placement: 'lr2' })).toEqual([
      { seconds: 0, bpm: 120 },
      { seconds: 10, bpm: 140 },
      { seconds: 16, bpm: 150 },
      { seconds: 18, bpm: 165 },
      { seconds: 36, bpm: 135 },
    ]);
  });

  test('keeps the previous BPM for a later stage without #BPM under lr2', () => {
    const tempo = resolveNonstopTempo([stages[0]!, { tempo: [{ seconds: 0, bpm: 130 }] }], placements, {
      placement: 'lr2',
    });
    expect(tempo.map((point) => point.bpm)).toEqual([120, 140]);
  });
});

describe('nonstopBpmAt', () => {
  const tempo = resolveNonstopTempo(stages, placements);

  test('reads the tempo in force', () => {
    expect(nonstopBpmAt(tempo, -1)).toBe(120);
    expect(nonstopBpmAt(tempo, 9.9)).toBe(120);
    expect(nonstopBpmAt(tempo, 10)).toBe(140);
    expect(nonstopBpmAt(tempo, 25)).toBe(165);
    expect(nonstopBpmAt(tempo, 100)).toBe(135);
  });

  test('is undefined without a tempo', () => {
    expect(nonstopBpmAt([], 1)).toBeUndefined();
  });
});
