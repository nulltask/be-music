import { describe, expect, test } from 'vite-plus/test';
import type { NonstopStagePlacement } from './plan.ts';
import { nonstopBPMAt, resolveNonstopStageRanks, resolveNonstopTempo } from './readouts.ts';

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
    headerBPM: 120,
    rank: 3,
  },
  {
    tempo: [
      { seconds: 0, bpm: 100 },
      { seconds: 3, bpm: 110 },
      { seconds: 30, bpm: 90 },
    ],
    headerBPM: 100,
    rank: 0,
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

describe('nonstopBPMAt', () => {
  const tempo = resolveNonstopTempo(stages, placements);

  test('reads the tempo in force', () => {
    expect(nonstopBPMAt(tempo, -1)).toBe(120);
    expect(nonstopBPMAt(tempo, 9.9)).toBe(120);
    expect(nonstopBPMAt(tempo, 10)).toBe(140);
    expect(nonstopBPMAt(tempo, 25)).toBe(165);
    expect(nonstopBPMAt(tempo, 100)).toBe(135);
  });

  test('is undefined without a tempo', () => {
    expect(nonstopBPMAt([], 1)).toBeUndefined();
  });
});

describe('resolveNonstopStageRanks', () => {
  test("switches to each later stage's #RANK at the boundary when a side has no notes", () => {
    expect(resolveNonstopStageRanks(stages, placements)).toEqual([{ seconds: 20, rank: 0, table: 'chart' }]);
  });

  test("switches halfway between the previous stage's last note and the stage's first", () => {
    const withNotes = [
      { ...stages[0]!, noteHeads: { first: 1, last: 20.5 } },
      { ...stages[1]!, noteHeads: { first: 21.5, last: 40 } },
    ];
    expect(resolveNonstopStageRanks(withNotes, placements)).toEqual([{ seconds: 21, rank: 0, table: 'chart' }]);
  });

  test('reads a later stage without #RANK as NORMAL', () => {
    expect(resolveNonstopStageRanks([stages[0]!, {}], placements)).toEqual([{ seconds: 20, rank: 2, table: 'chart' }]);
  });

  test("switches at the stage's own time zero, by LR2's NONSTOP table, under lr2", () => {
    expect(resolveNonstopStageRanks(stages, placements, { placement: 'lr2' })).toEqual([
      { seconds: 16, rank: 0, table: 'lr2-nonstop' },
    ]);
    expect(resolveNonstopStageRanks([stages[0]!, {}], placements, { placement: 'lr2' })).toEqual([]);
    expect(resolveNonstopStageRanks([stages[0]!, { rank: 1.9 }], placements, { placement: 'lr2' })).toEqual([
      { seconds: 16, rank: 1, table: 'lr2-nonstop' },
    ]);
  });
});
