import { describe, expect, test } from 'vite-plus/test';
import { buildGhostPace, countJudgedNotes } from './ghost-pace.ts';
import type { GhostJudgmentCounts, GhostJudgmentStep } from './ghost-timeline.ts';

function step(exScore: number, counts: Partial<GhostJudgmentCounts>): GhostJudgmentStep {
  return {
    seconds: 0,
    judgment: 'PERFECT',
    emptyPoor: false,
    combo: 0,
    maxCombo: 0,
    exScore,
    gauge: 0,
    counts: { perfect: 0, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0, ...counts },
  };
}

describe('countJudgedNotes', () => {
  test('counts every judgment that takes a note, not the empty POORs', () => {
    expect(countJudgedNotes({ perfect: 1, great: 2, good: 3, bad: 4, poor: 5 })).toBe(15);
    expect(countJudgedNotes({ perfect: 1, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 9 })).toBe(1);
  });
});

describe('buildGhostPace', () => {
  const pace = buildGhostPace({
    judgments: [
      step(2, { perfect: 1 }),
      step(3, { perfect: 1, great: 1 }),
      // An empty POOR takes no note: the ghost's EX score at two notes stays.
      step(3, { perfect: 1, great: 1, emptyPoor: 1 }),
      step(3, { perfect: 1, great: 1, poor: 1, emptyPoor: 1 }),
      step(5, { perfect: 2, great: 1, poor: 1, emptyPoor: 1 }),
    ],
  });

  test('stands where the ghost stood after as many notes judged', () => {
    expect(pace.exScoreAt(0)).toBe(0);
    expect(pace.exScoreAt(1)).toBe(2);
    expect(pace.exScoreAt(2)).toBe(3);
    expect(pace.exScoreAt(3)).toBe(3);
    expect(pace.exScoreAt(4)).toBe(5);
  });

  test('holds at the ghost’s last past its notes, and its final EX score is its last judgment’s', () => {
    expect(pace.exScoreAt(40)).toBe(5);
    expect(pace.finalEXScore).toBe(5);
    expect(pace.exScoreAt(-1)).toBe(0);
  });

  test('carries a count the ghost jumped over (a long note’s head and tail settled together)', () => {
    const jumped = buildGhostPace({ judgments: [step(4, { perfect: 2 }), step(6, { perfect: 3 })] });
    expect(jumped.exScoreAt(1)).toBe(0);
    expect(jumped.exScoreAt(2)).toBe(4);
    expect(jumped.exScoreAt(3)).toBe(6);
  });

  test('an empty timeline paces at zero', () => {
    const empty = buildGhostPace({ judgments: [] });
    expect(empty.finalEXScore).toBe(0);
    expect(empty.exScoreAt(10)).toBe(0);
  });
});
