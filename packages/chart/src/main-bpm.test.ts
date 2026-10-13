import { describe, expect, test } from 'vite-plus/test';
import { resolveChartMainBpm, type MainBpmChart } from './main-bpm.ts';

/** A chart whose tempo map is a list of `[beat, bpm]` steps. */
function chart(
  steps: ReadonlyArray<readonly [number, number]>,
  notes: MainBpmChart['notes'],
  fallbackBpm = steps[0]?.[1] ?? 130,
): MainBpmChart {
  return {
    notes,
    timing: {
      bpmAtBeat: (beat) => {
        let bpm = fallbackBpm;
        for (const [at, value] of steps) if (at <= beat) bpm = value;
        return bpm;
      },
    },
  };
}

const tap = (beat: number) => ({ kind: 'tap' as const, beat });

describe('resolveChartMainBpm', () => {
  test('is the BPM the most notes sit at, not a time average (beatoraja MAINBPM)', () => {
    // A BPM×100001 + STOP gimmick: a few notes at the huge BPM, most at the base 145.
    const value = chart(
      [
        [0, 145],
        [8, 14_500_145],
        [9, 145],
      ],
      [tap(1), tap(2), tap(3), tap(8.5), tap(10)],
    );
    expect(resolveChartMainBpm(value)).toBe(145);
  });

  test('counts a long note once at its head, and its tail too when the mode judges it (CN / HCN)', () => {
    const steps = [
      [0, 120],
      [4, 180],
    ] as const;
    const ln = (lnMode: 1 | 2 | 3) => ({ kind: 'ln' as const, beat: 1, endBeat: 5, lnMode });
    // LN: head at 120, tap at 180 → a tie, broken by the BPM reached first.
    expect(resolveChartMainBpm(chart(steps, [ln(1), tap(6)]))).toBe(120);
    // CN: the tail at 180 counts too.
    expect(resolveChartMainBpm(chart(steps, [ln(2), tap(6)]))).toBe(180);
    expect(resolveChartMainBpm(chart(steps, [ln(3), tap(6)]))).toBe(180);
  });

  test('breaks ties by the BPM reached first and ignores non-positive values', () => {
    expect(
      resolveChartMainBpm(
        chart(
          [
            [0, 150],
            [4, 200],
          ],
          [tap(5), tap(1)],
        ),
      ),
    ).toBe(150);
  });

  test('is undefined for a chart without notes', () => {
    expect(resolveChartMainBpm(chart([[0, 150]], []))).toBeUndefined();
  });
});
