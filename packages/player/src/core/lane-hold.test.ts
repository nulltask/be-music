import { describe, expect, test } from 'vite-plus/test';
import {
  createLaneHoldHistory,
  LANE_HOLD_HISTORY_MS,
  recordLaneDown,
  recordLaneUp,
  wasLaneDownAt,
  wasLanePressedWithin,
} from './lane-hold.ts';

describe('lane hold history', () => {
  test('a lane is down from its press up to (not at) its release', () => {
    const history = createLaneHoldHistory();
    recordLaneDown(history, ['a'], 100);
    recordLaneUp(history, ['a'], 200);
    expect(wasLaneDownAt(history, 99)).toBe(false);
    // At a shared instant the input comes first: down at 100 is down, up at 200 is up.
    expect(wasLaneDownAt(history, 100)).toBe(true);
    expect(wasLaneDownAt(history, 199)).toBe(true);
    expect(wasLaneDownAt(history, 200)).toBe(false);
  });

  test('a second key on a held lane neither restarts nor ends the hold', () => {
    const history = createLaneHoldHistory();
    recordLaneDown(history, ['a'], 100);
    recordLaneDown(history, ['b'], 150);
    recordLaneUp(history, ['b'], 160);
    expect(wasLaneDownAt(history, 120)).toBe(true);
    expect(wasLaneDownAt(history, 170)).toBe(true);
    recordLaneUp(history, ['a'], 300);
    expect(wasLaneDownAt(history, 299)).toBe(true);
    expect(wasLaneDownAt(history, 300)).toBe(false);
  });

  test('inputs without tokens hold and release the lane as a whole', () => {
    const history = createLaneHoldHistory();
    recordLaneDown(history, [], 100);
    recordLaneDown(history, ['a'], 120);
    recordLaneUp(history, [], 150);
    expect(wasLaneDownAt(history, 149)).toBe(true);
    expect(wasLaneDownAt(history, 150)).toBe(false);
  });

  test('a release with no key down changes nothing', () => {
    const history = createLaneHoldHistory();
    recordLaneUp(history, ['a'], 50);
    recordLaneDown(history, ['a'], 100);
    expect(wasLaneDownAt(history, 120)).toBe(true);
  });

  test('presses are found within a span of time, the latest at or before its end deciding', () => {
    const history = createLaneHoldHistory();
    recordLaneDown(history, [], 100);
    recordLaneDown(history, [], 300);
    expect(wasLanePressedWithin(history, 0, 150)).toBe(true);
    expect(wasLanePressedWithin(history, 120, 250)).toBe(false);
    expect(wasLanePressedWithin(history, 200, 300)).toBe(true);
    expect(wasLanePressedWithin(history, 0, 99)).toBe(false);
  });

  test('old spans and presses are dropped once they are well past', () => {
    const history = createLaneHoldHistory();
    recordLaneDown(history, ['a'], 0);
    recordLaneUp(history, ['a'], 10);
    recordLaneDown(history, ['a'], 20 + LANE_HOLD_HISTORY_MS);
    expect(history.spans).toHaveLength(1);
    expect(history.pressesMs).toEqual([20 + LANE_HOLD_HISTORY_MS]);
  });
});
