import { describe, expect, it } from 'vite-plus/test';
import { createEmptyJSON, type BeMusicEvent, type BeMusicJSON } from '@be-music/json';
import {
  computeBeatorajaChartDensity,
  computeBeatorajaChartDensityValues,
  toBeatorajaDensityReadout,
} from './density.ts';

/** BPM 240: one measure is one second, so `measure` reads as the second a note lands in. */
function chart(
  events: BeMusicEvent[],
  options: { total?: number; lnObj?: string; lnMode?: 1 | 2 | 3 } = {},
): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  if (options.total !== undefined) json.metadata.total = options.total;
  if (options.lnObj !== undefined) json.bms.lnObjs = [options.lnObj];
  if (options.lnMode !== undefined) json.bms.lnMode = options.lnMode;
  json.events = events;
  return json;
}

/** `count` taps spread evenly over second `measure` on lane `11`. */
function taps(measure: number, count: number): BeMusicEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    measure,
    channel: '11',
    position: [index, count] as [number, number],
    value: '01',
  }));
}

describe('computeBeatorajaChartDensityValues (beatoraja SongInformation)', () => {
  it('counts notes per second up to the last timeline plus one, and averages every second when the chart is sparse', () => {
    // Seconds 0..3 (last timeline at 2 s → 2 + 2 seconds): [0, 4, 1, 0].
    const values = computeBeatorajaChartDensityValues(chart([...taps(1, 4), ...taps(2, 1)]));
    expect(values.peak).toBe(4);
    // `totalNotes / seconds / 4` is 0, so every second counts: 5 / 4.
    expect(values.average).toBe(1.25);
    // No #TOTAL reads as 100: the border is 0 and the end window starts at second 0, three seconds wide (4 - 0 - 1).
    expect(values.end).toBeCloseTo(5 / 3, 10);
  });

  it('averages only the seconds that hold at least a quarter of the mean', () => {
    // Seconds 0..4: [0, 16, 16, 1, 0]; 33 notes / 5 seconds / 4 = 1, so the two empty seconds drop out.
    const values = computeBeatorajaChartDensityValues(chart([...taps(1, 16), ...taps(2, 16), ...taps(3, 1)]));
    expect(values.average).toBe(11);
    expect(values.peak).toBe(16);
  });

  it('starts the end window where the notes left fit inside the #TOTAL border', () => {
    // Seconds 1-4 hold 4 notes each and seconds 5-8 one each (20 notes; seconds 0..9).
    const events = [1, 2, 3, 4].flatMap((second) => taps(second, 4)).concat([5, 6, 7, 8].flatMap((s) => taps(s, 1)));
    // TOTAL 200: border = 20 × (1 - 100 / 200) = 10, crossed by the 10th note, in second 3. The busiest 5-second
    // window from there is seconds 3-7: (4 + 4 + 1 + 1 + 1) / 5.
    expect(computeBeatorajaChartDensityValues(chart(events, { total: 200 })).end).toBeCloseTo(2.2, 10);
    // TOTAL 100 (the default): from second 0, the busiest window is seconds 1-5.
    expect(computeBeatorajaChartDensityValues(chart(events)).end).toBeCloseTo(3.4, 10);
  });

  it('counts a long note in every second it is held', () => {
    // An #LNOBJ long note from 1 s to 4 s: seconds 0..5 read [0, 1, 1, 1, 1, 0].
    const ln = chart(
      [
        { measure: 1, channel: '11', position: [0, 1], value: '01' },
        { measure: 4, channel: '11', position: [0, 1], value: 'ZZ' },
      ],
      { lnObj: 'ZZ' },
    );
    const values = computeBeatorajaChartDensityValues(ln);
    expect(values.peak).toBe(1);
    expect(values.average).toBeCloseTo(4 / 6, 10);
  });

  it('leaves a chart without timelines at zero', () => {
    expect(computeBeatorajaChartDensityValues(chart([]))).toEqual({ peak: 0, end: 0, average: 0 });
  });
});

describe('beatoraja density readouts (numbers 360-365)', () => {
  it('splits a density into its whole part and two truncated decimal digits', () => {
    expect(toBeatorajaDensityReadout(12.345)).toEqual({ whole: 12, afterDot: 34 });
    expect(toBeatorajaDensityReadout(7)).toEqual({ whole: 7, afterDot: 0 });
    // Java's `(int) (x * 100)` truncates the binary product: 0.29 × 100 is 28.999…
    expect(toBeatorajaDensityReadout(0.29)).toEqual({ whole: 0, afterDot: 28 });
    expect(toBeatorajaDensityReadout(Number.NaN)).toEqual({ whole: 0, afterDot: 0 });
  });

  it('reads the chart densities as numbers 360-365 show them', () => {
    expect(computeBeatorajaChartDensity(chart([...taps(1, 4), ...taps(2, 1)]))).toEqual({
      peak: { whole: 4, afterDot: 0 },
      end: { whole: 1, afterDot: 66 },
      average: { whole: 1, afterDot: 25 },
    });
  });
});
