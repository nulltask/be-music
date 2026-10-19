import { describe, expect, it } from 'vite-plus/test';
import {
  courseStageRecordKey,
  parseSongRecords,
  playRecordKey,
  rulesetRecordKey,
  rulesetRecords,
  serializeSongRecords,
  songRecordKey,
  toLR2RecordLamp,
} from './song-records.ts';

describe('songRecordKey', () => {
  it('prefers the chart SHA-256 and falls back to the chart path', () => {
    expect(songRecordKey({ chartPath: 'a/b.bms' }, 'abc123')).toBe('sha256:abc123');
    expect(songRecordKey({ chartPath: 'a/b.bms' }, undefined)).toBe('path:a/b.bms');
    expect(songRecordKey({ chartPath: 'a/b.bms' }, '')).toBe('path:a/b.bms');
  });
});

describe('rulesetRecordKey / rulesetRecords', () => {
  it('keys a chart’s or course’s record by the judge ruleset first', () => {
    expect(rulesetRecordKey('lr2', 'sha256:abc')).toBe('lr2:sha256:abc');
    expect(rulesetRecordKey('beatoraja', 'course:grade::a,b')).toBe('beatoraja:course:grade::a,b');
  });

  it('reads one ruleset’s records by the chart’s or course’s own key', () => {
    const records = new Map([
      ['lr2:sha256:abc', { lamp: 'FULL_COMBO' as const }],
      ['beatoraja:sha256:abc', { lamp: 'MAX' as const }],
    ]);
    expect(rulesetRecords(records, 'lr2').get('sha256:abc')?.lamp).toBe('FULL_COMBO');
    expect(rulesetRecords(records, 'beatoraja').get('sha256:abc')?.lamp).toBe('MAX');
    expect(rulesetRecords(records, 'iidx').get('sha256:abc')).toBeUndefined();
  });
});

describe('parseSongRecords / serializeSongRecords', () => {
  it('round-trips records of every ruleset', () => {
    const records = new Map([
      ['lr2:sha256:abc', { lamp: 'FULL_COMBO' as const, exScore: 900, maxCombo: 450, missCount: 0, playCount: 2 }],
      ['beatoraja:sha256:abc', { lamp: 'MAX' as const, exScore: 910, playCount: 1 }],
      ['iidx:path:x.bms', { lamp: 'FAILED' as const, playCount: 1 }],
    ]);
    expect(JSON.parse(serializeSongRecords(records)).version).toBe(3);
    expect(parseSongRecords(serializeSongRecords(records))).toEqual(records);
  });

  it('yields no records for missing, unreadable, or foreign-version data', () => {
    expect(parseSongRecords(null).size).toBe(0);
    expect(parseSongRecords('{not json').size).toBe(0);
    expect(parseSongRecords('[]').size).toBe(0);
    expect(parseSongRecords(JSON.stringify({ version: 4, records: { 'lr2:a': { lamp: 'MAX' } } })).size).toBe(0);
  });

  it('drops version-3 records whose key names no judge ruleset', () => {
    const raw = JSON.stringify({ version: 3, records: { 'sha256:abc': { lamp: 'HARD' }, 'lr2:a': { lamp: 'EASY' } } });
    expect([...parseSongRecords(raw)]).toEqual([['lr2:a', { lamp: 'EASY' }]]);
  });

  it('reads version-2 records as LR2 records', () => {
    const raw = JSON.stringify({
      version: 2,
      records: {
        'sha256:abc': { lamp: 'EX_HARD', exScore: 10, playCount: 3 },
        'course:grade::a,b': { lamp: 'MAX' },
      },
    });
    expect(Object.fromEntries(parseSongRecords(raw))).toEqual({
      'lr2:sha256:abc': { lamp: 'EX_HARD', exScore: 10, playCount: 3 },
      'lr2:course:grade::a,b': { lamp: 'MAX' },
    });
  });

  it('reads version-1 records as LR2 records, with the lamps LR2 awards', () => {
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
      'lr2:max': { lamp: 'FULL_COMBO' },
      'lr2:perfect': { lamp: 'FULL_COMBO' },
      'lr2:death': { lamp: 'NORMAL', exScore: 10 },
      'lr2:hard': { lamp: 'HARD' },
    });
    // Records written now keep their lamps as they are.
    const current = new Map([['beatoraja:a', { lamp: 'EX_HARD' as const }]]);
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
    expect([...parseSongRecords(raw)]).toEqual([['lr2:ok', { lamp: 'HARD', playCount: 4 }]]);
  });
});

describe('toLR2RecordLamp', () => {
  it('keeps LR2’s own lamps and maps the ones LR2 does not award', () => {
    expect(
      ['FAILED', 'EASY', 'NORMAL', 'HARD', 'FULL_COMBO', 'ASSIST_EASY'].map((lamp) => toLR2RecordLamp(lamp as never)),
    ).toEqual(['FAILED', 'EASY', 'NORMAL', 'HARD', 'FULL_COMBO', 'ASSIST_EASY']);
    expect(toLR2RecordLamp('MAX')).toBe('FULL_COMBO');
    expect(toLR2RecordLamp('EX_HARD')).toBe('NORMAL');
  });
});

describe('playRecordKey', () => {
  const song = { chartPath: 'Songs/a/main.bms' };
  const played = { autoPlay: false, replay: false, course: false, tempo: 1, judgeRuleset: 'lr2' as const };

  it('records a played chart under its hash and the judge ruleset it ran under', () => {
    expect(playRecordKey(song, 'abc', played)).toBe('lr2:sha256:abc');
    expect(playRecordKey(song, undefined, played)).toBe('lr2:path:Songs/a/main.bms');
    expect(playRecordKey(song, 'abc', { ...played, judgeRuleset: 'iidx' })).toBe('iidx:sha256:abc');
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
    const played = { autoPlay: false, replay: false, tempo: 1, judgeRuleset: 'beatoraja' as const };
    expect(courseStageRecordKey(song, 'abc', played)).toBe('beatoraja:sha256:abc');
    expect(courseStageRecordKey(song, 'abc', { ...played, autoPlay: true })).toBeUndefined();
    expect(courseStageRecordKey(song, 'abc', { ...played, replay: true })).toBeUndefined();
    expect(courseStageRecordKey(song, 'abc', { ...played, tempo: 0.9 })).toBeUndefined();
  });
});
