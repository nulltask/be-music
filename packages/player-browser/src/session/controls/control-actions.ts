/**
 * What each screen's keys do, as data: every operation a screen takes from a key (`ControlActionId`), with the keys it
 * takes by default on each key map (`CONTROL_ACTIONS`). A default is a physical key (`KeyboardEvent.code`) or a control
 * button (`control-buttons.ts`: a lane key, START, SELECT), so it moves with the player's lane and START / SELECT keys.
 * The player can give an operation keys of their own (`ControlActionOverrides`), which take the place of its defaults.
 *
 * A screen asks which of its operations a key event is (`matchControlActions`) instead of reading the key. The keys a
 * screen reads in its own way stay with it: the README dialog's scrolling, the PLAY OPTION panel's option keys (the
 * 1P keys, by button) and the Escape that closes an open panel.
 */

import type { SceneFamily } from '../../host/family-kit.ts';
import {
  resolveControlScheme,
  type ControlButton,
  type ControlScheme,
  type ControlSettings,
} from './control-buttons.ts';

/** The screen an operation belongs to. */
export type ControlScreen = 'global' | 'select' | 'decide' | 'play' | 'result';

/** A key an operation takes: a physical key, or a control button. */
export type ControlActionKey = { readonly code: string } | { readonly button: ControlButton };

/** One operation of a screen, with its default keys. */
export interface ControlActionDefinition {
  readonly id: ControlActionId;
  readonly screen: ControlScreen;
  /** Its name in the key config, which `labels.ts` translates. */
  readonly label: string;
  /** The keys it takes on each key map; an operation a key map lacks has no entry for it. */
  readonly defaults: Partial<Readonly<Record<ControlScheme, readonly ControlActionKey[]>>>;
  /**
   * Taken only without Ctrl, Alt or ⌘ (a bare R or 1, so the browser's Ctrl / ⌘+R and Ctrl+1 keep working). Shift
   * counts as a modifier too when `bareShift` is set.
   */
  readonly bare?: boolean;
  readonly bareShift?: boolean;
  /** Taken only with exactly these of Ctrl (or ⌘) and Shift down (beatoraja's Ctrl+F3 and Ctrl+Shift+F3). */
  readonly modifiers?: { readonly ctrl: boolean; readonly shift: boolean };
}

const both = (keys: readonly ControlActionKey[]) => ({ lr2: keys, beatoraja: keys });
const code = (value: string): ControlActionKey => ({ code: value });
const button = (value: ControlButton): ControlActionKey => ({ button: value });

/** Every operation a screen takes from a key, by id: `CONTROL_ACTIONS` lists each once, in this order. */
export const CONTROL_ACTION_IDS = [
  'global.fullscreen',
  'global.screenshot',
  'global.help',
  'global.fps',
  'select.down',
  'select.up',
  'select.page-down',
  'select.page-up',
  'select.first',
  'select.last',
  'select.random',
  'select.activate',
  'select.open-folder',
  'select.ranking',
  'select.level-edit',
  'select.difficulty',
  'select.auto',
  'select.back',
  'select.close-folder',
  'select.option-panel',
  'select.option-panel-2',
  'select.option-panel-3',
  'select.sort',
  'select.keys-filter',
  'select.ln-mode',
  'select.battle',
  'select.m-ran-1p',
  'select.m-ran-2p',
  'select.search',
  'select.reload',
  'select.mania-options',
  'select.copy-md5',
  'select.copy-sha256',
  'select.autoplay-folder',
  'select.same-folder',
  'select.readme',
  'select.favorite-song',
  'select.favorite-chart',
  'select.next-replay',
  'select.replay',
  'decide.continue',
  'decide.cancel',
  'play.quit',
  'play.quit-hold',
  'play.restart',
  'play.pause',
  'play.hi-speed-up',
  'play.hi-speed-down',
  'play.cover-less',
  'play.cover-more',
  'play.floating-hi-speed',
  'play.restore-green',
  'play.seek-back',
  'play.seek-forward',
  'play.sudden-up',
  'play.sudden-down',
  'play.lift-up',
  'play.lift-down',
  'play.hidden-toggle',
  'play.hidden-up',
  'play.hidden-down',
  'play.speed-1',
  'play.speed-2',
  'play.speed-3',
  'play.speed-4',
  'play.m-sudden-down',
  'play.m-sudden-up',
  'result.continue',
  'result.leave',
  'result.retry',
  'result.retry-same',
  'result.change-graph',
  'result.save-replay-1',
  'result.save-replay-2',
  'result.save-replay-3',
  'result.save-replay-4',
] as const;

