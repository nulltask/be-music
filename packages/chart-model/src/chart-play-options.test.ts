import { expect, test } from 'vite-plus/test';
import {
  compileChartPlayOptions,
  hasChartPlayOptions,
  isChartPlayOptionDeclaration,
  parseChartPlayOption,
} from './chart-play-options.ts';

test.each([
  ['774:RANDOM_MIRROR', { random: 'MIRROR' }],
  ['774:RANDOM_RANDOM+', { random: 'RANDOM+' }],
  ['774:RANDOM_ALL', { random: 'ALL' }],
  ['774:RANDOM_ALL+', { random: 'ALL+' }],
  ['774:CRAZY_GOOD2BAD', { judge: 'GOOD2BAD' }],
  ['774:CRAZY_GREAT2BAD', { judge: 'GREAT2BAD' }],
  ['774:CRAZY_HELLJUDGE', { hellJudge: true }],
  ['774:CRAZY_ADDMINE', { addMine: true }],
])('compiles %s', (declaration, options) => {
  expect(compileChartPlayOptions({ initial: [declaration] })).toEqual({ version: 1, options });
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

test('ignores other families, NOTES, legacy aliases and wrong case', () => {
  for (const declaration of [
    '774:NOTES_DOUBLE',
    '774:RANDOM_S-RANDOM',
    '774:random_MIRROR',
    '774:RND-MIRROR',
    '774:CRAZY_SPIN',
    '774:HI-SPEED_x2.00',
  ]) {
    expect(parseChartPlayOption(declaration)).toBeUndefined();
    expect(isChartPlayOptionDeclaration(declaration)).toBe(false);
  }
  expect(compileChartPlayOptions({ initial: ['774:NOTES_DOUBLE'] }).options).toEqual({});
});

test('hasChartPlayOptions', () => {
  expect(hasChartPlayOptions(undefined)).toBe(false);
  expect(hasChartPlayOptions({ version: 1, options: {} })).toBe(false);
  expect(hasChartPlayOptions({ version: 1, options: { hellJudge: true } })).toBe(true);
});
