import { describe, expect, test } from 'vitest';
import { resolveVisibleBeatsForTuiGrid } from './tui.ts';

describe('player tui', () => {
  test('tui: keeps rows-per-beat constant across different terminal heights', () => {
    const shortRows = 14;
    const tallRows = 28;
    const shortWindowBeats = resolveVisibleBeatsForTuiGrid(shortRows, 1);
    const tallWindowBeats = resolveVisibleBeatsForTuiGrid(tallRows, 1);

    const shortRowsPerBeat = shortRows / shortWindowBeats;
    const tallRowsPerBeat = tallRows / tallWindowBeats;
    expect(shortRowsPerBeat).toBeCloseTo(tallRowsPerBeat, 9);
  });

  test('tui: makes visible beat range smaller as HIGH-SPEED increases', () => {
    const rows = 24;
    const normal = resolveVisibleBeatsForTuiGrid(rows, 1);
    const fast = resolveVisibleBeatsForTuiGrid(rows, 2);
    expect(fast).toBeCloseTo(normal / 2, 9);
  });

  test('tui: clamps invalid HIGH-SPEED to supported range', () => {
    const rows = 24;
    const belowMin = resolveVisibleBeatsForTuiGrid(rows, 0.1);
    const atMin = resolveVisibleBeatsForTuiGrid(rows, 0.5);
    const aboveMax = resolveVisibleBeatsForTuiGrid(rows, 100);
    const atMax = resolveVisibleBeatsForTuiGrid(rows, 10);
    expect(belowMin).toBeCloseTo(atMin, 9);
    expect(aboveMax).toBeCloseTo(atMax, 9);
  });
});
