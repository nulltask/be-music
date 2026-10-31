import { expect, test } from 'vite-plus/test';
import { parseBMS, parseChart, resolveBMSControlFlowWithDraws } from '../index.ts';

const declarations = ['774:HI-SPEED_x2.00', 'charatbeatHDX:BGAMODE 0', '774:CRAZY_STAR', '774:HI-SPEED_x0.77'];

test('repeated OPTION declarations retain whole vendor payloads and their source order', () => {
  const chart = parseBMS(declarations.map((value) => `#OPTION ${value}`).join('\n'));
  expect(chart.bms.options).toEqual(declarations);
  expect(chart.bms.option).toBe(declarations.at(-1));
  expect(chart.bms.controlFlow).toEqual([]);
  expect(chart.bms.optionHeadersInControlFlow).toBeUndefined();
  expect(parseChart(JSON.stringify(chart), 'json').bms.options).toEqual(declarations);
});

test('conditional and unconditional OPTION lines resolve together in original order without duplicate base values', () => {
  const source = parseBMS(`#OPTION 774:HI-SPEED_x1.00
#SETRANDOM 1
#IF 1
#OPTION 774:HIDDEN_STEALTH
#OPTION 774:HI-SPEED_x3.00
#ELSE
#OPTION 774:RANDOM_MIRROR
#ENDIF
#ENDRANDOM
#OPTION 774:HI-SPEED_x2.00
`);
  const before = JSON.stringify(source);
  expect(source.bms.optionHeadersInControlFlow).toBe(true);
  const resolved = resolveBMSControlFlowWithDraws(source, [{ command: 'SETRANDOM', range: 1, value: 1 }]);
  expect(resolved.bms.options).toEqual([
    '774:HI-SPEED_x1.00',
    '774:HIDDEN_STEALTH',
    '774:HI-SPEED_x3.00',
    '774:HI-SPEED_x2.00',
  ]);
  expect(resolved.bms.option).toBe('774:HI-SPEED_x2.00');
  expect(resolved.bms.optionHeadersInControlFlow).toBeUndefined();
  expect(resolved.bms.controlFlow).toEqual([]);
  expect(resolveBMSControlFlowWithDraws(resolved, []).bms.options).toEqual(resolved.bms.options);
  expect(JSON.stringify(source)).toBe(before);
  const fromJSON = parseChart(JSON.stringify(source), 'json');
  expect(resolveBMSControlFlowWithDraws(fromJSON, [{ command: 'SETRANDOM', range: 1, value: 1 }]).bms.options).toEqual(
    resolved.bms.options,
  );
});

test('legacy JSON option remains usable and explicit options arrays own their last-value alias', () => {
  const legacy = parseBMS('#OPTION 774:RANDOM_MIRROR');
  delete legacy.bms.options;
  expect(parseChart(JSON.stringify(legacy), 'json').bms.option).toBe('774:RANDOM_MIRROR');
  legacy.bms.options = ['774:HIDDEN_STEALTH', '774:HI-SPEED_x0.77'];
  expect(parseChart(JSON.stringify(legacy), 'json').bms.option).toBe('774:HI-SPEED_x0.77');
});

test('an explicit empty option list clears the legacy alias', () => {
  const source = parseBMS('#OPTION 774:RANDOM_MIRROR');
  source.bms.options = [];
  const chart = parseChart(JSON.stringify(source), 'json');
  expect(chart.bms.options).toEqual([]);
  expect(chart.bms.option).toBeUndefined();
});

test.each([null, '774:RANDOM_MIRROR', [1], ['']])('invalid ordered option declarations are rejected: %j', (options) => {
  const chart = parseBMS('#BPM 120');
  (chart.bms as unknown as Record<string, unknown>).options = options;
  expect(() => parseChart(JSON.stringify(chart), 'json')).toThrow(TypeError);
});

test('inactive OPTION branches do not leak declarations and legacy control-flow JSON keeps its unconditional base', () => {
  const chart = parseBMS(
    '#OPTION 774:HI-SPEED_x1.00\n#SETRANDOM 2\n#IF 1\n#OPTION 774:HIDDEN_STEALTH\n#ENDIF\n#ENDRANDOM\n#OPTION 774:HI-SPEED_x2.00',
  );
  const draws = [{ command: 'SETRANDOM' as const, range: 1, value: 2 }];
  expect(resolveBMSControlFlowWithDraws(chart, draws).bms.options).toEqual([
    '774:HI-SPEED_x1.00',
    '774:HI-SPEED_x2.00',
  ]);
  const legacy = parseBMS(
    '#OPTION 774:HI-SPEED_x1.00\n#SETRANDOM 1\n#IF 1\n#OPTION 774:HIDDEN_STEALTH\n#ENDIF\n#ENDRANDOM',
  );
  delete legacy.bms.optionHeadersInControlFlow;
  delete legacy.bms.options;
  legacy.bms.controlFlow = legacy.bms.controlFlow.filter(
    (entry) => entry.kind !== 'header' || entry.value !== '774:HI-SPEED_x1.00',
  );
  const resolved = resolveBMSControlFlowWithDraws(legacy, [{ command: 'SETRANDOM', range: 1, value: 1 }]);
  expect(resolved.bms.options).toEqual(['774:HI-SPEED_x1.00', '774:HIDDEN_STEALTH']);
});
