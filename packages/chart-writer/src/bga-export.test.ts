import { expect, test } from 'vite-plus/test';
import { buildBGATimelines, createTimingResolver } from '@be-music/chart-model';
import { parseBmson, parseChart } from '@be-music/chart-parser';
import type { BeMusicJSON } from '@be-music/chart-source';
import { stringifyBMS, stringifyBmson, type ChartExportDiagnostic } from './index.ts';

const cues = (json: BeMusicJSON) => {
  const timelines = buildBGATimelines(json, createTimingResolver(json));
  const names = (plane: keyof typeof timelines) =>
    timelines[plane].map((cue) => [cue.seconds, cue.key === undefined ? undefined : imageName(json, cue.key)]);
  return { base: names('base'), layer: names('layer'), poor: names('poor') };
};
const imageName = (json: BeMusicJSON, key: string) =>
  json.sourceFormat === 'bmson' ? key : (json.resources.bmp[key] ?? `missing:${key}`);

function bms(...lines: string[]) {
  return parseChart(['#TITLE bga', '#BPM 120', ...lines].join('\n'), 'chart.bms');
}

test('#839: ordinary BMS BGA survives bmson export with its images and cue times', () => {
  const source = bms('#BMP01 image.png', '#00104:01', '#00207:01', '#00306:01');
  const output = JSON.parse(stringifyBmson(source));
  expect(output.bga.bga_header).toEqual([{ id: 1, name: 'image.png' }]);
  expect(output.bga.bga_events).toEqual([{ y: 960, id: 1 }]);
  expect(output.bga.layer_events).toEqual([{ y: 1920, id: 1 }]);
  expect(output.bga.poor_events).toEqual([{ y: 2880, id: 1 }]);
  expect(cues(parseBmson(JSON.stringify(output)))).toEqual({
    base: [[2, 'image.png']],
    layer: [[4, 'image.png']],
    poor: [[6, 'image.png']],
  });
  // The output resolution only changes the pulse grid.
  expect(JSON.parse(stringifyBmson(source, { resolution: 48 })).bga.bga_events).toEqual([{ y: 192, id: 1 }]);
});

test('#839: BMP00 becomes the initial POOR image unless #POORBGA 2 hides POOR', () => {
  const withFallback = JSON.parse(stringifyBmson(bms('#BMP00 miss.png', '#BMP01 a.png', '#00104:01')));
  expect(withFallback.bga.bga_header).toEqual([
    { id: 1, name: 'miss.png' },
    { id: 2, name: 'a.png' },
  ]);
  expect(withFallback.bga.poor_events).toEqual([{ y: 0, id: 1 }]);
  const hidden = JSON.parse(
    stringifyBmson(bms('#POORBGA 2', '#BMP00 miss.png', '#00306:00', '#BMP01 a.png', '#00306:01')),
  );
  expect(hidden.bga.poor_events).toEqual([]);
});

test('#839: undefined images stay blank and base-62 keys stay distinct', () => {
  const missing = JSON.parse(stringifyBmson(bms('#BMP01 a.png', '#00104:0102')));
  expect(missing.bga.bga_events).toEqual([
    { y: 960, id: 1 },
    { y: 1440, id: 2 },
  ]);
  expect(cues(parseBmson(JSON.stringify(missing))).base).toEqual([
    [2, 'a.png'],
    [3, undefined],
  ]);
  const base62 = JSON.parse(stringifyBmson(bms('#BASE 62', '#BMP0a lower.png', '#BMP0A upper.png', '#00104:0a0A')));
  expect(cues(parseBmson(JSON.stringify(base62))).base).toEqual([
    [2, 'lower.png'],
    [3, 'upper.png'],
  ]);
});

