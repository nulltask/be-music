/**
 * The select screen's keyboard, as plain data: what a key going down asks of the screen. ↑ / ↓ move the cursor, Enter
 * takes the bar under it, and Escape, Backspace or ← back out of a folder. Space opens and closes the play-options panel
 * (LR2's panel 1; LR2's START key opens it); while it is open the 1P lane keys step its options, and Escape closes an
 * open panel. While the README overlay is open, the keys scroll or close it.
 */

import type { PlayOptions } from '@be-music/scene-model';
import type { SessionKeyEvent } from '../session-scene.ts';

/** Pixel scroll of the README overlay per arrow key: about two lines of its 14 px / 18 px text. */
export const READTEXT_LINE_SCROLL = 36;
/** Pixel scroll per PageUp / PageDown: most of the overlay, leaving a couple of lines to find one's place by. */
export const READTEXT_PAGE_SCROLL = 360;

/** What a key asks of the select screen. */
export type SelectKeyAction =
  /** Move the cursor one bar, wrapping past either end. */
  | { readonly type: 'step'; readonly direction: 1 | -1 }
  /** Open the folder or start the bar under the cursor. */
  | { readonly type: 'activate' }
  /** Back out of the folder shown. */
  | { readonly type: 'back' }
  /** Open or close an option panel. */
  | { readonly type: 'panel'; readonly panel: number }
  /** Step a play option of the play-options panel (the hi-speed by its step). */
  | { readonly type: 'play-option'; readonly key: keyof PlayOptions; readonly step: 1 | -1 }
  /** Scroll the README overlay by `delta` pixels. */
  | { readonly type: 'readtext-scroll'; readonly delta: number }
  /** Close the README overlay. */
  | { readonly type: 'readtext-close' }
  /** The key does nothing here, but no other handler may take it (the README overlay owns the keyboard). */
  | { readonly type: 'swallow' };

/** What the keys depend on: the panel open and whether the README overlay is. */
export interface SelectKeyState {
  readonly panel: number | undefined;
  readonly readTextOpen: boolean;
}

/**
 * The play options the 1P lane keys step while the play-options panel is open, in the panel's button order (LR2 binds
 * these "adjacent key" shortcuts for its option panels): 1 PLAY STYLE (DP flip), 2 RANDOM, 3 BATTLE (the 2P random), 4
 * GAUGE, 5 hi-speed down, 6 ASSIST (auto scratch), 7 hi-speed up.
 */
const PANEL_KEYS: Readonly<Record<string, { key: keyof PlayOptions; step: 1 | -1 }>> = {
  KeyZ: { key: 'dpFlip', step: 1 },
  KeyS: { key: 'random1P', step: 1 },
  KeyX: { key: 'random2P', step: 1 },
  KeyD: { key: 'gauge1P', step: 1 },
  KeyC: { key: 'hiSpeed', step: -1 },
  KeyF: { key: 'autoScratch1P', step: 1 },
  KeyV: { key: 'hiSpeed', step: 1 },
};

/** The README overlay's scroll keys and how far each one goes. */
const READTEXT_SCROLL_KEYS: Readonly<Record<string, number>> = {
  ArrowDown: READTEXT_LINE_SCROLL,
  ArrowUp: -READTEXT_LINE_SCROLL,
  PageDown: READTEXT_PAGE_SCROLL,
  ' ': READTEXT_PAGE_SCROLL,
  PageUp: -READTEXT_PAGE_SCROLL,
  Home: -Number.MAX_SAFE_INTEGER,
  End: Number.MAX_SAFE_INTEGER,
};

/** What a key going down asks of the select screen in `state`, or `undefined` for nothing. */
export function resolveSelectKeyAction(event: SessionKeyEvent, state: SelectKeyState): SelectKeyAction | undefined {
  if (event.type !== 'down') return undefined;
  // Space toggles the play-options panel (LR2's START key opens panel 1); Enter already takes the bar.
  if (event.code === 'Space') return { type: 'panel', panel: 1 };
  // The README overlay owns the keyboard while open: Enter (LR2's decide key) or Backspace close it, the arrows and the
  // page keys scroll it, and nothing else reaches the list behind it.
  if (state.readTextOpen) {
    if (event.key === 'Backspace' || event.key === 'Enter') return { type: 'readtext-close' };
    const delta = READTEXT_SCROLL_KEYS[event.key];
    return delta === undefined ? { type: 'swallow' } : { type: 'readtext-scroll', delta };
  }
  // Escape closes an open panel before it backs out of a folder.
  if (event.key === 'Escape' && state.panel !== undefined) return { type: 'panel', panel: state.panel };
  if (state.panel === 1) {
    const option = PANEL_KEYS[event.code];
    if (option !== undefined) return { type: 'play-option', ...option };
  }
  switch (event.key) {
    case 'ArrowDown':
      return { type: 'step', direction: 1 };
    case 'ArrowUp':
      return { type: 'step', direction: -1 };
    case 'Enter':
      return { type: 'activate' };
    case 'Escape':
    case 'Backspace':
    case 'ArrowLeft':
      return { type: 'back' };
    default:
      return undefined;
  }
}
