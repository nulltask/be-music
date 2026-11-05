import { describe, expect, test } from 'vite-plus/test';
import {
  createLaneHoldHistory,
  LANE_HOLD_HISTORY_MS,
  recordLaneDown,
  recordLaneUp,
  wasLaneDownAt,
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

  test('old spans are dropped once they are well past', () => {
    const history = createLaneHoldHistory();
    recordLaneDown(history, ['a'], 0);
    recordLaneUp(history, ['a'], 10);
    recordLaneDown(history, ['a'], 20 + LANE_HOLD_HISTORY_MS);
    expect(history.spans).toHaveLength(1);
  });

  test('pruning keeps the recent spans in order', () => {
    const history = createLaneHoldHistory();
    for (const downMs of [0, 100, 200, 300]) {
      recordLaneDown(history, ['a'], downMs);
      recordLaneUp(history, ['a'], downMs + 50);
    }
    // At 2_160 ms the horizon is 160 ms: the spans ending at 50 and 150 go, the ones ending at 250 and 350 stay.
    recordLaneDown(history, ['a'], 2160);
    expect(history.spans).toEqual([
      { downMs: 200, upMs: 250 },
      { downMs: 300, upMs: 350 },
      { downMs: 2160, upMs: undefined },
    ]);
    expect(wasLaneDownAt(history, 225)).toBe(true);
    expect(wasLaneDownAt(history, 275)).toBe(false);
  });
});
