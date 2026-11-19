import { expect, test } from 'vite-plus/test';
import { applyChartPlayOptions, resolveChartPlayProgram } from './chart-play-options.ts';

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

test('records only effective player options when chart declarations take precedence', () => {
  expect(
    resolveChartPlayProgram(
      { version: 1, options: { judge: 'GOOD2BAD' } },
      { judge: 'GREAT2BAD', hellJudge: true, notes: 'DBLCOPY' },
      { playVariant: '7', course: true },
    ),
  ).toEqual({
    program: { version: 3, options: { judge: 'GOOD2BAD', hellJudge: true, notes: 'DOUBLE' } },
    diagnostics: [{ code: 'unsupported-option', declaration: '774:NOTES_DBLCOPY' }],
    playerOptions: { hellJudge: true, notes: 'DOUBLE' },
  });
});

test('omits a player selection that has no effect', () => {
  expect(
    resolveChartPlayProgram({ version: 3, options: {} }, { notes: 'COPY' }, { playVariant: '7', course: true }),
  ).toEqual({
    program: { version: 3, options: {} },
    diagnostics: [{ code: 'unsupported-option', declaration: '774:NOTES_COPY' }],
    playerOptions: {},
  });
});

test('keeps the recorded program version when the chart supplies all options', () => {
  const declared = { version: 1, options: { notes: 'DOUBLE' } } as const;
  expect(resolveChartPlayProgram(declared, undefined, { playVariant: '24', course: false })).toEqual({
    program: declared,
    diagnostics: [],
    playerOptions: {},
  });
});

test('without a program the player keeps every choice', () => {
  expect(applyChartPlayOptions(player, undefined, dp)).toEqual({ selection: player });
  expect(applyChartPlayOptions(player, program({}), dp)).toEqual({ selection: player });
});

test.each([
  ['MIRROR', sp, 'MIRROR', undefined],
  ['RANDOM', sp, 'RANDOM', undefined],
  ['RANDOM+', sp, 'RANDOM+', undefined],
  ['RANDOM+', { doublePlay: false, hasScratch: false }, 'RANDOM', undefined],
  ['ALL', sp, 'RANDOM', undefined],
  ['ALL+', sp, 'RANDOM+', undefined],
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
