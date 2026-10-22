import { describe, expect, test } from 'vite-plus/test';
import { createRealtimeAudioCursor } from './play-audio-cursor.ts';

const items = [{ seconds: 0 }, { seconds: 0.5 }, { seconds: 0.5 }, { seconds: 1 }, { seconds: 2 }];

describe('createRealtimeAudioCursor', () => {
  test('fires every item due by the reference time once, in order', () => {
    const fired: number[] = [];
    const cursor = createRealtimeAudioCursor(items, (item) => fired.push(items.indexOf(item)));
    cursor.triggerUntil(0.5);
    expect(fired).toEqual([0, 1, 2]);
    cursor.triggerUntil(0.5);
    cursor.triggerUntil(0.9);
    expect(fired).toEqual([0, 1, 2]);
    expect(cursor.done).toBe(false);
    cursor.triggerUntil(5);
    expect(fired).toEqual([0, 1, 2, 3, 4]);
    expect(cursor.done).toBe(true);
  });

  test('takes an item a hair past the reference time, and nothing before the chart starts early', () => {
    const fired: number[] = [];
    const cursor = createRealtimeAudioCursor(items, (item) => fired.push(item.seconds));
    // A negative reference reads as the chart's start.
    cursor.triggerUntil(-1);
    expect(fired).toEqual([0]);
    // Within a microsecond of the reference counts as due (float drift of a chart second).
    cursor.triggerUntil(0.5 - 5e-7);
    expect(fired).toEqual([0, 0.5, 0.5]);
  });

  test('caps the reference time with the clamp', () => {
    const fired: number[] = [];
    const cursor = createRealtimeAudioCursor(
      items,
      (item) => fired.push(item.seconds),
      (seconds) => Math.min(seconds, 0.9),
    );
    cursor.triggerUntil(10);
    expect(fired).toEqual([0, 0.5, 0.5]);
    expect(cursor.done).toBe(false);
  });

  test('an empty list is done from the start', () => {
    const cursor = createRealtimeAudioCursor([], () => {
      throw new Error('nothing to fire');
    });
    cursor.triggerUntil(10);
    expect(cursor.done).toBe(true);
  });

  test('seeks forward past the items due by then, handing each one how long ago it was due', () => {
    const fired: number[] = [];
    const ringing: [number, number][] = [];
    const cursor = createRealtimeAudioCursor(items, (item) => fired.push(item.seconds));
    cursor.seek(1.25, (item, offsetSeconds) => ringing.push([item.seconds, offsetSeconds]));
    expect(fired).toEqual([]);
    expect(ringing).toEqual([
      [0, 1.25],
      [0.5, 0.75],
      [0.5, 0.75],
      [1, 0.25],
    ]);
    cursor.triggerUntil(5);
    expect(fired).toEqual([2]);
  });

  test('seeks backwards: the items after the new reference fire again', () => {
    const fired: number[] = [];
    const ringing: number[] = [];
    const cursor = createRealtimeAudioCursor(items, (item) => fired.push(item.seconds));
    cursor.triggerUntil(5);
    expect(cursor.done).toBe(true);
    cursor.seek(0.6, (item) => ringing.push(item.seconds));
    expect(ringing).toEqual([0, 0.5, 0.5]);
    expect(cursor.done).toBe(false);
    cursor.triggerUntil(5);
    expect(fired).toEqual([0, 0.5, 0.5, 1, 2, 1, 2]);
  });

  test('a seek without a callback fires the items it passes, from the start, under the clamp', () => {
    const fired: number[] = [];
    const cursor = createRealtimeAudioCursor(
      items,
      (item) => fired.push(item.seconds),
      (seconds) => Math.min(seconds, 0.9),
    );
    cursor.seek(1.5);
    expect(fired).toEqual([0, 0.5, 0.5]);
    cursor.seek(0.2);
    expect(fired).toEqual([0, 0.5, 0.5, 0]);
  });
});