/** Every operation a screen takes from a key, with its default keys. */
export const CONTROL_ACTIONS: readonly ControlActionDefinition[] = [
  // Every screen.
  { id: 'global.fullscreen', screen: 'global', label: 'Full screen', defaults: both([code('F4')]) },
  { id: 'global.screenshot', screen: 'global', label: 'Screenshot', defaults: both([code('F6')]) },
  { id: 'global.help', screen: 'global', label: 'Help', defaults: { lr2: [code('F1')] } },
  {
    id: 'global.fps',
    screen: 'global',
    label: 'Frame rate',
    defaults: { lr2: [code('F7')], beatoraja: [code('F1')] },
  },
  // The select screen. The turntable scrolls the list: LR2 turns it down (the second key) to the next bar, beatoraja up.
  {
    id: 'select.down',
    screen: 'select',
    label: 'Next bar',
    defaults: {
      lr2: [code('ArrowDown'), button('1P-scratch-ccw'), button('2P-scratch-ccw')],
      beatoraja: [code('ArrowDown'), button('1P-scratch-cw'), button('2P-scratch-cw')],
    },
  },
  {
    id: 'select.up',
    screen: 'select',
    label: 'Previous bar',
    defaults: {
      lr2: [code('ArrowUp'), button('1P-scratch-cw'), button('2P-scratch-cw')],
      beatoraja: [code('ArrowUp'), button('1P-scratch-ccw'), button('2P-scratch-ccw')],
    },
  },
  { id: 'select.page-down', screen: 'select', label: 'Ten bars down', defaults: { beatoraja: [code('PageDown')] } },
  { id: 'select.page-up', screen: 'select', label: 'Ten bars up', defaults: { beatoraja: [code('PageUp')] } },
  { id: 'select.first', screen: 'select', label: 'First bar', defaults: { beatoraja: [code('Home')] } },
  { id: 'select.last', screen: 'select', label: 'Last bar', defaults: { beatoraja: [code('End')] } },
  { id: 'select.random', screen: 'select', label: 'Random bar', defaults: { beatoraja: [code('KeyR')] }, bare: true },
  {
    id: 'select.activate',
    screen: 'select',
    label: 'Open / play',
    defaults: {
      // LR2's and That-Which-Must-Not-Be-Named PC's white keys; beatoraja's key 1 (PLAY) and →.
      lr2: [code('Enter'), button('1P-key1'), button('1P-key3'), button('1P-key5'), button('1P-key7')],
      beatoraja: [code('Enter'), code('ArrowRight'), button('1P-key1')],
    },
  },
  {
    id: 'select.open-folder',
    screen: 'select',
    label: 'Open folder',
    // LR2's → on a folder; beatoraja's key 3 (PRACTICE, which opens a folder).
    defaults: { lr2: [code('ArrowRight')], beatoraja: [button('1P-key3')] },
  },
  {
    id: 'select.ranking',
    screen: 'select',
    label: 'Ranking (hold)',
    // LR2's key 4 held: the chart's ranking (IR); a tap backs out, as the black keys do.
    defaults: { lr2: [button('1P-key4')] },
  },
  {
    id: 'select.level-edit',
    screen: 'select',
    label: 'Edit level (hold)',
    // LR2's F3 held with the arrows: ↑ / ↓ the chart's difficulty, ← / → its level.
    defaults: { lr2: [code('F3')] },
  },
  {
    id: 'select.difficulty',
    screen: 'select',
    label: 'Next difficulty',
    // LR2's SELECT (and → on a chart), That-Which-Must-Not-Be-Named PC's 1.
    defaults: { lr2: [code('Digit1'), button('1P-select'), button('2P-select')] },
    bare: true,
  },
  {
    id: 'select.auto',
    screen: 'select',
    label: 'AUTO play',
    defaults: { lr2: [button('1P-key6')], beatoraja: [button('1P-key5')] },
  },
  {
    id: 'select.back',
    screen: 'select',
    label: 'Back',
    defaults: {
      // LR2's key 2 and That-Which-Must-Not-Be-Named PC's black keys (key 4 is `select.ranking`'s, which backs out on a tap).
      lr2: [code('Escape'), code('Backspace'), code('ArrowLeft'), button('1P-key2')],
      beatoraja: [code('Escape')],
    },
  },
  {
    id: 'select.close-folder',
    screen: 'select',
    label: 'Close folder',
    defaults: { beatoraja: [code('Backspace'), code('ArrowLeft'), button('1P-key2'), button('1P-key4')] },
  },
  {
    id: 'select.option-panel',
    screen: 'select',
    label: 'PLAY OPTION panel',
    // LR2's START and Space, and That-Which-Must-Not-Be-Named PC's Tab; beatoraja's START (its panel 1).
    defaults: { lr2: [code('Space'), code('Tab'), button('1P-start')], beatoraja: [button('1P-start')] },
  },
  {
    id: 'select.option-panel-2',
    screen: 'select',
    label: 'Option panel 2',
    // beatoraja's SELECT; START and SELECT together, or 5, open panel 3.
    defaults: { beatoraja: [button('1P-select')] },
  },
  {
    id: 'select.option-panel-3',
    screen: 'select',
    label: 'Option panel 3',
    defaults: { beatoraja: [code('Digit5')] },
    bare: true,
  },
  { id: 'select.sort', screen: 'select', label: 'Sort', defaults: both([code('Digit2')]), bare: true },
  {
    id: 'select.keys-filter',
    screen: 'select',
    label: 'Key mode filter',
    // That-Which-Must-Not-Be-Named PC's 3 (SP / DP), beatoraja's 1 (MODE).
    defaults: { lr2: [code('Digit3')], beatoraja: [code('Digit1')] },
    bare: true,
  },
  {
    id: 'select.ln-mode',
    screen: 'select',
    label: 'LN mode',
    defaults: { beatoraja: [code('Digit3')] },
    bare: true,
  },
  // That-Which-Must-Not-Be-Named AC 34 sets BATTLE with numpad 7 and M-RAN with numpad 6 on its option screen; here they
  // are select-screen keys of their own. Each player has a numpad there; here the 2P M-RAN takes Shift + numpad 6.
  { id: 'select.battle', screen: 'select', label: 'BATTLE (????)', defaults: both([code('Numpad7')]), bare: true },
  {
    id: 'select.m-ran-1p',
    screen: 'select',
    label: 'M-RAN 1P',
    defaults: both([code('Numpad6')]),
    bare: true,
    bareShift: true,
  },
  {
    id: 'select.m-ran-2p',
    screen: 'select',
    label: 'M-RAN 2P',
    defaults: both([code('Numpad6')]),
    modifiers: { ctrl: false, shift: true },
  },
  { id: 'select.search', screen: 'select', label: 'Search', defaults: both([code('Digit0')]), bare: true },
  {
    id: 'select.reload',
    screen: 'select',
    label: 'Reload folders',
    defaults: { lr2: [code('F8')], beatoraja: [code('F2')] },
  },
  // LR2 shows its mania options panel while F2 is held on the select screen. beatoraja's F2 reloads the folders, so the
  // action is unbound there.
  { id: 'select.mania-options', screen: 'select', label: 'LR2 mania options', defaults: { lr2: [code('F2')] } },
  {
    id: 'select.copy-md5',
    screen: 'select',
    label: 'Copy MD5',
    defaults: { beatoraja: [code('F3')] },
    modifiers: { ctrl: true, shift: false },
  },
  {
    id: 'select.copy-sha256',
    screen: 'select',
    label: 'Copy SHA-256',
    defaults: { beatoraja: [code('F3')] },
    modifiers: { ctrl: true, shift: true },
  },
  {
    id: 'select.autoplay-folder',
    screen: 'select',
    label: 'AUTO play the folder',
    defaults: { beatoraja: [code('F10')] },
  },
  {
    id: 'select.same-folder',
    screen: 'select',
    label: 'Open its folder',
    defaults: { beatoraja: [code('Digit8')] },
    bare: true,
  },
  {
    id: 'select.readme',
    screen: 'select',
    label: 'Text file',
    defaults: { beatoraja: [code('Digit9')] },
    bare: true,
  },
  {
    id: 'select.favorite-song',
    screen: 'select',
    label: 'Favorite song',
    defaults: { beatoraja: [code('F8')] },
  },
  {
    id: 'select.favorite-chart',
    screen: 'select',
    label: 'Favorite chart',
    defaults: { beatoraja: [code('F9')] },
  },
  {
    id: 'select.next-replay',
    screen: 'select',
    label: 'Next replay slot',
    defaults: { beatoraja: [button('1P-key6'), code('Digit4')] },
    bare: true,
  },
  {
    id: 'select.replay',
    screen: 'select',
    label: 'Replay',
    defaults: { beatoraja: [button('1P-key7')] },
    bare: true,
  },
  // The decide screen.
  {
    id: 'decide.continue',
    screen: 'decide',
    label: 'Continue',
    // LR2 skips the screen on any key, beatoraja on its keys 1, 3, 5 and 7.
    defaults: {
      lr2: [
        code('Enter'),
        code('Space'),
        button('1P-key1'),
        button('1P-key2'),
        button('1P-key3'),
        button('1P-key4'),
        button('1P-key5'),
        button('1P-key6'),
        button('1P-key7'),
      ],
      beatoraja: [
        code('Enter'),
        code('Space'),
        button('1P-key1'),
        button('1P-key3'),
        button('1P-key5'),
        button('1P-key7'),
      ],
    },
  },
  { id: 'decide.cancel', screen: 'decide', label: 'Back to select', defaults: both([code('Escape')]) },
  // The play.
  { id: 'play.quit', screen: 'play', label: 'Quit', defaults: both([code('Escape')]) },
  { id: 'play.quit-hold', screen: 'play', label: 'Quit (hold)', defaults: both([code('Backspace')]) },
  { id: 'play.restart', screen: 'play', label: 'Restart', defaults: both([code('F5')]) },
  { id: 'play.pause', screen: 'play', label: 'Pause', defaults: both([code('Pause'), code('Tab')]) },
  // ↑ / ↓ step the hi-speed in LR2 and move the lane cover in beatoraja.
  { id: 'play.hi-speed-up', screen: 'play', label: 'Hi-speed up', defaults: { lr2: [code('ArrowUp')] } },
  { id: 'play.hi-speed-down', screen: 'play', label: 'Hi-speed down', defaults: { lr2: [code('ArrowDown')] } },
  {
    id: 'play.cover-less',
    screen: 'play',
    label: 'Lane cover up',
    defaults: { lr2: [code('ArrowLeft')], beatoraja: [code('ArrowUp')] },
  },
  {
    id: 'play.cover-more',
    screen: 'play',
    label: 'Lane cover down',
    defaults: { lr2: [code('ArrowRight')], beatoraja: [code('ArrowDown')] },
  },
  {
    id: 'play.floating-hi-speed',
    screen: 'play',
    label: 'FLOATING HI-SPEED',
    defaults: both([code('Numpad0')]),
  },
  {
    id: 'play.restore-green',
    screen: 'play',
    label: 'Restore green number (twice)',
    defaults: both([code('Enter')]),
  },
  { id: 'play.seek-back', screen: 'play', label: 'Seek back (AUTO)', defaults: both([code('ArrowLeft')]) },
  { id: 'play.seek-forward', screen: 'play', label: 'Seek forward (AUTO)', defaults: both([code('ArrowRight')]) },
  { id: 'play.sudden-up', screen: 'play', label: 'SUDDEN+ up', defaults: both([code('PageUp')]) },
  { id: 'play.sudden-down', screen: 'play', label: 'SUDDEN+ down', defaults: both([code('PageDown')]) },
  { id: 'play.lift-up', screen: 'play', label: 'LIFT up', defaults: both([code('End')]) },
  { id: 'play.lift-down', screen: 'play', label: 'LIFT down', defaults: both([code('Home')]) },
  { id: 'play.hidden-toggle', screen: 'play', label: 'HIDDEN+ on / off', defaults: both([code('KeyH')]) },
  { id: 'play.hidden-up', screen: 'play', label: 'HIDDEN+ up', defaults: both([code('KeyK')]) },
  { id: 'play.hidden-down', screen: 'play', label: 'HIDDEN+ down', defaults: both([code('KeyJ')]) },
  // beatoraja's AUTO play speed while 1-4 are held, and LR2's skin moves with 1 / 2 / 6 + the arrows.
  ...([1, 2, 3, 4] as const).map((key) => ({
    id: `play.speed-${key}` as const,
    screen: 'play' as const,
    label: `AUTO speed ${(['×0.25', '×0.5', '×2', '×3'] as const)[key - 1]}`,
    defaults: { beatoraja: [code(`Digit${key}`)] },
    bare: true,
  })),
  { id: 'play.m-sudden-down', screen: 'play', label: 'M-SUDDEN down', defaults: both([code('F3')]) },
  { id: 'play.m-sudden-up', screen: 'play', label: 'M-SUDDEN up', defaults: both([code('F4')]) },
  // The result screen.
  {
    id: 'result.continue',
    screen: 'result',
    label: 'Next',
    // LR2 moves on with any key, beatoraja with its keys 1 to 4.
    defaults: {
      lr2: [
        code('Enter'),
        code('Space'),
        button('1P-key1'),
        button('1P-key2'),
        button('1P-key3'),
        button('1P-key4'),
        button('1P-key5'),
        button('1P-key6'),
        button('1P-key7'),
      ],
      beatoraja: [
        code('Enter'),
        code('Space'),
        button('1P-key1'),
        button('1P-key2'),
        button('1P-key3'),
        button('1P-key4'),
      ],
    },
  },
  { id: 'result.leave', screen: 'result', label: 'Leave', defaults: both([code('Escape')]) },
  {
    id: 'result.retry',
    screen: 'result',
    label: 'Retry',
    defaults: both([code('KeyR')]),
    bare: true,
    bareShift: true,
  },
  // beatoraja's result keys (`MusicResult`): the same chart on the same note arrangement (REPLAY_SAME, key 7 held as
  // the screen leaves) and the gauge graph stepped to the next gauge (CHANGE_GRAPH, key 6).
  {
    id: 'result.retry-same',
    screen: 'result',
    label: 'Retry (same arrangement)',
    defaults: both([code('KeyT')]),
    bare: true,
  },
  {
    id: 'result.change-graph',
    screen: 'result',
    label: 'Gauge graph',
    defaults: { lr2: [code('KeyG')], beatoraja: [code('KeyG'), button('1P-key6')] },
    bare: true,
  },
  ...([1, 2, 3, 4] as const).map((slot) => ({
    id: `result.save-replay-${slot}` as const,
    screen: 'result' as const,
    label: `Save replay ${slot}`,
    defaults: both([code(`Digit${slot}`)]),
    bare: true,
    bareShift: true,
  })),
];

