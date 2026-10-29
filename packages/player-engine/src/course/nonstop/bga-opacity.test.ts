import { createEmptyJSON } from '@be-music/chart-source';
import {
  buildBGAOpacityTimelines,
  pickBGAOpacity,
  pickBGATint,
  resolveChart,
  type BGAOpacityTimelines,
} from '@be-music/chart-model';
import { parseBMS } from '@be-music/chart-parser';
import { expect, test } from 'vite-plus/test';
import { flattenNonstopBGAOpacity, hasBGAOpacity, placeNonstopBGAOpacity } from './bga-opacity.ts';
import { stitchNonstopCourse } from './compose.ts';

const empty = (): BGAOpacityTimelines => ({ base: [], layer: [], layer2: [], poor: [] });

test('places opacity on the FIT clock and freezes stage history at negative-BPM reversal', () => {
  const source = parseBMS('#BPM 120\n#0000C:80\n#0010D:40\n#BPM01 -120\n#00208:01\n#0030C:FF');
  const result = placeNonstopBGAOpacity(resolveChart(source), {
    offsetSeconds: -1,
    rate: 2,
    measureOffset: 0,
    cut: 1,
    boundaryMeasure: 4,
    boundarySeconds: 8,
  });
  expect(result.layer).toEqual([{ seconds: -1, opacity: 128 / 255 }]);
  expect(result.layer2).toEqual([{ seconds: 0, opacity: 64 / 255 }]);
  expect(hasBGAOpacity(result)).toBe(true);
  expect(hasBGAOpacity(empty())).toBe(false);
});

test('flattened stage windows restore defaults and carry trimmed leading values without leaking tail events', () => {
  const a = empty(),
    b = empty();
  a.layer = [
    { seconds: 0, opacity: 128 / 255 },
    { seconds: 5, opacity: 64 / 255 },
  ];
  b.layer2 = [
    { seconds: 2, opacity: 32 / 255 },
    { seconds: 4, opacity: 16 / 255 },
    { seconds: 6, opacity: 48 / 255 },
  ];
  const objects = flattenNonstopBGAOpacity([
    { opacity: a, windowStart: Number.NEGATIVE_INFINITY, windowEnd: 4 },
    { opacity: b, windowStart: 4, windowEnd: Number.POSITIVE_INFINITY },
  ]);
  expect(objects.filter((entry) => entry.channel === '0C')).toEqual([
    { seconds: 0, channel: '0C', value: '80', stage: 0 },
    { seconds: 4, channel: '0C', value: 'FF', stage: 1 },
  ]);
  expect(objects.filter((entry) => entry.channel === '0D')).toEqual([
    { seconds: 0, channel: '0D', value: 'FF', stage: 0 },
    { seconds: 4, channel: '0D', value: '10', stage: 1 },
    { seconds: 6, channel: '0D', value: '30', stage: 1 },
  ]);
  expect(flattenNonstopBGAOpacity([{ opacity: empty(), windowStart: 0, windowEnd: 4 }])).toEqual([]);
  // Stage histories remain usable on both sides of a crossfade, independently of the flattened ownership switch.
  expect(pickBGAOpacity(a.layer, 5)).toBe(64 / 255);
  expect(pickBGAOpacity(b.layer2, 3)).toBe(32 / 255);
});

