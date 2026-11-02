import { expect, test } from 'vite-plus/test';
import { resolveChartLegacyOptionAlias } from './chart-option-legacy.ts';
import { compileChartOptions, resolveChartOptionsAt } from './chart-option-program.ts';
import { compileChartPlayOptions } from './chart-play-options.ts';

test.each([
  ['774:HID-NORMAL', '774:HIDDEN_OFF'],
  ['774:HID-HIDDEN1', '774:HIDDEN_HIDDEN'],
  ['774:HID-HIDSUD3', '774:HIDDEN_HID-SUD3'],
  ['774:HID-HIDJUDGE', '774:CRAZY_HIDJUDGE'],
  ['774:CRA-NORMAL', '774:CRAZY_OFF'],
  ['774:CRA-3DWAVE1', '774:CRAZY_3DWAVE'],
  ['774:CRA-HARD2', '774:CRAZY_GREAT2BAD'],
  ['774:CRA-2JUDGE', '774:CRAZY_HELLJUDGE'],
  ['774:CRA-ACCEL', '774:CHANGE-HS_ACCEL'],
])('maps the legacy %s to %s', (legacy, modern) => {
  expect(resolveChartLegacyOptionAlias(legacy)).toBe(modern);
});

test.each(['774:CRA-RHS1', '774:CRA-HYPER', '774:CRA-CPDOUBLE', '774:hid-hidden1', 'HID-HIDDEN1', '774:constructor'])(
  'leaves %s unmapped',
  (declaration) => {
    expect(resolveChartLegacyOptionAlias(declaration)).toBeUndefined();
  },
);

test('legacy display aliases execute initially and are diagnosed initial-only-alias on A6', () => {
  const declaration = '774:HID-STEALTH';
  const result = compileChartOptions({
    initial: ['774:CRA-LINEMOVE', declaration, '774:CRA-ACCEL'],
    cues: [{ seconds: 1, key: '01', declaration: '774:HID-NORMAL' }],
  });
  expect(result.program.initial).toEqual({ crazyLine: 'LINEMOVE', hidden: 'STEALTH', changeHS: 'ACCEL' });
  expect(result.program.cues).toEqual([]);
  expect(result.diagnostics).toEqual([
    { code: 'initial-only-alias', declaration: '774:HID-NORMAL', key: '01', seconds: 1 },
  ]);
  expect(resolveChartOptionsAt(result.program, 2_000_000).hidden).toBe('STEALTH');
});

test('legacy gameplay aliases are play options initially and initial-only-alias on A6; CRA-NORMAL clears both', () => {
  expect(compileChartPlayOptions({ initial: ['774:CRA-HARD1', '774:CRA-ULTHARD'] }).options).toEqual({
    judge: 'GOOD2BAD',
    hellJudge: true,
  });
  expect(compileChartPlayOptions({ initial: ['774:CRA-HARD1', '774:CRA-NORMAL'] }).options).toEqual({});
  const display = compileChartOptions({
    initial: ['774:CRA-HARD1', '774:CRA-DARK', '774:CRA-NORMAL', '774:CRA-STAR'],
    cues: [{ seconds: 1, key: '01', declaration: '774:CRA-HARD2' }],
  });
  expect(display.program.initial).toEqual({ crazyColor: 'STAR' });
  expect(display.diagnostics).toEqual([
    { code: 'initial-only-alias', declaration: '774:CRA-HARD2', key: '01', seconds: 1 },
  ]);
});
