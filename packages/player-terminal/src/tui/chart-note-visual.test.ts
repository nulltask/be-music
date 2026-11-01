import { expect, test } from 'vite-plus/test';
import { placeTUIChartNote } from './chart-note-visual.ts';

const input = { windowBeats: 4, channel: '11', beat: 4, seconds: 0 };

test('without HIDDEN or CHANGE-HS a note keeps its grid distance', () => {
  expect(placeTUIChartNote(undefined, { ...input, distance: 2 })).toEqual({ distance: 2, visible: true });
  expect(placeTUIChartNote({ hiSpeed: 3, crazySize: 'BIG' }, { ...input, distance: 2 })).toEqual({
    distance: 2,
    visible: true,
  });
});

test('CHANGE-HS moves the note along the window and HIDDEN hides it below half opacity', () => {
  expect(placeTUIChartNote({ changeHS: 'ACCEL' }, { ...input, distance: 2 }).distance).toBe(2.5);
  expect(placeTUIChartNote({ hidden: 'SUDDEN' }, { ...input, distance: 3.6 }).visible).toBe(false);
  expect(placeTUIChartNote({ hidden: 'SUDDEN' }, { ...input, distance: 1 }).visible).toBe(true);
  expect(placeTUIChartNote({ hidden: 'MIST' }, { ...input, distance: 1 }).visible).toBe(false);
  expect(placeTUIChartNote({ hidden: 'BLINK' }, { ...input, distance: 1, seconds: 0 }).visible).toBe(true);
  expect(placeTUIChartNote({ hidden: 'BLINK' }, { ...input, distance: 1, seconds: 1 }).visible).toBe(false);
  // A held long note whose head has passed reads as on the line.
  expect(placeTUIChartNote({ hidden: 'HIDDEN' }, { ...input, distance: Number.NaN }).visible).toBe(false);
  expect(placeTUIChartNote({ hidden: 'SUDDEN' }, { ...input, distance: Number.NaN }).visible).toBe(true);
});
