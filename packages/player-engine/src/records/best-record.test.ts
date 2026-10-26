import { describe, expect, it } from 'vite-plus/test';
import {
  abortedRecordPlayFromResult,
  courseRunKeepsRecord,
  courseRunRecordPlay,
  courseStageKeepsRecord,
  courseStageRecordPlayFromResult,
  courseStageRecordPlayFromSummary,
  isCourseRunAtAnotherTempo,
  isCourseRunAutoPlayed,
  mergeBestRecord,
  mergeCourseStageRecord,
  playKeepsRecord,
  recordPlayFromResult,
  recordPlayFromSummary,
  type RecordPlayResult,
  type RecordPlaySummary,
} from './best-record.ts';

describe('mergeBestRecord', () => {
  const play = { lamp: 'HARD' as const, exScore: 1500, maxCombo: 400, missCount: 12 };

  it('starts a record from the first play', () => {
    expect(mergeBestRecord(undefined, play)).toEqual({ ...play, playCount: 1 });
  });

  it('keeps each best independently and counts the play', () => {
    const previous = { lamp: 'EX_HARD' as const, exScore: 1400, maxCombo: 500, missCount: 20, playCount: 3 };
    expect(mergeBestRecord(previous, play)).toEqual({
      lamp: 'EX_HARD',
      exScore: 1500,
      maxCombo: 500,
      missCount: 12,
      playCount: 4,
    });
  });

  it('upgrades the lamp when the play is better', () => {
    expect(mergeBestRecord({ lamp: 'FAILED', playCount: 1 }, play).lamp).toBe('HARD');
    expect(mergeBestRecord({ lamp: 'HARD', playCount: 1 }, { ...play, lamp: 'FAILED' }).lamp).toBe('HARD');
  });

  it('fills fields a stored record lacks', () => {
    expect(mergeBestRecord({ lamp: 'NORMAL' }, play)).toEqual({
      lamp: 'HARD',
      exScore: 1500,
      maxCombo: 400,
      missCount: 12,
      playCount: 1,
    });
  });
});

describe('mergeCourseStageRecord', () => {
  it('keeps the best EX score, max combo and BP but neither the clear lamp nor the play count, as LR2 does', () => {
    const previous = { lamp: 'EASY' as const, exScore: 100, maxCombo: 50, missCount: 9, playCount: 3 };
    expect(mergeCourseStageRecord(previous, { lamp: 'HARD', exScore: 120, maxCombo: 40, missCount: 12 })).toEqual({
      lamp: 'EASY',
      exScore: 120,
      maxCombo: 50,
      missCount: 9,
      playCount: 3,
    });
  });

  it('writes a FULL COMBO (or better) lamp', () => {
    const previous = { lamp: 'HARD' as const, exScore: 100 };
    expect(mergeCourseStageRecord(previous, { lamp: 'FULL_COMBO', exScore: 90, maxCombo: 80, missCount: 0 }).lamp).toBe(
      'FULL_COMBO',
    );
    expect(
      mergeCourseStageRecord({ lamp: 'MAX' }, { lamp: 'FULL_COMBO', exScore: 0, maxCombo: 0, missCount: 0 }).lamp,
    ).toBe('MAX');
  });

  it('starts a chart never played alone at NO PLAY without a play count', () => {
    expect(mergeCourseStageRecord(undefined, { lamp: 'NORMAL', exScore: 30, maxCombo: 12, missCount: 4 })).toEqual({
      lamp: 'NO_PLAY',
      exScore: 30,
      maxCombo: 12,
      missCount: 4,
    });
  });
});

