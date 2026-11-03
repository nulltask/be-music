// The player's own START / SELECT keys (Options → Keys): read back from storage, and assigning one the way the lane key
// config does — a key START or SELECT already has moves over, and that one takes this one's. The defaults are
// `CONTROL_KEY_CONFIG`'s (Q / W, O / P); the screens read them as control buttons over the lane keys.
import {
  CONTROL_KEY_CONFIG,
  effectiveControlKey,
  type ControlKeyId,
  type ControlKeyOverrides,
  type ControlScheme,
  type ControlSettings,
} from '@be-music/player-browser/host';
import type { LaneKeyOverrides } from '@be-music/player-engine/lanes';

/** The key maps a built-in skin's screens can read. */
export const CONTROL_SCHEMES: readonly ControlScheme[] = ['lr2', 'beatoraja'];

/** The screens' control settings (`ControlSettings`) of the player's keys and the built-in skins' key map. */
export function controlSettingsOf(state: {
  readonly laneKeys: LaneKeyOverrides;
  readonly controlKeys: ControlKeyOverrides;
  readonly builtInControlScheme: ControlScheme;
}): ControlSettings {
  return { laneKeys: state.laneKeys, controlKeys: state.controlKeys, builtInScheme: state.builtInControlScheme };
}

/** Stored START / SELECT keys, keeping only known ids with a non-empty token list. */
export function parseControlKeys(raw: unknown): ControlKeyOverrides {
  const keys: ControlKeyOverrides = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return keys;
  for (const { id } of CONTROL_KEY_CONFIG) {
    const tokens = (raw as Record<string, unknown>)[id];
    if (!Array.isArray(tokens)) continue;
    const valid = tokens.filter((token): token is string => typeof token === 'string' && token !== '');
    if (valid.length > 0) keys[id] = valid;
  }
  return keys;
}

/**
 * Gives START / SELECT `id` the key `token`. The one that has the key now takes the key `id` had, so no two share one.
 * One left on its default keeps no entry.
 */
export function assignControlKey(keys: ControlKeyOverrides, id: ControlKeyId, token: string): ControlKeyOverrides {
  if (!CONTROL_KEY_CONFIG.some((entry) => entry.id === id) || token === '') return keys;
  const previous = effectiveControlKey(keys, id);
  const next = new Map(CONTROL_KEY_CONFIG.map((entry) => [entry.id, effectiveControlKey(keys, entry.id)]));
  const taken = CONTROL_KEY_CONFIG.find((entry) => entry.id !== id && next.get(entry.id) === token);
  next.set(id, token);
  if (taken !== undefined) next.set(taken.id, previous);
  const own: ControlKeyOverrides = {};
  for (const entry of CONTROL_KEY_CONFIG) {
    const key = next.get(entry.id)!;
    if (key !== entry.defaultToken) own[entry.id] = [key];
  }
  return own;
}
