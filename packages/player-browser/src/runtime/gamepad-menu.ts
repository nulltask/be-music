/**
 * A gamepad on the screens around the play (select, decide, result): each pad's buttons read as the control buttons a
 * keyboard's keys are (`session/controls/control-buttons.ts`): the seven keys, the turntable, START and SELECT, on the
 * play's own pad layouts (`web-input-runtime.ts`: the CS DualShock layout for a standard pad, the INFINITAS layout for
 * an IIDX controller). A screen then reads them by its skin family's key map, as it reads the keyboard's lane keys: LR2's
 * turntable down scrolls to the next bar and its white keys open, beatoraja's turntable up scrolls and its key 1 plays.
 *
 * A standard pad's D-pad is the first white key in the play. Around the play it is the arrow keys instead, as a pad's
 * D-pad moves a console's menus. START is the pad's Start (Options), SELECT its Back (Share / Create). An IIDX
 * controller's START and SELECT are E1 and E2 (buttons 9 and 10, beatoraja's default START and SELECT).
 *
 * The first pad is 1P, the second 2P, as in the play. A turntable held, or a D-pad direction, repeats as a held key
 * does, so a held turntable keeps the bar list moving.
 *
 * {@link stepGamepadMenu} is the deterministic core: it takes the pads' state and the time and returns the presses and
 * releases. {@link createGamepadMenuInput} polls `navigator.getGamepads()` with it.
 */

import { isIIDXArcadeGamepad, sampleArcadeScratch, type ArcadeScratchState } from './arcade-gamepad.ts';
import { CS_GAMEPAD_BUTTON_CHANNELS } from './web-input-runtime.ts';

/** A pad's side: the first pad is 1P, the second 2P. */
export type GamepadMenuSide = '1P' | '2P';

/** What a pad button is on a menu: a side's key, turntable key, START or SELECT, or an arrow key. */
export type GamepadMenuButton =
  | 'key1'
  | 'key2'
  | 'key3'
  | 'key4'
  | 'key5'
  | 'key6'
  | 'key7'
  | 'scratch-cw'
  | 'scratch-ccw'
  | 'start'
  | 'select'
  | 'up'
  | 'down'
  | 'left'
  | 'right';

/** The arrow key a D-pad direction is (`KeyboardEvent.code`). */
export const GAMEPAD_MENU_ARROW_CODES: Readonly<Partial<Record<GamepadMenuButton, string>>> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

/** The key a play's lane channel is (the suffix of `11`–`19`). */
const CHANNEL_BUTTONS: Readonly<Record<string, GamepadMenuButton>> = {
  '1': 'key1',
  '2': 'key2',
  '3': 'key3',
  '4': 'key4',
  '5': 'key5',
  '8': 'key6',
  '9': 'key7',
};

function standardMenuButtons(): Readonly<Record<number, GamepadMenuButton>> {
  const buttons: Record<number, GamepadMenuButton> = {};
  for (const [index, channel] of Object.entries(CS_GAMEPAD_BUTTON_CHANNELS)) {
    const button = CHANNEL_BUTTONS[channel];
    // The D-pad (12) is the arrows on a menu; L2 / R2 (the turntable) are set below.
    if (button !== undefined && Number(index) < 12) buttons[Number(index)] = button;
  }
  return {
    ...buttons,
    // The play's turntable: L2 turns it clockwise, R2 counter-clockwise.
    6: 'scratch-cw',
    7: 'scratch-ccw',
    8: 'select',
    9: 'start',
    12: 'up',
    13: 'down',
    14: 'left',
    15: 'right',
  };
}

/** A standard pad's buttons (Web Gamepad standard indices) on a menu: the CS layout, its D-pad the arrows. */
export const STANDARD_GAMEPAD_MENU_BUTTONS: Readonly<Record<number, GamepadMenuButton>> = standardMenuButtons();

