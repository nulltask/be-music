import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { createPlayerInputSignalBus } from '../../../player-engine/src/core/input-signal-bus.ts';
import { CS_GAMEPAD_BUTTON_CHANNELS, createWebInputRuntime, keyboardEventToTokens } from './web-input-runtime.ts';

afterEach(() => vi.unstubAllGlobals());

/**
 * Minimal stand-in for the {@link KeyboardEvent} surface the runtime touches. `repeat` defaults to `false` because
 * most tests want to exercise the un-repeated path; the auto-repeat suppression is its own dedicated test.
 * `timeStamp` defaults to `0` because real `KeyboardEvent`s always carry a `DOMHighResTimeStamp` (the runtime
 * promotes it to wall-clock-ms with `performance.timeOrigin + timeStamp`); leaving it `undefined` would make the
 * promotion arithmetic produce `NaN` and break the existing shape assertions. Press-timestamp tests pass
 * `timeStamp` explicitly.
 */
function makeKeyEvent(code: string, options: { repeat?: boolean; timeStamp?: number } = {}): KeyboardEvent {
  let prevented = false;
  const event = {
    code,
    repeat: options.repeat ?? false,
    timeStamp: options.timeStamp ?? 0,
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
  test('uses the CS DualShock button layout', () => {
    expect(CS_GAMEPAD_BUTTON_CHANNELS).toEqual({
      0: '5', // Cross
      1: '9', // Circle
      2: '3', // Square
      3: '8', // Triangle
      4: '2', // L1
      5: '4', // R1
      6: '6', // L2
      7: '6', // R2
      12: '1', // D-pad up
    });
  });

  test('maps a standard gamepad button to its CS lane and reports controller source metadata', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    buttons[2] = { pressed: true, value: 1 }; // Square → second white key.
    vi.stubGlobal('navigator', {
      getGamepads: () => [{ index: 0, mapping: 'standard', buttons }],
    });
    const inputSignals = createPlayerInputSignalBus();
    const { target } = makeMockTarget();
    const runtime = createWebInputRuntime({
      inputSignals,
      inputTokenToChannels: new Map([['s', ['13']]]),
      target,
    });
    runtime.start();
    runtime.stop();
    expect(inputSignals.drainCommands()).toEqual([
      {
        kind: 'lane-input',
        tokens: ['s'],
        source: { kind: 'button', device: 'controller', label: 'p1-b2' },
        code: 'gamepad-button-2',
        pressedAt: expect.any(Number),
      },
      {
        kind: 'kitty-state',
        pressTokens: ['s'],
        repeatTokens: [],
        releaseTokens: [],
        source: { kind: 'button', device: 'controller', label: 'p1-b2' },
        code: 'gamepad-button-2',
        pressedAt: expect.any(Number),
      },
      {
        kind: 'kitty-state',
        pressTokens: [],
        repeatTokens: [],
        releaseTokens: ['s'],
        source: { kind: 'button', device: 'controller', label: 'p1-b2' },
        code: 'gamepad-button-2',
        pressedAt: expect.any(Number),
      },
    ]);
  });

  test('maps L2 and R2 to opposite scratch directions', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    buttons[6] = { pressed: true, value: 1 };
    vi.stubGlobal('navigator', {
      getGamepads: () => [{ index: 0, mapping: 'standard', buttons }],
    });
    const inputSignals = createPlayerInputSignalBus();
    const { target } = makeMockTarget();
    const runtime = createWebInputRuntime({
      inputSignals,
      inputTokenToChannels: new Map([['shift-left', ['16']]]),
      target,
    });
    runtime.start();
    runtime.stop();
    expect(inputSignals.drainCommands()[0]).toMatchObject({
      kind: 'lane-input',
      tokens: ['shift-left'],
      source: { kind: 'turntable', device: 'controller', label: 'p1-tt', direction: 'up' },
      spin: 'cw',
      code: 'gamepad-button-6',
    });
  });

  test('uses sequential lane buttons for a USB INFINITAS-compatible controller', () => {
    const buttons = Array.from({ length: 16 }, (_, index) => ({
      pressed: index === 6,
      value: index === 6 ? 1 : 0,
    }));
    vi.stubGlobal('navigator', {
      getGamepads: () => [{ id: '1ccf-8048-Controller', index: 0, mapping: '', buttons, axes: [0, 0] }],
    });
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createWebInputRuntime({
      inputSignals,
      inputTokenToChannels: new Map([
        ['v', ['19']],
        ['shift-left', ['16']],
      ]),
      target: makeMockTarget().target,
    });
    runtime.start();
    runtime.stop();
    expect(inputSignals.drainCommands()).toMatchObject([
      { kind: 'lane-input', tokens: ['v'], source: { device: 'controller', label: 'p1-b6' } },
      { kind: 'kitty-state', pressTokens: ['v'] },
      { kind: 'kitty-state', releaseTokens: ['v'] },
    ]);
  });

  test('polls only while a supported gamepad is connected', () => {
    vi.useFakeTimers();
    const gamepadTarget = new EventTarget();
    vi.stubGlobal('window', gamepadTarget);
    const getGamepads = vi.fn<() => unknown[]>().mockReturnValue([]);
    vi.stubGlobal('navigator', { getGamepads });
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createWebInputRuntime({
      inputSignals,
      inputTokenToChannels: new Map([['s', ['13']]]),
      target: makeMockTarget().target,
    });
    try {
      runtime.start();
      vi.advanceTimersByTime(20);
      expect(getGamepads).toHaveBeenCalledTimes(1);

      getGamepads.mockReturnValue([
        {
          id: 'Standard Gamepad',
          index: 0,
          mapping: 'standard',
          buttons: [
            { pressed: false, value: 0 },
            { pressed: false, value: 0 },
            { pressed: true, value: 1 },
          ],
        },
      ]);
      gamepadTarget.dispatchEvent(new Event('gamepadconnected'));
      vi.advanceTimersByTime(4);
      expect(getGamepads).toHaveBeenCalledTimes(3);
      expect(inputSignals.drainCommands().map(({ kind }) => kind)).toEqual(['lane-input', 'kitty-state']);

      getGamepads.mockReturnValue([]);
      gamepadTarget.dispatchEvent(new Event('gamepaddisconnected'));
      vi.advanceTimersByTime(20);
      expect(getGamepads).toHaveBeenCalledTimes(4);
      expect(inputSignals.drainCommands()).toMatchObject([{ kind: 'kitty-state', releaseTokens: ['s'] }]);
    } finally {
      runtime.stop();
      vi.useRealTimers();
    }
  });

  test('handles a raw Gamepad event before polling and ignores stale or duplicate snapshots', () => {
    vi.useFakeTimers();
    const window = new EventTarget();
    vi.stubGlobal('window', window);
    const makePad = (timestamp: number, pressed: boolean) => ({
      id: 'Standard Gamepad',
      index: 0,
      mapping: 'standard',
      timestamp,
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 2 && pressed, value: 0 })),
    });
    let pad = makePad(1, false);
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createWebInputRuntime({
      inputSignals,
      inputTokenToChannels: new Map([['s', ['13']]]),
      target: makeMockTarget().target,
    });
    const rawInput = (gamepad: ReturnType<typeof makePad>): void => {
      window.dispatchEvent(Object.assign(new Event('gamepadrawinputchanged'), { gamepad }));
    };
    try {
      runtime.start();
      const pressed = makePad(2, true);
      rawInput(pressed);
      expect(inputSignals.drainCommands().map(({ kind }) => kind)).toEqual(['lane-input', 'kitty-state']);
      vi.advanceTimersByTime(4);
      pad = pressed;
      vi.advanceTimersByTime(4);
      expect(inputSignals.drainCommands()).toEqual([]);
      rawInput(makePad(3, false));
      expect(inputSignals.drainCommands()).toMatchObject([{ kind: 'kitty-state', releaseTokens: ['s'] }]);
      runtime.stop();
      rawInput(makePad(4, true));
      expect(inputSignals.drainCommands()).toEqual([]);
    } finally {
      runtime.stop();
      vi.useRealTimers();
    }
  });

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

  test('declares that it reports key releases, so the engine judges the play as key-state input from its first key', () => {
    const runtime = createWebInputRuntime({
      inputSignals: createPlayerInputSignalBus(),
      inputTokenToChannels: new Map(),
    });
    expect(runtime.reportsKeyReleases).toBe(true);
  });

  test('lane key press pushes a lane-input command followed by a kitty-state press for LN sustain tracking', () => {
    // The runtime emits BOTH commands on a single keydown:
    // - `lane-input` resolves the timing judge for the press itself.
    // - `kitty-state` with `pressTokens` holds the lane down in the engine's judge until the key's release, so a
    //   long note stays held while the user holds the key.
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('KeyZ'));
    const commands = inputSignals.drainCommands();
    expect(commands).toEqual([
      { kind: 'lane-input', tokens: ['z'], code: 'KeyZ', pressedAt: expect.any(Number) },
      {
        kind: 'kitty-state',
        pressTokens: ['z'],
        repeatTokens: [],
        releaseTokens: [],
        code: 'KeyZ',
        pressedAt: expect.any(Number),
      },
    ]);
  });

  test('lane key press forwards `KeyboardEvent.timeStamp` as a wall-clock-ms `pressedAt`', () => {
    // The runtime promotes `KeyboardEvent.timeStamp` (a `DOMHighResTimeStamp` relative to
    // `performance.timeOrigin`) into the wall-clock-ms domain by adding `performance.timeOrigin`. The engine
    // reads `pressedAt` in that domain so the value is process-shared — TUI's worker-thread engine reads the
    // same wall clock the main-thread input adapter wrote to. Without this promotion the value would be on
    // the page's `performance.timeOrigin` clock, which doesn't survive a Worker boundary.
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('KeyZ', { timeStamp: 12_345.6 }));
    expect(inputSignals.drainCommands()).toEqual([
      { kind: 'lane-input', tokens: ['z'], code: 'KeyZ', pressedAt: performance.timeOrigin + 12_345.6 },
      {
        kind: 'kitty-state',
        pressTokens: ['z'],
        repeatTokens: [],
        releaseTokens: [],
        code: 'KeyZ',
        pressedAt: performance.timeOrigin + 12_345.6,
      },
    ]);
  });

  test('lane key release forwards `KeyboardEvent.timeStamp` as a wall-clock-ms `pressedAt` on kitty-state release', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keyup', makeKeyEvent('KeyZ', { timeStamp: 9_999 }));
    expect(inputSignals.drainCommands()).toEqual([
      {
        kind: 'kitty-state',
        pressTokens: [],
        repeatTokens: [],
        releaseTokens: ['z'],
        code: 'KeyZ',
        pressedAt: performance.timeOrigin + 9_999,
      },
    ]);
  });

  test('lane key commands carry the physical KeyboardEvent.code the replay records', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('ShiftLeft'));
    dispatch('keyup', makeKeyEvent('ShiftLeft'));
    expect(inputSignals.drainCommands().map((command) => ('code' in command ? command.code : undefined))).toEqual([
      'ShiftLeft',
      'ShiftLeft',
      'ShiftLeft',
    ]);
  });

  test('Escape pushes interrupt(escape)', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('Escape'));
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'interrupt', reason: 'escape' }]);
  });

  test('Pause pushes toggle-pause', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keydown', makeKeyEvent('Pause'));
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
    // Only the first (un-repeated) keydown produces commands; both `lane-input` and `kitty-state` press are
    // emitted as a pair so the engine has the timing judge AND the held-state tracking for LN sustain.
    expect(inputSignals.drainCommands()).toEqual([
      { kind: 'lane-input', tokens: ['z'], code: 'KeyZ', pressedAt: expect.any(Number) },
      {
        kind: 'kitty-state',
        pressTokens: ['z'],
        repeatTokens: [],
        releaseTokens: [],
        code: 'KeyZ',
        pressedAt: expect.any(Number),
      },
    ]);
  });

  test('keyup pushes a kitty-state release-only command for LN release handling', () => {
    const inputSignals = createPlayerInputSignalBus();
    const { target, dispatch } = makeMockTarget();
    const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map(), target });
    runtime.start();
    dispatch('keyup', makeKeyEvent('KeyZ'));
    expect(inputSignals.drainCommands()).toEqual([
      {
        kind: 'kitty-state',
        pressTokens: [],
        repeatTokens: [],
        releaseTokens: ['z'],
        code: 'KeyZ',
        pressedAt: expect.any(Number),
      },
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
    expect(keyboardEventToTokens(makeKeyEvent('F0'))).toEqual([]);
    expect(keyboardEventToTokens(makeKeyEvent('F25'))).toEqual([]);
    expect(keyboardEventToTokens(makeKeyEvent('IntlBackslash'))).toEqual([]);
  });
});

