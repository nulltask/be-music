import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { yieldToTask } from './yield.ts';

describe('yieldToTask', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves after pending microtasks', async () => {
    const order: string[] = [];
    const yielded = yieldToTask().then(() => order.push('yield'));
    queueMicrotask(() => order.push('microtask'));
    await yielded;
    expect(order).toEqual(['microtask', 'yield']);
  });

  it('uses scheduler.yield where the host has it', async () => {
    const schedulerYield = vi.fn(() => Promise.resolve());
    vi.stubGlobal('scheduler', { yield: schedulerYield });
    await yieldToTask();
    expect(schedulerYield).toHaveBeenCalledTimes(1);
  });

  it('falls back to setTimeout without MessageChannel', async () => {
    vi.stubGlobal('MessageChannel', undefined);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    await yieldToTask();
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 0);
  });
});
