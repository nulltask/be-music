import { expect, test } from 'vite-plus/test';
import { compileChartOptions, resolveChartOptionsAt } from './chart-option-program.ts';

test('HI-SPEED accepts native bounds and hundredths without applying user speed limits', () => {
  for (const value of ['0.25', '0.77', '2.00', '99.75', '100.00']) {
    const result = compileChartOptions({ initial: [`774:HI-SPEED_x${value}`], cues: [] });
    expect(result.program.initial).toEqual({ hiSpeed: Number(value) });
    expect(result.diagnostics).toEqual([]);
  }
});
test('initial declarations combine in order; invalid or unsupported declarations preserve accepted values', () => {
  const result = compileChartOptions({
    initial: ['774:HI-SPEED_x2.00', '774:HIDDEN_STEALTH', '774:HI-SPEED_x0.77', '774:HI-SPEED_x200'],
    cues: [],
  });
  expect(result.program.initial).toEqual({ hiSpeed: 0.77 });
  expect(result.diagnostics.map((value) => value.code)).toEqual(['unsupported-option', 'invalid-parameter']);
});
test('legacy HSP values are initial-only and the native minimum clamps the old 0.2 alias', () => {
  const result = compileChartOptions({
    initial: ['774:HSP-0.2'],
    cues: [{ seconds: 1, key: '01', declaration: '774:HSP-2.0' }],
  });
  expect(result.program.initial).toEqual({ hiSpeed: 0.25 });
  expect(result.program.cues).toEqual([]);
  expect(result.diagnostics[0]?.code).toBe('initial-only-alias');
});
test.each([
  '774:HI-SPEED_xNaN',
  '774:HI-SPEED_x0.24',
  '774:HI-SPEED_x100.01',
  '774:HI-SPEED_x1.234',
  '774:HI-SPEED_x-2',
])('rejects malformed or out-of-range native values: %s', (value) => {
  expect(compileChartOptions({ initial: [value], cues: [] }).diagnostics[0]?.code).toBe('invalid-parameter');
});
test('timed changes, same-time normalized IR order and backwards lookup reproduce exact effective values', () => {
  const input = {
    initial: ['774:HI-SPEED_x2.00'],
    cues: [
      { seconds: 2, key: '01', declaration: '774:HI-SPEED_x100.00' },
      { seconds: 1, key: '02', declaration: '774:HI-SPEED_x0.77' },
      { seconds: 2, key: '03', declaration: '774:HI-SPEED_x0.25' },
    ],
  };
  const before = structuredClone(input);
  const { program } = compileChartOptions(input);
  expect(resolveChartOptionsAt(program, 999999)).toEqual({ hiSpeed: 2 });
  expect(resolveChartOptionsAt(program, 1000000)).toEqual({ hiSpeed: 0.77 });
  expect(resolveChartOptionsAt(program, 2000000)).toEqual({ hiSpeed: 0.25 });
  expect(resolveChartOptionsAt(program, 0)).toEqual({ hiSpeed: 2 });
  resolveChartOptionsAt(program, 0).hiSpeed = 100;
  expect(program.initial.hiSpeed).toBe(2);
  expect(input).toEqual(before);
});
test('missing references and unrepresentable cue time are diagnosed without changing state', () => {
  const result = compileChartOptions({
    initial: [],
    cues: [
      { seconds: 1, key: '01' },
      { seconds: Infinity, key: '02', declaration: '774:HI-SPEED_x2.00' },
    ],
  });
  expect(result.diagnostics.map((value) => value.code)).toEqual(['missing-reference', 'invalid-time']);
  expect(resolveChartOptionsAt(result.program, 10000000)).toEqual({});
});
