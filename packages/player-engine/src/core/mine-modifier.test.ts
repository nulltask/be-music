import { prepareMineModifier } from './mine-modifier.ts';
import { resolveLandmineGaugeEffect } from './landmine.ts';
import { expect, test } from 'vite-plus/test';
import { resolveChart } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import { preparePlaybackChart } from './bootstrap.ts';

const source = () =>
  resolveChart(parseChart('#BPM 120\n#PLAYER 3\n#00011:01\n#00031:01\n#000D1:01\n#000D6:02\n#000E1:03', 'bms'), {
    playVariant: '14',
  });

test('mine REMOVE changes the shared judged/rendered mine list and leaves source facts intact', () => {
  const resolved = source();
  const original = structuredClone(resolved.mines);
  const ordinary = preparePlaybackChart(resolved);
  const removed = preparePlaybackChart(resolved, { mineModifier: 'REMOVE' });
  expect(ordinary.landmineNotes).toHaveLength(3);
  expect(removed.landmineNotes).toEqual([]);
  expect(removed.mineModifierChangeCount).toBe(3);
  expect(removed.notes).toEqual(ordinary.notes);
  expect(removed.invisibleNotes).toEqual(ordinary.invisibleNotes);
  expect(removed.renderNotes).toBe(removed.notes);
  expect(resolved.mines).toEqual(original);
});

test('REMOVE on a mine-free chart records zero actual changes; OFF retains every mine', () => {
  const resolved = resolveChart(parseChart('#BPM 120\n#00011:01', 'bms'));
  expect(preparePlaybackChart(resolved, { mineModifier: 'REMOVE' }).mineModifierChangeCount).toBe(0);
  const off = preparePlaybackChart(source(), { mineModifier: 'OFF' });
  expect(off.mineModifierChangeCount).toBe(0);
  expect(off.landmineNotes).toHaveLength(3);
});

test('ADD RANDOM uses the strict source probability, draws only for blank lanes, and generates silent damage-10 mines', () => {
  const resolved = resolveChart(parseChart('#BPM 120\n#00011:01', 'bms'), { playVariant: '7' });
  let draws = 0;
  expect(
    prepareMineModifier(resolved, 'ADD_RANDOM', {
      random: () => {
        draws += 1;
        return 0.9;
      },
    }).changes,
  ).toBe(0);
  expect(draws).toBe(7);
  const result = prepareMineModifier(resolved, 'ADD_RANDOM', { random: () => 0.90001 });
  expect(result.changes).toBe(7);
  expect(result.mines.map((mine) => mine.channel)).toEqual(['12', '13', '14', '15', '18', '19', '16']);
  for (const mine of result.mines) {
    expect(resolveLandmineGaugeEffect(mine.event).damage).toBe(10);
    expect(mine.silent).toBe(true);
  }
  expect(resolved.mines).toEqual([]);
});

test('ADD RANDOM visits measure starts and BGM/BPM positions, but not fractional POOR/unknown channel positions', () => {
  const resolved = resolveChart(
    parseChart('#BPM 120\n#00001:0001\n#00111:01\n#00103:0078\n#00106:000001\n#00199:000001', 'bms'),
    { playVariant: '7' },
  );
  const result = prepareMineModifier(resolved, 'ADD_RANDOM', { random: () => 0.99 });
  expect([...new Set(result.mines.map((mine) => mine.beat))]).toEqual([0, 2, 4, 6]);
  const prepared = preparePlaybackChart(resolved, { mineModifier: 'ADD_RANDOM' }, 0, () => 0.99);
  expect(prepared.totalSeconds).toBe(3);
});

test('ADD RANDOM reserves LN heads, interiors and exact tails; a removed LN tail becomes a blank cell', () => {
  const resolved = resolveChart(
    parseChart('#BPM 120\n#LNOBJ AA\n#00011:01\n#00111:AA\n#00001:0001\n#00212:01', 'bms'),
    { playVariant: '7' },
  );
  const held = preparePlaybackChart(resolved, { mineModifier: 'ADD_RANDOM' }, 0, () => 0.99);
  expect(held.landmineNotes.filter((mine) => mine.channel === '11').map((mine) => mine.beat)).toEqual([8]);
  const removed = preparePlaybackChart(
    resolved,
    { longNoteModifier: 'REMOVE', mineModifier: 'ADD_RANDOM' },
    0,
    () => 0.99,
  );
  expect(removed.landmineNotes.filter((mine) => mine.channel === '11').map((mine) => mine.beat)).toEqual([2, 4, 8]);
});

