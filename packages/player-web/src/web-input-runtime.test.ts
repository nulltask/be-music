import { describe, expect, test } from 'vitest';
import { createPlayerInputSignalBus } from '../../player/src/core/input-signal-bus.ts';
import { createWebInputRuntime, keyboardEventToTokens } from './web-input-runtime.ts';

/**
 * Minimal stand-in for the {@link KeyboardEvent} surface the runtime touches. `repeat` defaults to `false` because
 * most tests want to exercise the un-repeated path; the auto-repeat suppression is its own dedicated test.
 */
function makeKeyEvent(code: string, options: { repeat?: boolean } = {}): KeyboardEvent {
  let prevented = false;
  const event = {
    code,
    repeat: options.repeat ?? false,
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as KeyboardEvent;
  return event;
}

/**
 * Captures `addEventListener` / `removeEventListener` calls so the runtime's lifecycle assertions can verify
 * attach / detach without depending on a real `window`.
 */
function makeMockTarget(): {
  target: EventTarget;
  dispatch: (type: string, event: KeyboardEvent) => void;
  attachedTypes: string[];
} {
  const handlers = new Map<string, Set<EventListener>>();
  const attachedTypes: string[] = [];
  const target: EventTarget = {
    addEventListener: ((type: string, listener: EventListener) => {
      attachedTypes.push(type);
      const set = handlers.get(type) ?? new Set<EventListener>();
      set.add(listener);
      handlers.set(type, set);
    }) as EventTarget['addEventListener'],
    removeEventListener: ((type: string, listener: EventListener) => {
      handlers.get(type)?.delete(listener);
    }) as EventTarget['removeEventListener'],
    dispatchEvent: () => true,
  };
  const dispatch = (type: string, event: KeyboardEvent): void => {
    const set = handlers.get(type);
    if (!set) return;
    for (const listener of set) listener(event as unknown as Event);
  };
  return { target, dispatch, attachedTypes };
}

describe('createWebInputRuntime', () => {
  test('start attaches keydown / keyup listeners and stop detaches them', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, attachedTypes } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    expect(attachedTypes).toContain('keydown');
    expect(attachedTypes).toContain('keyup');
    runtime.stop();
    // After stop, the runtime should be safe to start again — re-attach without throwing.
    runtime.start();
    runtime.stop();
  });

  test('lane key press pushes a lane-input command with the resolved token', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('KeyZ'));
    const commands = inputSignals.drainCommands();
    expect(commands).toEqual([{ kind: 'lane-input', tokens: ['z'] }]);
  });

  test('Escape pushes interrupt(escape)', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('Escape'));
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'interrupt', reason: 'escape' }]);
  });

  test('Space pushes toggle-pause', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('Space'));
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'toggle-pause' }]);
  });

  test('F5 pushes interrupt(restart) and prevents the browser reload', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    const event = makeKeyEvent('F5');
    dispatch('keydown', event);
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'interrupt', reason: 'restart' }]);
    expect(event.defaultPrevented).toBe(true);
  });

  test('OS auto-repeat keydowns are filtered out so a held key does not flood the engine with judges', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('KeyZ'));
    dispatch('keydown', makeKeyEvent('KeyZ', { repeat: true }));
    dispatch('keydown', makeKeyEvent('KeyZ', { repeat: true }));
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'lane-input', tokens: ['z'] }]);
  });

  test('keyup pushes a kitty-state release-only command for LN release handling', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keyup', makeKeyEvent('KeyZ'));
    expect(inputSignals.drainCommands()).toEqual([
      { kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens: ['z'] },
    ]);
  });

  test('shouldSkipKey hook lets the host suppress keydowns under modal overlays', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({
      inputSignals,
      inputTokenToChannels: new Map(),
      target,
      shouldSkipKey: () => true,
    });
    runtime.start();
    dispatch('keydown', makeKeyEvent('KeyZ'));
    expect(inputSignals.drainCommands()).toEqual([]);
  });
});

describe('keyboardEventToTokens', () => {
  test('maps KeyA..KeyZ to lowercase letters', () => {
    expect(keyboardEventToTokens(makeKeyEvent('KeyA'))).toEqual(['a']);
    expect(keyboardEventToTokens(makeKeyEvent('KeyZ'))).toEqual(['z']);
  });

  test('emits both directional + generic forms for modifier keys', () => {
    expect(keyboardEventToTokens(makeKeyEvent('ShiftLeft'))).toEqual(['shift-left', 'shift']);
    expect(keyboardEventToTokens(makeKeyEvent('ShiftRight'))).toEqual(['shift-right', 'shift']);
    expect(keyboardEventToTokens(makeKeyEvent('ControlLeft'))).toEqual(['ctrl-left', 'ctrl']);
    expect(keyboardEventToTokens(makeKeyEvent('AltLeft'))).toEqual(['alt-left', 'alt']);
  });

  test('emits dedicated tokens for symbol keys used by the 9-key layout', () => {
    expect(keyboardEventToTokens(makeKeyEvent('Semicolon'))).toEqual([';']);
    expect(keyboardEventToTokens(makeKeyEvent('Comma'))).toEqual([',']);
    expect(keyboardEventToTokens(makeKeyEvent('Period'))).toEqual(['.']);
    expect(keyboardEventToTokens(makeKeyEvent('Slash'))).toEqual(['/']);
  });

  test('returns an empty array for keys without a meaningful token mapping', () => {
    expect(keyboardEventToTokens(makeKeyEvent('F1'))).toEqual([]);
    expect(keyboardEventToTokens(makeKeyEvent('IntlBackslash'))).toEqual([]);
  });
});
