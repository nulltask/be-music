// The keys of a US keyboard, placed in key units (one unit is a letter key's width) for `<be-music-keyboard-map>`, as a
// Windows or a Mac keyboard, full-size or a laptop's. A full keyboard has the main block, the navigation cluster and
// the arrows, and the number pad when a key of it is in use; a laptop's has the main block with the arrows tucked into
// its bottom row. Codes are `KeyboardEvent.code`, the same on both: only the caps, their names and their places differ.

/** One key: its `KeyboardEvent.code`, the text on its cap, its name in a sentence, and its place in key units. */
export interface KeyboardKey {
  readonly code: string;
  /** The text on the cap (`Shift`, `F4`, `↑`). */
  readonly label: string;
  /** Its name in a sentence, telling the two sides apart (`Left Shift`). */
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The keys to draw and the size they take, in key units. */
export interface KeyboardLayout {
  readonly keys: readonly KeyboardKey[];
  readonly width: number;
  readonly height: number;
}

/** Whose caps the keyboard has: a Windows PC's or a Mac's. */
export type KeyboardPlatform = 'windows' | 'mac';
/** A full-size keyboard (navigation cluster and number pad) or a laptop's. */
export type KeyboardForm = 'full' | 'laptop';

export const KEYBOARD_PLATFORMS: readonly KeyboardPlatform[] = ['windows', 'mac'];
export const KEYBOARD_FORMS: readonly KeyboardForm[] = ['full', 'laptop'];

export interface KeyboardLayoutOptions {
  readonly platform?: KeyboardPlatform;
  readonly form?: KeyboardForm;
  /** Draws a full keyboard's number pad. A laptop has none. */
  readonly numpad?: boolean;
}

/** A key in a row: its code, its cap, and its width and name when not the default (one unit, the cap). */
type RowKey = readonly [code: string, label: string, width?: number, name?: string];

/** A gap in a row, in key units. */
type RowGap = number;

type Row = readonly (RowKey | RowGap)[];

const MAIN_WIDTH = 15;
const CLUSTER_GAP = 0.25;
const NAVIGATION_WIDTH = 3;
const NUMPAD_WIDTH = 4;
/** A full keyboard's function row stands a quarter of a key above the rest; a laptop's sits right on it. */
const FUNCTION_ROW_GAP = 0.25;

const F_KEYS = (from: number, to: number): RowKey[] =>
  Array.from({ length: to - from + 1 }, (_, index): RowKey => [`F${from + index}`, `F${from + index}`]);

const FULL_FUNCTION_ROW: Row = [['Escape', 'Esc'], 1, ...F_KEYS(1, 4), 0.5, ...F_KEYS(5, 8), 0.5, ...F_KEYS(9, 12)];

const FUNCTION_ROWS: Readonly<Record<KeyboardPlatform, Readonly<Record<KeyboardForm, Row>>>> = {
  windows: {
    full: FULL_FUNCTION_ROW,
    laptop: [
      ['Escape', 'Esc'],
      ...F_KEYS(1, 12),
      ['PrintScreen', 'PrtSc', 1, 'Print Screen'],
      ['Delete', 'Del', 1, 'Delete'],
    ],
  },
  mac: {
    full: FULL_FUNCTION_ROW,
    // The last place on a Mac laptop's row is Touch ID, which is no key.
    laptop: [['Escape', 'Esc', 2], ...F_KEYS(1, 12)],
  },
};

/** The main block above its bottom row, the same on every keyboard but for a Mac's caps. */
const MAIN_ROWS: readonly Row[] = [
  [
    ['Backquote', '`'],
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit): RowKey => [`Digit${digit}`, String(digit)]),
    ['Minus', '-'],
    ['Equal', '='],
    ['Backspace', 'Backspace', 2],
  ],
  [
    ['Tab', 'Tab', 1.5],
    ...letters('QWERTYUIOP'),
    ['BracketLeft', '['],
    ['BracketRight', ']'],
    ['Backslash', '\\', 1.5],
  ],
  [
    ['CapsLock', 'Caps', 1.75, 'Caps Lock'],
    ...letters('ASDFGHJKL'),
    ['Semicolon', ';'],
    ['Quote', "'"],
    ['Enter', 'Enter', 2.25],
  ],
  [
    ['ShiftLeft', 'Shift', 2.25, 'Left Shift'],
    ...letters('ZXCVBNM'),
    ['Comma', ','],
    ['Period', '.'],
    ['Slash', '/'],
    ['ShiftRight', 'Shift', 2.75, 'Right Shift'],
  ],
];

