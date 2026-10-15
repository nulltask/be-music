import { describe, expect, it } from 'vite-plus/test';
import type { PixiGameplayResultData } from '@be-music/player-web/scenes';
import {
  CLEAR_LAMP_ORDER,
  clearLampRank,
  courseRunKeepsRecord,
  courseStagePlayFromResult,
  courseStagePlayFromSummary,
  courseStageRecordKey,
  mergeCourseStageRecord,
  isCourseRunAtAnotherTempo,
  isCourseRunAutoPlayed,
  mergeSongRecord,
  parseSongRecords,
  playRecordKey,
  serializeSongRecords,
  songRecordKey,
  songRecordPlayFromResult,
  songRecordPlayFromSummary,
} from './song-records.ts';

describe('clearLampRank', () => {
  it('ranks lamps from NO_PLAY up to MAX', () => {
    expect(clearLampRank('NO_PLAY')).toBe(0);
    expect(clearLampRank('FAILED')).toBeLessThan(clearLampRank('ASSIST_EASY'));
    expect(clearLampRank('EX_HARD')).toBeLessThan(clearLampRank('FULL_COMBO'));
    expect(clearLampRank('MAX')).toBe(CLEAR_LAMP_ORDER.length - 1);
  });
});

describe('mergeSongRecord', () => {
  const play = { lamp: 'HARD' as const, exScore: 1500, maxCombo: 400, missCount: 12 };

  it('starts a record from the first play', () => {
    expect(mergeSongRecord(undefined, play)).toEqual({ ...play, playCount: 1 });
  });

  it('keeps each best independently and counts the play', () => {
    const previous = { lamp: 'EX_HARD' as const, exScore: 1400, maxCombo: 500, missCount: 20, playCount: 3 };
    expect(mergeSongRecord(previous, play)).toEqual({
      lamp: 'EX_HARD',
      exScore: 1500,
      maxCombo: 500,
      missCount: 12,
      playCount: 4,
    });
  });

  it('upgrades the lamp when the play is better', () => {
    expect(mergeSongRecord({ lamp: 'FAILED', playCount: 1 }, play).lamp).toBe('HARD');
    expect(mergeSongRecord({ lamp: 'HARD', playCount: 1 }, { ...play, lamp: 'FAILED' }).lamp).toBe('HARD');
  });

  it('fills fields a stored record lacks', () => {
    expect(mergeSongRecord({ lamp: 'NORMAL' }, play)).toEqual({
      lamp: 'HARD',
      exScore: 1500,
      maxCombo: 400,
      missCount: 12,
      playCount: 1,
    });
  });
});

describe('songRecordPlayFromResult', () => {
  const score = { total: 10, perfect: 5, great: 2, good: 1, bad: 1, poor: 1, emptyPoor: 4, exScore: 12, score: 0 };

  it('reads the lamp, EX score, max combo, and BAD + POOR + empty POOR', () => {
    const data = { score, maxCombo: 6, cleared: true, lamp: 'EASY' } as PixiGameplayResultData;
    // Empty POORs count in BP, as LR2, beatoraja and the Leaderboard count them.
    expect(songRecordPlayFromResult(data)).toEqual({ lamp: 'EASY', exScore: 12, maxCombo: 6, missCount: 6 });
  });

  it('falls back to the gauge verdict without a lamp', () => {
    expect(songRecordPlayFromResult({ score, maxCombo: 0, cleared: false } as PixiGameplayResultData).lamp).toBe(
      'FAILED',
    );
    expect(songRecordPlayFromResult({ score, maxCombo: 0, cleared: true } as PixiGameplayResultData).lamp).toBe(
      'NORMAL',
    );
  });
});

describe('songRecordKey', () => {
  it('prefers the chart SHA-256 and falls back to the chart path', () => {
    expect(songRecordKey({ chartPath: 'a/b.bms' }, 'abc123')).toBe('sha256:abc123');
    expect(songRecordKey({ chartPath: 'a/b.bms' }, undefined)).toBe('path:a/b.bms');
    expect(songRecordKey({ chartPath: 'a/b.bms' }, '')).toBe('path:a/b.bms');
  });
});

describe('parseSongRecords / serializeSongRecords', () => {
  it('round-trips records', () => {
    const records = new Map([
      ['sha256:abc', { lamp: 'FULL_COMBO' as const, exScore: 900, maxCombo: 450, missCount: 0, playCount: 2 }],
      ['path:x.bms', { lamp: 'FAILED' as const, playCount: 1 }],
    ]);
    expect(parseSongRecords(serializeSongRecords(records))).toEqual(records);
  });

  it('yields no records for missing, unreadable, or foreign-version data', () => {
    expect(parseSongRecords(null).size).toBe(0);
    expect(parseSongRecords('{not json').size).toBe(0);
    expect(parseSongRecords('[]').size).toBe(0);
    expect(parseSongRecords(JSON.stringify({ version: 2, records: { a: { lamp: 'MAX' } } })).size).toBe(0);
  });

  it('drops entries with an unknown lamp and leaves out malformed counts', () => {
    const raw = JSON.stringify({
      version: 1,
      records: {
        bad: { lamp: 'SUPER_CLEAR', exScore: 10 },
        ok: { lamp: 'HARD', exScore: -1, maxCombo: 1.5, missCount: '3', playCount: 4 },
      },
    });
    expect([...parseSongRecords(raw)]).toEqual([['ok', { lamp: 'HARD', playCount: 4 }]]);
  });
});

