import type { LoadProgress } from '@be-music/player-browser/collection';

/** The `enumerating` progress of several listings run one after another, counted as one listing of them all. */
export interface ListingTally {
  /** Takes one listing's progress: its count runs on from the files the earlier listings found. */
  readonly report: (progress: LoadProgress) => void;
  /** One listing is done and found `count` files. */
  readonly done: (count: number) => void;
  /** Every listing is done: reports the total, so the progress shows the listing finished before parsing starts. */
  readonly finish: () => void;
}

/**
 * Counts several listings (the folder reload, which lists every earlier load again) as one, the way a drop of several
 * folders is listed: the count does not start again at each listing, and the total is only known once all are done.
 */
export function tallyListings(onProgress: (progress: LoadProgress) => void): ListingTally {
  let before = 0;
  return {
    report: (progress) =>
      onProgress(
        progress.phase === 'enumerating' ? { ...progress, current: before + progress.current, total: -1 } : progress,
      ),
    done: (count) => {
      before += count;
    },
    finish: () => onProgress({ phase: 'enumerating', current: before, total: before }),
  };
}
