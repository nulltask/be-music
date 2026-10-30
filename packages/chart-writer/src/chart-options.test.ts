import { expect, test } from 'vite-plus/test';
import { parseBMS, parseChart, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { stringifyBMS } from './index.ts';

const payloads = ['774:HI-SPEED_x2.00', 'charatbeatHDX:BGAMODE 0', '774:CRAZY_STAR', '774:HI-SPEED_x0.77'];

test.each([false, true])('repeated OPTION declarations round trip in order with canonical=%s', (canonical) => {
  const chart = parseBMS(payloads.map((value) => `#OPTION ${value}`).join('\n'));
  const output = stringifyBMS(chart, canonical ? { maxResolution: 192 } : {});
  expect(parseBMS(output).bms.options).toEqual(payloads);
  expect(parseChart(JSON.stringify(chart), 'json').bms.options).toEqual(payloads);
});

test.each([false, true])('conditional OPTION programs keep whole-file precedence with canonical=%s', (canonical) => {
  const chart = parseBMS(
    '#OPTION 774:HI-SPEED_x1.00\n#SETRANDOM 1\n#IF 1\n#OPTION 774:HIDDEN_STEALTH\n#OPTION 774:HI-SPEED_x3.00\n#ENDIF\n#ENDRANDOM\n#OPTION 774:HI-SPEED_x2.00',
  );
  const draws = [{ command: 'SETRANDOM' as const, range: 1, value: 1 }];
  const expected = resolveBMSControlFlowWithDraws(chart, draws);
  const output = stringifyBMS(chart, canonical ? { maxResolution: 192 } : {});
  expect(output.match(/^#OPTION /gm)).toHaveLength(4);
  expect(resolveBMSControlFlowWithDraws(parseBMS(output), draws).bms.options).toEqual(expected.bms.options);
});

test('editing an earlier declaration invalidates preserved source even if the legacy last value stays unchanged', () => {
  const chart = parseBMS(payloads.map((value) => `#OPTION ${value}`).join('\n'));
  chart.bms.options![0] = '774:HI-SPEED_x3.00';
  expect(parseBMS(stringifyBMS(chart)).bms.options).toEqual(chart.bms.options);
});

test('legacy single-option charts still export a native declaration', () => {
  const chart = parseBMS('#OPTION 774:RANDOM_MIRROR');
  delete chart.bms.options;
  expect(parseBMS(stringifyBMS(chart, { maxResolution: 192 })).bms.options).toEqual(['774:RANDOM_MIRROR']);
});
