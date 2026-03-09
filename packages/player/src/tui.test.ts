import { afterEach, describe, expect, test, vi } from 'vitest';
import { formatMeasureSignature, resolveAnimatedHighSpeedValue, resolveVisibleBeatsForTuiGrid } from './tui.ts';
import { PlayerTui } from './tui.ts';
import { estimateBgaAnsiDisplaySize, resolveLaneWidths } from './tui/layout.ts';

const STDOUT_IS_TTY_DESCRIPTOR = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
const STDIN_IS_TTY_DESCRIPTOR = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const STDOUT_COLUMNS_DESCRIPTOR = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
const STDOUT_ROWS_DESCRIPTOR = Object.getOwnPropertyDescriptor(process.stdout, 'rows');

afterEach(() => {
  restoreDescriptor(process.stdout, 'isTTY', STDOUT_IS_TTY_DESCRIPTOR);
  restoreDescriptor(process.stdin, 'isTTY', STDIN_IS_TTY_DESCRIPTOR);
  restoreDescriptor(process.stdout, 'columns', STDOUT_COLUMNS_DESCRIPTOR);
  restoreDescriptor(process.stdout, 'rows', STDOUT_ROWS_DESCRIPTOR);
  vi.restoreAllMocks();
});

describe('player tui', () => {
  test('tui: keeps rows-per-beat constant across different terminal heights', () => {
    const shortRows = 14;
    const tallRows = 28;
    const shortWindowBeats = resolveVisibleBeatsForTuiGrid(shortRows, 1);
    const tallWindowBeats = resolveVisibleBeatsForTuiGrid(tallRows, 1);

    const shortRowsPerBeat = shortRows / shortWindowBeats;
    const tallRowsPerBeat = tallRows / tallWindowBeats;
    expect(shortRowsPerBeat).toBeCloseTo(tallRowsPerBeat, 9);
  });

  test('tui: makes visible beat range smaller as HIGH-SPEED increases', () => {
    const rows = 24;
    const normal = resolveVisibleBeatsForTuiGrid(rows, 1);
    const fast = resolveVisibleBeatsForTuiGrid(rows, 2);
    expect(fast).toBeCloseTo(normal / 2, 9);
  });

  test('tui: clamps invalid HIGH-SPEED to supported range', () => {
    const rows = 24;
    const belowMin = resolveVisibleBeatsForTuiGrid(rows, 0.1);
    const atMin = resolveVisibleBeatsForTuiGrid(rows, 0.5);
    const aboveMax = resolveVisibleBeatsForTuiGrid(rows, 100);
    const atMax = resolveVisibleBeatsForTuiGrid(rows, 10);
    expect(belowMin).toBeCloseTo(atMin, 9);
    expect(aboveMax).toBeCloseTo(atMax, 9);
  });

  test('tui: interpolates HIGH-SPEED changes over animation duration', () => {
    expect(resolveAnimatedHighSpeedValue(1, 3, 0, 180)).toBeCloseTo(1, 9);
    expect(resolveAnimatedHighSpeedValue(1, 3, 90, 180)).toBeCloseTo(2, 9);
    expect(resolveAnimatedHighSpeedValue(1, 3, 180, 180)).toBeCloseTo(3, 9);
  });

  test('tui: clamps interpolated HIGH-SPEED endpoints to supported range', () => {
    expect(resolveAnimatedHighSpeedValue(0.1, 12, 90, 180)).toBeCloseTo(5.25, 9);
    expect(resolveAnimatedHighSpeedValue(1, 3, 90, 0)).toBeCloseTo(3, 9);
  });

  test('tui: formats current measure meter as a fraction', () => {
    expect(formatMeasureSignature(undefined)).toBe('4/4');
    expect(formatMeasureSignature(0.75)).toBe('3/4');
    expect(formatMeasureSignature(1.5)).toBe('6/4');
    expect(formatMeasureSignature(1 / 3)).toBe('4/12');
  });

  test('tui: falls back to decimal meter when fraction conversion is not stable', () => {
    expect(formatMeasureSignature(0.123456789)).toBe('0.493827/4');
  });

  test('tui: can use explicit tty support overrides for worker rendering', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });

    const tui = new PlayerTui({
      mode: 'MANUAL',
      laneDisplayMode: '7 KEY',
      title: 'Test Song',
      lanes: [
        { channel: '16', key: 'A', isScratch: true },
        { channel: '11', key: 'S' },
        { channel: '12', key: 'D' },
      ],
      speed: 1,
      highSpeed: 1,
      judgeWindowMs: 16.67,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });

    expect(tui.isSupported()).toBe(true);
  });

  test('tui: clears and relayouts the frame after terminal resize', () => {
    mockTerminal({ columns: 120, rows: 32 });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const tui = new PlayerTui({
      mode: 'MANUAL',
      laneDisplayMode: '7 KEY',
      title: 'Test Song',
      lanes: [
        { channel: '16', key: 'A', isScratch: true },
        { channel: '11', key: 'S' },
        { channel: '12', key: 'D' },
      ],
      speed: 1,
      highSpeed: 1,
      judgeWindowMs: 16.67,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });
    const frame: Parameters<PlayerTui['render']>[0] = {
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds: 120,
      summary: {
        total: 100,
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

    tui.start();
    writeSpy.mockClear();

    tui.render(frame);
    const initialRender = writeSpy.mock.calls.at(-1)?.[0];
    expect(initialRender).toContain('\u001b[H');
    expect(initialRender).not.toContain('\u001b[2J\u001b[H');

    tui.setTerminalSize(80, 24);
    tui.render(frame);

    const resizedRender = writeSpy.mock.calls.at(-1)?.[0];
    expect(resizedRender).toContain('\u001b[2J\u001b[H');

    tui.stop();
  });

  test('tui: estimates BGA size from the actual lane block layout', () => {
    const laneWidths = resolveLaneWidths([
      { isScratch: true },
      { isScratch: false },
      { isScratch: false },
      { isScratch: false },
      { isScratch: false },
      { isScratch: false },
      { isScratch: false },
      { isScratch: false },
    ]);

    expect(
      estimateBgaAnsiDisplaySize({
        laneWidths,
        splitAfterIndex: -1,
        columns: 120,
        rows: 32,
        showLaneChannels: true,
        hasRandomPatternSummary: true,
        hasAudioDebugLine: true,
      }),
    ).toEqual({
      width: 81,
      height: 15,
    });
  });

  test('tui: renders groove gauge line when gauge summary is present', () => {
    mockTerminal({ columns: 120, rows: 32 });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const tui = new PlayerTui({
      mode: 'MANUAL',
      laneDisplayMode: '7 KEY',
      title: 'Test Song',
      lanes: [
        { channel: '16', key: 'A', isScratch: true },
        { channel: '11', key: 'S' },
        { channel: '12', key: 'D' },
      ],
      speed: 1,
      highSpeed: 1,
      judgeWindowMs: 16.67,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });

    tui.start();
    tui.render({
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds: 120,
      summary: {
        total: 100,
        perfect: 0,
        fast: 0,
        slow: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        exScore: 0,
        score: 0,
        gauge: {
          current: 64,
          max: 100,
          clearThreshold: 80,
          initial: 20,
          effectiveTotal: 160,
          cleared: false,
        },
      },
      notes: [],
    });

    const renderOutput = String(writeSpy.mock.calls.at(-1)?.[0] ?? '');
    expect(renderOutput).toContain(' 64%');

    tui.stop();
  });

  test('tui: keeps rendered lines within terminal height when optional rows are enabled', () => {
    mockTerminal({ columns: 120, rows: 32 });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const tui = new PlayerTui({
      mode: 'MANUAL',
      laneDisplayMode: '7 KEY',
      title: 'Test Song',
      lanes: [
        { channel: '16', key: 'A', isScratch: true },
        { channel: '11', key: 'S' },
        { channel: '12', key: 'D' },
      ],
      speed: 1,
      highSpeed: 1,
      judgeWindowMs: 16.67,
      showLaneChannels: true,
      randomPatternSummary: 'RANDOM 42: 1 -> 3 -> 2',
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });
    const frame: Parameters<PlayerTui['render']>[0] = {
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds: 120,
      summary: {
        total: 100,
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
      activeAudioFiles: [],
      activeAudioVoiceCount: 0,
    };

    tui.start();
    writeSpy.mockClear();

    tui.render(frame);

    const renderOutput = String(writeSpy.mock.calls.at(-1)?.[0] ?? '');
    const visibleFrame = renderOutput.startsWith('\u001b[2J\u001b[H')
      ? renderOutput.slice('\u001b[2J\u001b[H'.length)
      : renderOutput.startsWith('\u001b[H')
        ? renderOutput.slice('\u001b[H'.length)
        : renderOutput;
    expect(visibleFrame.split('\n')).toHaveLength(32);

    tui.stop();
  });
});

function mockTerminal({ columns, rows }: { columns: number; rows: number }): void {
  Object.defineProperty(process.stdout, 'columns', {
    configurable: true,
    value: columns,
  });
  Object.defineProperty(process.stdout, 'rows', {
    configurable: true,
    value: rows,
  });
}

function restoreDescriptor(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }
  Reflect.deleteProperty(target, key);
}
