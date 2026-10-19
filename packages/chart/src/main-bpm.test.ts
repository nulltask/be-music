import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJSON, type BeMusicEvent } from '../../json/src/index.ts';
import { resolveChartMainBPM, type MainBPMChart } from './main-bpm.ts';
import { resolveChart } from './resolved-chart.ts';

/** A chart whose tempo map is a list of `[beat, bpm]` steps. */
function chart(
  steps: ReadonlyArray<readonly [number, number]>,
  notes: MainBPMChart['notes'],
  fallbackBPM = steps[0]?.[1] ?? 130,
): MainBPMChart {
  return {
    notes,
    timing: {
      bpmAtBeat: (beat) => {
        let bpm = fallbackBPM;
        for (const [at, value] of steps) if (at <= beat) bpm = value;
        return bpm;
      },
    },
  };
}

const tap = (beat: number) => ({ kind: 'tap' as const, beat });

describe('resolveChartMainBPM', () => {
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
    expect(resolveChartMainBPM(value)).toBe(145);
  });

  test('counts a long note once at its head, and its tail too when the mode judges it (CN / HCN)', () => {
    const steps = [
      [0, 120],
      [4, 180],
    ] as const;
    const ln = (lnMode: 1 | 2 | 3) => ({ kind: 'ln' as const, beat: 1, endBeat: 5, lnMode });
    // LN: head at 120, tap at 180 → a tie, broken by the BPM reached first.
    expect(resolveChartMainBPM(chart(steps, [ln(1), tap(6)]))).toBe(120);
    // CN: the tail at 180 counts too.
    expect(resolveChartMainBPM(chart(steps, [ln(2), tap(6)]))).toBe(180);
    expect(resolveChartMainBPM(chart(steps, [ln(3), tap(6)]))).toBe(180);
  });

  test('breaks ties by the BPM reached first and ignores non-positive values', () => {
    expect(
      resolveChartMainBPM(
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
    expect(resolveChartMainBPM(chart([[0, 150]], []))).toBeUndefined();
  });

  test('counts a resolved chart as beatoraja counts its timelines: judged notes only, at the BPM of their position', () => {
    const event = (measure: number, channel: string, value: string, position: [number, number] = [0, 1]) =>
      ({ measure, channel, position, value }) satisfies BeMusicEvent;
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [
      // Two taps at 120, with three mines and two invisible notes that do not count.
      event(1, '11', '01'),
      event(1, '12', '01'),
      event(1, 'D3', '01'),
      event(1, 'D4', '01'),
      event(1, 'D5', '01', [1, 2]),
      event(1, '31', '01', [1, 2]),
      event(1, '32', '01', [1, 2]),
      // 60 from measure 2, a tap on the change itself counting at 60: three taps at 60.
      event(2, '03', '3C'),
      event(2, '11', '01'),
      event(2, '13', '01', [1, 2]),
      event(3, '14', '01'),
      // 240 from measure 4, held longest (64 beats, 16 s) with one tap at its end.
      event(4, '03', 'F0'),
      event(20, '15', '01'),
    ];
    expect(resolveChartMainBPM(resolveChart(json))).toBe(60);
  });
});
