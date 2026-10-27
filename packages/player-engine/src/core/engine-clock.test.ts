import { afterEach, describe, expect, it } from 'vite-plus/test';
import { setEngineScheduler, waitPreciseOrInput, type EngineScheduler } from './engine-clock.ts';

/** A scheduler whose clock the wake-up below advances by hand. */
function manualScheduler(): EngineScheduler & { advance: (ms: number) => void } {
  let nowMs = 0;
  return {
    now: () => nowMs,
    wallClockNow: () => nowMs,
    setTimeout: () => () => undefined,
    setImmediate: () => () => undefined,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

describe('waitPreciseOrInput', () => {
  afterEach(() => {
    setEngineScheduler(undefined);
  });

  it('waits out the whole delay in one timer', async () => {
    const scheduler = manualScheduler();
    setEngineScheduler(scheduler);
    const timeouts: number[] = [];
    const result = await waitPreciseOrInput(16, {
      waitForInputOrTimeout: async (timeoutMs) => {
        timeouts.push(timeoutMs);
        scheduler.advance(timeoutMs);
        return 'timeout';
      },
    });
    expect(result).toBe('timeout');
    expect(timeouts).toEqual([16]);
  });

  it('re-arms for the rest when the timer fires early', async () => {
    const scheduler = manualScheduler();
    setEngineScheduler(scheduler);
    const timeouts: number[] = [];
    const result = await waitPreciseOrInput(16, {
      waitForInputOrTimeout: async (timeoutMs) => {
        timeouts.push(timeoutMs);
        scheduler.advance(timeouts.length === 1 ? 10 : timeoutMs);
        return 'timeout';
      },
    });
    expect(result).toBe('timeout');
    expect(timeouts).toEqual([16, 6]);
  });

  it('returns at once when an input arrives', async () => {
    setEngineScheduler(manualScheduler());
    const result = await waitPreciseOrInput(16, { waitForInputOrTimeout: async () => 'input' });
    expect(result).toBe('input');
  });
});
