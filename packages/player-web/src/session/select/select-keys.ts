/**
 * The select screen's keyboard, as plain data: what a key going down asks of the screen, by the family's key map.
 *
 * - **LR2** (the built-in and LR2 screens). ↑ / ↓ move the cursor, Enter takes the bar under it, and Escape, Backspace
 *   or ← back out of a folder. Space opens and closes the play-options panel (LR2's panel 1; LR2's START key opens
 *   it); while it is open the 1P lane keys step its options, and Escape closes an open panel.
 * - **beatoraja**. ↑ / ↓ move the cursor, Page Up / Page Down ten bars, Home / End to the first and the last bar, R to a
 *   random bar (beatoraja's random select), Enter takes the bar under it, Escape backs out of a folder (and leaves the
 *   screen at the root, as the family's select policy says) and Backspace backs out of a folder only. beatoraja has no
 *   option panel.
 *
 * While the README overlay is open, the keys scroll or close it, on either map.
 */

import type { BrowseCommand, PlayOptions } from '@be-music/scene-model';
import type { SessionKeyEvent } from '../session-scene.ts';

/** Pixel scroll of the README overlay per arrow key: about two lines of its 14 px / 18 px text. */
export const READTEXT_LINE_SCROLL = 36;
/** Pixel scroll per PageUp / PageDown: most of the overlay, leaving a couple of lines to find one's place by. */
export const READTEXT_PAGE_SCROLL = 360;

/** How many bars Page Up / Page Down move the cursor on the beatoraja map. */
export const SELECT_PAGE_BARS = 10;

/** The families' key maps: the built-in and LR2 screens use LR2's. */
export type SelectKeyMap = 'lr2' | 'beatoraja';

/** What a key asks of the select screen. */
export type SelectKeyAction =
  /** Move the cursor one bar, wrapping past either end. */
  | { readonly type: 'step'; readonly direction: 1 | -1 }
  /** Browse the list otherwise: move a page, jump to the first or the last bar. */
  | { readonly type: 'browse'; readonly command: BrowseCommand }
  /** Put the cursor on a random bar other than the focused one. */
  | { readonly type: 'random' }
  /** Open the folder or start the bar under the cursor. */
  | { readonly type: 'activate' }
  /**
   * Back out of the folder shown. At the root the screen does what its select policy says, unless `inFolder` limits
   * the key to a folder (beatoraja's Backspace).
   */
  | { readonly type: 'back'; readonly inFolder?: true }
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

/**
 * What a key going down asks of the select screen in `state`, on the family's key map (LR2's by default), or
 * `undefined` for nothing.
 */
export function resolveSelectKeyAction(
  event: SessionKeyEvent,
  state: SelectKeyState,
  map: SelectKeyMap = 'lr2',
): SelectKeyAction | undefined {
  if (event.type !== 'down') return undefined;
  return map === 'beatoraja' ? resolveBeatorajaKey(event, state) : resolveLr2Key(event, state);
}

/**
 * The README overlay's keys while it is open: Enter (LR2's decide key) or Backspace close it, the arrows and the page
 * keys scroll it, and nothing else reaches the list behind it.
 */
function resolveReadTextKey(event: SessionKeyEvent): SelectKeyAction {
  if (event.key === 'Backspace' || event.key === 'Enter') return { type: 'readtext-close' };
  const delta = READTEXT_SCROLL_KEYS[event.key];
  return delta === undefined ? { type: 'swallow' } : { type: 'readtext-scroll', delta };
}

function resolveLr2Key(event: SessionKeyEvent, state: SelectKeyState): SelectKeyAction | undefined {
  // Space toggles the play-options panel (LR2's START key opens panel 1); Enter already takes the bar.
  if (event.code === 'Space') return { type: 'panel', panel: 1 };
  if (state.readTextOpen) return resolveReadTextKey(event);
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

function resolveBeatorajaKey(event: SessionKeyEvent, state: SelectKeyState): SelectKeyAction | undefined {
  if (state.readTextOpen) return resolveReadTextKey(event);
  switch (event.key) {
    case 'ArrowDown':
      return { type: 'step', direction: 1 };
    case 'ArrowUp':
      return { type: 'step', direction: -1 };
    case 'PageDown':
      return { type: 'browse', command: { type: 'move', delta: SELECT_PAGE_BARS } };
    case 'PageUp':
      return { type: 'browse', command: { type: 'move', delta: -SELECT_PAGE_BARS } };
    case 'Home':
      return { type: 'browse', command: { type: 'jump', index: 0 } };
    case 'End':
      // The jump is clamped to the list: the last bar.
      return { type: 'browse', command: { type: 'jump', index: Number.MAX_SAFE_INTEGER } };
    case 'Enter':
      return { type: 'activate' };
    case 'Escape':
      return { type: 'back' };
    case 'Backspace':
      return { type: 'back', inFolder: true };
    case 'r':
    case 'R':
      // Not with a modifier: Ctrl / Cmd + R reloads the page.
      return event.ctrlKey || event.metaKey || event.altKey ? undefined : { type: 'random' };
    default:
      return undefined;
  }
}
