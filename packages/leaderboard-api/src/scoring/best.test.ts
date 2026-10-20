import { describe, expect, test } from 'vite-plus/test';
import { mergeBestScores, type BestScores } from './best.ts';
import { clearLampRank } from '@be-music/player/ruleset';

const current: BestScores = {
  bestEx: 1000,
  bestExScoreId: 'a',
  bestExAt: 100,
  bestLamp: clearLampRank('NORMAL'),
  bestLampScoreId: 'a',
  minMiss: 20,
  minMissScoreId: 'a',
  playCount: 3,
};

describe('mergeBestScores', () => {
  test('the first play sets every best', () => {
    const { next, improved } = mergeBestScores(undefined, {
      scoreId: 'x',
      playedAt: 5,
      exScore: 10,
      lamp: clearLampRank('FAILED'),
      missCount: 50,
    });
    expect(next).toEqual({
      bestEx: 10,
      bestExScoreId: 'x',
      bestExAt: 5,
      bestLamp: clearLampRank('FAILED'),
      bestLampScoreId: 'x',
      minMiss: 50,
      minMissScoreId: 'x',
      playCount: 1,
    });
    expect(improved).toEqual({ exScore: true, lamp: true, missCount: true });
  });

  test('keeps each best separately, each pointing at the play that set it', () => {
    const { next, improved } = mergeBestScores(current, {
      scoreId: 'b',
      playedAt: 200,
      exScore: 1100,
      lamp: clearLampRank('EASY'),
      missCount: 15,
    });
    expect(next).toEqual({
      bestEx: 1100,
      bestExScoreId: 'b',
      bestExAt: 200,
      bestLamp: clearLampRank('NORMAL'),
      bestLampScoreId: 'a',
      minMiss: 15,
      minMissScoreId: 'b',
      playCount: 4,
    });
    expect(improved).toEqual({ exScore: true, lamp: false, missCount: true });
  });

  test('a tie keeps the earlier play', () => {
    const { next, improved } = mergeBestScores(current, {
      scoreId: 'c',
      playedAt: 300,
      exScore: 1000,
      lamp: clearLampRank('NORMAL'),
      missCount: 20,
    });
    expect(next).toMatchObject({ bestExScoreId: 'a', bestExAt: 100, bestLampScoreId: 'a', minMissScoreId: 'a' });
    expect(next.playCount).toBe(4);
    expect(improved).toEqual({ exScore: false, lamp: false, missCount: false });
  });
});