/** An IIDX controller's buttons on a menu: keys 1–7, E1 START and E2 SELECT; its turntable is the X axis. */
export const IIDX_GAMEPAD_MENU_BUTTONS: Readonly<Record<number, GamepadMenuButton>> = {
  0: 'key1',
  1: 'key2',
  2: 'key3',
  3: 'key4',
  4: 'key5',
  5: 'key6',
  6: 'key7',
  8: 'start',
  9: 'select',
};

/** The buttons that repeat while held: the turntable and the D-pad, which move a list. */
const REPEATING: ReadonlySet<GamepadMenuButton> = new Set(['scratch-cw', 'scratch-ccw', 'up', 'down', 'left', 'right']);

/** How long a repeating button is held before it repeats, and how often it repeats then, in ms. */
export const GAMEPAD_MENU_REPEAT = { delayMs: 300, intervalMs: 60 } as const;

const pressThreshold = 0.5;

/** A pad button going down (a repeat too) or up. */
export interface GamepadMenuEvent {
  readonly type: 'down' | 'up';
  readonly side: GamepadMenuSide;
  readonly button: GamepadMenuButton;
  readonly repeat: boolean;
  readonly timeStamp: number;
}

/** The pad state {@link stepGamepadMenu} keeps between samples. */
export interface GamepadMenuState {
  /** The pad index each side reads. */
  readonly slots: readonly [number | undefined, number | undefined];
  /** Each held button (`<side>:<button>`) with when it next repeats. */
  readonly held: ReadonlyMap<
    string,
    { readonly side: GamepadMenuSide; readonly button: GamepadMenuButton; readonly nextRepeatAt: number }
  >;
  readonly scratch: ReadonlyMap<number, ArcadeScratchState>;
}

export const INITIAL_GAMEPAD_MENU_STATE: GamepadMenuState = {
  slots: [undefined, undefined],
  held: new Map(),
  scratch: new Map(),
};

/** A pad as {@link stepGamepadMenu} reads it. */
export type GamepadMenuPad = Pick<Gamepad, 'index' | 'id' | 'mapping' | 'axes' | 'buttons'> & {
  readonly connected?: boolean;
};

/** Whether a pad has a layout the play reads: a standard pad or an IIDX controller. */
function isMenuPad(pad: GamepadMenuPad): boolean {
  return pad.connected !== false && (pad.mapping === 'standard' || isIIDXArcadeGamepad(pad));
}

/** The menu buttons a pad holds; an IIDX controller's turntable from its scratch state. */
export function gamepadMenuButtonsDown(pad: GamepadMenuPad, scratch?: ArcadeScratchState): GamepadMenuButton[] {
  const arcade = isIIDXArcadeGamepad(pad);
  const layout = arcade ? IIDX_GAMEPAD_MENU_BUTTONS : STANDARD_GAMEPAD_MENU_BUTTONS;
  const down: GamepadMenuButton[] = [];
  for (const [index, button] of Object.entries(layout)) {
    const state = pad.buttons[Number(index)];
    if (state !== undefined && (state.pressed || state.value >= pressThreshold) && !down.includes(button)) {
      down.push(button);
    }
  }
  if (arcade && scratch?.direction !== undefined) down.push(scratch.direction === 'up' ? 'scratch-cw' : 'scratch-ccw');
  return down;
}

/**
 * One sample of the pads at `nowMs`: which buttons went down, came up or repeat since `state`. A pad that went away
 * lets its buttons go. Deterministic: it reads nothing but its inputs.
 */
