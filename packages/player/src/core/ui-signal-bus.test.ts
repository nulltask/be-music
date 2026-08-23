import { describe, expect, test } from 'vitest';
import { createPlayerUiSignalBus } from './ui-signal-bus.ts';

describe('player ui signal bus', () => {
  test('publishes latest frame and drains commands in order', () => {
    const uiBus = createPlayerUiSignalBus({
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds: 10,
      summary: {
        total: 1,
        perfect: 0,
        fast: 0,
        slow: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        emptyPoor: 0,
        exScore: 0,
        score: 0,
      },
      notes: [],
    });

    expect(uiBus.frameTick()).toBe(0);
    uiBus.publishFrame({
      currentBeat: 2,
      currentSeconds: 1,
      totalSeconds: 10,
      summary: {
        total: 1,
        perfect: 1,
        fast: 0,
        slow: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        emptyPoor: 0,
        exScore: 2,
        score: 200000,
      },
      notes: [],
    });
    expect(uiBus.frameTick()).toBe(1);
    expect(uiBus.getFrame().currentBeat).toBe(2);

    uiBus.pushCommand({ kind: 'flash-lane', channel: '11' });
    uiBus.pushCommand({ kind: 'clear-poor-bga' });
    expect(uiBus.commandTick()).toBe(2);
    expect(uiBus.drainCommands()).toEqual([{ kind: 'flash-lane', channel: '11' }, { kind: 'clear-poor-bga' }]);
    expect(uiBus.drainCommands()).toEqual([]);
  });

  test('publishFrame copies the mirrored display clock fields', () => {
    const summary = {
      total: 1,
      perfect: 0,
      fast: 0,
      slow: 0,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
      emptyPoor: 0,
      exScore: 0,
      score: 0,
    };
    const uiBus = createPlayerUiSignalBus({ currentBeat: 0, currentSeconds: 0, totalSeconds: 10, summary, notes: [] });

    uiBus.publishFrame({
      currentBeat: 12,
      currentSeconds: 6,
      displayBeat: 4,
      displaySeconds: 2,
      reversalSeconds: 4,
      totalSeconds: 10,
      summary,
      notes: [],
    });
    expect(uiBus.getFrame().displayBeat).toBe(4);
    expect(uiBus.getFrame().displaySeconds).toBe(2);
    expect(uiBus.getFrame().reversalSeconds).toBe(4);

    // The fields are per-frame: a frame published without them clears the previous ones.
    uiBus.publishFrame({ currentBeat: 13, currentSeconds: 6.5, totalSeconds: 10, summary, notes: [] });
    expect(uiBus.getFrame().displayBeat).toBeUndefined();
    expect(uiBus.getFrame().displaySeconds).toBeUndefined();
  });
});
