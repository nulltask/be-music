/**
 * The select screen's keyboard, as plain data: what a key going down asks of the screen, by the family's key map.
 *
 * - **LR2** (the LR2 screens, and the built-in ones unless the player picked beatoraja's). ↑ / ↓ move the cursor, Enter
 *   takes the bar under it, and Escape, Backspace or ← back out of a folder. START or Space opens and closes the
 *   play-options panel (LR2's panel 1); while it is open the 1P keys step its options, and Escape closes an open panel.
 * - **beatoraja**. ↑ / ↓ move the cursor, Page Up / Page Down ten bars, Home / End to the first and the last bar, R to a
 *   random bar (beatoraja's random select), Enter takes the bar under it, Escape backs out of a folder (and leaves the
 *   screen at the root, as the family's select policy says) and Backspace backs out of a folder only. As beatoraja's
 *   `MusicSelectInputProcessor` binds them, 4 and the 1P key 6 pick the next replay slot holding a replay
 *   (NEXT_REPLAY) and the 1P key 7 replays it (REPLAY). beatoraja has no option panel.
 *
 * The keys and START are the player's (`SessionKeyEvent.buttons`).
 *
 * While the README overlay is open, the keys scroll or close it, on either map.
 */

import type { BrowseCommand, PlayOptions } from '@be-music/player-scene-model';
import type { SessionKeyEvent } from '../session-scene.ts';
import { DEFAULT_CONTROL_ACTIONS, type ControlActionId, type ControlActionMap } from '../controls/control-actions.ts';
import {
  controlButtonsOfKey,
  DEFAULT_CONTROL_BUTTONS,
  type ControlButton,
  type ControlScheme,
} from '../controls/control-buttons.ts';

/** Pixel scroll of the README overlay per arrow key: about two lines of its 14 px / 18 px text. */
export const READTEXT_LINE_SCROLL = 36;
/** Pixel scroll per PageUp / PageDown: most of the overlay, leaving a couple of lines to find one's place by. */
export const READTEXT_PAGE_SCROLL = 360;

/** How many bars Page Up / Page Down move the cursor on the beatoraja map. */
export const SELECT_PAGE_BARS = 10;

/** The families' key maps (`ControlScheme`): the LR2 screens use LR2's, the built-in ones the one the player picked. */
export type SelectKeyMap = ControlScheme;

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
  /** Pick the next replay slot holding a replay (beatoraja's NEXT_REPLAY). */
  | { readonly type: 'replay-slot'; readonly step: 1 | -1 }
  /** Replay the bar under the cursor from the replay slot picked, or play it when none is (beatoraja's REPLAY). */
  | { readonly type: 'replay' }
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
  /** Open the folder under the cursor, and do nothing on a chart (LR2's →). */
  | { readonly type: 'open-folder' }
  /** Move the cursor to the next chart of the focused chart's track (LR2's difficulty change). */
  | { readonly type: 'difficulty' }
  /** Start the chart under the cursor in AUTO play, or open the folder (LR2's key 6, beatoraja's AUTO). */
  | { readonly type: 'auto' }
  /** Step the sort, or the key mode filter, where the family keeps them (`SelectPolicy.listOptions`). */
  | { readonly type: 'list'; readonly option: 'sort' | 'keysFilter' }
  /** Step the LN mode (beatoraja's 3). */
  | { readonly type: 'ln-mode' }
  /** Open the search field. */
  | { readonly type: 'search' }
  /** Mark or unmark the focused chart as a favourite (beatoraja's F8 / F9). */
  | { readonly type: 'favorite'; readonly list: 'music' | 'charts' }
  /** The key does nothing here, but no other handler may take it (the README overlay owns the keyboard). */
  | { readonly type: 'swallow' };

/** What the keys depend on: the panel open and whether the README overlay is. */
export interface SelectKeyState {
  readonly panel: number | undefined;
  readonly readTextOpen: boolean;
  /** Whether the key mode filter shows double-play charts (10 / 14 KEY): LR2's panel key 3 is DP FLIP then. */
  readonly doublePlayFilter?: boolean;
}

/**
 * The play options the 1P keys step while the play-options panel is open, as LR2's option panel 1 binds them
 * (`SetPlayOption`): 1 the key mode filter, 2 RANDOM, 3 BATTLE (DP FLIP with a double-play filter), 4 GAUGE, 5 hi-speed
 * down, 6 ASSIST (auto scratch), 7 hi-speed up.
 */
