import { parseBMS } from '@be-music/chart-parser';
import { createEmptyJSON } from '@be-music/chart-source';
import { parseBMSExBMP, parseBmsBGA, resolveChart } from '@be-music/chart-model';
import { expect, test, vi } from 'vite-plus/test';
import { KeyBoundBGAController } from '../../core/key-bound-bga.ts';
import { createNonstopBMPAllocator } from './bga-resources.ts';
import { NonstopKeyAllocator } from './ids.ts';
import { placeNonstopKeyBoundBGA } from './key-bound-bga.ts';
import { stitchNonstopCourse } from './compose.ts';

const placement = { measureOffset: 0, offsetSeconds: 10, rate: 2, cut: 0, boundaryMeasure: 8, boundarySeconds: 12 };
const source = () =>
  parseBMS(
    '#BPM 240\n#SWBGA61 100:1000:11:1:255,1,2,3 0002\n#SWBGA62 200:0:12:0:0,0,0,0 02\n#000A5:61\n#001A5:62\n#005A5:61',
  );

test('seeds a trimmed stage, places selections on FIT time, scales animation milliseconds and drops later controls', () => {
  const chart = source();
  const original = structuredClone(chart);
  const bmp = vi.fn((key: string) => `long-internal-${key}`);
  const cues = placeNonstopKeyBoundBGA(resolveChart(chart), placement, { start: 10.25, end: 12 }, 3, bmp)!;
  expect(cues.map(({ seconds, endSeconds, definitionId }) => ({ seconds, endSeconds, definitionId }))).toEqual([
    { seconds: 10.25, endSeconds: 12, definitionId: 'stage:3:61' },
    { seconds: 10.5, endSeconds: 12, definitionId: 'stage:3:62' },
  ]);
  expect(cues[0]!.playbackRate).toBe(2);
  expect(cues[0]!.definition).toMatchObject({
    frameIntervalMs: 50,
    durationMs: 500,
    frames: ['long-internal-00', 'long-internal-02'],
    argb: { a: 255, r: 1, g: 2, b: 3 },
  });
  expect(cues[1]!.definition).toMatchObject({ frameIntervalMs: 100, durationMs: 0, frames: ['long-internal-02'] });
  expect(chart).toEqual(original);
});

test('freezes selections at source reversal, preserves STOP timing and reports allocation failure', () => {
  const chart = parseBMS('#BPM 240\n#STOP01 192\n#SWBGA61 100:0:11:1:0,0,0,0 00\n#00009:01\n#001A5:61');
  const resolved = resolveChart(chart);
  const cues = placeNonstopKeyBoundBGA(resolved, placement, { start: 0, end: 20 }, 0, (key) => key)!;
  expect(cues[0]!.seconds).toBe(11); // One second of STOP plus one second to measure 1, divided by FIT 2.
  expect(
    placeNonstopKeyBoundBGA(
      { ...resolved, reversal: { ...resolved.reversal!, seconds: 1 } },
      placement,
      { start: 0, end: 20 },
      0,
      (key) => key,
    ),
  ).toEqual([]);
  expect(placeNonstopKeyBoundBGA(resolved, placement, { start: 0, end: 20 }, 0, () => undefined)).toBeUndefined();
});

test.each([false, true])('stitches A5-only BMP00, EXBMP and aliases into stage-owned resources (mixed=%s)', (mixed) => {
  const a = parseBMS(
    '#BPM 120\n#BMP00 a.png\n#BGA02 00 0 0 64 64 32 48\n#SWBGA61 100:20000:11:0:255,255,255,255 0002\n#000A5:61\n#00111:01\n#00411:01',
  );
  const b = parseBMS(
    '#BPM 180\n#EXBMP00 0,1,2,3 b.png\n#SWBGA61 200:0:11:1:255,255,255,255 00\n#000A5:61\n#00211:01\n#00411:01',
  );
  const stages = [{ chart: a }, { chart: b }, ...(mixed ? [{ chart: createEmptyJSON('bmson') }] : [])];
  const result = stitchNonstopCourse(stages, {
    connections: ['cut-fit', 'blank2'],
    assetPath: (stage, _kind, path) => `s${stage}/${path}`,
  });
  if (!result.ok) throw new Error(result.reason);
  const cues = result.map.keyBoundBGA!;
  expect(cues).toHaveLength(2);
  expect(new Set(cues.map((cue) => cue.definitionId)).size).toBe(2);
  const [first, second] = cues;
  const [image, alias] = first!.definition.frames;
  expect(result.chart.resources.bmp[image!]).toBe('s0/a.png');
  expect(parseBmsBGA(result.chart.bms.bga[alias!]!, 62, mixed)).toMatchObject({ sourceBMP: image, dx: 32, dy: 48 });
  const nextImage = second!.definition.frames[0]!;
  expect(nextImage).not.toBe(image);
  expect(parseBMSExBMP(result.chart.bms.exBMP[nextImage]!)).toMatchObject({
    filename: 's1/b.png',
    argb: { a: 0, r: 1, g: 2, b: 3 },
  });
  expect(result.map.stages[0]!.bmpKeys).toContain(image);
  expect(second!.definition.frameIntervalMs).toBeCloseTo(200 / result.map.stages[1]!.placement.rate);
  const boundary = result.map.stages[1]!.windowStart;
  expect(first!.endSeconds).toBe(boundary);
  expect(second!.seconds).toBe(boundary);
  const state = new KeyBoundBGAController(cues, {
    inputs: [
      { seconds: 1, action: 'down', channels: ['11'] },
      { seconds: boundary + 0.1, action: 'up', channels: ['11'] },
      { seconds: boundary + 0.2, action: 'down', channels: ['11'] },
    ],
  });
  expect(state.read(boundary - 0.01)?.definitionId).toBe(first!.definitionId);
  expect(state.read(boundary)).toBeUndefined();
  expect(state.read(boundary + 0.25)?.definitionId).toBe(second!.definitionId);
});

test('keeps remapped frames structured past the two-character BMP namespace and fails bounded allocation', () => {
  const chart = createEmptyJSON('bmson');
  chart.bms.base = 62;
  chart.bms.swBGA['61'] = '100:0:11:0:0,0,0,0 0001';
  chart.events.push({ measure: 0, position: [0, 1], channel: 'A5', value: '61' });
  for (let index = 0; index < 4000; index++)
    chart.bms.bga[index === 0 ? '00' : `node${index}`] = `node${index + 1} 0 0 64 64 0 0`;
  chart.resources.bmp.node4000 = 'root.png';
  chart.resources.bmp['01'] = 'last.png';
  for (const unlimited of [false, true]) {
    const target = createEmptyJSON('bmson');
    const bmp = createNonstopBMPAllocator({
      source: chart,
      target,
      stage: 0,
      keys: new NonstopKeyAllocator(unlimited),
      stageKeys: [],
      assetPath: (path) => path,
    });
    const cues = placeNonstopKeyBoundBGA(resolveChart(chart), placement, { start: 0, end: 20 }, 0, bmp);
    if (!unlimited) expect(cues).toBeUndefined();
    else {
      expect(cues![0]!.definition.frames[1]!.length).toBeGreaterThan(2);
      expect(target.resources.bmp[cues![0]!.definition.frames[1]!]).toBe('last.png');
    }
  }
});
