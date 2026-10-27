import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicEvent } from '@be-music/chart-source';
import { compareEvents } from './beats.ts';
import { bucketEvents, mergeSortedEvents } from './fingerprint-items.ts';

const event = (measure: number, channel: string, n: number, d: number, value = '01'): BeMusicEvent => ({
  measure,
  channel,
  position: [n, d],
  value,
});

describe('mergeSortedEvents', () => {
  test('equals a stable sort of the concatenated sorted lists', () => {
    let seed = 11;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 200; round += 1) {
      const events = Array.from({ length: 1 + Math.floor(random() * 60) }, () =>
        event(
          Math.floor(random() * 4),
          ['11', '12', '13', '51', '52'][Math.floor(random() * 5)]!,
          Math.floor(random() * 4),
          [4, 8, 16][Math.floor(random() * 3)]!,
          ['01', '02', 'ZZ'][Math.floor(random() * 3)],
        ),
      );
      const lists = [...bucketEvents(events).values()];
      const merged = mergeSortedEvents(lists);
      expect(merged).toEqual(lists.flat().sort(compareEvents));
      // Ties keep the earlier list's event first, element for element.
      lists
        .flat()
        .sort(compareEvents)
        .forEach((expected, index) => expect(merged[index]).toBe(expected));
    }
  });

  test('handles no lists and empty lists', () => {
    expect(mergeSortedEvents([])).toEqual([]);
    const only = [event(0, '11', 0, 4)];
    expect(mergeSortedEvents([[], only, []])).toEqual(only);
    expect(mergeSortedEvents([[], only, []])).not.toBe(only);
  });
});
