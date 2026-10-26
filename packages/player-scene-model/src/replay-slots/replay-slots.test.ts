import { describe, expect, test } from 'vite-plus/test';
import { firstReplaySlot, stepReplaySlot } from './replay-slots.ts';

describe('replay slot selection', () => {
  test('picks the first slot holding a replay, or none', () => {
    expect(firstReplaySlot([false, false, true, true])).toBe(2);
    expect(firstReplaySlot([false, false, false, false])).toBe(-1);
    expect(firstReplaySlot([])).toBe(-1);
  });

  test('steps round to the next or previous slot holding a replay', () => {
    const exists = [true, false, true, false];
    expect(stepReplaySlot(exists, 0, 1)).toBe(2);
    expect(stepReplaySlot(exists, 2, 1)).toBe(0);
    expect(stepReplaySlot(exists, 0, -1)).toBe(2);
    expect(stepReplaySlot([false, true, false, false], 1, 1)).toBe(1);
    // No slot is picked only when none holds a replay: stepping keeps it so.
    expect(stepReplaySlot([false, false, false, false], -1, 1)).toBe(-1);
  });
});