const PANEL_KEYS: Partial<Readonly<Record<ControlButton, { key: keyof PlayOptions; step: 1 | -1 }>>> = {
  '1P-key1': { key: 'keysFilter', step: 1 },
  '1P-key2': { key: 'random1P', step: 1 },
  '1P-key3': { key: 'battleMode', step: 1 },
  '1P-key4': { key: 'gauge1P', step: 1 },
  '1P-key5': { key: 'hiSpeed', step: -1 },
  '1P-key6': { key: 'autoScratch1P', step: 1 },
  '1P-key7': { key: 'hiSpeed', step: 1 },
};

/** The control buttons a key is: the event's, or the default keys' for an event built without them. */
function buttonsOf(event: SessionKeyEvent): readonly ControlButton[] {
  return event.buttons ?? controlButtonsOfKey(event, DEFAULT_CONTROL_BUTTONS);
}

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
 * What a key going down asks of the select screen in `state`, on the family's key map (LR2's by default) with the
 * player's keys for its operations (`actions`), or `undefined` for nothing.
 */
export function resolveSelectKeyAction(
  event: SessionKeyEvent,
  state: SelectKeyState,
  map: SelectKeyMap = 'lr2',
  actions: ControlActionMap = DEFAULT_CONTROL_ACTIONS[map],
): SelectKeyAction | undefined {
  if (event.type !== 'down') return undefined;
  const keyEvent = { ...event, buttons: buttonsOf(event) };
  const is = (id: ControlActionId): boolean => actions.is(id, keyEvent);
  // LR2's START (and Space) toggles the play-options panel, even over the README; Enter already takes the bar.
  if (is('select.option-panel')) return { type: 'panel', panel: 1 };
  if (state.readTextOpen) return resolveReadTextKey(event);
  // LR2's panels: Escape closes an open one before it backs out of a folder, and panel 1 steps its options.
  if (map === 'lr2' && event.key === 'Escape' && state.panel !== undefined) {
    return { type: 'panel', panel: state.panel };
  }
  if (map === 'lr2' && state.panel === 1) {
    for (const button of keyEvent.buttons) {
      if (button === '1P-key3' && state.doublePlayFilter === true)
        return { type: 'play-option', key: 'dpFlip', step: 1 };
      const option = PANEL_KEYS[button];
      if (option !== undefined) return { type: 'play-option', ...option };
    }
  }
  // beatoraja's replay keys are lane keys, ahead of the list's.
  if (is('select.next-replay')) return { type: 'replay-slot', step: 1 };
  if (is('select.replay')) return { type: 'replay' };
  if (is('select.down')) return { type: 'step', direction: 1 };
  if (is('select.up')) return { type: 'step', direction: -1 };
  if (is('select.page-down')) return { type: 'browse', command: { type: 'move', delta: SELECT_PAGE_BARS } };
  if (is('select.page-up')) return { type: 'browse', command: { type: 'move', delta: -SELECT_PAGE_BARS } };
  if (is('select.first')) return { type: 'browse', command: { type: 'jump', index: 0 } };
  // The jump is clamped to the list: the last bar.
  if (is('select.last')) return { type: 'browse', command: { type: 'jump', index: Number.MAX_SAFE_INTEGER } };
  if (is('select.activate')) return { type: 'activate' };
  if (is('select.open-folder')) return { type: 'open-folder' };
  if (is('select.difficulty')) return { type: 'difficulty' };
  if (is('select.auto')) return { type: 'auto' };
  if (is('select.back')) return { type: 'back' };
  if (is('select.close-folder')) return { type: 'back', inFolder: true };
  // Not with a modifier: Ctrl / Cmd + R reloads the page.
  if (is('select.random')) return { type: 'random' };
  if (is('select.sort')) return { type: 'list', option: 'sort' };
  if (is('select.keys-filter')) return { type: 'list', option: 'keysFilter' };
  if (is('select.ln-mode')) return { type: 'ln-mode' };
  if (is('select.search')) return { type: 'search' };
  if (is('select.favorite-song')) return { type: 'favorite', list: 'music' };
  if (is('select.favorite-chart')) return { type: 'favorite', list: 'charts' };
  return undefined;
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
