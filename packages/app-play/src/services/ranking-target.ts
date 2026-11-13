// The score target's ranking places (`IR_*`): the EX score at a place on a chart's Leaderboard ranking, read a page at
// a time. beatoraja reads its IR ranking whole; the Leaderboard pages it, so the place is found with as few pages as
// it takes.
import { resolveRankingTargetIndex, type RankingScoreTarget } from '@be-music/player-scene-model';

/** A stretch of a ranking: its entries' EX scores from `offset`, best first, and how many players the ranking has. */
export interface RankingPage {
  readonly exScores: readonly number[];
  readonly players: number;
}

/** Reads the ranking's entries from `offset`, at most `limit` of them; `undefined` when it cannot be read. */
export type FetchRankingPage = (offset: number, limit: number) => Promise<RankingPage | undefined>;

/** How many entries one request asks for: the Leaderboard's page limit. */
export const RANKING_PAGE_SIZE = 100;

/**
 * The EX score at `target`'s place on a ranking, or `undefined` for an empty ranking or one that cannot be read.
 * `bestEXScore` is the player's best on the chart, which NEXT counts its places up from.
 */
export async function resolveRankingTargetEXScore(
  target: RankingScoreTarget,
  bestEXScore: number,
  fetchPage: FetchRankingPage,
): Promise<number | undefined> {
  const first = await fetchPage(0, RANKING_PAGE_SIZE);
  if (first === undefined || first.players <= 0 || first.exScores.length === 0) return undefined;
  const pages = new Map<number, RankingPage>([[0, first]]);
  const page = async (index: number): Promise<RankingPage | undefined> => {
    const kept = pages.get(index);
    if (kept !== undefined) return kept;
    const fetched = await fetchPage(index * RANKING_PAGE_SIZE, RANKING_PAGE_SIZE);
    if (fetched !== undefined) pages.set(index, fetched);
    return fetched;
  };
  let ownIndex: number | undefined;
  if (target.kind === 'NEXT') {
    const found = await findFirstAtOrBelow(bestEXScore, first.players, page);
    if (found === 'unread') return undefined;
    ownIndex = found;
  }
  const index = resolveRankingTargetIndex(target, first.players, ownIndex);
  if (index === undefined) return undefined;
  const holder = await page(Math.floor(index / RANKING_PAGE_SIZE));
  return holder?.exScores[index % RANKING_PAGE_SIZE];
}

/**
 * The first place whose EX score is `exScore` or lower, `undefined` when every place is above it, or `'unread'` when a
 * page it needs cannot be read. The ranking is sorted best first, so the page is found by bisection.
 */
async function findFirstAtOrBelow(
  exScore: number,
  players: number,
  page: (index: number) => Promise<RankingPage | undefined>,
): Promise<number | 'unread' | undefined> {
  let low = 0;
  let high = Math.ceil(players / RANKING_PAGE_SIZE) - 1;
  // The first page whose last entry is at or below the score holds the place.
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const entries = (await page(middle))?.exScores;
    if (entries === undefined || entries.length === 0) return 'unread';
    if (entries[entries.length - 1]! <= exScore) high = middle;
    else low = middle + 1;
  }
  const entries = (await page(low))?.exScores;
  if (entries === undefined) return 'unread';
  const at = entries.findIndex((entry) => entry <= exScore);
  return at < 0 ? undefined : low * RANKING_PAGE_SIZE + at;
}
