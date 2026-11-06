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
 * While the README dialog is open, the keys scroll or close it, on either map.
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

/** CSS pixels the README dialog scrolls per arrow key: about two lines of its text. */
export const READTEXT_LINE_SCROLL = 36;
/** CSS pixels per PageUp / PageDown: most of the dialog's text, leaving a couple of lines to find one's place by. */
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
  /** Scroll the README dialog by `delta` pixels. */
  | { readonly type: 'readtext-scroll'; readonly delta: number }
  /** Close the README dialog. */
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
  /** LR2's key 4: back out on a tap, open the chart's ranking when held (`SelectSessionEvents.ranking`). */
  | { readonly type: 'ranking' }
  /** LR2's F3: held, the arrows edit the chart's difficulty and level (`SelectSessionEvents.levelEdit`). */
  | { readonly type: 'level-edit' }
  /** Copy the focused chart's MD5 or SHA-256 (beatoraja's Ctrl+F3 / Ctrl+Shift+F3). */
  | { readonly type: 'copy-hash'; readonly hash: 'md5' | 'sha256' }
  /** Play every chart of the focused folder in AUTO, one after the other (beatoraja's F10). */
  | { readonly type: 'autoplay-folder' }
  /** Open the folder the focused chart is in, on it (beatoraja's 8). */
  | { readonly type: 'same-folder' }
  /** Open or close the focused chart's text file (beatoraja's 9). */
  | { readonly type: 'readme' }
  /** Read the library's folders again (LR2's F8, beatoraja's F2). */
  | { readonly type: 'reload' }
  /** Mark or unmark the focused chart as a favourite (beatoraja's F8 / F9). */
  | { readonly type: 'favorite'; readonly list: 'music' | 'charts' }
  /** The key does nothing here, but no other handler may take it (the README dialog owns the keyboard). */
  | { readonly type: 'swallow' };

/** What the keys depend on: the panel open and whether the README dialog is. */
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

/** One step of a beatoraja option panel's key: a play option stepped by `step`. */
type PanelKey = { readonly key: keyof PlayOptions; readonly step: 1 | -1 };

/**
 * beatoraja's option panels' 1P keys (`MusicSelectKeyProperty.BEAT_7K`), as Be-Music has the options: panel 1 (START)
 * steps RANDOM (keys 1 / 2), the gauge (3), the DP option (4), HS-FIX (5) and the 2P RANDOM (6 / 7); panel 2 (SELECT)
 * switches CUSTOM JUDGE (1), CONSTANT (2), the judge area display (3), the LN mode (4), the BPM guide (6) and the mines
 * (7); panel 3 (START + SELECT, or 5) steps the BGA (1), the gauge auto-shift (2), the judge timing auto-adjust (3), the
 * visible time (4 / 6, by 1 ms) and the judge timing (5 / 7, by 1 ms).
 */
const BEATORAJA_PANEL_KEYS: Readonly<Record<number, Partial<Readonly<Record<ControlButton, PanelKey>>>>> = {
  1: {
    '1P-key1': { key: 'random1P', step: 1 },
    '1P-key2': { key: 'random1P', step: -1 },
    '1P-key3': { key: 'gauge1P', step: 1 },
    '1P-key4': { key: 'dpFlip', step: 1 },
    '1P-key5': { key: 'hsFix', step: 1 },
    '1P-key6': { key: 'random2P', step: -1 },
    '1P-key7': { key: 'random2P', step: 1 },
  },
  2: {
    '1P-key1': { key: 'customJudge', step: 1 },
    '1P-key2': { key: 'visualConstant', step: 1 },
    '1P-key3': { key: 'displayAreaInfo', step: 1 },
    '1P-key4': { key: 'longNoteMode', step: 1 },
    '1P-key6': { key: 'bpmGuide', step: 1 },
    '1P-key7': { key: 'mineModifier', step: 1 },
  },
  3: {
    '1P-key1': { key: 'bga', step: 1 },
    '1P-key2': { key: 'gaugeAutoShift', step: 1 },
    '1P-key3': { key: 'judgeTimingAutoAdjust', step: 1 },
    '1P-key4': { key: 'noteDurationMs', step: -1 },
    '1P-key5': { key: 'judgeTimingMs', step: -1 },
    '1P-key6': { key: 'noteDurationMs', step: 1 },
    '1P-key7': { key: 'judgeTimingMs', step: 1 },
  },
};

/** The control buttons a key is: the event's, or the default keys' for an event built without them. */
function buttonsOf(event: SessionKeyEvent): readonly ControlButton[] {
  return event.buttons ?? controlButtonsOfKey(event, DEFAULT_CONTROL_BUTTONS);
}

/** The README dialog's scroll keys and how far each one goes. */
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
  // START (LR2's Space too) toggles the play-options panel, even over the README; Enter already takes the bar. beatoraja's
  // SELECT opens its panel 2, and 5 its panel 3.
  if (is('select.option-panel')) return { type: 'panel', panel: 1 };
  if (is('select.option-panel-2')) return { type: 'panel', panel: 2 };
  if (is('select.option-panel-3')) return { type: 'panel', panel: 3 };
  if (state.readTextOpen) return resolveReadTextKey(event);
  // An open panel: Escape closes it before it backs out of a folder, and the 1P keys step its options.
  if (event.key === 'Escape' && state.panel !== undefined) return { type: 'panel', panel: state.panel };
  if (map === 'beatoraja' && state.panel !== undefined) {
    for (const button of keyEvent.buttons) {
      const option = BEATORAJA_PANEL_KEYS[state.panel]?.[button];
      if (option !== undefined) return { type: 'play-option', ...option };
    }
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
  if (is('select.ranking')) return { type: 'ranking' };
  if (is('select.level-edit')) return { type: 'level-edit' };
  if (is('select.auto')) return { type: 'auto' };
  if (is('select.back')) return { type: 'back' };
  if (is('select.close-folder')) return { type: 'back', inFolder: true };
  // Not with a modifier: Ctrl / Cmd + R reloads the page.
  if (is('select.random')) return { type: 'random' };
  if (is('select.sort')) return { type: 'list', option: 'sort' };
  if (is('select.keys-filter')) return { type: 'list', option: 'keysFilter' };
  if (is('select.ln-mode')) return { type: 'ln-mode' };
  if (is('select.search')) return { type: 'search' };
  if (is('select.reload')) return { type: 'reload' };
  if (is('select.copy-md5')) return { type: 'copy-hash', hash: 'md5' };
  if (is('select.copy-sha256')) return { type: 'copy-hash', hash: 'sha256' };
  if (is('select.autoplay-folder')) return { type: 'autoplay-folder' };
  if (is('select.same-folder')) return { type: 'same-folder' };
  if (is('select.readme')) return { type: 'readme' };
  if (is('select.favorite-song')) return { type: 'favorite', list: 'music' };
  if (is('select.favorite-chart')) return { type: 'favorite', list: 'charts' };
  return undefined;
}

/**
 * The README dialog's keys while it is open: Enter (LR2's decide key), Backspace or Escape close it, the arrows and the
 * page keys scroll it, and nothing else reaches the list behind it.
 */
function resolveReadTextKey(event: SessionKeyEvent): SelectKeyAction {
  if (event.key === 'Backspace' || event.key === 'Enter' || event.key === 'Escape') return { type: 'readtext-close' };
  const delta = READTEXT_SCROLL_KEYS[event.key];
  return delta === undefined ? { type: 'swallow' } : { type: 'readtext-scroll', delta };
}
