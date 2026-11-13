import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  type BeMusicReplay,
  type ReplayInputEvent,
  type ReplayNote,
} from '@be-music/player-engine/replay';
import { describe, expect, test } from 'vite-plus/test';
import { resolveResultGaugeGraphs, type GaugeGraphResult } from './gauge-graphs.ts';

const tap = (timeUs: number): ReplayNote => ({ id: 0, channel: '11', type: 'normal', timeUs });
const press = (timeUs: number): Array<Omit<ReplayInputEvent, 'seq'>> => [
  { timeUs, action: 'down', channels: ['11'], source: 0 },
  { timeUs: timeUs + 50_000, action: 'up', channels: ['11'], source: 0 },
];

/** Ten notes a second apart on a 12-second chart: the first four hit, the rest missed. */
function replay(play: Partial<BeMusicReplay['play']> = {}): BeMusicReplay {
  const notes = Array.from({ length: 10 }, (_, index) => tap((index + 1) * 1_000_000));
  const inputs = [1, 2, 3, 4].flatMap((second) => press(second * 1_000_000));
  return {
    format: BE_MUSIC_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75, sourceRank: 2 },
      noteCount: notes.length,
      notes: notes.map((note, id) => ({ ...note, id })),
    },
    inputs: inputs.map((input, seq) => ({ ...input, seq })),
    play: { inputSources: [], mode: 'manual', autoScratch: false, gauge: 'GROOVE', judgeRuleset: 'beatoraja', ...play },
  };
}

const result = (changes: Partial<GaugeGraphResult> = {}): GaugeGraphResult => ({
  replay: replay(),
  chartSeconds: 12,
  gaugeHistory: [{ progress: 1, value: 40 }],
  ...changes,
});

describe('resolveResultGaugeGraphs', () => {
  test('gives one graph per gauge of the play’s ruleset, from its starting value to the end of the play', () => {
    const graphs = resolveResultGaugeGraphs(result());
    expect(graphs.map((graph) => graph.type)).toEqual(['ASSIST-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD', 'HAZARD']);
    for (const graph of graphs) {
      expect(graph.history[0]!.progress).toBe(0);
      expect(graph.history.at(-1)!.progress).toBe(1);
      for (let index = 1; index < graph.history.length; index += 1)
        expect(graph.history[index]!.progress).toBeGreaterThanOrEqual(graph.history[index - 1]!.progress);
    }
    // The first note is a twelfth of the way through; HARD starts full and has lost gauge by the end.
    expect(graphs[2]!.history[0]!.value).toBe(20);
    expect(graphs[2]!.history[1]!.progress).toBeCloseTo(1 / 12, 5);
    expect(graphs[3]!.history[0]!.value).toBe(100);
    expect(graphs[3]!.history.at(-1)!.value).toBeLessThan(100);
    // HAZARD empties at the first miss.
    expect(graphs[5]!.history.at(-1)!.value).toBe(0);
  });

  test('a play that stopped early has no judgment after it', () => {
    // Stopped half-way: only what was judged in the first six seconds.
    const graphs = resolveResultGaugeGraphs(result({ gaugeHistory: [{ progress: 0.5, value: 0 }] }));
    for (const graph of graphs) {
      expect(graph.history.every((sample) => sample.progress <= 0.5)).toBe(true);
      expect(graph.history.at(-1)!.progress).toBe(0.5);
    }
    expect(graphs[0]!.history.length).toBeLessThan(resolveResultGaugeGraphs(result())[0]!.history.length);
  });

  test('has none without a replay or a chart length, and for a course', () => {
    expect(resolveResultGaugeGraphs(result({ replay: undefined }))).toEqual([]);
    expect(resolveResultGaugeGraphs(result({ chartSeconds: undefined }))).toEqual([]);
    expect(resolveResultGaugeGraphs(result({ run: 'course' }))).toEqual([]);
    expect(resolveResultGaugeGraphs(result({ course: {} as never }))).toEqual([]);
  });
});
