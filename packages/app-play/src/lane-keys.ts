// The player's own lane keys (Options → Keys): read back from storage, the key a lane takes now, and assigning a key the
// way a key config does — a key already on another lane of the same group moves over, and that lane takes this one's.
// The defaults and the lanes are the engine's (`LANE_KEY_CONFIG`); a play takes these over them (`laneKeys`).
import { LANE_KEY_CONFIG, type LaneKeyGroup, type LaneKeyOverrides } from '@be-music/player-engine/lanes';

/** Every key config group. */
export const LANE_KEY_GROUPS: readonly LaneKeyGroup[] = ['beat', 'popn'];

/** Stored lane keys, keeping only known groups and lanes with a non-empty token list. */
export function parseLaneKeys(raw: unknown): LaneKeyOverrides {
  const keys: LaneKeyOverrides = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return keys;
  for (const group of LANE_KEY_GROUPS) {
    const lanes = (raw as Record<string, unknown>)[group];
    if (typeof lanes !== 'object' || lanes === null || Array.isArray(lanes)) continue;
    const parsed: Record<string, string[]> = {};
    for (const { id } of LANE_KEY_CONFIG[group]) {
      const tokens = (lanes as Record<string, unknown>)[id];
      if (!Array.isArray(tokens)) continue;
      const valid = tokens.filter((token): token is string => typeof token === 'string' && token !== '');
      if (valid.length > 0) parsed[id] = valid;
    }
    if (Object.keys(parsed).length > 0) keys[group] = parsed;
  }
  return keys;
}

/** The key lane `id` of `group` takes: the player's own, or the default. */
export function effectiveLaneKey(keys: LaneKeyOverrides, group: LaneKeyGroup, id: string): string {
  return keys[group]?.[id]?.[0] ?? LANE_KEY_CONFIG[group].find((lane) => lane.id === id)?.defaultToken ?? '';
}

/**
 * Gives lane `id` of `group` the key `token`. A lane of the group that has the key now takes the key `id` had, so no two
 * lanes share one. A lane left on its default keeps no entry.
 */
export function assignLaneKey(
  keys: LaneKeyOverrides,
  group: LaneKeyGroup,
  id: string,
  token: string,
): LaneKeyOverrides {
  const lanes = LANE_KEY_CONFIG[group];
  if (!lanes.some((lane) => lane.id === id) || token === '') return keys;
  const previous = effectiveLaneKey(keys, group, id);
  const taken = lanes.find((lane) => lane.id !== id && effectiveLaneKey(keys, group, lane.id) === token);
  const next: Record<string, string> = Object.fromEntries(
    lanes.map((lane) => [lane.id, effectiveLaneKey(keys, group, lane.id)]),
  );
  next[id] = token;
  if (taken !== undefined) next[taken.id] = previous;
  const own: Record<string, string[]> = {};
  for (const lane of lanes) {
    if (next[lane.id] !== lane.defaultToken) own[lane.id] = [next[lane.id]!];
  }
  const rest = resetLaneKeys(keys, group);
  return Object.keys(own).length > 0 ? { ...rest, [group]: own } : rest;
}

/** `keys` with `group` back on its defaults. */
export function resetLaneKeys(keys: LaneKeyOverrides, group: LaneKeyGroup): LaneKeyOverrides {
  const rest: LaneKeyOverrides = { ...keys };
  delete rest[group];
  return rest;
}
