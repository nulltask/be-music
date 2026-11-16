import { expect, test } from 'vite-plus/test';
import type { LoadProgress } from '@be-music/player-browser/collection';
import { tallyListings } from './listing-progress.ts';

test('counts later listings on from the files the earlier ones found, and reports the total at the end', () => {
  const events: LoadProgress[] = [];
  const tally = tallyListings((event) => events.push(event));

  tally.report({ phase: 'enumerating', current: 1, total: -1, label: 'A/a.bms' });
  tally.report({ phase: 'enumerating', current: 2, total: 2 });
  tally.done(2);
  tally.report({ phase: 'enumerating', current: 1, total: -1, label: 'B/b.bms' });
  tally.done(3);
  tally.finish();

  expect(events).toEqual([
    { phase: 'enumerating', current: 1, total: -1, label: 'A/a.bms' },
    // One listing's own total is not the total of them all.
    { phase: 'enumerating', current: 2, total: -1 },
    { phase: 'enumerating', current: 3, total: -1, label: 'B/b.bms' },
    { phase: 'enumerating', current: 5, total: 5 },
  ]);
});

test('passes other phases through unchanged', () => {
  const events: LoadProgress[] = [];
  const tally = tallyListings((event) => events.push(event));
  tally.done(4);
  tally.report({ phase: 'reading', current: 1, total: 2 });
  expect(events).toEqual([{ phase: 'reading', current: 1, total: 2 }]);
});
