import { describe, expect, test } from 'vite-plus/test';
import { CLEAR_LAMPS } from '../ruleset/clear-lamp.ts';
import {
  beatorajaClearType,
  createCourseChartScore,
  evaluateCourseChartFilter,
  parseCourseChartFilter,
} from './index.ts';

describe('beatorajaClearType', () => {
  test("maps every lamp to beatoraja's ClearType id", () => {
    expect(CLEAR_LAMPS.map(beatorajaClearType)).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('createCourseChartScore', () => {
  test('maps a best record onto the score columns', () => {
    expect(
      createCourseChartScore({ lamp: 'HARD', exScore: 2000, maxCombo: 800, missCount: 4, playCount: 3 }, 1200),
    ).toEqual({ clear: 6, exscore: 2000, combo: 800, minbp: 4, playcount: 3, notes: 1200 });
  });

  test('leaves out what the record lacks, so a filter reads it as NULL', () => {
    const score = createCourseChartScore({ lamp: 'FULL_COMBO' });
    expect(score).toEqual({ clear: 8 });
    const parsed = parseCourseChartFilter('score.clear = 8 AND score.minbp IS NULL');
    expect(parsed.ok && evaluateCourseChartFilter(parsed.filter, { score })).toBe(true);
  });
});
