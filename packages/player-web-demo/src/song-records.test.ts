import { describe, expect, it } from 'vite-plus/test';
import {
  courseStageRecordKey,
  parseSongRecords,
  playRecordKey,
  serializeSongRecords,
  songRecordKey,
  toLr2RecordLamp,
} from './song-records.ts';

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
    expect(parseSongRecords(JSON.stringify({ version: 3, records: { a: { lamp: 'MAX' } } })).size).toBe(0);
  });

  it('reads version-1 records with the lamps LR2 awards', () => {
    const raw = JSON.stringify({
      version: 1,
      records: {
        max: { lamp: 'MAX' },
        perfect: { lamp: 'PERFECT' },
        death: { lamp: 'EX_HARD', exScore: 10 },
        hard: { lamp: 'HARD' },
      },
    });
    expect(Object.fromEntries(parseSongRecords(raw))).toEqual({
      max: { lamp: 'FULL_COMBO' },
      perfect: { lamp: 'FULL_COMBO' },
      death: { lamp: 'NORMAL', exScore: 10 },
      hard: { lamp: 'HARD' },
    });
    // Records written now keep their lamps as they are.
    const current = new Map([['a', { lamp: 'EX_HARD' as const }]]);
    expect(parseSongRecords(serializeSongRecords(current))).toEqual(current);
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

describe('toLr2RecordLamp', () => {
  it('keeps LR2’s own lamps and maps the ones LR2 does not award', () => {
    expect(
      ['FAILED', 'EASY', 'NORMAL', 'HARD', 'FULL_COMBO', 'ASSIST_EASY'].map((lamp) => toLr2RecordLamp(lamp as never)),
    ).toEqual(['FAILED', 'EASY', 'NORMAL', 'HARD', 'FULL_COMBO', 'ASSIST_EASY']);
    expect(toLr2RecordLamp('MAX')).toBe('FULL_COMBO');
    expect(toLr2RecordLamp('EX_HARD')).toBe('NORMAL');
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
});
