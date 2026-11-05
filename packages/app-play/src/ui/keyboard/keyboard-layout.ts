// The keys of a US keyboard, placed in key units (one unit is a letter key's width) for `<be-music-keyboard-map>`: the
// main block, the navigation cluster and the arrows, and the number pad when a key of it is in use.

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

/** A key in a row: its code, its cap, and its width and name when not the default (one unit, the cap). */
type RowKey = readonly [code: string, label: string, width?: number, name?: string];

/** A gap in a row, in key units. */
type RowGap = number;

const MAIN_WIDTH = 15;
const CLUSTER_GAP = 0.25;
const NAVIGATION_WIDTH = 3;
const NUMPAD_WIDTH = 4;
/** The function row stands a quarter of a key above the rest. */
const FUNCTION_ROW_GAP = 0.25;

const FUNCTION_ROW: readonly (RowKey | RowGap)[] = [
  ['Escape', 'Esc'],
  1,
  ['F1', 'F1'],
  ['F2', 'F2'],
  ['F3', 'F3'],
  ['F4', 'F4'],
  0.5,
  ['F5', 'F5'],
  ['F6', 'F6'],
  ['F7', 'F7'],
  ['F8', 'F8'],
  0.5,
  ['F9', 'F9'],
  ['F10', 'F10'],
  ['F11', 'F11'],
  ['F12', 'F12'],
];

const MAIN_ROWS: readonly (readonly (RowKey | RowGap)[])[] = [
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
  [
    ['ControlLeft', 'Ctrl', 1.25, 'Left Ctrl'],
    ['MetaLeft', 'Meta', 1.25, 'Left Meta'],
    ['AltLeft', 'Alt', 1.25, 'Left Alt'],
    ['Space', 'Space', 6.25],
    ['AltRight', 'Alt', 1.25, 'Right Alt'],
    ['MetaRight', 'Meta', 1.25, 'Right Meta'],
    ['ContextMenu', 'Menu', 1.25],
    ['ControlRight', 'Ctrl', 1.25, 'Right Ctrl'],
  ],
];

const NAVIGATION_FUNCTION_ROW: readonly RowKey[] = [
  ['PrintScreen', 'PrtSc', 1, 'Print Screen'],
  ['ScrollLock', 'ScrLk', 1, 'Scroll Lock'],
  ['Pause', 'Pause'],
];

const NAVIGATION_ROWS: readonly (readonly (RowKey | RowGap)[])[] = [
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
  [],
  [1, ['ArrowUp', '↑']],
  [
    ['ArrowLeft', '←'],
    ['ArrowDown', '↓'],
    ['ArrowRight', '→'],
  ],
];

const NUMPAD_ROWS: readonly (readonly (RowKey | RowGap)[])[] = [
  [
    ['NumLock', 'Num', 1, 'Num Lock'],
    ['NumpadDivide', '/', 1, 'Num /'],
    ['NumpadMultiply', '*', 1, 'Num *'],
    ['NumpadSubtract', '-', 1, 'Num -'],
  ],
  [...numpadDigits(7, 8, 9)],
  [...numpadDigits(4, 5, 6)],
  [...numpadDigits(1, 2, 3)],
  [
    ['Numpad0', '0', 2, 'Num 0'],
    ['NumpadDecimal', '.', 1, 'Num .'],
  ],
];

/** The number pad's two tall keys, beside the rows above. */
const NUMPAD_TALL_KEYS = [
  { code: 'NumpadAdd', label: '+', name: 'Num +', row: 1 },
  { code: 'NumpadEnter', label: 'Enter', name: 'Num Enter', row: 3 },
] as const;

function letters(row: string): RowKey[] {
  return [...row].map((letter): RowKey => [`Key${letter}`, letter]);
}

function numpadDigits(...digits: number[]): RowKey[] {
  return digits.map((digit): RowKey => [`Numpad${digit}`, String(digit), 1, `Num ${digit}`]);
}

/** Lays a row of keys and gaps out from `x` at `y`. */
function placeRow(row: readonly (RowKey | RowGap)[], x: number, y: number): KeyboardKey[] {
  const keys: KeyboardKey[] = [];
  let at = x;
  for (const cell of row) {
    if (typeof cell === 'number') {
      at += cell;
      continue;
    }
    const [code, label, width = 1, name = label] = cell;
    keys.push({ code, label, name, x: at, y, width, height: 1 });
    at += width;
  }
  return keys;
}

/**
 * The keys of a US keyboard in key units, from the top-left corner: Esc and the F-keys, the main block, the navigation
 * cluster with the arrows and, with `numpad`, the number pad.
 */
export function keyboardLayout(options: { readonly numpad?: boolean } = {}): KeyboardLayout {
  const top = 1 + FUNCTION_ROW_GAP;
  const navigationX = MAIN_WIDTH + CLUSTER_GAP;
  const numpadX = navigationX + NAVIGATION_WIDTH + CLUSTER_GAP;
  const keys: KeyboardKey[] = [
    ...placeRow(FUNCTION_ROW, 0, 0),
    ...MAIN_ROWS.flatMap((row, index) => placeRow(row, 0, top + index)),
    ...placeRow(NAVIGATION_FUNCTION_ROW, navigationX, 0),
    ...NAVIGATION_ROWS.flatMap((row, index) => placeRow(row, navigationX, top + index)),
  ];
  if (options.numpad === true) {
    keys.push(...NUMPAD_ROWS.flatMap((row, index) => placeRow(row, numpadX, top + index)));
    for (const { code, label, name, row } of NUMPAD_TALL_KEYS) {
      keys.push({ code, label, name, x: numpadX + 3, y: top + row, width: 1, height: 2 });
    }
  }
  return {
    keys,
    width: options.numpad === true ? numpadX + NUMPAD_WIDTH : navigationX + NAVIGATION_WIDTH,
    height: top + MAIN_ROWS.length,
  };
}

/** The key of `code` on the full layout, number pad included. */
export function keyboardKey(code: string): KeyboardKey | undefined {
  return FULL_LAYOUT.keys.find((key) => key.code === code);
}

const FULL_LAYOUT = keyboardLayout({ numpad: true });
