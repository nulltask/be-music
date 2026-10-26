import { expect, test, vi } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { addScrollChanges, clampScrollRate, clampScrollSection } from './scroll-modifier.ts';

const source = () =>
  resolveChart(parseChart('#BPM 120\n#SCROLL01 2\n#SCROLL02 -3\n#000SC:01\n#001SC:02\n#00102:0.5\n#00711:01', 'bms'));

test('ADD counts the first section line and uneven measures, using the first scroll as its base', () => {
  const chart = source();
  const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.75);
  const result = addScrollChanges(chart, { random });
  expect(result).toMatchObject({ changed: true, section: 4, rate: 0.5 });
  expect(result.timeline).toEqual([
    { beat: 0, speed: 2 },
    { beat: 10, speed: 1 },
    { beat: 26, speed: 2.5 },
  ]);
  expect(random).toHaveBeenCalledTimes(2);
  expect(result.chart.scroll).toBe(result.timeline);
  expect(chart.scroll).toContainEqual({ beat: 4, speed: -3 });
});

test('ADD changes only scroll: source timing, notes, LN endpoints, BGA, volume and section lines remain shared', () => {
  const chart = resolveChart(
    parseChart(
      '#BPM 120\n#BPM01 240\n#STOP01 192\n#LNOBJ AA\n#00108:01\n#00109:01\n#00111:01\n#00311:AA\n#00334:01\n#003D3:0A',
      'bms',
    ),
  );
  const result = addScrollChanges(chart, { section: 1, random: () => 0 });
  expect(result.chart).not.toBe(chart);
  for (const key of [
    'source',
    'sourceFormat',
    'randomDraws',
    'hasUnresolvedControlFlow',
    'idBase',
    'playVariant',
    'layouts',
    'lnMode',
    'inferBmsLNTypeWhenMissing',
    'beatResolver',
    'timing',
    'reversal',
    'sortedEvents',
    'notes',
    'shadowedNotes',
    'mines',
    'invisibleNotes',
    'sampleTriggers',
    'volumeChanges',
    'bga',
    'speed',
    'barLines',
    'barLinesSuppressed',
    'judgeRank',
    'total',
    'lastNoteSeconds',
  ] as const) {
    expect(result.chart[key], key).toEqual(chart[key]);
  }
  expect(result.chart.notes).toBe(chart.notes);
  expect(result.chart.timing).toBe(chart.timing);
  expect(result.chart.barLines).toBe(chart.barLines);
  expect(result.timeline.slice(0, 2)).toEqual([
    { beat: 0, speed: 1 },
    { beat: 0, speed: 0.5 },
  ]);
});

test('rate zero still draws at each selected section, overwriting original SCROLL without claiming an assist policy', () => {
  const chart = source();
  const random = vi.fn(() => 0.1);
  expect(addScrollChanges(chart, { section: 1, rate: 0, random }).changed).toBe(true);
  expect(random).toHaveBeenCalledTimes(8);
  const constant = resolveChart(parseChart('#BPM 120\n#00311:01', 'bms'));
  expect(addScrollChanges(constant, { rate: 0, random: () => 0 }).changed).toBe(false);
});

test('ADD retains negative and zero first-scroll values', () => {
  for (const base of [-2, 0]) {
    const chart = resolveChart(parseChart(`#BPM 120\n#SCROLL01 ${base}\n#000SC:01\n#00111:01`, 'bms'));
    expect(addScrollChanges(chart, { section: 1, rate: 1, random: () => 0.75 }).timeline).toEqual([
      { beat: 0, speed: base },
      { beat: 0, speed: base * 1.5 },
      { beat: 4, speed: base * 1.5 },
    ]);
  }
});

test('recorded effective timeline restores without drawing and rejects mismatched anchors or out-of-range values atomically', () => {
  const chart = source();
  const original = structuredClone(chart.source);
  const first = addScrollChanges(chart, { random: () => 0.25 });
  const random = vi.fn(() => {
    throw new Error('reroll');
  });
  const result = addScrollChanges(chart, { random, timeline: first.timeline });
  expect(result.timeline).toEqual(first.timeline);
  expect(result.timeline).not.toBe(first.timeline);
  expect(random).not.toHaveBeenCalled();
  for (const timeline of [
    [],
    [{ beat: 0, speed: 2 }],
    first.timeline.map((point, index) => ({ ...point, beat: index ? point.beat + 1 : 0 })),
    first.timeline.map((point, index) => ({ ...point, speed: index ? 99 : 2 })),
  ]) {
    expect(() => addScrollChanges(chart, { timeline, random })).toThrow(/scroll ADD/);
  }
  expect(() => addScrollChanges(chart, { random: () => NaN })).toThrow(/randomness/);
  expect(chart.source).toEqual(original);
});

test('config bounds and non-finite fallbacks follow PlayerConfig', () => {
  expect([0, 4, 2048, 2.9, NaN].map(clampScrollSection)).toEqual([1, 4, 1024, 2, 4]);
  expect([-1, 0.25, 2, Infinity, NaN].map(clampScrollRate)).toEqual([0, 0.25, 1, 0.5, 0.5]);
});

test('bmson with suppressed section lines generates no draws or invented section changes', () => {
  const chart = resolveChart(
    parseChart(
      JSON.stringify({
        version: '1.0.0',
        info: { init_bpm: 120, mode_hint: 'beat-7k', resolution: 240 },
        lines: [],
        sound_channels: [{ name: 'note.wav', notes: [{ x: 1, y: 960, l: 0, c: false }] }],
      }),
      'bmson',
    ),
  );
  const random = vi.fn(() => 0);
  expect(addScrollChanges(chart, { section: 1, random }).timeline).toEqual([{ beat: 0, speed: 1 }]);
  expect(random).not.toHaveBeenCalled();
});