/** An operation a screen takes from a key. */
export type ControlActionId = (typeof CONTROL_ACTION_IDS)[number];

/** A player's own keys for operations: for each, the physical keys (`KeyboardEvent.code`) that take its defaults' place. */
export type ControlActionOverrides = Partial<Record<ControlActionId, readonly string[]>>;

const DEFINITIONS: ReadonlyMap<string, ControlActionDefinition> = new Map(
  CONTROL_ACTIONS.map((definition) => [definition.id, definition]),
);

/** The definition of `id`. */
export function controlActionDefinition(id: ControlActionId): ControlActionDefinition {
  return DEFINITIONS.get(id)!;
}

/** The keys `id` takes on `scheme`: the player's own, or its defaults there (none where the key map lacks it). */
export function controlActionKeys(
  id: ControlActionId,
  scheme: ControlScheme,
  overrides: ControlActionOverrides | undefined,
): readonly ControlActionKey[] {
  const definition = controlActionDefinition(id);
  const defaults = definition.defaults[scheme];
  if (defaults === undefined) return [];
  const own = overrides?.[id];
  return own !== undefined && own.length > 0 ? own.map(code) : defaults;
}

/** A key event as the operations read it. */
export interface ControlActionKeyEvent {
  readonly code: string;
  /** The key's value (`KeyboardEvent.key`): a compact keyboard's Fn + arrow reports PageUp / PageDown / Home / End here. */
  readonly key?: string;
  readonly buttons?: readonly ControlButton[];
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

/** The operations of a screen on one key map, with the player's keys, to match key events against. */
export interface ControlActionMap {
  readonly scheme: ControlScheme;
  /** Whether `event` is a key of `id`. */
  is(id: ControlActionId, event: ControlActionKeyEvent): boolean;
  /** The physical keys `id` takes (its button keys aside). */
  codes(id: ControlActionId): readonly string[];
}

/**
 * The navigation keys a key's value names whatever its `code` (Fn + an arrow on a compact keyboard): an operation on one
 * takes it either way.
 */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown', 'Home', 'End']);

/** The operations on `scheme`, with the player's own keys for them. */
export function resolveControlActions(scheme: ControlScheme, overrides?: ControlActionOverrides): ControlActionMap {
  const keys = new Map<ControlActionId, readonly ControlActionKey[]>();
  const keysOf = (id: ControlActionId): readonly ControlActionKey[] => {
    let list = keys.get(id);
    if (list === undefined) {
      list = controlActionKeys(id, scheme, overrides);
      keys.set(id, list);
    }
    return list;
  };
  return {
    scheme,
    is: (id, event) => {
      const definition = controlActionDefinition(id);
      if (definition.bare === true && (event.ctrlKey === true || event.altKey === true || event.metaKey === true)) {
        return false;
      }
      if (definition.bareShift === true && event.shiftKey === true) return false;
      const modifiers = definition.modifiers;
      if (
        modifiers !== undefined &&
        (modifiers.ctrl !== (event.ctrlKey === true || event.metaKey === true) ||
          modifiers.shift !== (event.shiftKey === true))
      ) {
        return false;
      }
      const navigation = event.key !== undefined && NAVIGATION_KEYS.has(event.key) ? event.key : undefined;
      return keysOf(id).some((key) =>
        'code' in key ? key.code === event.code || key.code === navigation : (event.buttons ?? []).includes(key.button),
      );
    },
    codes: (id) => keysOf(id).flatMap((key) => ('code' in key ? [key.code] : [])),
  };
}

/** The operations of a screen of `family`'s skin, on its key map (`resolveControlScheme`), with the player's keys. */
export function resolveFamilyControlActions(
  family: SceneFamily,
  controls: ControlSettings | undefined,
): ControlActionMap {
  return resolveControlActions(resolveControlScheme(family, controls?.builtInScheme), controls?.actionKeys);
}

/** The operations on each key map with the default keys. */
export const DEFAULT_CONTROL_ACTIONS: Readonly<Record<ControlScheme, ControlActionMap>> = {
  lr2: resolveControlActions('lr2'),
  beatoraja: resolveControlActions('beatoraja'),
};
