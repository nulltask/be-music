import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { collectLR2ChartObjects, resolveLR2RawLane, formatLR2Lane } from './lr2-chart-objects.ts';
import { convertLR2ExtraChart } from './lr2-extra-chart.ts';

test('LR2 raw lane mapping distinguishes scratch, hidden/LN/mine families and PMS routing', () => {
  expect(['16', '36', '56', 'D6', '26', '46', '66', 'E6'].map((channel) => resolveLR2RawLane(channel, false))).toEqual([
    0, 0, 0, 0, 10, 10, 10, 10,
  ]);
  expect(['16', '17', '18', '19', '22', '23', '24', '25'].map((channel) => resolveLR2RawLane(channel, true))).toEqual([
    8, 9, 6, 7, 6, 7, 8, 9,
  ]);
  for (const channel of ['01', '08', 'SC', '1A', '17']) expect(resolveLR2RawLane(channel, false)).toBeUndefined();
  expect([0, 1, 6, 7, 10, 11, 16, 17].map((lane) => formatLR2Lane(lane, false))).toEqual([
    '16',
    '11',
    '18',
    '19',
    '26',
    '21',
    '28',
    '29',
  ]);
  expect([1, 6, 7, 8, 9].map((lane) => formatLR2Lane(lane, true))).toEqual(['11', '16', '17', '18', '19']);
  for (const lane of [-1, 1.5, 20, NaN]) expect(() => formatLR2Lane(lane, false)).toThrow(/lane slot/);
});

test('native timing adds the source blank measure only for a raw normal or hidden zero-position object', () => {
  for (const [objects, expected] of [
    ['#00011:01', 2000],
    ['#00031:01', 2000],
    ['#00051:01\n#00151:01', 0],
    ['#000D1:10', 0],
  ] as const) {
    const source = resolveChart(parseBMS(`#BPM 120\n${objects}`), { playVariant: '7' });
    const stream = collectLR2ChartObjects(source, { tempo: 1, nativeLeadIn: true });
    expect(stream.find((object) => object.note)?.timeMs, objects).toBe(expected);
    expect(collectLR2ChartObjects(source, { tempo: 1 }).find((object) => object.note)?.timeMs).toBe(0);
  }
});

test('native lead timing follows the opening measure length and selected playback tempo', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#00002:0.5\n#00016:01'), { playVariant: '7' });
  expect(collectLR2ChartObjects(source, { tempo: 2, nativeLeadIn: true }).find((object) => object.note)?.timeMs).toBe(
    500,
  );
});

test('decoded heads, tails and mines retain their native op classes and sound ids', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#LNOBJ AA\n#00111:01\n#00211:AA\n#001D2:10'), { playVariant: '7' });
  const stream = collectLR2ChartObjects(source, { tempo: 1, nativeLeadIn: true });
  expect(stream.find((object) => object.note?.kind === 'ln')).toMatchObject({
    op: 11,
    value: 1,
    timeMs: 2000,
    holdEndMs: 4000,
  });
  expect(stream.find((object) => object.op === 51)).toMatchObject({ timeMs: 4000 });
  expect(stream.find((object) => object.note?.kind === 'mine')).toMatchObject({ op: 12, value: 0 });
});

test('EXTRA followed by another conversion retains a fractional raw tail row after stripping the hold', () => {
  const original = resolveChart(parseBMS('#BPM 120\n#LNOBJ AA\n#00111:01\n#00111:000000AA\n#00312:01'), {
    playVariant: '7',
  });
  const extra = convertLR2ExtraChart(original, { level: 0 }).chart;
  expect(extra.notes.every((note) => note.endBeat === undefined)).toBe(true);
  expect(collectLR2ChartObjects(extra, { tempo: 1 }).some((object) => object.op === 51 && object.position === 7)).toBe(
    true,
  );
});