/** The arrows a laptop tucks into its bottom row: ← and →, with ↑ over ↓ in half-height keys between them. */
const LAPTOP_ARROWS_WIDTH = 3;

const BOTTOM_ROWS: Readonly<Record<KeyboardPlatform, Readonly<Record<KeyboardForm, Row>>>> = {
  windows: {
    full: [
      ['ControlLeft', 'Ctrl', 1.25, 'Left Ctrl'],
      ['MetaLeft', 'Win', 1.25, 'Left Windows'],
      ['AltLeft', 'Alt', 1.25, 'Left Alt'],
      ['Space', 'Space', 6.25],
      ['AltRight', 'Alt', 1.25, 'Right Alt'],
      ['MetaRight', 'Win', 1.25, 'Right Windows'],
      ['ContextMenu', 'Menu', 1.25],
      ['ControlRight', 'Ctrl', 1.25, 'Right Ctrl'],
    ],
    laptop: [
      ['ControlLeft', 'Ctrl', 1.25, 'Left Ctrl'],
      ['Fn', 'Fn'],
      ['MetaLeft', 'Win', 1.25, 'Left Windows'],
      ['AltLeft', 'Alt', 1.25, 'Left Alt'],
      ['Space', 'Space', 5],
      ['AltRight', 'Alt', 1.25, 'Right Alt'],
      ['ControlRight', 'Ctrl', 1, 'Right Ctrl'],
    ],
  },
  mac: {
    full: [
      ['ControlLeft', '⌃', 1.5, 'Left Control'],
      ['AltLeft', '⌥', 1.5, 'Left Option'],
      ['MetaLeft', '⌘', 1.75, 'Left Command'],
      ['Space', 'Space', 6.5],
      ['MetaRight', '⌘', 1.75, 'Right Command'],
      ['AltRight', '⌥', 2, 'Right Option'],
    ],
    laptop: [
      ['Fn', 'fn'],
      ['ControlLeft', '⌃', 1, 'Control'],
      ['AltLeft', '⌥', 1, 'Left Option'],
      ['MetaLeft', '⌘', 1.25, 'Left Command'],
      ['Space', 'Space', 5.5],
      ['MetaRight', '⌘', 1.25, 'Right Command'],
      ['AltRight', '⌥', 1, 'Right Option'],
    ],
  },
};

/** A Mac's caps and names for the keys a Windows PC labels otherwise. */
const MAC_CAPS: Readonly<Record<string, readonly [label: string, name: string]>> = {
  Escape: ['esc', 'Esc'],
  Backspace: ['delete', 'Delete'],
  Tab: ['tab', 'Tab'],
  CapsLock: ['caps', 'Caps Lock'],
  Enter: ['return', 'Return'],
  ShiftLeft: ['⇧', 'Left Shift'],
  ShiftRight: ['⇧', 'Right Shift'],
  Delete: ['⌦', 'Forward Delete'],
  NumLock: ['clear', 'Clear'],
  NumpadEnter: ['enter', 'Num Enter'],
};

const NAVIGATION_FUNCTION_ROWS: Readonly<Record<KeyboardPlatform, Row>> = {
  windows: [
    ['PrintScreen', 'PrtSc', 1, 'Print Screen'],
    ['ScrollLock', 'ScrLk', 1, 'Scroll Lock'],
    ['Pause', 'Pause'],
  ],
  mac: F_KEYS(13, 15),
};

