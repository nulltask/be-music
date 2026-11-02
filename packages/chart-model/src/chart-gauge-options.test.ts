import { expect, test } from 'vite-plus/test';
import {
  compileChartGaugeOptions,
  isChartGaugeOptionDeclaration,
  parseChartGaugeOption,
} from './chart-gauge-options.ts';

test.each([
  [['774:GAMELEVEL_BEGINNER'], { gameLevel: 'BEGINNER' }],
  [['774:GAMELEVEL_DANGER'], { gameLevel: 'DANGER' }],
  [['774:EXTRA_VERYHARD'], { extra: 'VERYHARD' }],
  [['774:GAMELEVEL_HYPER', '774:EXTRA_EASY'], { gameLevel: 'HYPER', extra: 'EASY' }],
  [['774:GAMELEVEL_HYPER', '774:GAMELEVEL_NORMAL', '774:EXTRA_HARD', '774:EXTRA_OFF'], { gameLevel: 'NORMAL' }],
])('compiles %j', (initial, options) => {
  expect(compileChartGaugeOptions({ initial })).toEqual(options);
});

test('ignores other families, legacy aliases, unknown values and wrong case', () => {
  for (const declaration of [
    '774:GAMELEVEL_ANOTHER',
    '774:GAMELEVEL_OFF',
    '774:EXTRA_NORMAL',
    '774:GLV-HYPER',
    '774:gamelevel_HYPER',
    '774:RANDOM_MIRROR',
  ]) {
    expect(parseChartGaugeOption(declaration)).toBeUndefined();
    expect(isChartGaugeOptionDeclaration(declaration)).toBe(false);
  }
  expect(compileChartGaugeOptions({ initial: ['774:GLV-HYPER'] })).toEqual({});
});
