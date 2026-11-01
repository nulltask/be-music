import { describe, expect, test } from 'vite-plus/test';
import type { DanRank } from '@be-music/player-engine/records';
import {
  danRankKey,
  listDanRanks,
  mergeDanRank,
  parseDanRanks,
  resolveDanRankUpdate,
  serializeDanRanks,
} from './dan-ranks.ts';

describe('danRankKey', () => {
  test('keys a rank by judge ruleset, then key mode', () => {
    expect(danRankKey('lr2', 7)).toBe('lr2:7');
    expect(danRankKey('beatoraja', 14)).toBe('beatoraja:14');
  });
});

describe('resolveDanRankUpdate', () => {
  const run = { definition: { kind: 'grade' as const, name: '七段' }, stageKeyModes: [7, 7], lamp: 'NORMAL' as const };

  test('certifies a cleared GRADE course named after a dan in its key mode', () => {
    expect(resolveDanRankUpdate(run, 'lr2')).toEqual({ key: 'lr2:7', rank: 'dan-7' });
    expect(resolveDanRankUpdate({ ...run, definition: { ...run.definition, keyMode: 5 } }, 'lr2')?.key).toBe('lr2:5');
  });

  test('certifies nothing without a ruleset, a dan name, a clear or a key mode', () => {
    expect(resolveDanRankUpdate(run, undefined)).toBeUndefined();
    expect(resolveDanRankUpdate({ ...run, definition: { kind: 'grade', name: 'Mix' } }, 'lr2')).toBeUndefined();
    expect(resolveDanRankUpdate({ ...run, lamp: 'FAILED' }, 'lr2')).toBeUndefined();
    expect(resolveDanRankUpdate({ ...run, stageKeyModes: [7, 14] }, 'lr2')).toBeUndefined();
  });
});

describe('mergeDanRank / listDanRanks', () => {
  test('keeps the higher rank and lists one ruleset’s ranks by key mode', () => {
    const ranks = new Map<string, DanRank>();
    expect(mergeDanRank(ranks, { key: 'lr2:14', rank: 'dan-2' })).toEqual({ previous: undefined });
    expect(mergeDanRank(ranks, { key: 'lr2:7', rank: 'dan-9' })).toEqual({ previous: undefined });
    expect(mergeDanRank(ranks, { key: 'lr2:7', rank: 'dan-4' })).toEqual({ previous: 'dan-9' });
    mergeDanRank(ranks, { key: 'beatoraja:7', rank: 'overjoy' });
    expect(listDanRanks(ranks, 'lr2')).toEqual([
      { keyMode: 7, rank: 'dan-9', label: '九段' },
      { keyMode: 14, rank: 'dan-2', label: '二段' },
    ]);
    expect(listDanRanks(ranks, '____')).toEqual([]);
  });
});

describe('parseDanRanks / serializeDanRanks', () => {
  test('round-trips the ranks', () => {
    const ranks = new Map<string, DanRank>([
      ['lr2:7', 'dan-7'],
      ['beatoraja:14', 'insane-kaiden'],
    ]);
    expect(parseDanRanks(serializeDanRanks(ranks))).toEqual(ranks);
  });

  test('reads no store, a store of another version or junk as no ranks', () => {
    expect(parseDanRanks(null)).toEqual(new Map());
    expect(parseDanRanks('not json')).toEqual(new Map());
    expect(parseDanRanks(JSON.stringify({ version: 1, ranks: { 'lr2:7': 'dan-7' } }))).toEqual(new Map());
  });

  test('drops entries with an unknown rank, ruleset or key mode', () => {
    const raw = JSON.stringify({
      version: 0,
      ranks: { 'lr2:7': 'dan-7', 'lr2:x': 'dan-1', 'other:7': 'dan-1', 'lr2:5': 'dan-11', 'lr2:0': 'dan-1' },
    });
    expect(parseDanRanks(raw)).toEqual(new Map([['lr2:7', 'dan-7']]));
  });
});