test.each(['fade', 'fade-fit', 'cut', 'cut-fit', 'blank1', 'blank2'] as const)(
  'stitches opacity and stage defaults under %s without changing judged notes',
  (connection) => {
    const a = parseBMS('#BPM 120\n#WAV01 a.wav\n#00111:01\n#00411:01\n#0000B:80\n#0000C:40\n#0000D:20\n#0000E:10');
    const b = parseBMS('#BPM 180\n#WAV01 b.wav\n#00211:01\n#00411:01');
    const result = stitchNonstopCourse([{ chart: a }, { chart: b }], { connections: [connection] });
    const baseline = structuredClone(a);
    baseline.events = baseline.events.filter((event) => !/^0[B-E]$/u.test(event.channel));
    const original = stitchNonstopCourse([{ chart: baseline }, { chart: b }], { connections: [connection] });
    if (!result.ok || !original.ok) throw new Error('Stitch failed');
    expect(resolveChart(result.chart).notes.map((note) => note.seconds)).toEqual(
      resolveChart(original.chart).notes.map((note) => note.seconds),
    );
    expect(result.map.stageRanks).toEqual(original.map.stageRanks);
    const resolved = resolveChart(result.chart);
    const opacity = buildBGAOpacityTimelines(result.chart, resolved.timing);
    const boundary = result.map.stages[1]!.windowStart;
    expect(pickBGAOpacity(opacity.layer, boundary - 0.01)).toBe(64 / 255);
    for (const track of ['base', 'layer', 'layer2', 'poor'] as const) {
      expect(pickBGAOpacity(opacity[track], boundary + 0.001)).toBe(1);
      expect(pickBGAOpacity(opacity[track], boundary - 0.01)).toBeLessThan(1);
    }
    expect(result.map.stages[0]!.bgaOpacity!.layer[0]!.opacity).toBe(64 / 255);
    expect(result.map.stages[1]!.bgaOpacity).toBeUndefined();
  },
);

test('mixed bmson output keeps opacity controls and maps their FIT timing without resource renumbering', () => {
  const a = parseBMS('#BPM 180\n#00111:01\n#00411:01');
  const b = createEmptyJSON('bmson');
  b.metadata.bpm = 120;
  b.bmson.info.modeHint = 'beat-7k';
  b.resources.wav['01'] = 'b.wav';
  b.events = [
    { measure: 2, position: [0, 1], channel: '11', value: '01' },
    { measure: 4, position: [0, 1], channel: '11', value: '01' },
    { measure: 0, position: [0, 1], channel: '0C', value: '80' },
    { measure: 3, position: [0, 1], channel: '0C', value: '40' },
  ];
  const result = stitchNonstopCourse([{ chart: a }, { chart: b }], { connections: ['fade-fit'] });
  if (!result.ok) throw new Error(result.reason);
  expect(result.chart.sourceFormat).toBe('bmson');
  const stage = result.map.stages[1]!;
  expect(stage.placement.rate).toBe(1.5);
  const sourceOpacity = stage.bgaOpacity!.layer;
  expect(sourceOpacity[0]).toEqual({ seconds: stage.placement.offsetSeconds, opacity: 128 / 255 });
  expect(sourceOpacity[1]!.seconds).toBeCloseTo(stage.placement.offsetSeconds + 6 / 1.5);
  const resolved = resolveChart(result.chart);
  const opacity = buildBGAOpacityTimelines(result.chart, resolved.timing);
  expect(pickBGAOpacity(opacity.layer, stage.windowStart + 0.001)).toBe(128 / 255);
  expect(result.chart.events.filter((event) => event.channel === '0C').map((event) => event.value)).toContain('40');
});

test('opacity events after a stage STOP retain their placed times in the flattened chart', () => {
  const a = parseBMS('#BPM 180\n#00111:01\n#00411:01');
  const b = parseBMS('#BPM 120\n#STOP01 96\n#00211:01\n#00411:01\n#00209:01\n#0000C:80\n#0030C:40');
  const result = stitchNonstopCourse([{ chart: a }, { chart: b }], { connections: ['fade-fit'] });
  if (!result.ok) throw new Error(result.reason);
  const resolved = resolveChart(result.chart);
  const cues = buildBGAOpacityTimelines(result.chart, resolved.timing).layer;
  const expected = result.map.stages[1]!.placement.offsetSeconds + 7 / 1.5;
  expect(cues.find((cue) => cue.opacity === 64 / 255)!.seconds).toBeCloseTo(expected, 3);
  expect(pickBGAOpacity(cues, expected - 0.01)).toBe(128 / 255);
  expect(pickBGAOpacity(cues, expected + 0.01)).toBe(64 / 255);
});

