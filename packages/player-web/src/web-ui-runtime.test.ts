import { describe, expect, test, vi } from 'vitest';
import { createPlayerUiSignalBus } from '../../player/src/core/ui-signal-bus.ts';
import type { PlayerUiCommand, PlayerUiFramePayload } from '../../player/src/core/ui-signal-bus.ts';
import { createWebUiRuntime, drainWebUiSignals } from './web-ui-runtime.ts';

function makeInitialFrame(): PlayerUiFramePayload {
  return {
    currentBeat: 0,
    currentSeconds: 0,
    totalSeconds: 0,
    summary: {
      total: 0,
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
  };
}

describe('createWebUiRuntime', () => {
  test('start fires onStart and triggerPoor / clearPoor route to their host callbacks', () => {
    const uiSignals = createPlayerUiSignalBus(makeInitialFrame());
    const onStart = vi.fn();
    const onPoorTriggered = vi.fn();
    const onPoorCleared = vi.fn();
    const runtime = createWebUiRuntime({ uiSignals, onStart, onPoorTriggered, onPoorCleared });
    runtime.start();
    expect(onStart).toHaveBeenCalledTimes(1);
    runtime.triggerPoor(1.5);
    expect(onPoorTriggered).toHaveBeenCalledWith(1.5);
    runtime.clearPoor();
    expect(onPoorCleared).toHaveBeenCalledTimes(1);
  });

  test('stop and dispose fire their respective callbacks', () => {
    const uiSignals = createPlayerUiSignalBus(makeInitialFrame());
    const onStop = vi.fn();
    const onDispose = vi.fn();
    const runtime = createWebUiRuntime({ uiSignals, onStop, onDispose });
    runtime.start();
    runtime.stop();
    expect(onStop).toHaveBeenCalledTimes(1);
    runtime.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  test('callback exceptions do not propagate so a Pixi-side bug cannot break the engine main loop', () => {
    const uiSignals = createPlayerUiSignalBus(makeInitialFrame());
    const runtime = createWebUiRuntime({
      uiSignals,
      onStart: () => {
        throw new Error('boom');
      },
      onPoorTriggered: () => {
        throw new Error('boom');
      },
    });
    expect(() => runtime.start()).not.toThrow();
    expect(() => runtime.triggerPoor(0)).not.toThrow();
  });

  test('tuiEnabled is false so the engine keeps emitting per-frame log output for diagnostics', () => {
    const uiSignals = createPlayerUiSignalBus(makeInitialFrame());
    const runtime = createWebUiRuntime({ uiSignals });
    expect(runtime.tuiEnabled).toBe(false);
  });

  test('playbackEndSeconds is forwarded so the engine can wait for trailing BGA / audio tails', () => {
    const uiSignals = createPlayerUiSignalBus(makeInitialFrame());
    const runtime = createWebUiRuntime({ uiSignals, playbackEndSeconds: 12.5 });
    expect(runtime.playbackEndSeconds).toBe(12.5);
  });
});

describe('drainWebUiSignals', () => {
  test('routes the current frame snapshot + queued commands to the host callbacks', () => {
    const uiSignals = createPlayerUiSignalBus(makeInitialFrame());
    const onFrame = vi.fn();
    const onCommand = vi.fn();
    uiSignals.publishFrame({
      ...makeInitialFrame(),
      currentSeconds: 1,
      summary: { ...makeInitialFrame().summary, perfect: 5 },
    });
    uiSignals.pushCommand({ kind: 'flash-lane', channel: '11' });
    uiSignals.pushCommand({ kind: 'press-lane', channel: '12' });
    const result = drainWebUiSignals(uiSignals, { onFrame, onCommand });
    expect(result.drained).toBe(true);
    expect(onFrame).toHaveBeenCalledTimes(1);
    const frame = onFrame.mock.calls[0]![0] as PlayerUiFramePayload;
    expect(frame.currentSeconds).toBe(1);
    expect(frame.summary.perfect).toBe(5);
    expect(onCommand).toHaveBeenCalledTimes(2);
    const commandKinds = onCommand.mock.calls.map((call) => (call[0] as PlayerUiCommand).kind);
    expect(commandKinds).toEqual(['flash-lane', 'press-lane']);
    // Drained queue is now empty so a subsequent drain is a no-op (still returns drained:true because the frame
    // snapshot is always reported, but no further commands fire).
    onCommand.mockClear();
    drainWebUiSignals(uiSignals, { onFrame, onCommand });
    expect(onCommand).not.toHaveBeenCalled();
  });
});
