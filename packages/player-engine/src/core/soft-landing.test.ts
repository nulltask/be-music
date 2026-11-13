import { expect, test, vi } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { addSoftLanding, isSoftLanding } from './scroll-modifier.ts';

// Three 4-beat measures and a half-length one: notes at beats 4 and 6, a mine at 9, a long note from 12 to 14.
const source = () =>
  resolveChart(
    parseChart(
      '#BPM 120\n#LNOBJ AA\n#00111:0001\n#00211:00000000\n#002D2:0001\n#00302:0.5\n#00313:01\n#00413:AA',
      'bms',
    ),
  );
/** Draws in pairs: the side (`< 0.5` stretches), then the amount over 0..100. */
const draws = (...values: number[]) => {
  const random = vi.fn();
  for (const value of values) random.mockReturnValueOnce(value);
  return random;
};

test('recognizes both SOFTLANDING levels', () => {
  const modifiers = ['OFF', 'REMOVE', 'ADD', 'SOFTLANDING-1', 'SOFTLANDING-2', undefined] as const;
  expect(modifiers.map((modifier) => isSoftLanding(modifier))).toEqual([false, false, false, true, true, false]);
});

test('LEVEL 1 draws a factor at every measure, between a half and double', () => {
  const chart = source();
  // Stretch by 1.5, shrink to 1/2, stretch by 1, shrink to 100/150, then the factors of the last measures.
  const random = draws(0, 0.5, 0.9, 0.999, 0.25, 0, 0.75, 0.5, 0, 0);
  const result = addSoftLanding(chart, { level: 1, random });
  expect(result.timeline.map((point) => point.beat)).toEqual([0, 4, 8, 12, 14]);
  expect(result.timeline.map((point) => point.speed)).toEqual([1.5, 0.5, 1, 100 / 150, 1]);
  expect(random).toHaveBeenCalledTimes(10);
  expect(result.changed).toBe(true);
  expect(result.chart.scroll).toBe(result.timeline);
});

test('LEVEL 2 also draws at every note and mine, once per beat, and not at a long note end', () => {
  const chart = source();
  const result = addSoftLanding(chart, { level: 2, random: () => 0 });
  // Measures at 0, 4, 8, 12 and 14; notes at 6 and 12; the mine at 10. The long note's end at 14 is a measure anyway.
  expect(result.timeline.map((point) => point.beat)).toEqual([0, 4, 6, 8, 10, 12, 14]);
  expect(result.timeline.every((point) => point.speed === 1)).toBe(true);
  expect(result.changed).toBe(false);
});

test('changes only the scroll: times, notes and the tempo map are the source', () => {
  const chart = source();
  const result = addSoftLanding(chart, { level: 2, random: () => 0.3 });
  expect(result.chart.timing).toBe(chart.timing);
  expect(result.chart.notes).toBe(chart.notes);
  expect(result.chart.mines).toBe(chart.mines);
  expect(result.chart.barLines).toBe(chart.barLines);
});

test('multiplies the chart’s initial SCROLL and replaces its later values', () => {
  const chart = resolveChart(parseChart('#BPM 120\n#SCROLL01 2\n#SCROLL02 -3\n#000SC:01\n#001SC:02\n#00211:01', 'bms'));
  const result = addSoftLanding(chart, { level: 1, random: draws(0, 0.5, 0.9, 0, 0, 0) });
  expect(result.timeline).toEqual([
    { beat: 0, speed: 3 },
    { beat: 4, speed: 2 },
    { beat: 8, speed: 2 },
  ]);
  expect(result.changed).toBe(true);
});

test('plays a recorded timeline back without drawing, and rejects one that does not fit', () => {
  const chart = source();
  const recorded = addSoftLanding(chart, { level: 1, random: () => 0.7 }).timeline;
  const random = vi.fn();
  expect(addSoftLanding(chart, { level: 1, timeline: recorded, random }).timeline).toEqual(recorded);
  expect(random).not.toHaveBeenCalled();
  expect(() => addSoftLanding(chart, { level: 2, timeline: recorded })).toThrow(/does not match/);
  expect(() =>
    addSoftLanding(chart, { level: 1, timeline: recorded.map((point) => ({ ...point, speed: 2.5 })) }),
  ).toThrow(/Invalid recorded/);
  expect(() =>
    addSoftLanding(chart, { level: 1, timeline: recorded.map((point) => ({ ...point, beat: point.beat + 1 })) }),
  ).toThrow(/Invalid recorded/);
});

test('needs randomness or a recorded timeline', () => {
  expect(() => addSoftLanding(source(), { level: 1 })).toThrow(/requires supplied randomness/);
  expect(() => addSoftLanding(source(), { level: 1, random: () => 1 })).toThrow(/requires supplied randomness/);
});
