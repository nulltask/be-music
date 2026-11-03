/**
 * The control buttons every screen reads, as LR2, beatoraja and That-Which-Must-Not-Be-Named PC read them: each side's seven keys and
 * its turntable (by the player's own lane keys, `laneKeys`), and its START and SELECT (`controlKeys`, Q / W and O / P by
 * default, LR2's default key config). A screen asks which buttons a key is (`controlButtonsOfKey`) instead of reading
 * the key itself, so a player who moves a lane moves the screens' keys with it.
 *
 * The turntable is two buttons, one for each of its keys (`LaneBinding.inputKeys`): `scratch-cw` is the Shift key and
 * `scratch-ccw` the second key (Ctrl, and Space with the 1P one).
 *
 * Which of the families' key maps a screen reads them by is its control scheme (`resolveControlScheme`): the skin's
 * family's, or the one the player picked for the built-in skins.
 */

import { createLaneBindings, LANE_KEY_CONFIG, type LaneKeyOverrides } from '@be-music/player-engine/lanes';
import type { SceneFamily } from '../../host/family-kit.ts';
import { keyboardEventToTokens } from '../../runtime/web-input-runtime.ts';

/** A side of the controller. */
export type ControlSide = '1P' | '2P';

/** A button of one side: a key (1 to 7), a turntable key, START or SELECT. */
export type ControlSideButton =
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
  | 'select';

/** A control button: a side's button (`'1P-key1'`, `'2P-start'`). */
export type ControlButton = `${ControlSide}-${ControlSideButton}`;

/** The control buttons that are not lanes, which `controlKeys` sets. */
export type ControlKeyId = `${ControlSide}-${'start' | 'select'}`;

/** One control key of the key config: its id, its side and its default token. */
export interface ControlKeyConfigEntry {
  readonly id: ControlKeyId;
  readonly side: ControlSide;
  readonly defaultToken: string;
}

/** START and SELECT of each side, in the order a key config lists them, with LR2's default keys. */
export const CONTROL_KEY_CONFIG: readonly ControlKeyConfigEntry[] = [
  { id: '1P-start', side: '1P', defaultToken: 'q' },
  { id: '1P-select', side: '1P', defaultToken: 'w' },
  { id: '2P-start', side: '2P', defaultToken: 'o' },
  { id: '2P-select', side: '2P', defaultToken: 'p' },
];

/** A player's own START / SELECT keys: for each, the input tokens it takes. */
export type ControlKeyOverrides = Partial<Record<ControlKeyId, readonly string[]>>;

/** The key map a screen reads its keys by: LR2's, or beatoraja's. */
export type ControlScheme = 'lr2' | 'beatoraja';

/** What the screens' keys are made of: the player's lane keys, START / SELECT keys and the built-in skins' scheme. */
export interface ControlSettings {
  readonly laneKeys?: LaneKeyOverrides;
  readonly controlKeys?: ControlKeyOverrides;
  /** The key map of the built-in skins: LR2's (the default) or beatoraja's. */
  readonly builtInScheme?: ControlScheme;
}

/** Which buttons each input token is, lowercase (`keyboardEventToTokens`). */
export type ControlButtonMap = ReadonlyMap<string, readonly ControlButton[]>;

/** The key a side's lane channel is, in the 14 KEY layout: the seven keys and the turntable. */
const LANE_BUTTONS: Readonly<Record<string, ControlButton>> = {
  '11': '1P-key1',
  '12': '1P-key2',
  '13': '1P-key3',
  '14': '1P-key4',
  '15': '1P-key5',
  '18': '1P-key6',
  '19': '1P-key7',
  '21': '2P-key1',
  '22': '2P-key2',
  '23': '2P-key3',
  '24': '2P-key4',
  '25': '2P-key5',
  '28': '2P-key6',
  '29': '2P-key7',
};

const SCRATCH_SIDES: Readonly<Record<string, ControlSide>> = { '16': '1P', '26': '2P' };

/** The key map the screens of `family` read: the family's own, and for the built-in skins the one the player picked. */
export function resolveControlScheme(family: SceneFamily, builtInScheme: ControlScheme | undefined): ControlScheme {
  if (family === 'lr2' || family === 'beatoraja') return family;
  return builtInScheme ?? 'lr2';
}

/** The key START / SELECT `id` takes: the player's own, or the default. */
export function effectiveControlKey(keys: ControlKeyOverrides | undefined, id: ControlKeyId): string {
  return keys?.[id]?.[0] ?? CONTROL_KEY_CONFIG.find((entry) => entry.id === id)?.defaultToken ?? '';
}

/**
 * Which buttons each input token is under `settings`: the 14 KEY lanes' keys (both turntable keys of each side), and
 * START / SELECT. A token can be several buttons when the player gave two of them one key.
 */
export function resolveControlButtons(settings: ControlSettings = {}): ControlButtonMap {
  const buttons = new Map<string, ControlButton[]>();
  const add = (token: string, button: ControlButton): void => {
    const key = token.toLowerCase();
    if (key === '') return;
    const list = buttons.get(key);
    if (list === undefined) buttons.set(key, [button]);
    else if (!list.includes(button)) list.push(button);
  };
  const channels = LANE_KEY_CONFIG.beat.map((lane) => lane.id);
  const bindings = createLaneBindings(channels, {
    playVariant: '14',
    // A browser's keys: the turntable's second key is Ctrl (macOS terminals take Option instead).
    platform: 'linux',
    ...(settings.laneKeys !== undefined ? { laneKeys: settings.laneKeys } : {}),
  });
  for (const binding of bindings) {
    const side = SCRATCH_SIDES[binding.channel];
    if (side !== undefined) {
      const [cw, ccw] = binding.inputKeys ?? [binding.inputTokens, []];
      for (const token of cw ?? []) add(token, `${side}-scratch-cw`);
      for (const token of ccw ?? []) add(token, `${side}-scratch-ccw`);
      continue;
    }
    const button = LANE_BUTTONS[binding.channel];
    if (button !== undefined) for (const token of binding.inputTokens) add(token, button);
  }
  for (const entry of CONTROL_KEY_CONFIG) {
    const tokens = settings.controlKeys?.[entry.id];
    for (const token of tokens !== undefined && tokens.length > 0 ? tokens : [entry.defaultToken]) add(token, entry.id);
  }
  return buttons;
}

/** Which buttons each input token is with the default keys. */
export const DEFAULT_CONTROL_BUTTONS: ControlButtonMap = resolveControlButtons();

/** The buttons a key is under `map` (none for a key no button takes), in the order of the key's tokens. */
export function controlButtonsOfKey(event: { readonly code: string }, map: ControlButtonMap): ControlButton[] {
  const result: ControlButton[] = [];
  for (const token of keyboardEventToTokens(event)) {
    for (const button of map.get(token) ?? []) if (!result.includes(button)) result.push(button);
  }
  return result;
}