export function stepGamepadMenu(
  state: GamepadMenuState,
  pads: readonly (GamepadMenuPad | null | undefined)[],
  nowMs: number,
): { readonly state: GamepadMenuState; readonly events: readonly GamepadMenuEvent[] } {
  const present = pads.filter((pad): pad is GamepadMenuPad => pad != null && isMenuPad(pad));
  const slots: [number | undefined, number | undefined] = [...state.slots];
  for (const [slot, index] of slots.entries()) {
    if (!present.some((pad) => pad.index === index)) slots[slot] = undefined;
  }
  for (const pad of present) {
    const free = slots.indexOf(undefined);
    if (free !== -1 && !slots.includes(pad.index)) slots[free] = pad.index;
  }
  const scratch = new Map<number, ArcadeScratchState>();
  const down = new Map<string, { side: GamepadMenuSide; button: GamepadMenuButton }>();
  for (const [slot, index] of slots.entries()) {
    const pad = present.find((candidate) => candidate.index === index);
    if (pad === undefined) continue;
    const side: GamepadMenuSide = slot === 0 ? '1P' : '2P';
    let sample: ArcadeScratchState | undefined;
    if (isIIDXArcadeGamepad(pad)) {
      sample = sampleArcadeScratch(pad.axes[0]!, nowMs, state.scratch.get(pad.index));
      if (sample !== undefined) scratch.set(pad.index, sample);
    }
    for (const button of gamepadMenuButtonsDown(pad, sample)) down.set(`${side}:${button}`, { side, button });
  }
  const events: GamepadMenuEvent[] = [];
  const held = new Map<string, { side: GamepadMenuSide; button: GamepadMenuButton; nextRepeatAt: number }>();
  for (const [key, previous] of state.held) {
    if (down.has(key)) continue;
    events.push({ type: 'up', side: previous.side, button: previous.button, repeat: false, timeStamp: nowMs });
  }
  for (const [key, { side, button }] of down) {
    const previous = state.held.get(key);
    if (previous === undefined) {
      events.push({ type: 'down', side, button, repeat: false, timeStamp: nowMs });
      held.set(key, { side, button, nextRepeatAt: nowMs + GAMEPAD_MENU_REPEAT.delayMs });
      continue;
    }
    let nextRepeatAt = previous.nextRepeatAt;
    if (REPEATING.has(button) && nowMs >= nextRepeatAt) {
      events.push({ type: 'down', side, button, repeat: true, timeStamp: nowMs });
      nextRepeatAt = Math.max(nextRepeatAt + GAMEPAD_MENU_REPEAT.intervalMs, nowMs);
    }
    held.set(key, { side, button, nextRepeatAt });
  }
  return { state: { slots, held, scratch }, events };
}

/** What {@link createGamepadMenuInput} reads: the pads and the clock. Browser globals by default. */
export interface GamepadMenuInputOptions {
  readonly getGamepads?: () => readonly (GamepadMenuPad | null)[];
  readonly now?: () => number;
  /** How often the pads are sampled, in ms. */
  readonly intervalMs?: number;
}

/** A source of pad presses and releases on a menu. */
export interface GamepadMenuInput {
  start(listener: (event: GamepadMenuEvent) => void): void;
  /** Stops sampling and forgets the held buttons without releasing them (the screen left). */
  stop(): void;
}

/** Samples the pads every `intervalMs` while started; nothing in a runtime without the Gamepad API. */
export function createGamepadMenuInput(options: GamepadMenuInputOptions = {}): GamepadMenuInput {
  const getGamepads =
    options.getGamepads ??
    ((): readonly (Gamepad | null)[] =>
      typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
        ? Array.from(navigator.getGamepads())
        : []);
  const now = options.now ?? (() => performance.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  let state = INITIAL_GAMEPAD_MENU_STATE;
  return {
    start: (listener) => {
      if (timer !== undefined) return;
      if (options.getGamepads === undefined && (typeof navigator === 'undefined' || !('getGamepads' in navigator))) {
        return;
      }
      const sample = (): readonly GamepadMenuEvent[] => {
        let pads: readonly (GamepadMenuPad | null)[];
        try {
          pads = getGamepads();
        } catch {
          return [];
        }
        const next = stepGamepadMenu(state, pads, now());
        state = next.state;
        return next.events;
      };
      // A button already held as the screen comes (the one that left the screen before) is not a press on it, and
      // does not repeat.
      sample();
      state = {
        ...state,
        held: new Map([...state.held].map(([key, value]) => [key, { ...value, nextRepeatAt: Infinity }])),
      };
      timer = setInterval(() => {
        for (const event of sample()) listener(event);
      }, options.intervalMs ?? 8);
    },
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      state = INITIAL_GAMEPAD_MENU_STATE;
    },
  };
}
