import { expect, test } from 'vite-plus/test';
import { parseBMS, parseBmson, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { parseHDXLongNoteMode, resolveHDXLongNoteMode } from './hdx-long-note-mode.ts';
import { resolveChartLongNoteMode } from './note-rules.ts';
import { resolveChart } from './resolved-chart.ts';
import { compileChartOptions } from './chart-option-program.ts';
import { buildChartOptionTimeline } from './chart-options.ts';

const LNOBJ = '#BPM 120\n#LNOBJ ZZ\n#00111:01\n#00211:ZZ';
const PAIR = '#BPM 120\n#LNTYPE 1\n#00151:01\n#00251:01';

test('HDX LONGMODE parses documented numeric arguments as a whole declaration with exact vendor case', () => {
  expect(parseHDXLongNoteMode('charatbeatHDX:LONGMODE 0')).toBe(2);
  expect(parseHDXLongNoteMode('charatbeatHDX:LONGMODE\t1  ')).toBe(3);
  for (const raw of [
    'LONGMODE 1',
    'charatbeathdx:LONGMODE 1',
    'charatbeatHDX:LONGMODE 2',
    'charatbeatHDX:LONGMODE 1 extra',
    'charatbeatHDX:LONGMODE 01',
  ])
    expect(parseHDXLongNoteMode(raw)).toBeUndefined();
});
test.each([LNOBJ, PAIR])('both BMS long-note representations use the authored mode: %s', (source) => {
  for (const [argument, expected] of [
    [0, 2],
    [1, 3],
  ] as const) {
    const chart = parseBMS(`#OPTION charatbeatHDX:LONGMODE ${argument}\n${source}`);
    const before = JSON.stringify(chart);
    expect(resolveChartLongNoteMode(chart)).toBe(expected);
    expect(resolveChart(chart).notes[0]?.lnMode).toBe(expected);
    expect(JSON.stringify(chart)).toBe(before);
  }
});
test('last valid declaration wins without splitting arguments or letting malformed values erase it', () => {
  const chart = parseBMS(
    `#OPTION charatbeatHDX:LONGMODE 0\n#OPTION 774:HI-SPEED_x0.77\n#OPTION charatbeatHDX:LONGMODE 1\n#OPTION charatbeatHDX:LONGMODE 9\n${PAIR}`,
  );
  expect(resolveHDXLongNoteMode(chart)).toBe(3);
  expect(resolveChartLongNoteMode(chart)).toBe(3);
  delete chart.bms.options;
  chart.bms.option = 'charatbeatHDX:LONGMODE 0';
  expect(resolveChartLongNoteMode(chart)).toBe(2);
  chart.bms.options = [];
  expect(resolveChartLongNoteMode(chart)).toBe(1);
});
test('valid LNMODE takes precedence independently of declaration order and invalid LNMODE falls back', () => {
  for (const mode of [1, 2, 3] as const) {
    const chart = parseBMS(`#LNMODE ${mode}\n#OPTION charatbeatHDX:LONGMODE 1\n${PAIR}`);
    expect(resolveChartLongNoteMode(chart)).toBe(mode);
    expect(resolveChart(chart).notes[0]?.lnMode).toBe(mode);
  }
  expect(resolveChartLongNoteMode(parseBMS(`#LNMODE 9\n#OPTION charatbeatHDX:LONGMODE 0\n${PAIR}`))).toBe(2);
});
test('bmson chart and per-note modes keep their native precedence over BMS-only HDX declarations', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, ln_type: 2 },
      sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 0, l: 480, t: 3 }] }],
    }),
  );
  chart.bms.options = ['charatbeatHDX:LONGMODE 0'];
  expect(resolveChartLongNoteMode(chart)).toBe(2);
  expect(resolveChart(chart).notes[0]?.lnMode).toBe(3);
});
test('initial LONGMODE is consumed as a note rule while timed changes are diagnosed and do not change notes', () => {
  const chart = parseBMS(
    `#OPTION charatbeatHDX:LONGMODE 1\n#CHANGEOPTION01 charatbeatHDX:LONGMODE 0\n#001A6:01\n${PAIR}`,
  );
  const compiled = compileChartOptions(buildChartOptionTimeline(chart));
  expect(compiled.program).toEqual({ version: 3, initial: {}, cues: [] });
  expect(compiled.diagnostics).toEqual([
    { code: 'initial-only-option', declaration: 'charatbeatHDX:LONGMODE 0', key: '01', seconds: 2 },
  ]);
  expect(resolveChart(chart).notes[0]?.lnMode).toBe(3);
});
test('branch selection determines the effective mode before note extraction', () => {
  const source = parseBMS(
    `#RANDOM 2\n#IF 1\n#OPTION charatbeatHDX:LONGMODE 0\n#ELSE\n#OPTION charatbeatHDX:LONGMODE 1\n#ENDIF\n#ENDRANDOM\n${PAIR}`,
  );
  for (const [value, mode] of [
    [1, 2],
    [2, 3],
  ] as const) {
    const chart = resolveBMSControlFlowWithDraws(source, [{ command: 'RANDOM', range: 2, value }]);
    expect(resolveChart(chart).notes[0]?.lnMode).toBe(mode);
  }
});
