import { parseRankingScoreTarget } from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { RANKING_PAGE_SIZE, resolveRankingTargetEXScore, type FetchRankingPage } from './ranking-target.ts';

/** A ranking of `players` entries scoring `top`, `top - 1`, … and the offsets asked of it. */
function ranking(players: number, top = 5000) {
  const offsets: number[] = [];
  const fetchPage: FetchRankingPage = async (offset, limit) => {
    offsets.push(offset);
    const exScores = Array.from(
      { length: Math.max(0, Math.min(limit, players - offset)) },
      (_, at) => top - offset - at,
    );
    return { exScores, players };
  };
  return { offsets, fetchPage };
}

const target = (id: Parameters<typeof parseRankingScoreTarget>[0]) => parseRankingScoreTarget(id)!;

describe('resolveRankingTargetEXScore', () => {
  test('RANK reads the place, or the last place of a shorter ranking', async () => {
    expect(await resolveRankingTargetEXScore(target('IR_RANK_1'), 0, ranking(30).fetchPage)).toBe(5000);
    expect(await resolveRankingTargetEXScore(target('IR_RANK_10'), 0, ranking(30).fetchPage)).toBe(4991);
    expect(await resolveRankingTargetEXScore(target('IR_RANK_50'), 0, ranking(30).fetchPage)).toBe(4971);
  });

  test('RANKRATE reads the place that share of the players down, from another page when it is there', async () => {
    expect(await resolveRankingTargetEXScore(target('IR_RANKRATE_10'), 0, ranking(30).fetchPage)).toBe(4997);
    const far = ranking(1000);
    expect(await resolveRankingTargetEXScore(target('IR_RANKRATE_50'), 0, far.fetchPage)).toBe(4500);
    expect(far.offsets).toEqual([0, 500]);
  });

  test('NEXT counts up from the first place at or below the best, and is the top without one', async () => {
    // A best of 4990 sits at place 11 (index 10); one place above is 4991.
    expect(await resolveRankingTargetEXScore(target('IR_NEXT_1'), 4990, ranking(30).fetchPage)).toBe(4991);
    expect(await resolveRankingTargetEXScore(target('IR_NEXT_5'), 4990, ranking(30).fetchPage)).toBe(4995);
    expect(await resolveRankingTargetEXScore(target('IR_NEXT_10'), 4998, ranking(30).fetchPage)).toBe(5000);
    // Every place is above a best of 0: the top, as beatoraja picks it.
    expect(await resolveRankingTargetEXScore(target('IR_NEXT_1'), 0, ranking(30).fetchPage)).toBe(5000);
  });

  test('NEXT finds a place deep in a long ranking by bisecting its pages', async () => {
    const deep = ranking(100_000, 200_000);
    // A best of 123456 sits at index 76544; three places above is 123459.
    expect(await resolveRankingTargetEXScore(target('IR_NEXT_3'), 123_456, deep.fetchPage)).toBe(123_459);
    expect(deep.offsets.length).toBeLessThanOrEqual(12);
    expect(new Set(deep.offsets.map((offset) => offset % RANKING_PAGE_SIZE))).toEqual(new Set([0]));
  });

  test('has no score for an empty ranking or one that cannot be read', async () => {
    expect(await resolveRankingTargetEXScore(target('IR_RANK_1'), 0, ranking(0).fetchPage)).toBeUndefined();
    expect(await resolveRankingTargetEXScore(target('IR_RANK_1'), 0, async () => undefined)).toBeUndefined();
    const broken: FetchRankingPage = async (offset) =>
      offset === 0 ? { exScores: Array.from({ length: 100 }, (_, at) => 900 - at), players: 500 } : undefined;
    expect(await resolveRankingTargetEXScore(target('IR_NEXT_1'), 10, broken)).toBeUndefined();
  });
});
