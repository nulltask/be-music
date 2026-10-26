import { describe, expect, test } from 'vite-plus/test';
import {
  collectBPMChanges,
  formatBPMChangeWarning,
  resolveBPMChangeWarning,
  resolveBPMChangeWarningPlacements,
  type BPMChange,
} from './bpm-change-warning.ts';
import type { DisplayAreaLane } from './display-area-info.ts';

/** A resolver whose beat N falls at N seconds, so the changes' times read as their beats. */
function timing(points: { beat: number; bpm: number }[]) {
  return {
    tempoPoints: points.map((point) => ({ ...point, seconds: point.beat })),
    beatToSeconds: (beat: number) => beat,
  };
}

describe('AC 34 BPM-change warning', () => {
  test('collects actual changes, merging changes at one instant and skipping a change back to the same BPM', () => {
    expect(
      collectBPMChanges(
        timing([
          { beat: 0, bpm: 138 },
          { beat: 10, bpm: 138 },
          { beat: 20, bpm: 200 },
          { beat: 30, bpm: 150 },
          { beat: 30, bpm: 138 },
          { beat: 40, bpm: 160 },
          { beat: 40, bpm: 138 },
        ]),
      ),
    ).toEqual([
      { seconds: 20, from: 138, to: 200 },
      { seconds: 30, from: 200, to: 138 },
    ]);
  });

  const changes: BPMChange[] = [
    { seconds: 44.28, from: 138, to: 200 },
    { seconds: 64.78, from: 200, to: 138 },
  ];

  test('shows the next change from 2 s before it until the change itself', () => {
    expect(resolveBPMChangeWarning(changes, 42.2)).toBeUndefined();
    expect(resolveBPMChangeWarning(changes, 42.28)).toMatchObject({ from: 138, to: 200, rising: true });
    expect(resolveBPMChangeWarning(changes, 43.28)?.elapsedSeconds).toBeCloseTo(1);
    expect(resolveBPMChangeWarning(changes, 44.27)).toMatchObject({ to: 200 });
    // The warning goes on the change.
    expect(resolveBPMChangeWarning(changes, 44.28)).toBeUndefined();
    expect(resolveBPMChangeWarning(changes, 63)).toMatchObject({ from: 200, to: 138, rising: false });
    expect(resolveBPMChangeWarning(changes, 65)).toBeUndefined();
    expect(resolveBPMChangeWarning([], 0)).toBeUndefined();
  });

  test('a change less than 2 s after another warns as soon as the first one has happened', () => {
    const close: BPMChange[] = [
      { seconds: 10, from: 120, to: 180 },
      { seconds: 11, from: 180, to: 90 },
    ];
    expect(resolveBPMChangeWarning(close, 9.5)).toMatchObject({ to: 180 });
    expect(resolveBPMChangeWarning(close, 10)).toMatchObject({ from: 180, to: 90, elapsedSeconds: 1 });
  });

  test('prints whole BPMs as current » next', () => {
    expect(formatBPMChangeWarning({ from: 138, to: 200 })).toBe('138 » 200');
    expect(formatBPMChangeWarning({ from: 155.5, to: 77.9 })).toBe('155 » 77');
  });

  const lanes: DisplayAreaLane[] = [
    { side: '1P', x: 100, w: 20, top: 0, bottom: 400 },
    { side: '1P', x: 120, w: 80, top: 0, bottom: 400 },
    { side: '2P', x: 600, w: 400, top: 100, bottom: 500, baseBottom: 600 },
  ];

  test("centres each side's warning on its lanes, half-way down, sized to the lanes", () => {
    expect(resolveBPMChangeWarningPlacements(lanes)).toEqual([
      { side: '1P', x: 150, y: 200, size: 10 },
      { side: '2P', x: 800, y: 350, size: 20 },
    ]);
    expect(resolveBPMChangeWarningPlacements([])).toEqual([]);
  });
});
