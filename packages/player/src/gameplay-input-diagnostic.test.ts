import { describe, expect, test } from 'vitest';
import { createPlayerInputSignalBus } from './core/input-signal-bus.ts';

describe('gameplay input diagnostic', () => {
  test('input signal bus queues gameplay commands in order', () => {
    const bus = createPlayerInputSignalBus();

    bus.pushCommand({ kind: 'lane-input', tokens: ['z'] });
    bus.pushCommand({ kind: 'toggle-pause' });
    bus.pushCommand({ kind: 'interrupt', reason: 'escape' });

    expect(bus.drainCommands()).toEqual([
      { kind: 'lane-input', tokens: ['z'] },
      { kind: 'toggle-pause' },
      { kind: 'interrupt', reason: 'escape' },
    ]);
  });
});
