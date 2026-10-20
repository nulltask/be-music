/**
 * The bmson `mode_hint`s that name a play variant outright: the Keyboardmania keyboard layouts. Shared by
 * `resolveChartPlayVariant` and the fingerprint's lane-mode inputs so both read the same hints the same way. The
 * keyboard layouts are 26 lanes per side, but a chart can live entirely on the first nine keys (x ≤ 9 → `11..19`),
 * which the lane rules would otherwise read as 7 / 9 KEY.
 */
export type KeyboardModeHint = 'keyboard-24k' | 'keyboard-24k-double';

/** Play variant each keyboard `mode_hint` names. */
export const KEYBOARD_MODE_HINT_VARIANTS: ReadonlyMap<KeyboardModeHint, '24' | '48'> = new Map([
  ['keyboard-24k', '24'],
  ['keyboard-24k-double', '48'],
]);

/** The keyboard `mode_hint` a raw hint names (surrounding whitespace ignored), or `undefined` for any other value. */
export function resolveKeyboardModeHint(modeHint: unknown): KeyboardModeHint | undefined {
  if (typeof modeHint !== 'string') {
    return undefined;
  }
  const trimmed = modeHint.trim();
  return trimmed === 'keyboard-24k' || trimmed === 'keyboard-24k-double' ? trimmed : undefined;
}