test.each([
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backslash', '\\'],
  ['Backquote', '`'],
  ...Array.from({ length: 24 }, (_, index) => [`F${index + 1}`, `f${index + 1}`]),
])('maps generic keyboard code %s to a usable lane token', (code, token) => {
  expect(keyboardEventToTokens(makeKeyEvent(code!))).toEqual([token]);
});

test('a bound F5 sends lane press/release commands without restarting', () => {
  const inputSignals = createPlayerInputSignalBus();
  const { target, dispatch } = makeMockTarget();
  const runtime = createWebInputRuntime({ inputSignals, inputTokenToChannels: new Map([['f5', ['2G']]]), target });
  runtime.start();
  dispatch('keydown', makeKeyEvent('F5'));
  dispatch('keyup', makeKeyEvent('F5'));
  expect(inputSignals.drainCommands()).toEqual([
    { kind: 'lane-input', tokens: ['f5'], code: 'F5', pressedAt: expect.any(Number) },
    {
      kind: 'kitty-state',
      pressTokens: ['f5'],
      repeatTokens: [],
      releaseTokens: [],
      code: 'F5',
      pressedAt: expect.any(Number),
    },
    {
      kind: 'kitty-state',
      pressTokens: [],
      repeatTokens: [],
      releaseTokens: ['f5'],
      code: 'F5',
      pressedAt: expect.any(Number),
    },
  ]);
  runtime.stop();
});
