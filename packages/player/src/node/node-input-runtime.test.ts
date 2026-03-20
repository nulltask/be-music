import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPlayerInputSignalBus } from '../core/input-signal-bus.ts';

const manualInputState = vi.hoisted(() => ({
  stopKittyKeyboardProtocol: vi.fn(),
  resolveInputTokenEvent: vi.fn(
    (chunk: string) =>
      ({
        tokens:
          chunk === 'z'
            ? ['z']
            : chunk === ' '
              ? ['space']
              : chunk === 'ALT_Z'
                ? ['alt+z']
                : chunk === 'KITTY'
                  ? ['z']
                  : [],
        repeatTokens: chunk === 'KITTY' ? ['x'] : [],
        releaseTokens: chunk === 'KITTY' ? ['c'] : [],
        kittyProtocolEvent: chunk === 'KITTY',
      }) as {
        tokens: string[];
        repeatTokens: string[];
        releaseTokens: string[];
        kittyProtocolEvent: boolean;
      },
  ),
}));

vi.mock('node:readline', async () => {
  const actual = await vi.importActual<typeof import('node:readline')>('node:readline');
  return {
    ...actual,
    emitKeypressEvents: vi.fn(),
  };
});

vi.mock('../manual-input.ts', () => ({
  beginKittyKeyboardProtocolOptIn: vi.fn(() => manualInputState.stopKittyKeyboardProtocol),
  resolveInputTokenEvent: manualInputState.resolveInputTokenEvent,
}));

import { createNodeInputRuntime } from './node-input-runtime.ts';

describe('node input runtime', () => {
  const stdin = process.stdin as NodeJS.ReadStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (value: boolean) => void;
  };
  const originalIsTTY = stdin.isTTY;
  const originalIsRaw = stdin.isRaw;
  const originalSetRawMode = stdin.setRawMode;
  const originalResume = stdin.resume.bind(stdin);

  beforeEach(() => {
    manualInputState.stopKittyKeyboardProtocol.mockReset();
    manualInputState.resolveInputTokenEvent.mockClear();
    stdin.isTTY = true;
    stdin.isRaw = false;
    stdin.setRawMode = vi.fn();
    stdin.resume = vi.fn() as typeof stdin.resume;
  });

  afterEach(() => {
    stdin.removeAllListeners('keypress');
    stdin.removeAllListeners('data');
    stdin.isTTY = originalIsTTY;
    stdin.isRaw = originalIsRaw;
    stdin.setRawMode = originalSetRawMode;
    stdin.resume = originalResume;
    vi.restoreAllMocks();
  });

  test('manual mode captures lane, pause, interrupt, restart, and high-speed commands', () => {
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals,
      inputTokenToChannels: new Map([['z', ['11']]]),
    });

    runtime.start();
    process.stdin.emit('keypress', 'z', { name: 'z', sequence: 'z', ctrl: false, meta: false, shift: false });
    process.stdin.emit('keypress', ' ', { name: 'space', sequence: ' ', ctrl: false, meta: false, shift: false });
    process.stdin.emit('keypress', 'ALT_Z', {
      name: 'z',
      sequence: 'ALT_Z',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', undefined, {
      name: 'escape',
      sequence: '\u001b',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', undefined, {
      name: 'r',
      sequence: 'R',
      ctrl: false,
      meta: false,
      shift: true,
    });
    process.stdin.emit('keypress', undefined, {
      name: 'c',
      sequence: '\u0003',
      ctrl: true,
      meta: false,
      shift: false,
    });

    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    expect(stdin.resume).toHaveBeenCalled();
    expect(inputSignals.drainCommands()).toEqual([
      { kind: 'lane-input', tokens: ['z'] },
      { kind: 'toggle-pause' },
      { kind: 'high-speed', action: 'decrease' },
      { kind: 'interrupt', reason: 'escape' },
      { kind: 'interrupt', reason: 'restart' },
      { kind: 'interrupt', reason: 'ctrl-c' },
    ]);

    runtime.stop();
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(manualInputState.stopKittyKeyboardProtocol).toHaveBeenCalledTimes(1);
  });

  test('manual mode processes kitty protocol data and suppresses immediate legacy keypresses', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals,
      inputTokenToChannels: new Map([['z', ['11']]]),
    });

    runtime.start();
    process.stdin.emit('data', Buffer.from('KITTY'));
    process.stdin.emit('keypress', 'z', { name: 'z', sequence: 'z', ctrl: false, meta: false, shift: false });

    expect(inputSignals.drainCommands()).toEqual([
      {
        kind: 'kitty-state',
        pressTokens: ['z'],
        repeatTokens: ['x'],
        releaseTokens: ['c'],
      },
      { kind: 'lane-input', tokens: ['z'] },
    ]);

    vi.mocked(Date.now).mockReturnValue(1_100);
    process.stdin.emit('keypress', 'z', { name: 'z', sequence: 'z', ctrl: false, meta: false, shift: false });
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'lane-input', tokens: ['z'] }]);

    runtime.stop();
  });

  test('auto mode ignores raw kitty input and lane tokens but still handles pause and interrupts', () => {
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'auto',
      inputSignals,
      inputTokenToChannels: new Map([['z', ['11']]]),
    });

    runtime.start();
    process.stdin.emit('data', Buffer.from('KITTY'));
    process.stdin.emit('keypress', 'z', { name: 'z', sequence: 'z', ctrl: false, meta: false, shift: false });
    process.stdin.emit('keypress', ' ', { name: 'space', sequence: ' ', ctrl: false, meta: false, shift: false });
    process.stdin.emit('keypress', undefined, {
      name: 'escape',
      sequence: '\u001b',
      ctrl: false,
      meta: false,
      shift: false,
    });

    expect(inputSignals.drainCommands()).toEqual([
      { kind: 'toggle-pause' },
      { kind: 'interrupt', reason: 'escape' },
    ]);

    runtime.stop();
    expect(manualInputState.stopKittyKeyboardProtocol).not.toHaveBeenCalled();
  });

  test('supports meta-key fallback lane lookup and no-tty no-op lifecycle', () => {
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals,
      inputTokenToChannels: new Map([[',', ['12']]]),
    });

    runtime.start();
    process.stdin.emit('keypress', undefined, {
      name: 'comma',
      sequence: ',',
      ctrl: false,
      meta: true,
      shift: false,
    });
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'high-speed', action: 'increase' }]);

    runtime.stop();
    stdin.isTTY = false;
    const nonTtyRuntime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals: createPlayerInputSignalBus(),
      inputTokenToChannels: new Map(),
    });
    nonTtyRuntime.start();
    nonTtyRuntime.stop();
    expect(stdin.setRawMode).toHaveBeenCalledTimes(2);
  });
});