const NAVIGATION_ROWS: Readonly<Record<KeyboardPlatform, readonly Row[]>> = {
  windows: [
    [
      ['Insert', 'Ins', 1, 'Insert'],
      ['Home', 'Home'],
      ['PageUp', 'PgUp', 1, 'Page Up'],
    ],
    [
      ['Delete', 'Del', 1, 'Delete'],
      ['End', 'End'],
      ['PageDown', 'PgDn', 1, 'Page Down'],
    ],
  ],
  mac: [
    [
      ['Fn', 'fn'],
      ['Home', 'home', 1, 'Home'],
      ['PageUp', 'pg up', 1, 'Page Up'],
    ],
    [
      ['Delete', 'Del', 1, 'Delete'],
      ['End', 'end', 1, 'End'],
      ['PageDown', 'pg dn', 1, 'Page Down'],
    ],
  ],
};

const FULL_ARROW_ROWS: readonly Row[] = [
  [],
  [1, ['ArrowUp', '↑']],
  [
    ['ArrowLeft', '←'],
    ['ArrowDown', '↓'],
    ['ArrowRight', '→'],
  ],
];

const NUMPAD_FUNCTION_ROWS: Readonly<Record<KeyboardPlatform, Row>> = { windows: [], mac: F_KEYS(16, 19) };

const NUMPAD_ROWS: Readonly<Record<KeyboardPlatform, readonly Row[]>> = {
  windows: [
    [
      ['NumLock', 'Num', 1, 'Num Lock'],
      ['NumpadDivide', '/', 1, 'Num /'],
      ['NumpadMultiply', '*', 1, 'Num *'],
      ['NumpadSubtract', '-', 1, 'Num -'],
    ],
    numpadDigits(7, 8, 9),
    numpadDigits(4, 5, 6),
    numpadDigits(1, 2, 3),
    [
      ['Numpad0', '0', 2, 'Num 0'],
      ['NumpadDecimal', '.', 1, 'Num .'],
    ],
  ],
  mac: [
    [
      ['NumLock', 'Num', 1, 'Num Lock'],
      ['NumpadEqual', '=', 1, 'Num ='],
      ['NumpadDivide', '/', 1, 'Num /'],
      ['NumpadMultiply', '*', 1, 'Num *'],
    ],
    [...numpadDigits(7, 8, 9), ['NumpadSubtract', '-', 1, 'Num -']],
    [...numpadDigits(4, 5, 6), ['NumpadAdd', '+', 1, 'Num +']],
    numpadDigits(1, 2, 3),
    [
      ['Numpad0', '0', 2, 'Num 0'],
      ['NumpadDecimal', '.', 1, 'Num .'],
    ],
  ],
};

/** The number pad's tall keys, in its last column from the row given. */
const NUMPAD_TALL_KEYS: Readonly<
  Record<KeyboardPlatform, readonly { code: string; label: string; name: string; row: number }[]>
> = {
  windows: [
    { code: 'NumpadAdd', label: '+', name: 'Num +', row: 1 },
    { code: 'NumpadEnter', label: 'Enter', name: 'Num Enter', row: 3 },
  ],
  mac: [{ code: 'NumpadEnter', label: 'Enter', name: 'Num Enter', row: 3 }],
};

function letters(row: string): RowKey[] {
  return [...row].map((letter): RowKey => [`Key${letter}`, letter]);
}

function numpadDigits(...digits: number[]): RowKey[] {
  return digits.map((digit): RowKey => [`Numpad${digit}`, String(digit), 1, `Num ${digit}`]);
}

/** Lays a row of keys and gaps out from `x` at `y`, with a Mac's caps on `mac`. */
function placeRow(row: Row, x: number, y: number, platform: KeyboardPlatform): KeyboardKey[] {
  const keys: KeyboardKey[] = [];
  let at = x;
  for (const cell of row) {
    if (typeof cell === 'number') {
      at += cell;
      continue;
    }
    const [code, cap, width = 1, sentence = cap] = cell;
    const [label, name] = (platform === 'mac' ? MAC_CAPS[code] : undefined) ?? [cap, sentence];
    keys.push({ code, label, name, x: at, y, width, height: 1 });
    at += width;
  }
  return keys;
}