describe('isCourseRunAtAnotherTempo', () => {
  const played = (tempo?: number) =>
    ({ played: true, playlog: { play: tempo === undefined ? {} : { tempo } } }) as unknown as Parameters<
      typeof isCourseRunAtAnotherTempo
    >[0]['stages'][number];
  const unreached = { played: false, facts: {} } as unknown as ReturnType<typeof played>;

  it('flags a run with any stage played at another tempo', () => {
    expect(isCourseRunAtAnotherTempo({ stages: [played(), played(0.8), unreached] })).toBe(true);
  });

  it('keeps a run played at the charts’ own tempo', () => {
    expect(isCourseRunAtAnotherTempo({ stages: [played(), played(1), unreached] })).toBe(false);
  });
});

describe('isCourseRunAutoPlayed / courseRunKeepsRecord', () => {
  type Log = Parameters<typeof courseRunKeepsRecord>[0];
  const played = (play: { mode?: 'manual' | 'auto'; tempo?: number } = {}) =>
    ({ played: true, playlog: { play: { mode: 'manual', ...play } } }) as unknown as Log['stages'][number];
  const unreached = { played: false, facts: {} } as unknown as Log['stages'][number];

  it('flags a run with any stage played by itself', () => {
    expect(isCourseRunAutoPlayed({ stages: [played(), played({ mode: 'auto' }), unreached] })).toBe(true);
    expect(isCourseRunAutoPlayed({ stages: [played(), played(), unreached] })).toBe(false);
  });

  it('flags a NONSTOP run whose stitched play played itself', () => {
    const nonstop = { playlog: { play: { mode: 'auto' } } } as unknown as NonNullable<Log['nonstop']>;
    expect(isCourseRunAutoPlayed({ stages: [unreached], nonstop })).toBe(true);
  });

  it('keeps a record only for a run played by hand at the charts’ own tempo', () => {
    expect(courseRunKeepsRecord({ stages: [played(), played()] })).toBe(true);
    expect(courseRunKeepsRecord({ stages: [played({ mode: 'auto' }), played()] })).toBe(false);
    expect(courseRunKeepsRecord({ stages: [played({ tempo: 1.2 }), played()] })).toBe(false);
  });
});

describe('songRecordPlayFromSummary', () => {
  const summary = {
    total: 10,
    perfect: 10,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: 20,
    gauge: { type: 'HARD', cleared: true },
  } as Parameters<typeof songRecordPlayFromSummary>[0];

  it('takes the lamp from the same rule as a result: an all-PERFECT clear is MAX', () => {
    expect(songRecordPlayFromSummary(summary, 10)).toEqual({ lamp: 'MAX', exScore: 20, maxCombo: 10, missCount: 0 });
  });

  it('records a failed gauge as FAILED and counts BAD + POOR + empty POOR as misses', () => {
    const failed = { ...summary, perfect: 6, bad: 1, poor: 3, emptyPoor: 2, gauge: { type: 'HARD', cleared: false } };
    expect(songRecordPlayFromSummary(failed as typeof summary, 4)).toMatchObject({ lamp: 'FAILED', missCount: 6 });
  });
});

describe('playRecordKey', () => {
  const song = { chartPath: 'Songs/a/main.bms' };
  const played = { autoPlay: false, replay: false, course: false, tempo: 1 };

  it('records a played chart under its hash', () => {
    expect(playRecordKey(song, 'abc', played)).toBe('sha256:abc');
    expect(playRecordKey(song, undefined, played)).toBe('path:Songs/a/main.bms');
  });

  it('leaves the records alone for auto play, a replay, a course stage and another tempo', () => {
    expect(playRecordKey(song, 'abc', { ...played, autoPlay: true })).toBeUndefined();
    expect(playRecordKey(song, 'abc', { ...played, replay: true })).toBeUndefined();
    expect(playRecordKey(song, 'abc', { ...played, course: true })).toBeUndefined();
    expect(playRecordKey(song, 'abc', { ...played, tempo: 1.1 })).toBeUndefined();
  });
});

describe('course stage records', () => {
  const song = { chartPath: 'Songs/a/main.bms' };

  it('keys an EXPERT / GRADE stage under its chart, not when auto-played, replayed or at another tempo', () => {
    const played = { autoPlay: false, replay: false, tempo: 1 };
    expect(courseStageRecordKey(song, 'abc', played)).toBe('sha256:abc');
    expect(courseStageRecordKey(song, 'abc', { ...played, autoPlay: true })).toBeUndefined();
    expect(courseStageRecordKey(song, 'abc', { ...played, replay: true })).toBeUndefined();
    expect(courseStageRecordKey(song, 'abc', { ...played, tempo: 0.9 })).toBeUndefined();
  });

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

  it('counts the notes a failed stage never judged in its BP', () => {
    const data = {
      score: { total: 100, perfect: 30, great: 10, good: 5, bad: 2, poor: 3, emptyPoor: 1, exScore: 70, score: 70 },
      maxCombo: 20,
      cleared: false,
      lamp: 'FAILED',
    } as unknown as PixiGameplayResultData;
    // BAD + POOR + empty POOR (6), plus the 50 notes never judged.
    expect(courseStagePlayFromResult(data)).toEqual({ lamp: 'FAILED', exScore: 70, maxCombo: 20, missCount: 56 });
    const summary = {
      total: 100,
      perfect: 30,
      great: 10,
      good: 5,
      bad: 2,
      poor: 3,
      emptyPoor: 1,
      exScore: 70,
      gauge: { type: 'GRADE', cleared: false },
    } as Parameters<typeof courseStagePlayFromSummary>[0];
    expect(courseStagePlayFromSummary(summary, 20)).toMatchObject({ lamp: 'FAILED', missCount: 56 });
  });
});