test('ADD RANDOM retains authored mines and counts only the newly added population', () => {
  const resolved = source();
  const before = structuredClone(resolved.mines);
  const result = prepareMineModifier(resolved, 'ADD_RANDOM', { random: () => 0.99 });
  expect(result.mines.length - result.changes).toBe(3);
  expect(result.mines.filter((mine) => !mine.silent)).toHaveLength(3);
  const keys = result.mines.map((mine) => `${mine.channel}:${mine.beat}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(resolved.mines).toEqual(before);
});

test('empty keyboard charts still expose all 24 keys and both wheel directions', () => {
  const resolved = resolveChart(parseChart('#BPM 120', 'bms'), { playVariant: '24' });
  const mines = prepareMineModifier(resolved, 'ADD_RANDOM', { random: () => 0.99 }).mines;
  expect(mines).toHaveLength(26);
  expect(mines.slice(-2).map((mine) => mine.channel)).toEqual(['1P', '1Q']);
});

test('recorded placements bypass generation, preserve damage/silence, and reject missing source timelines', () => {
  const resolved = resolveChart(parseChart('#BPM 120\n#00111:01', 'bms'), { playVariant: '7' });
  const placements = [{ channel: '16', timeUs: 0, damage: 10, silent: true }];
  const restored = prepareMineModifier(resolved, 'ADD_RANDOM', {
    placements,
    random: () => {
      throw new Error('reroll');
    },
  });
  expect(restored.mines).toMatchObject([{ channel: '16', seconds: 0, silent: true }]);
  expect(() =>
    prepareMineModifier(resolved, 'ADD_RANDOM', { placements: [{ ...placements[0]!, timeUs: 123 }] }),
  ).toThrow(/source timeline/);
  expect(() => prepareMineModifier(resolved, 'ADD_RANDOM')).toThrow(/supplied randomness/);
});

test('ADD NEAR uses original occupied neighbors without wrapping or expanding through new mines', () => {
  const resolved = resolveChart(parseChart('#BPM 120\n#00013:01\n#00101:01', 'bms'), { playVariant: '7' });
  const result = prepareMineModifier(resolved, 'ADD_NEAR');
  expect(result.mines.map((mine) => [mine.channel, mine.beat])).toEqual([
    ['12', 0],
    ['14', 0],
  ]);
  expect(result.changes).toBe(2);
  expect(result.mines.every((mine) => mine.silent && resolveLandmineGaugeEffect(mine.event).damage === 10)).toBe(true);
});

test('ADD NEAR includes held LN lanes and exact tails but invisible notes remain blank', () => {
  const resolved = resolveChart(
    parseChart('#BPM 120\n#LNOBJ AA\n#00011:01\n#00001:0001\n#00111:AA\n#00231:01', 'bms'),
    { playVariant: '7' },
  );
  const result = prepareMineModifier(resolved, 'ADD_NEAR');
  expect(result.mines.map((mine) => [mine.channel, mine.beat])).toEqual([
    ['12', 0],
    ['12', 2],
    ['12', 4],
  ]);
});

test('ADD NEAR follows source key/scratch order across DP sides and retains existing mines', () => {
  const resolved = resolveChart(parseChart('#BPM 120\n#PLAYER 3\n#000D6:03', 'bms'), { playVariant: '14' });
  const result = prepareMineModifier(resolved, 'ADD_NEAR');
  expect(result.mines.map((mine) => mine.channel)).toEqual(['19', '16', '21']);
  expect(result.changes).toBe(2);
  expect(result.mines.find((mine) => mine.channel === '16')?.silent).toBeUndefined();
  const pms = resolveChart(parseChart('#BPM 120\n#00011:01', 'bms'), { playVariant: '9' });
  expect(prepareMineModifier(pms, 'ADD_NEAR').mines.map((mine) => mine.channel)).toEqual(['12']);
});