/** A laptop's arrows at the right end of its bottom row (`y`), from `x`. */
function laptopArrows(x: number, y: number): KeyboardKey[] {
  return [
    { code: 'ArrowLeft', label: '←', name: '←', x, y, width: 1, height: 1 },
    { code: 'ArrowUp', label: '↑', name: '↑', x: x + 1, y, width: 1, height: 0.5 },
    { code: 'ArrowDown', label: '↓', name: '↓', x: x + 1, y: y + 0.5, width: 1, height: 0.5 },
    { code: 'ArrowRight', label: '→', name: '→', x: x + 2, y, width: 1, height: 1 },
  ];
}

/**
 * The keys of a US keyboard in key units, from the top-left corner. A full keyboard (the default) has Esc and the
 * F-keys, the main block, the navigation cluster with the arrows and, with `numpad`, the number pad; a laptop has the
 * function row, the main block and the arrows in its bottom row. `platform` picks a Windows PC's caps (the default) or
 * a Mac's, and where a Mac puts its modifiers.
 */
export function keyboardLayout(options: KeyboardLayoutOptions = {}): KeyboardLayout {
  const platform = options.platform ?? 'windows';
  const form = options.form ?? 'full';
  const top = form === 'full' ? 1 + FUNCTION_ROW_GAP : 1;
  const bottom = top + MAIN_ROWS.length;
  const keys: KeyboardKey[] = [
    ...placeRow(FUNCTION_ROWS[platform][form], 0, 0, platform),
    ...MAIN_ROWS.flatMap((row, index) => placeRow(row, 0, top + index, platform)),
    ...placeRow(BOTTOM_ROWS[platform][form], 0, bottom, platform),
  ];
  const height = bottom + 1;
  if (form === 'laptop') {
    keys.push(...laptopArrows(MAIN_WIDTH - LAPTOP_ARROWS_WIDTH, bottom));
    return { keys, width: MAIN_WIDTH, height };
  }
  const navigationX = MAIN_WIDTH + CLUSTER_GAP;
  const numpadX = navigationX + NAVIGATION_WIDTH + CLUSTER_GAP;
  keys.push(
    ...placeRow(NAVIGATION_FUNCTION_ROWS[platform], navigationX, 0, platform),
    ...[...NAVIGATION_ROWS[platform], ...FULL_ARROW_ROWS].flatMap((row, index) =>
      placeRow(row, navigationX, top + index, platform),
    ),
  );
  if (options.numpad === true) {
    keys.push(
      ...placeRow(NUMPAD_FUNCTION_ROWS[platform], numpadX, 0, platform),
      ...NUMPAD_ROWS[platform].flatMap((row, index) => placeRow(row, numpadX, top + index, platform)),
    );
    for (const { code, label, name, row } of NUMPAD_TALL_KEYS[platform]) {
      const [cap, sentence] = (platform === 'mac' ? MAC_CAPS[code] : undefined) ?? [label, name];
      keys.push({ code, label: cap, name: sentence, x: numpadX + 3, y: top + row, width: 1, height: 2 });
    }
  }
  return {
    keys,
    width: options.numpad === true ? numpadX + NUMPAD_WIDTH : navigationX + NAVIGATION_WIDTH,
    height,
  };
}

const LAYOUTS: Readonly<Record<KeyboardPlatform, readonly KeyboardLayout[]>> = {
  windows: [keyboardLayout({ numpad: true }), keyboardLayout({ form: 'laptop' })],
  mac: [keyboardLayout({ platform: 'mac', numpad: true }), keyboardLayout({ platform: 'mac', form: 'laptop' })],
};

/**
 * The key of `code` on `platform`'s keyboards, number pad included, or on a Windows PC's when a Mac has no such key
 * (Print Screen, the menu key).
 */
