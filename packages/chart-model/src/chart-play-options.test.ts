import { expect, test } from 'vite-plus/test';
import {
  compileChartPlayOptions,
  hasChartPlayOptions,
  isChartPlayOptionDeclaration,
  isLegacyChartPlayOptionProgram,
  parseChartPlayOption,
  withPlayerChartPlayOptions,
} from './chart-play-options.ts';

test.each([
  ['774:RANDOM_MIRROR', { random: 'MIRROR' }, 1],
  ['774:RANDOM_RANDOM+', { random: 'RANDOM+' }, 1],
  ['774:RANDOM_ALL', { random: 'ALL' }, 1],
  ['774:RANDOM_ALL+', { random: 'ALL+' }, 1],
  ['774:CRAZY_GOOD2BAD', { judge: 'GOOD2BAD' }, 3],
  ['774:CRAZY_GREAT2BAD', { judge: 'GREAT2BAD' }, 3],
  ['774:CRAZY_HELLJUDGE', { hellJudge: true }, 3],
  ['774:CRAZY_ADDMINE', { addMine: true }, 3],
  ['774:NOTES_DOUBLE', { notes: 'DOUBLE' }, 1],
  ['774:NOTES_COPY', { notes: 'COPY' }, 1],
  ['774:NOTES_DBLCOPY', { notes: 'DBLCOPY' }, 1],
  ['774:CRA-RHS2', { baseSpeed: 1.5 }, 2],
])('compiles %s (version %#)', (declaration, options, version) => {
  // A CRAZY gameplay option takes nanasigroove's readings, version 3.
  expect(compileChartPlayOptions({ initial: [declaration] })).toEqual({ version, options });
});

test('a CRAZY gameplay option with a base speed is version 3, which keeps the base speed', () => {
  expect(compileChartPlayOptions({ initial: ['774:CRA-RHS1', '774:CRAZY_HELLJUDGE'] })).toEqual({
    version: 3,
    options: { baseSpeed: 1.2, hellJudge: true },
  });
});

test('only a program before version 3 is legacy', () => {
  expect(isLegacyChartPlayOptionProgram({ version: 1, options: {} })).toBe(true);
  expect(isLegacyChartPlayOptionProgram({ version: 2, options: { baseSpeed: 2 } })).toBe(true);
  expect(isLegacyChartPlayOptionProgram({ version: 3, options: { hellJudge: true } })).toBe(false);
});

test("the player's judgment options join where the chart sets none, the chart winning within a family", () => {
  const empty = { version: 1 as const, options: { random: 'MIRROR' as const } };
  expect(withPlayerChartPlayOptions(empty, undefined)).toBe(empty);
  expect(withPlayerChartPlayOptions(empty, {})).toBe(empty);
  expect(withPlayerChartPlayOptions(empty, { judge: 'GOOD2BAD', hellJudge: true })).toEqual({
    version: 3,
    options: { random: 'MIRROR', judge: 'GOOD2BAD', hellJudge: true },
  });
  const chart = { version: 3 as const, options: { judge: 'GREAT2BAD' as const } };
  expect(withPlayerChartPlayOptions(chart, { judge: 'GOOD2BAD' })).toBe(chart);
  expect(withPlayerChartPlayOptions(chart, { hellJudge: true })).toEqual({
    version: 3,
    options: { judge: 'GREAT2BAD', hellJudge: true },
  });
});

test('later declarations win within a family, OFF clears it, and other families stay', () => {
  expect(
    compileChartPlayOptions({
      initial: ['774:RANDOM_RANDOM', '774:CRAZY_GOOD2BAD', '774:RANDOM_MIRROR', '774:CRAZY_GREAT2BAD'],
    }).options,
  ).toEqual({ random: 'MIRROR', judge: 'GREAT2BAD' });
  expect(
    compileChartPlayOptions({
      initial: ['774:RANDOM_ALL', '774:CRAZY_HELLJUDGE', '774:CRAZY_ADDMINE', '774:CRAZY_OFF', '774:RANDOM_OFF'],
    }).options,
  ).toEqual({});
  expect(compileChartPlayOptions({ initial: ['774:CRAZY_OFF', '774:CRAZY_ADDMINE'] }).options).toEqual({
    addMine: true,
  });
});

test('NOTES_OFF clears the note conversion; CRAZY_OFF does not', () => {
  expect(compileChartPlayOptions({ initial: ['774:NOTES_COPY', '774:NOTES_DOUBLE'] }).options).toEqual({
    notes: 'DOUBLE',
  });
  expect(compileChartPlayOptions({ initial: ['774:NOTES_DBLCOPY', '774:NOTES_OFF'] }).options).toEqual({});
  expect(compileChartPlayOptions({ initial: ['774:NOTES_COPY', '774:CRAZY_OFF'] }).options).toEqual({
    notes: 'COPY',
  });
});

test('parses other families, legacy aliases and wrong case as none of its own', () => {
  for (const declaration of [
    '774:NOTES_TRIPLE',
    '774:CRA-HYPER',
    '774:CRA-CPDOUBLE',
    '774:notes_COPY',
    '774:RANDOM_S-RANDOM',
    '774:random_MIRROR',
    '774:RND-MIRROR',
    '774:CRAZY_SPIN',
    '774:HI-SPEED_x2.00',
  ]) {
    expect(parseChartPlayOption(declaration)).toBeUndefined();
    expect(isChartPlayOptionDeclaration(declaration)).toBe(false);
  }
  // The legacy aliases are not parsed here; the compiler maps them first (chart-option-legacy.ts).
  expect(compileChartPlayOptions({ initial: ['774:CRA-HYPER'] }).options).toEqual({ notes: 'DOUBLE' });
  expect(compileChartPlayOptions({ initial: ['774:CRA-CPDOUBLE'] }).options).toEqual({ notes: 'COPY' });
});

test('hasChartPlayOptions', () => {
  expect(hasChartPlayOptions(undefined)).toBe(false);
  expect(hasChartPlayOptions({ version: 1, options: {} })).toBe(false);
  expect(hasChartPlayOptions({ version: 1, options: { hellJudge: true } })).toBe(true);
});
