// What Help's Keyboard tab lists for the gamepads: which button of a standard pad (the CS DualShock layout) and of an
// IIDX controller is which key, turntable key, START or SELECT. In a play a standard pad's D-pad is key 1; on the other
// screens it is the arrow keys, and START / SELECT are the pad's Start and Back.
import {
  IIDX_GAMEPAD_MENU_BUTTONS,
  STANDARD_GAMEPAD_MENU_BUTTONS,
  type ControlButton,
  type ControlScreen,
  type GamepadMenuButton,
} from '@be-music/player-browser/host';
import { controlButtonName, type KeyboardGuideLang, type KeyboardGuideRow } from './keyboard-guide.ts';

/** The two lists: a standard pad's buttons and an IIDX controller's. */
export interface GamepadGuide {
  readonly standard: readonly KeyboardGuideRow[];
  readonly iidx: readonly KeyboardGuideRow[];
}

/** A standard pad's buttons (Web Gamepad standard indices) by their Xbox and PlayStation names. */
const STANDARD_NAMES: Readonly<Record<number, string>> = {
  0: 'A / ✕',
  1: 'B / ○',
  2: 'X / □',
  3: 'Y / △',
  4: 'LB / L1',
  5: 'RB / R1',
  6: 'LT / L2',
  7: 'RT / R2',
  8: 'Back / Share',
  9: 'Start / Options',
  12: 'D-pad ↑',
  13: 'D-pad ↓',
  14: 'D-pad ←',
  15: 'D-pad →',
};

const COPY = {
  en: {
    iidxButton: (n: number) => `Button ${n}`,
    turntable: 'Turntable',
    arrow: (arrow: string) => `${arrow} key`,
    dpad: 'D-pad',
  },
  ja: {
    iidxButton: (n: number) => `ボタン ${n}`,
    turntable: 'ターンテーブル',
    arrow: (arrow: string) => `${arrow} キー`,
    dpad: '十字キー',
  },
} as const;

const ARROWS: Partial<Record<GamepadMenuButton, string>> = { up: '↑', down: '↓', left: '←', right: '→' };

/** The order the rows list what a button is in. */
const ORDER: readonly GamepadMenuButton[] = [
  'key1',
  'key2',
  'key3',
  'key4',
  'key5',
  'key6',
  'key7',
  'scratch-cw',
  'scratch-ccw',
  'start',
  'select',
  'up',
  'down',
  'left',
  'right',
];

/** How what a 1P pad button is reads: a control button by its name, a D-pad direction as its arrow key. */
function buttonName(button: GamepadMenuButton, lang: KeyboardGuideLang): string {
  const arrow = ARROWS[button];
  return arrow !== undefined ? COPY[lang].arrow(arrow) : controlButtonName(`1P-${button}` as ControlButton, lang);
}

function rows(
  layout: Readonly<Record<number, GamepadMenuButton>>,
  name: (index: number) => string,
  lang: KeyboardGuideLang,
  extra: Partial<Record<GamepadMenuButton, readonly string[]>> = {},
): KeyboardGuideRow[] {
  const byButton = new Map<GamepadMenuButton, string[]>();
  for (const [index, button] of Object.entries(layout)) {
    const list = byButton.get(button) ?? [];
    list.push(name(Number(index)));
    byButton.set(button, list);
  }
  for (const [button, names] of Object.entries(extra) as [GamepadMenuButton, readonly string[]][]) {
    byButton.set(button, [...(byButton.get(button) ?? []), ...names]);
  }
  return ORDER.flatMap((button) => {
    const keys = byButton.get(button);
    return keys === undefined ? [] : [{ id: `gamepad-${button}`, name: buttonName(button, lang), keys, codes: [] }];
  });
}

/**
 * The gamepad lists of `screen`: on the select, decide and result screens the layout `runtime/gamepad-menu.ts` reads; in
 * a play the one the play reads, where a standard pad's D-pad is key 1 and it has no START or SELECT. The second pad is
 * 2P's, with the same buttons.
 */
export function buildGamepadGuide(screen: ControlScreen, lang: KeyboardGuideLang = 'en'): GamepadGuide {
  if (screen === 'global') return { standard: [], iidx: [] };
  const copy = COPY[lang];
  const iidxName = (index: number): string =>
    index <= 6 ? copy.iidxButton(index + 1) : index === 8 ? 'E1' : index === 9 ? 'E2' : copy.iidxButton(index + 1);
  const turntable = { 'scratch-cw': [`${copy.turntable} ↻`], 'scratch-ccw': [`${copy.turntable} ↺`] } as const;
  if (screen === 'play') {
    const standard: Record<number, GamepadMenuButton> = {};
    for (const [index, button] of Object.entries(STANDARD_GAMEPAD_MENU_BUTTONS)) {
      if (Number(index) < 8) standard[Number(index)] = button;
    }
    const iidx: Record<number, GamepadMenuButton> = {};
    for (const [index, button] of Object.entries(IIDX_GAMEPAD_MENU_BUTTONS)) {
      if (Number(index) <= 6) iidx[Number(index)] = button;
    }
    return {
      standard: rows(standard, (index) => STANDARD_NAMES[index] ?? String(index), lang, { key1: [copy.dpad] }),
      iidx: rows(iidx, iidxName, lang, turntable),
    };
  }
  return {
    standard: rows(STANDARD_GAMEPAD_MENU_BUTTONS, (index) => STANDARD_NAMES[index] ?? String(index), lang),
    iidx: rows(IIDX_GAMEPAD_MENU_BUTTONS, iidxName, lang, turntable),
  };
}
