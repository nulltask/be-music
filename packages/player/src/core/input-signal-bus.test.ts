import { describe, expect, test } from 'vitest';
import { createPlayerInputSignalBus } from './input-signal-bus.ts';

describe('player input signal bus', () => {
  test('queues and drains commands', () => {
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
