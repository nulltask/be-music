import { describe, expect, test, vi } from 'vite-plus/test';
import {
  IDLE_QUIT_HOLD,
  isQuitHoldComplete,
  pressQuitHold,
  QUIT_HOLD_THRESHOLD_MS,
  QuitHoldController,
  quitHoldRemainingMs,
  releaseQuitHold,
} from './quit-hold.ts';

describe('quit hold state', () => {
  test('a press starts a hold at the given time', () => {
    expect(pressQuitHold(IDLE_QUIT_HOLD, 100, false)).toEqual({ pressedAtMs: 100 });
  });

  test('a repeat event never starts a hold', () => {
    expect(pressQuitHold(IDLE_QUIT_HOLD, 100, true)).toBe(IDLE_QUIT_HOLD);
  });

  test('repeats and second presses keep the running hold', () => {
    const held = pressQuitHold(IDLE_QUIT_HOLD, 100, false);
    expect(pressQuitHold(held, 300, true)).toBe(held);
    expect(pressQuitHold(held, 300, false)).toBe(held);
  });

  test('release drops the hold', () => {
    expect(releaseQuitHold()).toEqual({ pressedAtMs: null });
  });

  test('completes at the threshold, not before', () => {
    const held = pressQuitHold(IDLE_QUIT_HOLD, 1000, false);
    expect(QUIT_HOLD_THRESHOLD_MS).toBe(500);
    expect(isQuitHoldComplete(held, 1499)).toBe(false);
    expect(isQuitHoldComplete(held, 1500)).toBe(true);
    expect(isQuitHoldComplete(held, 2000)).toBe(true);
    expect(isQuitHoldComplete(IDLE_QUIT_HOLD, 5000)).toBe(false);
  });

  test('remaining time counts down and clamps at zero', () => {
    const held = pressQuitHold(IDLE_QUIT_HOLD, 0, false);
    expect(quitHoldRemainingMs(held, 200)).toBe(300);
    expect(quitHoldRemainingMs(held, 900)).toBe(0);
    expect(quitHoldRemainingMs(held, 50, 100)).toBe(50);
    expect(quitHoldRemainingMs(IDLE_QUIT_HOLD, 0)).toBeNull();
  });
});

function createHarness() {
  let nowMs = 0;
  const pending: { callback: () => void; at: number; id: number }[] = [];
  let nextId = 1;
  const onComplete = vi.fn();
  const controller = new QuitHoldController({
    onComplete,
    now: () => nowMs,
    schedule: (callback, delayMs) => {
      const id = nextId++;
      pending.push({ callback, at: nowMs + delayMs, id });
      return id;
    },
    cancelScheduled: (handle) => {
      const index = pending.findIndex((entry) => entry.id === handle);
      if (index >= 0) pending.splice(index, 1);
    },
  });
  const advance = (toMs: number): void => {
    nowMs = toMs;
    for (;;) {
      const index = pending.findIndex((entry) => entry.at <= nowMs);
      if (index < 0) return;
      const [entry] = pending.splice(index, 1);
      entry!.callback();
    }
  };
  const key = (code: string, repeat = false, target: EventTarget | null = null) => ({
    code,
    repeat,
    target,
    preventDefault: vi.fn(),
  });
  return { controller, onComplete, advance, key, pending };
}

describe('QuitHoldController', () => {
  test('holding Backspace for the threshold quits once', () => {
    const { controller, onComplete, advance, key } = createHarness();
    const down = key('Backspace');
    expect(controller.handleKeyDown(down)).toBe(true);
    expect(down.preventDefault).toHaveBeenCalled();
    advance(499);
    expect(onComplete).not.toHaveBeenCalled();
    // Auto-repeat while held neither cancels nor restarts the hold.
    controller.handleKeyDown(key('Backspace', true));
    advance(500);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(controller.isHolding()).toBe(false);
    controller.handleKeyDown(key('Backspace', true));
    advance(2000);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  test('a tap does nothing', () => {
    const { controller, onComplete, advance, key, pending } = createHarness();
    controller.handleKeyDown(key('Backspace'));
    advance(200);
    expect(controller.handleKeyUp({ code: 'Backspace' })).toBe(true);
    expect(pending).toHaveLength(0);
    advance(1000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('a repeat-only press (key held into the scene) never quits', () => {
    const { controller, onComplete, advance, key } = createHarness();
    const repeat = key('Backspace', true);
    expect(controller.handleKeyDown(repeat)).toBe(true);
    expect(repeat.preventDefault).toHaveBeenCalled();
    advance(1000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('cancel drops a running hold', () => {
    const { controller, onComplete, advance, key } = createHarness();
    controller.handleKeyDown(key('Backspace'));
    advance(300);
    controller.cancel();
    advance(1000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('a timer firing early waits out the rest', () => {
    let nowMs = 0;
    const scheduled: { callback: () => void; delayMs: number }[] = [];
    const onComplete = vi.fn();
    const controller = new QuitHoldController({
      onComplete,
      now: () => nowMs,
      schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
      cancelScheduled: () => {},
    });
    controller.handleKeyDown({ code: 'Backspace', repeat: false, preventDefault: () => {} });
    expect(scheduled[0]!.delayMs).toBe(500);
    nowMs = 498;
    scheduled[0]!.callback();
    expect(onComplete).not.toHaveBeenCalled();
    expect(scheduled[1]!.delayMs).toBe(2);
    nowMs = 500;
    scheduled[1]!.callback();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  test('ignores other keys and Backspace typed into a text field', () => {
    const { controller, key } = createHarness();
    expect(controller.handleKeyDown(key('Escape'))).toBe(false);
    expect(controller.handleKeyUp({ code: 'KeyZ' })).toBe(false);
    const typing = key('Backspace', false, { tagName: 'INPUT' } as unknown as EventTarget);
    expect(controller.handleKeyDown(typing)).toBe(false);
    expect(typing.preventDefault).not.toHaveBeenCalled();
    expect(controller.isHolding()).toBe(false);
  });
});
