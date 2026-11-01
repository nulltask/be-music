import { describe, expect, it } from 'vite-plus/test';
import { danRankRecordKey, parseDanRankRecords, serializeDanRankRecords } from './dan-rank-records.ts';

describe('danRankRecordKey', () => {
  it('keys a rank by the judge ruleset, then the key mode', () => {
    expect(danRankRecordKey('lr2', 7)).toBe('lr2:7');
    expect(danRankRecordKey('beatoraja', 14)).toBe('beatoraja:14');
  });
});

describe('parseDanRankRecords / serializeDanRankRecords', () => {
  it('round-trips ranks of every ruleset and key mode', () => {
    const ranks = new Map([
      ['lr2:7', { rank: 'KAIDEN' as const, course: '皆伝' }],
      ['beatoraja:14', { rank: 'INSANE_2' as const, course: '発狂二段' }],
      ['____:5', { rank: 'DAN_1' as const, course: '初段' }],
    ]);
    expect(JSON.parse(serializeDanRankRecords(ranks)).version).toBe(0);
    expect(parseDanRankRecords(serializeDanRankRecords(ranks))).toEqual(ranks);
  });

  it('reads missing, unreadable or other-version data as no rank', () => {
    expect(parseDanRankRecords(null).size).toBe(0);
    expect(parseDanRankRecords(undefined).size).toBe(0);
    expect(parseDanRankRecords('{not json').size).toBe(0);
    expect(parseDanRankRecords('[]').size).toBe(0);
    expect(parseDanRankRecords(JSON.stringify({ version: 1, ranks: { 'lr2:7': { rank: 'KAIDEN' } } })).size).toBe(0);
  });

  it('drops entries with an unknown ruleset, a malformed key mode or an unknown rank', () => {
    const raw = JSON.stringify({
      version: 0,
      ranks: {
        'lr2:7': { rank: 'DAN_3', course: '三段' },
        'iidx:7': { rank: 'DAN_3' },
        'lr2:seven': { rank: 'DAN_3' },
        'lr2:0': { rank: 'DAN_3' },
        'lr2:7:x': { rank: 'DAN_3' },
        'lr2:5': { rank: 'DAN_11' },
        'lr2:14': null,
        'lr2:10': { rank: 'DAN_2', course: 42 },
      },
    });
    expect(parseDanRankRecords(raw)).toEqual(
      new Map([
        ['lr2:7', { rank: 'DAN_3', course: '三段' }],
        ['lr2:10', { rank: 'DAN_2', course: '' }],
      ]),
    );
  });
});