test('#839: parts native bmson cannot hold are reported, not merged', () => {
  const diagnostics: ChartExportDiagnostic[] = [];
  const output = JSON.parse(
    stringifyBmson(bms('#BMP01 a.png', '#BGA02 01 0 0 128 128 0 0', '#00107:01', '#0010A:01', '#0010B:FF'), {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }),
  );
  expect(diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([
    'bga-extended',
    'bga-layer-black-key',
    'bga-layer2',
  ]);
  // The second overlay is not folded into the single bmson layer.
  expect(output.bga.layer_events).toEqual([{ y: 960, id: 1 }]);
});

test('#839: BMS ids start after native bmson ids and sequences in a mixed IR', () => {
  const json = bms('#BMP01 bms.png', '#00104:01');
  json.bmson.bga.header = [{ id: 7, name: 'native.png' }];
  json.bmson.bga.events = [{ y: 0, id: 7 }];
  const output = JSON.parse(stringifyBmson(json));
  expect(output.bga.bga_header).toEqual([
    { id: 7, name: 'native.png' },
    { id: 8, name: 'bms.png' },
  ]);
  expect(output.bga.bga_events).toEqual([
    { y: 0, id: 7 },
    { y: 960, id: 8 },
  ]);
});

function bmson(bga: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240 },
      sound_channels: [],
      ...extra,
      bga,
    }),
  );
}

test('#840: ordinary bmson BGA survives BMS export with its images and cue times', () => {
  const source = bmson({
    bga_header: [{ id: 1, name: 'a.png' }],
    bga_events: [{ y: 960, id: 1 }],
  });
  const exported = parseChart(stringifyBMS(source), 'chart.bms');
  expect(exported.resources.bmp).toEqual({ '01': 'a.png' });
  expect(cues(exported).base).toEqual([[2, 'a.png']]);
});

test('#840: BPM changes, STOPs, simultaneous cues, clears and POOR keep their times', () => {
  const source = bmson(
    {
      bga_header: [
        { id: 1, name: 'a.png' },
        { id: 2, name: 'b.png' },
      ],
      bga_events: [
        { y: 960, id: 1 },
        { y: 1920, id: 0 },
        { y: 2880, id: 9 },
      ],
      layer_events: [{ y: 960, id: 2 }],
      poor_events: [{ y: 0, id: 2 }],
    },
    { bpm_events: [{ y: 480, bpm: 240 }], stop_events: [{ y: 1440, duration: 240 }] },
  );
  const before = cues(source);
  const exported = parseChart(stringifyBMS(source), 'chart.bms');
  const after = cues(exported);
  const names = (list: Array<Array<number | string | undefined>>) => list.map(([seconds, key]) => [seconds, key]);
  expect(after.base.map(([seconds]) => seconds)).toEqual(before.base.map(([seconds]) => seconds));
  expect(after.base.map(([, name]) => name)).toEqual(['a.png', 'missing:03', 'missing:03']);
  expect(names(after.layer)).toEqual([[before.layer[0]![0], 'b.png']]);
  expect(names(after.poor)).toEqual([[0, 'b.png']]);
});

test('#840: sequences and conditional layers are reported and skipped; existing image ids are not reused', () => {
  const diagnostics: ChartExportDiagnostic[] = [];
  const source = bmson({
    bga_header: [{ id: 1, name: 'a.png' }],
    bga_sequence: [{ id: 5, sequence: [{ time: 0, id: 0 }] }],
    layer_events: [
      { y: 0, id: 1 },
      { y: 240, id_set: [1], condition: 'play' },
      { y: 480, id: 5 },
    ],
  });
  source.resources.bmp['01'] = 'existing.png';
  const exported = parseChart(
    stringifyBMS(source, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }),
    'chart.bms',
  );
  expect(exported.resources.bmp).toEqual({ '01': 'existing.png', '02': 'a.png' });
  expect(cues(exported).layer).toEqual([[0, 'a.png']]);
  expect(diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual(['bga-layer-black-key', 'bga-sequence']);
  // The source chart is not modified.
  expect(source.events.filter((event) => ['04', '06', '07'].includes(event.channel))).toEqual([]);
});
