import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPlayerInputSignalBus } from '../core/input-signal-bus.ts';

const manualInputState = vi.hoisted(() => ({
  stopStatefulKeyboardProtocol: vi.fn(),
  resolveInputTokenEvent: vi.fn(
    (chunk: string, key?: Partial<{ name: string; sequence: string; ctrl: boolean; meta: boolean; shift: boolean }>) =>
      ({
        tokens:
          chunk === 'z'
            ? ['z']
            : chunk === ' '
              ? ['space']
              : chunk === 'ALT_Z' || (key?.meta && key.name === 'z')
                ? ['alt+z']
                : key?.meta && key.name === 'comma'
                  ? ['alt+,']
                : chunk === 'KITTY'
                  ? ['z']
                  : chunk === 'WIN32'
                    ? ['z']
                    : chunk === '\u001b[16;42;0;1;16;1_'
                      ? ['shift-left', 'shift']
                      : key?.sequence === '\u001b' || key?.name === 'escape'
                        ? ['escape']
                        : key?.sequence === '\u0003' || key?.ctrl
                          ? ['ctrl+c']
                          : key?.name === 'r' && key?.shift
                            ? ['shift+r']
                            : [],
        repeatTokens: chunk === 'KITTY' || chunk === 'WIN32' ? ['x'] : [],
        releaseTokens:
          chunk === 'KITTY' || chunk === 'WIN32'
            ? ['c']
            : chunk === '\u001b[16;42;0;0;0;1_'
              ? ['shift-left', 'shift']
              : [],
        protocol:
          chunk === 'KITTY'
            ? 'kitty'
            : chunk === 'WIN32' || chunk === '\u001b[16;42;0;1;16;1_' || chunk === '\u001b[16;42;0;0;0;1_'
              ? 'win32'
              : 'legacy',
        kittyProtocolEvent: chunk === 'KITTY',
      }) as {
        tokens: string[];
        repeatTokens: string[];
        releaseTokens: string[];
        protocol: 'legacy' | 'kitty' | 'win32';
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
  beginStatefulKeyboardProtocolOptIn: vi.fn(() => manualInputState.stopStatefulKeyboardProtocol),
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
    manualInputState.stopStatefulKeyboardProtocol.mockReset();
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
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
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
    expect(manualInputState.stopStatefulKeyboardProtocol).toHaveBeenCalledTimes(1);
    platformSpy.mockRestore();
  });

  test('manual mode resets raw mode before restarting capture on Windows', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    stdin.isRaw = true;
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals,
      inputTokenToChannels: new Map(),
    });

    runtime.start();

    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, false);
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(2, true);

    runtime.stop();
    platformSpy.mockRestore();
  });

  test('manual mode processes kitty protocol data and suppresses immediate legacy keypresses', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
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
    platformSpy.mockRestore();
  });

  test('manual mode processes win32 protocol data and suppresses immediate legacy keypresses', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals,
      inputTokenToChannels: new Map([['z', ['11']]]),
    });

    runtime.start();
    process.stdin.emit('data', Buffer.from('WIN32'));
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

    vi.mocked(Date.now).mockReturnValue(2_100);
    process.stdin.emit('keypress', 'z', { name: 'z', sequence: 'z', ctrl: false, meta: false, shift: false });
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'lane-input', tokens: ['z'] }]);

    runtime.stop();
    platformSpy.mockRestore();
  });

  test('manual mode on Windows falls back to keypress events when raw data is unavailable', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals,
      inputTokenToChannels: new Map([['z', ['11']]]),
    });

    runtime.start();
    process.stdin.emit('keypress', 'z', { name: 'z', sequence: 'z', ctrl: false, meta: false, shift: false });
    expect(inputSignals.drainCommands()).toEqual([{ kind: 'lane-input', tokens: ['z'] }]);

    runtime.stop();
    platformSpy.mockRestore();
  });

  test('manual mode on Windows assembles protocol keypress fragments into a win32 event', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    let nowMs = 3_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs++);
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals,
      inputTokenToChannels: new Map(),
    });

    runtime.start();
    process.stdin.emit('keypress', undefined, {
      name: 'undefined',
      sequence: '\u001b[16;42',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', ';', {
      name: undefined,
      sequence: ';',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', '0', {
      name: '0',
      sequence: '0',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', ';', {
      name: undefined,
      sequence: ';',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', '1', {
      name: '1',
      sequence: '1',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', ';16', {
      name: undefined,
      sequence: ';16',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', ';1_', {
      name: undefined,
      sequence: ';1_',
      ctrl: false,
      meta: false,
      shift: false,
    });

    expect(inputSignals.drainCommands()).toEqual([
      {
        kind: 'kitty-state',
        pressTokens: ['shift-left', 'shift'],
        repeatTokens: [],
        releaseTokens: [],
      },
      { kind: 'lane-input', tokens: ['shift-left', 'shift'] },
    ]);

    runtime.stop();
    platformSpy.mockRestore();
  });

  test('manual mode on Windows extracts concatenated win32 protocol sequences from keypress fragments', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    let nowMs = 4_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs++);
    const inputSignals = createPlayerInputSignalBus();
    const runtime = createNodeInputRuntime({
      mode: 'manual',
      inputSignals,
      inputTokenToChannels: new Map(),
    });

    runtime.start();
    process.stdin.emit('keypress', undefined, {
      name: 'undefined',
      sequence: '\u001b[16;42',
      ctrl: false,
      meta: false,
      shift: false,
    });
    process.stdin.emit('keypress', ';0;1;16;1_\u001b[16;42;0;0;0;1_', {
      name: undefined,
      sequence: ';0;1;16;1_\u001b[16;42;0;0;0;1_',
      ctrl: false,
      meta: false,
      shift: false,
    });

    expect(inputSignals.drainCommands()).toEqual([
      {
        kind: 'kitty-state',
        pressTokens: ['shift-left', 'shift'],
        repeatTokens: [],
        releaseTokens: [],
      },
      { kind: 'lane-input', tokens: ['shift-left', 'shift'] },
      {
        kind: 'kitty-state',
        pressTokens: [],
        repeatTokens: [],
        releaseTokens: ['shift-left', 'shift'],
      },
    ]);

    runtime.stop();
    platformSpy.mockRestore();
  });

  test('auto mode ignores raw kitty input and lane tokens but still handles pause and interrupts', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
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
    expect(manualInputState.stopStatefulKeyboardProtocol).not.toHaveBeenCalled();
    platformSpy.mockRestore();
  });

  test('supports meta-key fallback lane lookup and no-tty no-op lifecycle', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
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
    platformSpy.mockRestore();
  });
});
