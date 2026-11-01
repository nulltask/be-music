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
    initial: ['774:HI-SPEED_x2.00', '774:CRAZY_SPIN', '774:HI-SPEED_x0.77', '774:HI-SPEED_x200'],
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
// The documented support boundary (docs/research/chart-authored-options.md): every other family is diagnosed and has
// no effect, initially or on A6, so a program never carries an operation the engine cannot reproduce.
test.each([
  '774:CRAZY_SPIN',
  '774:HIDDEN_M-SUDDEN',
  '774:HID-HIDDEN1',
  '774:RANDOM_MIRROR',
  '774:NOTES_DOUBLE',
  '774:CRAZY_HELLJUDGE',
  '774:GAMELEVEL_HYPER',
  '774:EXTRA_HARD',
  'charatbeatHDX:BGAMODE 1',
])('diagnoses %s without changing the effective program', (declaration) => {
  const result = compileChartOptions({
    initial: ['774:HI-SPEED_x1.50', declaration],
    cues: [{ seconds: 1, key: '01', declaration }],
  });
  expect(result.program).toEqual({ version: 2, initial: { hiSpeed: 1.5 }, cues: [] });
  expect(result.diagnostics).toEqual([
    { code: 'unsupported-option', declaration },
    { code: 'unsupported-option', declaration, key: '01', seconds: 1 },
  ]);
});

test('version 2 executes HIDDEN, CHANGE-HS and CRAZY size / wave declarations alongside HI-SPEED', () => {
  const { program, diagnostics } = compileChartOptions({
    initial: ['774:HIDDEN_SUDDEN', '774:CHANGE-HS_ACCEL', '774:CRAZY_SMALL', '774:CRAZY_XWAVE', '774:HI-SPEED_x2.00'],
    cues: [
      { seconds: 1, key: '01', declaration: '774:HIDDEN_STEALTH' },
      { seconds: 2, key: '02', declaration: '774:CRAZY_BIG' },
      { seconds: 3, key: '03', declaration: '774:CRAZY_OFF' },
      { seconds: 4, key: '04', declaration: '774:HIDDEN_OFF' },
      { seconds: 4, key: '05', declaration: '774:CHANGE-HS_OFF' },
    ],
  });
  expect(diagnostics).toEqual([]);
  expect(program.version).toBe(2);
  expect(program.initial).toEqual({
    hidden: 'SUDDEN',
    changeHS: 'ACCEL',
    crazySize: 'SMALL',
    crazyWave: 'XWAVE',
    hiSpeed: 2,
  });
  expect(resolveChartOptionsAt(program, 1_000_000).hidden).toBe('STEALTH');
  expect(resolveChartOptionsAt(program, 2_000_000)).toMatchObject({ crazySize: 'BIG', crazyWave: 'XWAVE' });
  expect(resolveChartOptionsAt(program, 3_000_000)).toEqual({ hidden: 'STEALTH', changeHS: 'ACCEL', hiSpeed: 2 });
  // Same-time cues execute in normalized IR order: both OFFs land, HI-SPEED stays.
  expect(resolveChartOptionsAt(program, 4_000_000)).toEqual({ hiSpeed: 2 });
});
test('a later declaration of an exclusive family replaces the earlier one; other families stay', () => {
  const { program } = compileChartOptions({
    initial: ['774:HIDDEN_HIDDEN', '774:CRAZY_FADEIN', '774:HIDDEN_BLINK2', '774:CRAZY_XWAVE2', '774:CRAZY_RD-SIZE'],
    cues: [],
  });
  expect(program.initial).toEqual({ hidden: 'BLINK2', crazySize: 'RD-SIZE', crazyWave: 'XWAVE2' });
});
