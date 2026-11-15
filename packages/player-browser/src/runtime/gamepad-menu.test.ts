import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  createGamepadMenuInput,
  GAMEPAD_MENU_REPEAT,
  gamepadMenuButtonsDown,
  IIDX_GAMEPAD_MENU_BUTTONS,
  INITIAL_GAMEPAD_MENU_STATE,
  STANDARD_GAMEPAD_MENU_BUTTONS,
  stepGamepadMenu,
  type GamepadMenuEvent,
  type GamepadMenuPad,
} from './gamepad-menu.ts';

afterEach(() => {
  vi.useRealTimers();
});

function standardPad(index: number, pressed: readonly number[] = []): GamepadMenuPad {
  const buttons = Array.from({ length: 17 }, (_, button) => ({
    pressed: pressed.includes(button),
    touched: false,
    value: pressed.includes(button) ? 1 : 0,
  }));
  return { index, id: `Pad ${index}`, mapping: 'standard', axes: [0, 0, 0, 0], buttons };
}

function arcadePad(index: number, pressed: readonly number[], axis = 0): GamepadMenuPad {
  const buttons = Array.from({ length: 13 }, (_, button) => ({
    pressed: pressed.includes(button),
    touched: false,
    value: pressed.includes(button) ? 1 : 0,
  }));
  return { index, id: '1ccf-8048-Gamepad', mapping: '', axes: [axis, 0], buttons };
}

const summary = (events: readonly GamepadMenuEvent[]): string[] =>
  events.map((event) => `${event.type}${event.repeat ? '*' : ''} ${event.side}-${event.button}`);

describe('menu button layouts', () => {
  test('a standard pad is the CS layout, its D-pad the arrows, Start / Back START / SELECT', () => {
    expect(STANDARD_GAMEPAD_MENU_BUTTONS).toEqual({
      0: 'key5', // Cross
      1: 'key7', // Circle
      2: 'key3', // Square
      3: 'key6', // Triangle
      4: 'key2', // L1
      5: 'key4', // R1
      6: 'scratch-cw', // L2
      7: 'scratch-ccw', // R2
      8: 'select', // Back / Share
      9: 'start', // Start / Options
      12: 'up',
      13: 'down',
      14: 'left',
      15: 'right',
    });
  });

  test('an IIDX controller has keys 1–7 on buttons 1–7 and START / SELECT on E1 / E2', () => {
    expect(IIDX_GAMEPAD_MENU_BUTTONS).toEqual({
      0: 'key1',
      1: 'key2',
      2: 'key3',
      3: 'key4',
      4: 'key5',
      5: 'key6',
      6: 'key7',
      8: 'start',
      9: 'select',
    });
  });

  test('reads an analog trigger past half as held', () => {
    const pad = standardPad(0);
    const buttons = pad.buttons.map((button, index) =>
      index === 7 ? { pressed: false, touched: true, value: 0.6 } : button,
    );
    expect(gamepadMenuButtonsDown({ ...pad, buttons })).toEqual(['scratch-ccw']);
  });

  test("reads an IIDX controller's turntable from its scratch direction", () => {
    const pad = arcadePad(0, [0]);
    expect(gamepadMenuButtonsDown(pad, { tick: 10, movedAt: 0, direction: 'up' })).toEqual(['key1', 'scratch-cw']);
    expect(gamepadMenuButtonsDown(pad, { tick: 10, movedAt: 0, direction: 'down' })).toEqual(['key1', 'scratch-ccw']);
    expect(gamepadMenuButtonsDown(pad, { tick: 10, movedAt: 0 })).toEqual(['key1']);
  });
});

