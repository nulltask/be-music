import { resolveChart } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import {
  binPracticeNoteDensity,
  dragPracticeRangeHandle,
  findPracticeMeasureAt,
  formatPracticeTime,
  pickPracticeRangeHandle,
  practiceTimeToX,
  practiceXToTime,
  resolvePracticeRangeChart,
  resolveShownPracticeRange,
  type PracticeRangeChart,
} from './practice-range.ts';

// 120 BPM: a 4/4 measure lasts 2000 ms.
const CHART: PracticeRangeChart = {
  lengthMs: 10_000,
  measures: [0, 2000, 4000, 6000, 8000, 10_000].map((startMs, measure) => ({ measure, startMs })),
  noteTimesMs: [0, 500, 2000, 2500, 9999],
};

describe('resolvePracticeRangeChart', () => {
  test('reads the measure starts and judged note times of a resolved chart', () => {
    const source = parseChart(
      ['#BPM 120', '#WAV01 a.wav', '#00111:01000100', '#00212:01', '#00302:0.5', '#00313:01'].join('\n'),
      'bms',
    );
    const chart = resolvePracticeRangeChart(resolveChart(source));
    expect(chart.measures).toEqual([
      { measure: 0, startMs: 0 },
      { measure: 1, startMs: 2000 },
      { measure: 2, startMs: 4000 },
      { measure: 3, startMs: 6000 },
      { measure: 4, startMs: 7000 },
    ]);
    expect(chart.noteTimesMs).toEqual([2000, 3000, 4000, 6000]);
    expect(chart.lengthMs).toBe(7000);
  });

  test('keeps the first measure number where measures share a millisecond', () => {
    const source = parseChart(['#BPM 120', '#WAV01 a.wav', '#00102:0.0001', '#00211:01'].join('\n'), 'bms');
    const chart = resolvePracticeRangeChart(resolveChart(source));
    expect(chart.measures.map(({ measure }) => measure)).not.toContain(2);
  });
});

test('binPracticeNoteDensity counts the notes of each equal slice', () => {
  expect(binPracticeNoteDensity(CHART.noteTimesMs, CHART.lengthMs, 5)).toEqual([2, 2, 0, 0, 1]);
  expect(binPracticeNoteDensity([10_000, 20_000], 10_000, 2)).toEqual([0, 2]);
  expect(binPracticeNoteDensity([1], 0, 3)).toEqual([0, 0, 0]);
  expect(binPracticeNoteDensity([1], 10, 0)).toEqual([]);
});

test('practiceTimeToX and practiceXToTime map between time and the graph, clamped', () => {
  expect(practiceTimeToX(2500, 10_000, 200)).toBe(50);
  expect(practiceTimeToX(-1, 10_000, 200)).toBe(0);
  expect(practiceTimeToX(20_000, 10_000, 200)).toBe(200);
  expect(practiceTimeToX(1, 0, 200)).toBe(0);
  expect(practiceXToTime(50, 10_000, 200)).toBe(2500);
  expect(practiceXToTime(-5, 10_000, 200)).toBe(0);
  expect(practiceXToTime(500, 10_000, 200)).toBe(10_000);
  expect(practiceXToTime(5, 10_000, 0)).toBe(0);
});

test('findPracticeMeasureAt finds the measure a time lies in', () => {
  expect(findPracticeMeasureAt(0, CHART.measures)?.measure).toBe(0);
  expect(findPracticeMeasureAt(3999, CHART.measures)?.measure).toBe(1);
  expect(findPracticeMeasureAt(4000, CHART.measures)?.measure).toBe(2);
  expect(findPracticeMeasureAt(-10, CHART.measures)?.measure).toBe(0);
  expect(findPracticeMeasureAt(0, [])).toBeUndefined();
});

test('resolveShownPracticeRange reads END 0 as the chart end and keeps 1000 ms', () => {
  expect(resolveShownPracticeRange({ startMs: 2000, endMs: 0 }, 10_000)).toEqual({ startMs: 2000, endMs: 10_000 });
  expect(resolveShownPracticeRange({ startMs: 2000, endMs: 2500 }, 10_000)).toEqual({ startMs: 2000, endMs: 3000 });
  expect(resolveShownPracticeRange({ startMs: -5, endMs: 4000 }, 10_000)).toEqual({ startMs: 0, endMs: 4000 });
});

test('pickPracticeRangeHandle grabs the nearer handle, or the side pressed on a tie', () => {
  expect(pickPracticeRangeHandle(10, 20, 100)).toBe('start');
  expect(pickPracticeRangeHandle(80, 20, 100)).toBe('end');
  expect(pickPracticeRangeHandle(40, 50, 50)).toBe('start');
  expect(pickPracticeRangeHandle(60, 50, 50)).toBe('end');
});

describe('dragPracticeRangeHandle', () => {
  test('snaps the start to the nearest measure start', () => {
    expect(dragPracticeRangeHandle({ startMs: 0, endMs: 0 }, 'start', 4900, CHART)).toEqual({
      startMs: 4000,
      endMs: 0,
    });
    expect(dragPracticeRangeHandle({ startMs: 0, endMs: 0 }, 'start', 5100, CHART)).toEqual({
      startMs: 6000,
      endMs: 0,
    });
  });

  test('never starts at the bar line closing the chart', () => {
    expect(dragPracticeRangeHandle({ startMs: 0, endMs: 0 }, 'start', 10_000, CHART).startMs).toBe(8000);
  });

  test('keeps the start 1000 ms before the end', () => {
    expect(dragPracticeRangeHandle({ startMs: 0, endMs: 6000 }, 'start', 5900, CHART)).toEqual({
      startMs: 4000,
      endMs: 6000,
    });
  });

  test('snaps the end, storing 0 at the bar line closing the chart', () => {
    expect(dragPracticeRangeHandle({ startMs: 2000, endMs: 0 }, 'end', 6200, CHART)).toEqual({
      startMs: 2000,
      endMs: 6000,
    });
    expect(dragPracticeRangeHandle({ startMs: 2000, endMs: 6000 }, 'end', 9900, CHART)).toEqual({
      startMs: 2000,
      endMs: 0,
    });
  });

  test('keeps the end 1000 ms after the start', () => {
    expect(dragPracticeRangeHandle({ startMs: 4000, endMs: 0 }, 'end', 0, CHART)).toEqual({
      startMs: 4000,
      endMs: 6000,
    });
  });

  test('stops 1000 ms from the other handle where no measure start fits', () => {
    const sparse: PracticeRangeChart = {
      lengthMs: 20_000,
      measures: [
        { measure: 0, startMs: 0 },
        { measure: 1, startMs: 20_000 },
      ],
      noteTimesMs: [],
    };
    expect(dragPracticeRangeHandle({ startMs: 0, endMs: 600 }, 'start', 300, sparse)).toEqual({
      startMs: 0,
      endMs: 600,
    });
    expect(dragPracticeRangeHandle({ startMs: 5000, endMs: 9000 }, 'start', 8800, sparse)).toEqual({
      startMs: 0,
      endMs: 9000,
    });
    expect(dragPracticeRangeHandle({ startMs: 19_500, endMs: 0 }, 'end', 0, sparse)).toEqual({
      startMs: 19_500,
      endMs: 0,
    });
  });
});

test('formatPracticeTime writes m:ss.s', () => {
  expect(formatPracticeTime(0)).toBe('0:00.0');
  expect(formatPracticeTime(83_456)).toBe('1:23.4');
  expect(formatPracticeTime(9_999)).toBe('0:09.9');
  expect(formatPracticeTime(600_000)).toBe('10:00.0');
});
