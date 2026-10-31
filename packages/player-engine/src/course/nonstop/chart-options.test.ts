import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart, resolveChartOptionsAt } from '@be-music/chart-model';
import { placeNonstopChartOptions } from './chart-options.ts';
import { stitchNonstopCourse } from './compose.ts';

const chart = () =>
  parseBMS(
    '#BPM 120\n#OPTION 774:HI-SPEED_x0.77\n#CHANGEOPTION01 774:HI-SPEED_x100.00\n#CHANGEOPTION02 774:HI-SPEED_x0.25\n#001A6:01\n#002A6:02\n#00211:01\n#00411:01',
  );

test('FIT places timed operations without changing the authored spacing factor or source data', () => {
  const source = chart();
  const before = JSON.stringify(source);
  const result = placeNonstopChartOptions(
    resolveChart(source),
    { offsetSeconds: 10, rate: 2 },
    { start: 10, end: 13 },
    0,
  );
  expect(result.cues).toEqual([
    { timeUs: 10000000, state: { hiSpeed: 0.77 } },
    { timeUs: 11000000, state: { hiSpeed: 100 } },
    { timeUs: 12000000, state: { hiSpeed: 0.25 } },
  ]);
  expect(result.hasOperations).toBe(true);
  expect(JSON.stringify(source)).toBe(before);
});
test('a trimmed start seeds the last preceding selection and excludes the exact ownership end', () => {
  const result = placeNonstopChartOptions(
    resolveChart(chart()),
    { offsetSeconds: -1.5, rate: 2 },
    { start: 0, end: 0.5 },
    1,
  );
  expect(result.cues).toEqual([{ timeUs: 0, state: { hiSpeed: 100 } }]);
});
test('source reversal freezes its last accepted operation and does not include later source changes', () => {
  const source = chart();
  source.resources.bpm['01'] = -120;
  source.events.push({ measure: 1, channel: '08', position: [1, 2], value: '01' });
  const placed = placeNonstopChartOptions(
    resolveChart(source),
    { offsetSeconds: 0, rate: 1 },
    { start: 0, end: 10 },
    0,
  );
  expect(placed.cues.map((cue) => cue.state.hiSpeed)).toEqual([0.77, 100]);
});
test('diagnostics retain source and course time with stage ownership, including initial-only aliases', () => {
  const source = parseBMS(
    '#BPM 120\n#OPTION unknown:initial argument\n#CHANGEOPTION01 774:HSP-2.0\n#001A6:01\n#003A6:ZZ\n#004A6:YY',
  );
  const result = placeNonstopChartOptions(
    resolveChart(source),
    { offsetSeconds: -2, rate: 2 },
    { start: 0, end: 2 },
    3,
  );
  expect(result.hasOperations).toBe(false);
  expect(result.diagnostics).toEqual([
    { code: 'unsupported-option', declaration: 'unknown:initial argument', stage: 3, seconds: 0 },
    { code: 'initial-only-alias', declaration: '774:HSP-2.0', key: '01', stage: 3, sourceSeconds: 2, seconds: 0 },
    { code: 'missing-reference', key: 'ZZ', stage: 3, sourceSeconds: 6, seconds: 1 },
  ]);
});
test('composition owns each stage, releases speed for an empty stage and preserves a structured replay program', () => {
  const first = parseBMS('#BPM 120\n#OPTION 774:HI-SPEED_x0.77\n#00211:01\n#00411:01');
  const second = parseBMS(
    '#BPM 60\n#OPTION 774:HI-SPEED_x100.00\n#CHANGEOPTION01 774:HI-SPEED_x0.25\n#003A6:01\n#00211:01\n#00411:01',
  );
  const plain = parseBMS('#BPM 120\n#00211:01\n#00411:01');
  const result = stitchNonstopCourse([{ chart: first }, { chart: second }, { chart: plain }], {
    connections: ['cut-fit', 'cut'],
  });
  if (!result.ok) throw new Error(result.reason);
  const program = structuredClone(result.map.chartOptions!);
  const boundary = result.map.stages[1]!.windowStart;
  expect(result.map.stages[1]!.placement.rate).toBe(2);
  expect(resolveChartOptionsAt(program, 0)).toEqual({ hiSpeed: 0.77 });
  expect(resolveChartOptionsAt(program, Math.round(boundary * 1e6))).toEqual({ hiSpeed: 100 });
  expect(resolveChartOptionsAt(program, Math.round((boundary + 2) * 1e6))).toEqual({ hiSpeed: 0.25 });
  expect(resolveChartOptionsAt(program, Math.round(result.map.stages[2]!.windowStart * 1e6))).toEqual({});
  expect(JSON.parse(JSON.stringify(program))).toEqual(program);
});
test('unsupported-only and option-free courses do not invent effective display operations', () => {
  const source = parseBMS('#BPM 120\n#OPTION unknown:operation\n#00111:01');
  const result = stitchNonstopCourse([{ chart: source }], { connections: [] });
  if (!result.ok) throw new Error(result.reason);
  expect(result.map.chartOptions).toBeUndefined();
  expect(result.map.chartOptionDiagnostics).toMatchObject([{ code: 'unsupported-option', stage: 0 }]);
  delete source.bms.option;
  delete source.bms.options;
  const plain = stitchNonstopCourse([{ chart: source }], { connections: [] });
  if (!plain.ok) throw new Error(plain.reason);
  expect(plain.map.chartOptions).toBeUndefined();
  expect(plain.map.chartOptionDiagnostics).toBeUndefined();
});
