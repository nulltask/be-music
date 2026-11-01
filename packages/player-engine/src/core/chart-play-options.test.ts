import { expect, test } from 'vite-plus/test';
import { applyChartPlayOptions } from './chart-play-options.ts';

const player = {
  random1P: 'S-RANDOM',
  random2P: 'H-RANDOM',
  randomFixedLane1P: 3,
  randomFixedLane2P: 4,
  mRan1P: true,
  mRan2P: true,
  mineModifier: 'REMOVE' as const,
};
const dp = { doublePlay: true, hasScratch: true };
const sp = { doublePlay: false, hasScratch: true };
const program = (options: object) => ({ version: 1 as const, options });

test('without a program the player keeps every choice', () => {
  expect(applyChartPlayOptions(player, undefined, dp)).toEqual({ selection: player });
  expect(applyChartPlayOptions(player, program({}), dp)).toEqual({ selection: player });
});

test.each([
  ['MIRROR', sp, 'MIRROR', undefined],
  ['RANDOM', sp, 'RANDOM', undefined],
  ['RANDOM+', sp, 'RANDOM-EX', undefined],
  ['RANDOM+', { doublePlay: false, hasScratch: false }, 'RANDOM', undefined],
  ['ALL', sp, 'RANDOM', undefined],
  ['ALL+', sp, 'RANDOM-EX', undefined],
  ['ALL', dp, 'OFF', { scratch: false }],
  ['ALL+', dp, 'OFF', { scratch: true }],
])('chart %s replaces both sides (%j)', (random, layout, perSide, crossSide) => {
  const result = applyChartPlayOptions(player, program({ random }), layout);
  expect(result.selection).toEqual({
    random1P: perSide,
    random2P: perSide,
    mRan1P: false,
    mRan2P: false,
    mineModifier: 'REMOVE',
  });
  expect(result.crossSide).toEqual(crossSide);
});

test('ADDMINE replaces the mine option and leaves the arrangement', () => {
  expect(applyChartPlayOptions(player, program({ addMine: true }), dp).selection).toEqual({
    ...player,
    mineModifier: 'ADD_RANDOM',
  });
  // Judge modifiers belong to the engine's ruleset, not to the host's arrangement.
  expect(applyChartPlayOptions(player, program({ judge: 'GOOD2BAD' }), dp).selection).toEqual(player);
});
