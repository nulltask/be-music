import { describe, expect, test } from 'vite-plus/test';
import { practiceTempoRate } from './practice-bars.ts';

describe('practiceTempoRate', () => {
  test('plays at the tempo set while the tempo is on', () => {
    expect(practiceTempoRate({ enabled: true, percent: -20 })).toBeCloseTo(0.8);
    expect(practiceTempoRate({ enabled: true, percent: 0 })).toBe(1);
  });

  test("plays at the chart's own tempo while it is off, keeping the percent set", () => {
    expect(practiceTempoRate({ enabled: false, percent: -20 })).toBe(1);
  });
});
