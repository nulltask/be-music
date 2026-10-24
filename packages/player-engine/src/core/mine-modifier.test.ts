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
