import { describe, expect, test } from 'vite-plus/test';
import type { PlaylogRulesetResult } from '@be-music/player/playlog';
import { courseTrophyRank, mergeCourseTrophy, NO_TROPHY, toCourseStageFigures } from './figures.ts';

const TROPHIES = [
  { name: 'bronzemedal', missRate: 7.5, scoreRate: 55 },
  { name: 'silvermedal', missRate: 5, scoreRate: 70 },
  { name: 'goldmedal', missRate: 2.5, scoreRate: 85 },
];

describe('toCourseStageFigures', () => {
  test('keeps the stage’s figures, with BP counting the notes a failed stage never judged', () => {
    const result: PlaylogRulesetResult = {
      ruleset: 'lr2/0',
      judge: { pgreat: 4, great: 1, good: 1, bad: 1, poor: 1, emptyPoor: 2 },
      fast: 2,
      slow: 3,
      exScore: 9,
      noteCount: 10,
      maxCombo: 6,
      gauge: { type: 'GRADE-DEATH', final: 0, cleared: false },
    };
    expect(toCourseStageFigures(result)).toEqual({
      exScore: 9,
      noteCount: 10,
      // BAD, POOR, two empty POORs, and the two notes never judged.
      missCount: 6,
      maxCombo: 6,
      judges: { pgreat: 4, great: 1, good: 1, bad: 1, poor: 1, emptyPoor: 2, fast: 2, slow: 3 },
      gaugeType: 'GRADE-DEATH',
      gaugeFinal: 0,
      cleared: false,
    });
  });
});

describe('courseTrophyRank', () => {
  test('places a trophy in the course’s list, easiest first, and none at 0', () => {
    expect(courseTrophyRank(TROPHIES, 'bronzemedal')).toBe(1);
    expect(courseTrophyRank(TROPHIES, 'goldmedal')).toBe(3);
    expect(courseTrophyRank(TROPHIES, undefined)).toBe(0);
    expect(courseTrophyRank(TROPHIES, null)).toBe(0);
    expect(courseTrophyRank(TROPHIES, 'platinum')).toBe(0);
    expect(courseTrophyRank([...TROPHIES, { name: 'bronzemedal', missRate: 0, scoreRate: 100 }], 'bronzemedal')).toBe(
      4,
    );
  });
});

describe('mergeCourseTrophy', () => {
  test('a higher trophy replaces the best; a tie or a lower one keeps the earlier run', () => {
    const first = mergeCourseTrophy(undefined, { scoreId: 'a', trophy: 'silvermedal', rank: 2 });
    expect(first).toEqual({ next: { trophy: 'silvermedal', rank: 2, scoreId: 'a' }, improved: true });
    expect(mergeCourseTrophy(first.next, { scoreId: 'b', trophy: 'silvermedal', rank: 2 })).toEqual({
      next: first.next,
      improved: false,
    });
    expect(mergeCourseTrophy(first.next, { scoreId: 'c', trophy: 'bronzemedal', rank: 1 }).next).toBe(first.next);
    expect(mergeCourseTrophy(first.next, { scoreId: 'd', trophy: 'goldmedal', rank: 3 })).toEqual({
      next: { trophy: 'goldmedal', rank: 3, scoreId: 'd' },
      improved: true,
    });
  });

  test('a run without a trophy keeps none', () => {
    expect(mergeCourseTrophy(undefined, { scoreId: 'a', trophy: null, rank: 0 })).toEqual({
      next: NO_TROPHY,
      improved: false,
    });
  });
});
