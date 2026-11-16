import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicEvent } from '@be-music/chart-source';
import { createChainSoundQueue } from './chain-audio.ts';

const event = (value: string): BeMusicEvent => ({ measure: 0, position: [0, 1], channel: '01', value });

describe('createChainSoundQueue', () => {
  test('fires each sound its delay after the press, in time order, and at once when the delay is 0', () => {
    const fired: Array<[string, number]> = [];
    const queue = createChainSoundQueue((sound, seconds) => fired.push([sound.value, seconds]));
    queue.schedule(1, [
      { event: event('01'), delaySeconds: 0 },
      { event: event('03'), delaySeconds: 0.5 },
      { event: event('02'), delaySeconds: 0.25 },
    ]);
    expect(fired).toEqual([['01', 1]]);
    queue.triggerUntil(1.3);
    expect(fired).toEqual([
      ['01', 1],
      ['02', 1.25],
    ]);
    expect(queue.done).toBe(false);
    queue.triggerUntil(2);
    expect(fired.at(-1)).toEqual(['03', 1.5]);
    expect(queue.done).toBe(true);
  });

  test('a second press queues the chain again, and clearing drops what waits', () => {
    const fired: string[] = [];
    const queue = createChainSoundQueue((sound) => fired.push(sound.value));
    const chain = [{ event: event('02'), delaySeconds: 0.5 }];
    queue.schedule(1, chain);
    queue.schedule(1.2, chain);
    queue.triggerUntil(1.75);
    expect(fired).toEqual(['02', '02']);
    queue.schedule(3, chain);
    queue.clear();
    queue.triggerUntil(10);
    expect(fired).toEqual(['02', '02']);
  });
});