describe('recordPlayFromResult', () => {
  const score = { total: 10, perfect: 5, great: 2, good: 1, bad: 1, poor: 1, emptyPoor: 4, exScore: 12 };

  it('reads the lamp, EX score, max combo, and BAD + POOR + empty POOR', () => {
    const result: RecordPlayResult = { score, maxCombo: 6, cleared: true, lamp: 'EASY' };
    // Empty POORs count in BP, as LR2, beatoraja and the Leaderboard count them.
    expect(recordPlayFromResult(result)).toEqual({ lamp: 'EASY', exScore: 12, maxCombo: 6, missCount: 6 });
  });

  it('falls back to the gauge verdict without a lamp', () => {
    expect(recordPlayFromResult({ score, maxCombo: 0, cleared: false }).lamp).toBe('FAILED');
    expect(recordPlayFromResult({ score, maxCombo: 0, cleared: true }).lamp).toBe('NORMAL');
  });

  it('counts each empty POOR once where the POOR folds them in (an LR2 result)', () => {
    // The POOR readout shows 1 POOR + 4 empty POORs; the judgments alone are beside it.
    const lr2: RecordPlayResult = { score: { ...score, poor: 5 }, judgedPoor: 1, maxCombo: 6, cleared: true };
    expect(recordPlayFromResult(lr2).missCount).toBe(6);
  });

  it('counts the notes a play that failed mid-way never judged in its BP, as LR2 and beatoraja do (#584)', () => {
    const failed = { total: 100, perfect: 30, great: 10, good: 5, bad: 2, poor: 3, emptyPoor: 1, exScore: 70 };
    // BAD + POOR + empty POOR (6), plus the 50 notes never judged.
    expect(recordPlayFromResult({ score: failed, maxCombo: 20, cleared: false })).toEqual({
      lamp: 'FAILED',
      exScore: 70,
      maxCombo: 20,
      missCount: 56,
    });
  });

  it('does not take mine POORs (which an LR2 POOR counts) for judged notes', () => {
    // 6 notes judged, 2 POORs from mines: 4 notes were never reached.
    const mines = { total: 10, perfect: 6, great: 0, good: 0, bad: 0, poor: 2, minePoor: 2, emptyPoor: 0, exScore: 12 };
    expect(recordPlayFromResult({ score: mines, maxCombo: 6, cleared: false }).missCount).toBe(6);
  });
});

describe('abortedRecordPlayFromResult', () => {
  it('saves a play given up with ESC as FAILED, the notes it never reached in its BP', () => {
    const score = { total: 50, perfect: 10, great: 5, good: 1, bad: 1, poor: 2, emptyPoor: 3, exScore: 25 };
    // A gauge still above the border does not make a play given up a clear.
    expect(abortedRecordPlayFromResult({ score, maxCombo: 12, cleared: true, lamp: 'NORMAL' })).toEqual({
      lamp: 'FAILED',
      exScore: 25,
      maxCombo: 12,
      missCount: 37,
    });
  });

  it('saves nothing from a play that judged no note yet, as beatoraja saves none', () => {
    const score = { total: 50, perfect: 0, great: 0, good: 0, bad: 0, poor: 3, emptyPoor: 2, exScore: 0 };
    expect(abortedRecordPlayFromResult({ score, maxCombo: 0, cleared: false })).toBeUndefined();
    expect(abortedRecordPlayFromResult({ score: { ...score, bad: 1 }, maxCombo: 0, cleared: false })).toMatchObject({
      lamp: 'FAILED',
      missCount: 52,
    });
  });
});

describe('recordPlayFromSummary', () => {
  const summary: RecordPlaySummary = {
    total: 10,
    perfect: 10,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: 20,
    gauge: { type: 'HARD', cleared: true } as RecordPlaySummary['gauge'],
  };

  it('takes the lamp from the same rule as a result: an all-PERFECT clear is MAX', () => {
    expect(recordPlayFromSummary(summary, 10)).toEqual({ lamp: 'MAX', exScore: 20, maxCombo: 10, missCount: 0 });
  });

  it('keeps the lamp to the judge ruleset’s own lamps', () => {
    expect(recordPlayFromSummary(summary, 10, 'lr2').lamp).toBe('FULL_COMBO');
    expect(recordPlayFromSummary(summary, 10, 'beatoraja').lamp).toBe('MAX');
  });

  it('records a failed gauge as FAILED and counts BAD + POOR + empty POOR as misses', () => {
    const failed = {
      ...summary,
      perfect: 6,
      bad: 1,
      poor: 3,
      emptyPoor: 2,
      gauge: { type: 'HARD', cleared: false } as RecordPlaySummary['gauge'],
    };
    expect(recordPlayFromSummary(failed, 4)).toMatchObject({ lamp: 'FAILED', missCount: 6 });
  });

  it('counts the notes a play that failed mid-way never judged in its BP', () => {
    const failed = { ...summary, perfect: 3, bad: 1, poor: 1, gauge: { type: 'HARD', cleared: false } };
    expect(recordPlayFromSummary(failed as RecordPlaySummary, 3)).toMatchObject({ lamp: 'FAILED', missCount: 7 });
  });
});