test.each(['fade', 'fade-fit', 'cut', 'cut-fit', 'blank1', 'blank2'] as const)(
  'stitches channel ARGB under %s and restores untinted defaults without alpha leakage',
  (connection) => {
    const a = parseBMS(
      '#BPM 120\n#WAV01 a.wav\n#BMP01 a.png\n#00111:01\n#00411:01\n#00004:01\n#ARGB01 0,40,175,48\n#ARGB02 128,234,210,173\n#000A1:01\n#000A2:02\n#0010C:FF',
    );
    const b = parseBMS('#BPM 180\n#WAV01 b.wav\n#00111:01\n#00411:01');
    const result = stitchNonstopCourse([{ chart: a }, { chart: b }], { connections: [connection] });
    if (!result.ok) throw new Error('Stitch failed');
    const controls = buildBGAOpacityTimelines(result.chart, resolveChart(result.chart).timing);
    const boundary = result.map.stages[1]!.windowStart;
    expect(pickBGAOpacity(controls.base, boundary - 0.01)).toBe(0);
    expect(pickBGATint(controls.base, boundary - 0.01)).toBe(0x28af30);
    expect(pickBGATint(controls.layer, boundary - 0.01)).toBe(0xead2ad);
    for (const track of ['base', 'layer', 'layer2', 'poor'] as const) {
      expect(pickBGAOpacity(controls[track], boundary + 0.001)).toBe(1);
      expect(pickBGATint(controls[track], boundary + 0.001)).toBe(0xffffff);
    }
    const stage = result.map.stages[0]!;
    expect(stage.bgaOpacity!.base[0]!.tint).toBe(0x28af30);
    expect(stage.bgaOpacity!.layer.at(-1)!.tint).toBe(0xead2ad);
    expect(result.chart.bms.argb[stage.bmpKeys[0]!]).toBe('0,40,175,48');
    expect(result.chart.events.filter((entry) => /^A[1-4]$/u.test(entry.channel)).length).toBeGreaterThan(4);
  },
);

test('mixed bmson composition retains ARGB controls and independent FIT-adjusted stage colors', () => {
  const a = parseBMS('#BPM 120\n#00111:01\n#00411:01\n#ARGB61 64,1,2,3\n#000A3:61\n#0010D:FF');
  const b = createEmptyJSON('bmson');
  b.metadata.bpm = 180;
  b.events = [
    { measure: 1, position: [0, 1], channel: '11', value: 'note', bmson: { c: false } },
    { measure: 4, position: [0, 1], channel: '11', value: 'note', bmson: { c: false } },
  ];
  b.resources.wav.note = 'b.wav';
  const result = stitchNonstopCourse([{ chart: a }, { chart: b }], { connections: ['fade-fit'] });
  if (!result.ok) throw new Error(result.reason);
  expect(result.chart.sourceFormat).toBe('bmson');
  const controls = buildBGAOpacityTimelines(result.chart, resolveChart(result.chart).timing);
  const boundary = result.map.stages[1]!.windowStart;
  expect(pickBGATint(controls.layer2, boundary - 0.01)).toBe(0x010203);
  expect(pickBGAOpacity(controls.layer2, boundary - 0.01)).toBe(1);
  expect(pickBGATint(controls.layer2, boundary + 0.001)).toBe(0xffffff);
  const placed = result.map.stages[0]!.bgaOpacity!.layer2;
  expect(placed[0]!.seconds).toBe(result.map.stages[0]!.placement.offsetSeconds);
  expect(placed[0]!.tint).toBe(0x010203);
  expect(placed[1]!.seconds).toBeCloseTo(
    result.map.stages[0]!.placement.offsetSeconds + 2 / result.map.stages[0]!.placement.rate,
  );
});