describe('stepGamepadMenu', () => {
  test('reports presses and releases, the first pad as 1P and the second as 2P', () => {
    let step = stepGamepadMenu(INITIAL_GAMEPAD_MENU_STATE, [standardPad(0, [9]), standardPad(1, [0])], 0);
    expect(summary(step.events)).toEqual(['down 1P-start', 'down 2P-key5']);
    step = stepGamepadMenu(step.state, [standardPad(0, [9]), standardPad(1)], 10);
    expect(summary(step.events)).toEqual(['up 2P-key5']);
    expect(step.events[0]?.timeStamp).toBe(10);
  });

  test('ignores pads without a layout the play reads', () => {
    const pad = { ...standardPad(0, [0]), mapping: '' as const };
    expect(stepGamepadMenu(INITIAL_GAMEPAD_MENU_STATE, [pad, null], 0).events).toEqual([]);
  });

  test('releases the buttons of a pad that went away and gives its side to the next pad', () => {
    let step = stepGamepadMenu(INITIAL_GAMEPAD_MENU_STATE, [standardPad(0, [2])], 0);
    step = stepGamepadMenu(step.state, [null, standardPad(1, [1])], 10);
    expect(summary(step.events)).toEqual(['up 1P-key3', 'down 1P-key7']);
  });

  test('repeats a held turntable or D-pad, not a key', () => {
    let step = stepGamepadMenu(INITIAL_GAMEPAD_MENU_STATE, [standardPad(0, [7, 13, 0])], 0);
    expect(summary(step.events)).toEqual(['down 1P-key5', 'down 1P-scratch-ccw', 'down 1P-down']);
    step = stepGamepadMenu(step.state, [standardPad(0, [7, 13, 0])], GAMEPAD_MENU_REPEAT.delayMs - 1);
    expect(step.events).toEqual([]);
    step = stepGamepadMenu(step.state, [standardPad(0, [7, 13, 0])], GAMEPAD_MENU_REPEAT.delayMs);
    expect(summary(step.events)).toEqual(['down* 1P-scratch-ccw', 'down* 1P-down']);
    step = stepGamepadMenu(
      step.state,
      [standardPad(0, [7, 13, 0])],
      GAMEPAD_MENU_REPEAT.delayMs + GAMEPAD_MENU_REPEAT.intervalMs,
    );
    expect(summary(step.events)).toEqual(['down* 1P-scratch-ccw', 'down* 1P-down']);
  });

  test("turns an IIDX controller's spinning turntable into a held turntable key", () => {
    const axis = (tick: number): number => tick / 127.5 - 1;
    let step = stepGamepadMenu(INITIAL_GAMEPAD_MENU_STATE, [arcadePad(0, [], axis(100))], 0);
    expect(step.events).toEqual([]);
    step = stepGamepadMenu(step.state, [arcadePad(0, [], axis(104))], 4);
    expect(summary(step.events)).toEqual(['down 1P-scratch-cw']);
    step = stepGamepadMenu(step.state, [arcadePad(0, [], axis(104))], 200);
    expect(summary(step.events)).toEqual(['up 1P-scratch-cw']);
    step = stepGamepadMenu(step.state, [arcadePad(0, [8], axis(100))], 210);
    expect(summary(step.events)).toEqual(['down 1P-start', 'down 1P-scratch-ccw']);
  });
});

describe('createGamepadMenuInput', () => {
  test('samples the pads while started, and a button held as it starts is no press', () => {
    vi.useFakeTimers();
    let pads = [standardPad(0, [0])];
    let nowMs = 0;
    const input = createGamepadMenuInput({ getGamepads: () => pads, now: () => nowMs, intervalMs: 5 });
    const events: GamepadMenuEvent[] = [];
    input.start((event) => events.push(event));
    nowMs = 1000;
    vi.advanceTimersByTime(5);
    expect(events).toEqual([]);
    pads = [standardPad(0, [9])];
    vi.advanceTimersByTime(5);
    expect(summary(events)).toEqual(['up 1P-key5', 'down 1P-start']);
    input.stop();
    pads = [standardPad(0)];
    vi.advanceTimersByTime(20);
    expect(events).toHaveLength(2);
  });

  test('does nothing when getGamepads throws', () => {
    vi.useFakeTimers();
    const input = createGamepadMenuInput({
      getGamepads: () => {
        throw new Error('blocked');
      },
      intervalMs: 5,
    });
    const listener = vi.fn();
    input.start(listener);
    vi.advanceTimersByTime(20);
    expect(listener).not.toHaveBeenCalled();
    input.stop();
  });
});