describe('course stage record plays', () => {
  it('count a stage’s BP as a single play counts it, the notes never judged once', () => {
    const score = { total: 100, perfect: 30, great: 10, good: 5, bad: 2, poor: 3, emptyPoor: 1, exScore: 70 };
    const result: RecordPlayResult = { score, maxCombo: 20, cleared: false };
    expect(courseStageRecordPlayFromResult(result)).toEqual(recordPlayFromResult(result));
    expect(courseStageRecordPlayFromResult(result).missCount).toBe(56);
  });

  it('counts mine POORs as BP without counting them as judged notes', () => {
    const score = { total: 10, perfect: 8, great: 0, good: 0, bad: 0, poor: 2, minePoor: 2, emptyPoor: 0, exScore: 16 };
    expect(courseStageRecordPlayFromResult({ score, maxCombo: 8, cleared: false }).missCount).toBe(4);
    expect(courseStageRecordPlayFromSummary(score, 8).missCount).toBe(4);
  });

  it('count the notes a failed stage never judged in its BP', () => {
    const score = { total: 100, perfect: 30, great: 10, good: 5, bad: 2, poor: 3, emptyPoor: 1, exScore: 70 };
    // BAD + POOR + empty POOR (6), plus the 50 notes never judged.
    expect(courseStageRecordPlayFromResult({ score, maxCombo: 20, cleared: false, lamp: 'FAILED' })).toEqual({
      lamp: 'FAILED',
      exScore: 70,
      maxCombo: 20,
      missCount: 56,
    });
    const summary: RecordPlaySummary = {
      ...score,
      gauge: { type: 'GRADE', cleared: false } as RecordPlaySummary['gauge'],
    };
    expect(courseStageRecordPlayFromSummary(summary, 20)).toMatchObject({ lamp: 'FAILED', missCount: 56 });
  });

  it('count each empty POOR once where the POOR folds them in (an LR2 result)', () => {
    const score = { total: 10, perfect: 6, great: 1, good: 0, bad: 1, poor: 4, emptyPoor: 2, exScore: 13 };
    // 2 POORs + 2 empty POORs on the POOR readout: BAD + POOR + empty POOR is 5, and every note was judged.
    expect(courseStageRecordPlayFromResult({ score, judgedPoor: 2, maxCombo: 5, cleared: true }).missCount).toBe(5);
    // A stage failed with 1 note left: it counts too, and the empty POORs are not taken for judged notes.
    const failed = { ...score, perfect: 5 };
    expect(
      courseStageRecordPlayFromResult({ score: failed, judgedPoor: 2, maxCombo: 2, cleared: false }).missCount,
    ).toBe(6);
  });
});

describe('courseRunRecordPlay', () => {
  it('takes the lamp, EX score, course max combo and BP of the course result', () => {
    const result = { lamp: 'HARD' as const, exScore: 900, maxCombo: 300, missCount: 40, noteCount: 1000 };
    expect(courseRunRecordPlay(result)).toEqual({ lamp: 'HARD', exScore: 900, maxCombo: 300, missCount: 40 });
  });
});