export function keyboardKey(code: string, platform: KeyboardPlatform = 'windows'): KeyboardKey | undefined {
  for (const layout of [...LAYOUTS[platform], ...LAYOUTS.windows]) {
    const key = layout.keys.find((candidate) => candidate.code === code);
    if (key !== undefined) return key;
  }
  return undefined;
}

/** Every code any of the keyboards draws: the keys a mark can land on. */
export const KEYBOARD_CODES: readonly string[] = [
  ...new Set([...LAYOUTS.windows, ...LAYOUTS.mac].flatMap((layout) => layout.keys.map((key) => key.code))),
];

/**
 * The keyboard a device most likely has, from `navigator.userAgentData.platform` or `navigator.platform`: macOS gets a
 * Mac laptop's, anything else a full Windows keyboard.
 */
export function guessKeyboard(platform: string | undefined): { platform: KeyboardPlatform; form: KeyboardForm } {
  return platform !== undefined && /mac/i.test(platform)
    ? { platform: 'mac', form: 'laptop' }
    : { platform: 'windows', form: 'full' };
}

/**
 * The keys a laptop gives with Fn instead of a key of its own: Home, End, Page Up and Page Down on the arrows on both,
 * Forward Delete on a Mac's delete, and the number pad a Windows laptop embeds in its letter keys (7 8 9 0 / U I O P /
 * J K L ; / M . /). The firmware sends the missing key's own code, so the player reads it as that key.
 */
const LAPTOP_COMBOS: Readonly<Record<KeyboardPlatform, Readonly<Record<string, readonly string[]>>>> = {
  windows: {
    Home: ['Fn', 'ArrowLeft'],
    End: ['Fn', 'ArrowRight'],
    PageUp: ['Fn', 'ArrowUp'],
    PageDown: ['Fn', 'ArrowDown'],
    Numpad7: ['Fn', 'Digit7'],
    Numpad8: ['Fn', 'Digit8'],
    Numpad9: ['Fn', 'Digit9'],
    NumpadMultiply: ['Fn', 'Digit0'],
    Numpad4: ['Fn', 'KeyU'],
    Numpad5: ['Fn', 'KeyI'],
    Numpad6: ['Fn', 'KeyO'],
    NumpadSubtract: ['Fn', 'KeyP'],
    Numpad1: ['Fn', 'KeyJ'],
    Numpad2: ['Fn', 'KeyK'],
    Numpad3: ['Fn', 'KeyL'],
    NumpadAdd: ['Fn', 'Semicolon'],
    Numpad0: ['Fn', 'KeyM'],
    NumpadDecimal: ['Fn', 'Period'],
    NumpadDivide: ['Fn', 'Slash'],
  },
  mac: {
    Home: ['Fn', 'ArrowLeft'],
    End: ['Fn', 'ArrowRight'],
    PageUp: ['Fn', 'ArrowUp'],
    PageDown: ['Fn', 'ArrowDown'],
    Delete: ['Fn', 'Backspace'],
  },
};

/** How a key reaches the player on `platform`'s `form` keyboard: its own key, a combination, or not at all. */
export type KeyboardReach =
  | { readonly kind: 'key'; readonly key: KeyboardKey }
  | { readonly kind: 'combo'; readonly keys: readonly KeyboardKey[] }
  | { readonly kind: 'none' };

/**
 * Whether `code` has a key on `platform`'s `form` keyboard (a full keyboard with its number pad), else the keys a laptop
 * presses for it with Fn, else none (a Mac has no Pause key, a Mac laptop no number pad).
 */
export function keyboardReach(code: string, platform: KeyboardPlatform, form: KeyboardForm): KeyboardReach {
  const layout = LAYOUTS[platform][form === 'full' ? 0 : 1]!;
  const key = layout.keys.find((candidate) => candidate.code === code);
  if (key !== undefined) return { kind: 'key', key };
  const combo = form === 'laptop' ? LAPTOP_COMBOS[platform][code] : undefined;
  const keys = combo?.map((part) => layout.keys.find((candidate) => candidate.code === part));
  if (keys !== undefined && keys.every((part) => part !== undefined)) return { kind: 'combo', keys };
  return { kind: 'none' };
}
