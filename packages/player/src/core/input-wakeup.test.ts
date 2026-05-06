import { describe, expect, test } from 'vitest';
import { createPlayerInputSignalBus } from './input-signal-bus.ts';
import { createInputWakeUp } from './input-wakeup.ts';

describe('createInputWakeUp', () => {
  test('wait() resolves on the next pushCommand', async () => {
    // The engine's loop awaits `wait()` to know when to re-drain inputs. Verify that a `pushCommand`
    // after `wait()` was called resolves the awaited promise — this is the core "wake up the loop"
    // contract.
    const inputSignals = createPlayerInputSignalBus();
    const wakeUp = createInputWakeUp(inputSignals);
    let resolved = false;
    const pending = wakeUp.wait().then(() => {
      resolved = true;
    });
    // Microtask flush — the wait shouldn't resolve until something pushes.
    await Promise.resolve();
    expect(resolved).toBe(false);
    inputSignals.pushCommand({ kind: 'lane-input', tokens: ['z'] });
    await pending;
    expect(resolved).toBe(true);
    wakeUp.dispose();
  });

  test('subsequent wait() observes the next push, not the previous one', async () => {
    // After a push, the wake-up re-arms internally so the *next* wait() resolves on the *next* push.
    // Without re-arming, a loop calling wait() in a tight cycle would either deadlock (never re-resolve)
    // or fire spuriously on the already-consumed tick.
    const inputSignals = createPlayerInputSignalBus();
    const wakeUp = createInputWakeUp(inputSignals);
    inputSignals.pushCommand({ kind: 'lane-input', tokens: ['z'] });
    await wakeUp.wait();
    let resolved = false;
    const pending = wakeUp.wait().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    inputSignals.pushCommand({ kind: 'lane-input', tokens: ['x'] });
    await pending;
    expect(resolved).toBe(true);
    wakeUp.dispose();
  });

  test('wait() returns the same shared promise until resolution', async () => {
    // Multiple concurrent waiters all observe the same notification — `Promise.race` callers across
    // different tick iterations don't accumulate distinct resolvers that could leak or fire late.
    const inputSignals = createPlayerInputSignalBus();
    const wakeUp = createInputWakeUp(inputSignals);
    const a = wakeUp.wait();
    const b = wakeUp.wait();
    expect(a).toBe(b);
    inputSignals.pushCommand({ kind: 'lane-input', tokens: ['z'] });
    await Promise.all([a, b]);
    wakeUp.dispose();
  });

  test('dispose() resolves any pending waiter so the engine loop can exit cleanly', async () => {
    // The engine's `finally` block calls dispose(); a pending `wait()` from the loop's last iteration must
    // resolve so the await doesn't deadlock the cleanup path.
    const inputSignals = createPlayerInputSignalBus();
    const wakeUp = createInputWakeUp(inputSignals);
    const pending = wakeUp.wait();
    wakeUp.dispose();
    await expect(pending).resolves.toBeUndefined();
  });

  test('dispose() makes wait() resolve immediately afterwards', async () => {
    const inputSignals = createPlayerInputSignalBus();
    const wakeUp = createInputWakeUp(inputSignals);
    wakeUp.dispose();
    await expect(wakeUp.wait()).resolves.toBeUndefined();
  });

  test('dispose() is idempotent', () => {
    const inputSignals = createPlayerInputSignalBus();
    const wakeUp = createInputWakeUp(inputSignals);
    wakeUp.dispose();
    expect(() => wakeUp.dispose()).not.toThrow();
  });
});