describe('playKeepsRecord / courseStageKeepsRecord', () => {
  const played = { autoPlay: false, replay: false, course: false, tempo: 1 };

  it('keeps a record for a chart played by hand at its own tempo', () => {
    expect(playKeepsRecord(played)).toBe(true);
  });

  it('leaves the records alone for auto play, a replay, a course stage and another tempo', () => {
    expect(playKeepsRecord({ ...played, autoPlay: true })).toBe(false);
    expect(playKeepsRecord({ ...played, replay: true })).toBe(false);
    expect(playKeepsRecord({ ...played, course: true })).toBe(false);
    expect(playKeepsRecord({ ...played, tempo: 1.1 })).toBe(false);
  });

  it('lets an EXPERT / GRADE stage update its chart, not when auto-played, replayed or at another tempo', () => {
    const stage = { autoPlay: false, replay: false, tempo: 1 };
    expect(courseStageKeepsRecord(stage)).toBe(true);
    expect(courseStageKeepsRecord({ ...stage, autoPlay: true })).toBe(false);
    expect(courseStageKeepsRecord({ ...stage, replay: true })).toBe(false);
    expect(courseStageKeepsRecord({ ...stage, tempo: 0.9 })).toBe(false);
  });
});

describe('isCourseRunAtAnotherTempo', () => {
  const played = (tempo?: number) =>
    ({ played: true, replay: { play: tempo === undefined ? {} : { tempo } } }) as unknown as Parameters<
      typeof isCourseRunAtAnotherTempo
    >[0]['stages'][number];
  const unreached = { played: false, facts: {} } as unknown as ReturnType<typeof played>;

  it('flags a run with any stage played at another tempo', () => {
    expect(isCourseRunAtAnotherTempo({ stages: [played(), played(0.8), unreached] })).toBe(true);
  });

  it('flags a run with a stage whose tempo changed during the play', () => {
    const changed = {
      played: true,
      replay: { play: { tempoChanges: [{ timeUs: 1_000_000, tempo: 1.1 }] } },
    } as unknown as ReturnType<typeof played>;
    expect(isCourseRunAtAnotherTempo({ stages: [played(), changed] })).toBe(true);
  });

  it('keeps a run played at the charts’ own tempo', () => {
    expect(isCourseRunAtAnotherTempo({ stages: [played(), played(1), unreached] })).toBe(false);
  });
});

describe('isCourseRunAutoPlayed / courseRunKeepsRecord', () => {
  type Log = Parameters<typeof courseRunKeepsRecord>[0];
  const played = (play: { mode?: 'manual' | 'auto'; tempo?: number } = {}) =>
    ({ played: true, replay: { play: { mode: 'manual', ...play } } }) as unknown as Log['stages'][number];
  const unreached = { played: false, facts: {} } as unknown as Log['stages'][number];

  it('flags a run with any stage played by itself', () => {
    expect(isCourseRunAutoPlayed({ stages: [played(), played({ mode: 'auto' }), unreached] })).toBe(true);
    expect(isCourseRunAutoPlayed({ stages: [played(), played(), unreached] })).toBe(false);
  });

  it('flags a NONSTOP run whose stitched play played itself', () => {
    const nonstop = { replay: { play: { mode: 'auto' } } } as unknown as NonNullable<Log['nonstop']>;
    expect(isCourseRunAutoPlayed({ stages: [unreached], nonstop })).toBe(true);
  });

  it('keeps a record only for a run played by hand at the charts’ own tempo', () => {
    expect(courseRunKeepsRecord({ stages: [played(), played()] })).toBe(true);
    expect(courseRunKeepsRecord({ stages: [played({ mode: 'auto' }), played()] })).toBe(false);
    expect(courseRunKeepsRecord({ stages: [played({ tempo: 1.2 }), played()] })).toBe(false);
  });
});

it('keeps an LR2 full combo below the gauge border, using the same lamp rule as replay results', () => {
  const summary: RecordPlaySummary = {
    total: 10,
    perfect: 8,
    great: 1,
    good: 1,
    bad: 0,
    poor: 0,
    emptyPoor: 30,
    exScore: 17,
    gauge: {
      type: 'GROOVE',
      current: 40,
      max: 100,
      initial: 20,
      clearThreshold: 80,
      effectiveTotal: 160,
      cleared: false,
    },
  };
  expect(recordPlayFromSummary(summary, 10, 'lr2').lamp).toBe('FULL_COMBO');
  expect(recordPlayFromSummary(summary, 10, 'beatoraja').lamp).toBe('FAILED');
});
