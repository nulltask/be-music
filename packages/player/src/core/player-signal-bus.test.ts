import { describe, expect, test } from 'vitest';
import { createPlayerInputSignalBus } from './player-input-signal-bus.ts';
import { createPlayerUiSignalBus } from './player-ui-signal-bus.ts';

describe('player signal bus', () => {
  test('ui bus publishes latest frame and drains commands in order', () => {
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

  test('input bus queues and drains commands', () => {
    const inputBus = createPlayerInputSignalBus();
    expect(inputBus.tick()).toBe(0);

    inputBus.pushCommand({ kind: 'toggle-pause' });
    inputBus.pushCommand({ kind: 'high-speed', action: 'increase' });
    expect(inputBus.tick()).toBe(2);
    expect(inputBus.drainCommands()).toEqual([
      { kind: 'toggle-pause' },
      { kind: 'high-speed', action: 'increase' },
    ]);
    expect(inputBus.drainCommands()).toEqual([]);
  });
});
