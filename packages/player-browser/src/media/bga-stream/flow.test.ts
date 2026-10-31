import { describe, expect, it } from 'vite-plus/test';
import { createFlowCounter, MAX_FRAMES_IN_FLIGHT, signalFrameTaken, waitForEncoder } from './flow.ts';

describe('flow control', () => {
  it('counts taken frames and lets a decoder within the limit go on at once', () => {
    const flow = createFlowCounter();
    waitForEncoder(flow, MAX_FRAMES_IN_FLIGHT);
    signalFrameTaken(flow);
    signalFrameTaken(flow);
    expect(Atomics.load(flow, 0)).toBe(2);
    const startedAt = performance.now();
    waitForEncoder(flow, MAX_FRAMES_IN_FLIGHT + 2);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});
