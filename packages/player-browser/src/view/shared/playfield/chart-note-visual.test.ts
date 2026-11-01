import { expect, test } from 'vite-plus/test';
import { hasChartNoteVisual, placeChartNoteVisual } from './chart-note-visual.ts';

const base = { judgementY: 500, laneTopY: 100, laneWidth: 40, channel: '11', beat: 4, seconds: 0 };

test('without a visual family the note keeps its scrolled place', () => {
  expect(hasChartNoteVisual({ hiSpeed: 2 })).toBe(false);
  expect(placeChartNoteVisual({ hiSpeed: 2 }, { ...base, y: 300 })).toEqual({ y: 300, alpha: 1, scale: 1, xOffset: 0 });
  expect(placeChartNoteVisual(undefined, { ...base, y: 300 })).toEqual({ y: 300, alpha: 1, scale: 1, xOffset: 0 });
});

test('maps lane progress onto screen y and lane widths onto pixels', () => {
  // y 300 is progress 0.5; ACCEL shows it at 0.625, 250 px above the line.
  expect(placeChartNoteVisual({ changeHS: 'ACCEL' }, { ...base, y: 300 }).y).toBe(250);
  expect(placeChartNoteVisual({ hidden: 'SUDDEN' }, { ...base, y: 150 }).alpha).toBe(0);
  expect(placeChartNoteVisual({ hidden: 'SUDDEN' }, { ...base, y: 450 }).alpha).toBe(1);
  expect(placeChartNoteVisual({ crazySize: 'BIG' }, { ...base, y: 300 }).scale).toBe(1.4);
  // progress 0.125 is the XWAVE crest: a quarter lane, 10 px.
  expect(placeChartNoteVisual({ crazyWave: 'XWAVE' }, { ...base, y: 450 }).xOffset).toBeCloseTo(10);
  // A note LR2 holds below the line keeps its place.
  expect(placeChartNoteVisual({ changeHS: 'NAZO' }, { ...base, y: 520 }).y).toBe(520);
});

test('a zero-height lane is left alone', () => {
  expect(placeChartNoteVisual({ hidden: 'STEALTH' }, { ...base, laneTopY: 500, y: 300 }).alpha).toBe(1);
});
