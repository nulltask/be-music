import { parseBMS, parseBmson } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { expect, test } from 'vite-plus/test';
import { BmsonBGAController } from '../../core/bmson-bga.ts';
import { placeNonstopBmsonBGA } from './bmson-bga.ts';
import { stitchNonstopCourse } from './compose.ts';

const placement = { measureOffset: 0, offsetSeconds: 10, rate: 2, cut: 0, boundaryMeasure: 8, boundarySeconds: 12 };
function source(condition = 'always') {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [
        {
          name: 'note.wav',
          notes: [
            { x: 1, y: 480 },
            { x: 1, y: 1920 },
          ],
        },
      ],
      bga: {
        bga_header: [
          { id: 20, name: 'a.png' },
          { id: 30, name: 'b.webm' },
        ],
        bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 0 }, { time: 1000, id: 1 }, { time: 2000 }] }],
        layer_events: [
          { y: 0, id: 10, condition, interval: 4000 },
          { y: 960, id: 30 },
        ],
      },
    }),
  );
}

test('preserves trimmed ALWAYS phase, maps every filename and scales frame time and interval by FIT', () => {
  const chart = source();
  const original = structuredClone(chart);
  const cues = placeNonstopBmsonBGA(resolveChart(chart), placement, { start: 10.6, end: 12 }, 3, (key) => `s3/${key}`)!;
  expect(cues).toHaveLength(2);
  expect(cues[0]).toMatchObject({
    seconds: 10.6,
    animationStartSeconds: 10,
    stage: 3,
    endSeconds: 12,
    playbackRate: 2,
    interval: 2000,
  });
  expect(cues[0]!.sequences[0]!.frames).toEqual([
    { elapsedSeconds: 0, key: 's3/a.png' },
    { elapsedSeconds: 0.5, key: 's3/b.webm' },
    { elapsedSeconds: 1, end: true },
  ]);
  const state = new BmsonBGAController(cues);
  expect(state.read(10.6)).toMatchObject({
    key: 's3/b.webm',
    startedSeconds: 10,
    frameStartSeconds: 10.5,
    stage: 3,
    playbackRate: 2,
  });
  expect(state.read(11)).toBeUndefined();
  expect(state.read(10.6)?.key).toBe('s3/b.webm');
  expect(chart).toEqual(original);
});

test('does not restart an ended animation at a trimmed start and excludes cues at the next boundary', () => {
  const cues = placeNonstopBmsonBGA(resolveChart(source()), placement, { start: 11.1, end: 12 }, 0, (key) => key)!;
  expect(cues).toHaveLength(1);
  expect(new BmsonBGAController(cues).read(11.1)).toBeUndefined();
  expect(new BmsonBGAController(cues).read(12)).toBeUndefined();
});

test('keeps missing image frames and END markers distinct, fails only on real resource allocation', () => {
  const chart = source();
  chart.bmson.bga.sequences![0]!.sequence.splice(1, 0, { time: 200, id: 999 });
  const cues = placeNonstopBmsonBGA(resolveChart(chart), placement, { start: 0, end: 11 }, 0, (key) => key)!;
  expect(cues[1]!.sequences[0]!.frames[1]).toEqual({ elapsedSeconds: 0.1, key: undefined });
  expect(
    placeNonstopBmsonBGA(resolveChart(chart), placement, { start: 10, end: 11 }, 0, () => undefined),
  ).toBeUndefined();
});

test('freezes source selections and animation at reversal but releases them at the stage boundary', () => {
  const chart = resolveChart(source());
  const cues = placeNonstopBmsonBGA(
    { ...chart, reversal: { ...chart.reversal!, seconds: 1.5 } },
    placement,
    { start: 10, end: 12 },
    0,
    (key) => key,
  )!;
  expect(cues).toHaveLength(1);
  expect(cues[0]!.freezeSeconds).toBe(10.75);
  const state = new BmsonBGAController(cues);
  expect(state.read(11.9)?.key).toBe('b.webm');
  expect(state.read(12)).toBeUndefined();
  expect(state.read(10.1)?.key).toBe('a.png');
  const miss = new BmsonBGAController(cues.map((cue) => ({ ...cue, condition: 'miss' })));
  miss.addInput({ seconds: 10.5, condition: 'miss' });
  miss.addInput({ seconds: 10.9, condition: 'play' });
  miss.addInput({ seconds: 11, condition: 'miss' });
  expect(miss.read(11.5)).toMatchObject({ key: 'a.png', startedSeconds: 10.5 });
  expect(miss.read(12)).toBeUndefined();
});

test.each(['play', 'miss'])(
  'rejects %s triggers after a stage ends and resets selection in an empty stage',
  (condition) => {
    const cues = placeNonstopBmsonBGA(
      resolveChart(source(condition)),
      placement,
      { start: 10, end: 11 },
      0,
      (key) => key,
    )!;
    const next = placeNonstopBmsonBGA(
      resolveChart(parseBMS('#BPM 120')),
      { ...placement, offsetSeconds: 11 },
      { start: 11, end: 12 },
      1,
      (key) => key,
    )!;
    const state = new BmsonBGAController([...cues, ...next]);
    state.addInput({ seconds: 10.9, condition: condition as 'play' | 'miss' });
    state.addInput({ seconds: 11, condition: condition as 'play' | 'miss' });
    expect(state.read(10.95)?.stage).toBe(0);
    expect(state.read(11)).toBeUndefined();
    expect(state.read(11.1)).toBeUndefined();
  },
);

test('mixed courses allocate disjoint resources, preserve stage ownership and do not mutate sources', () => {
  const a = source('play'),
    b = source('miss');
  b.bmson.bga.layerEvents.splice(1);
  const originals = structuredClone([a, b]);
  const result = stitchNonstopCourse([{ chart: a }, { chart: b }, { chart: parseBMS('#BPM 120\n#00111:01') }], {
    connections: ['cut-fit', 'blank2'],
    assetPath: (stage, _kind, path) => `s${stage}/${path}`,
  });
  if (!result.ok) throw new Error(result.reason);
  const cues = result.map.bmsonBGA!;
  const aKey = cues.find((cue) => cue.stage === 0 && cue.sequences.length)!.sequences[0]!.frames[0]!.key!;
  const bKey = cues.find((cue) => cue.stage === 1 && cue.sequences.length)!.sequences[0]!.frames[0]!.key!;
  expect(aKey).not.toBe(bKey);
  expect(result.chart.resources.bmp[aKey]).toBe('s0/a.png');
  expect(result.chart.resources.bmp[bKey]).toBe('s1/a.png');
  expect(result.map.stages[0]!.bmpKeys).toContain(aKey);
  expect(result.map.stages[1]!.bmpKeys).toContain(bKey);
  expect(
    cues.filter((cue) => cue.stage === 0).every((cue) => cue.endSeconds === result.map.stages[1]!.windowStart),
  ).toBe(true);
  expect(cues.find((cue) => cue.stage === 2)?.sequences).toEqual([]);
  expect([a, b]).toEqual(originals);
});
