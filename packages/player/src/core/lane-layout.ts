import {
  PLAY_MODE_LAYOUTS,
  findPlayModeLane,
  resolveChartPlayVariant,
  type ChartPlayVariant,
  type PlayLane,
  type PlayModeLayout,
  type PlayModeLayoutId,
} from '@be-music/chart';
import { normalizeChannel } from '@be-music/json';

export type { ChartPlayVariant };

export interface ChannelLike {
  channel: string;
}

export interface LaneBinding {
  channel: string;
  keyLabel: string;
  inputTokens: string[];
  side: '1P' | '2P' | 'OTHER';
  isScratch: boolean;
}

export interface KeyboardCodeLike {
  code: string;
}

/**
 * The player's lane layouts and lanes all come from the play-mode table in `@be-music/chart` (`PLAY_MODE_LAYOUTS`);
 * this module only adds what is the player's own: default keys, the lane order the hosts index lanes by, and the
 * per-variant slot arithmetic the skins use.
 */

/** Physical key codes of the IIDX default keys, for hosts that receive DOM `KeyboardEvent.code`s. */
const CHANNEL_KEY_BINDINGS: Record<string, ReadonlySet<string>> = {
  '16': new Set(['ShiftLeft']),
  '11': new Set(['KeyZ']),
  '12': new Set(['KeyS']),
  '13': new Set(['KeyX']),
  '14': new Set(['KeyD']),
  '15': new Set(['KeyC']),
  '18': new Set(['KeyF']),
  '19': new Set(['KeyV']),
  '26': new Set(['ShiftRight']),
  '21': new Set(['KeyB']),
  '22': new Set(['KeyH']),
  '23': new Set(['KeyN']),
  '24': new Set(['KeyJ']),
  '25': new Set(['KeyM']),
  '28': new Set(['KeyK']),
};

const KEY_LAYOUT = [
  'a',
  's',
  'd',
  'f',
  'g',
  'h',
  'j',
  'k',
  'l',
  ';',
  'q',
  'w',
  'e',
  'r',
  'u',
  'i',
  'o',
  'p',
  'z',
  'x',
  'c',
  'v',
  'b',
  'n',
  'm',
  ',',
  '.',
  '/',
];

interface FixedLaneDefinition {
  channel: string;
  keyLabel: string;
  inputTokens: string[];
  side: '1P' | '2P' | 'OTHER';
  isScratch?: boolean;
}

export interface LaneModeOptions {
  player?: number;
  chartExtension?: string;
  platform?: NodeJS.Platform;
  /**
   * The chart's play variant when the caller already knows it (an explicit host declaration, or
   * `resolveChartPlayVariant` from `@be-music/chart` run over the chart's events). Without it the
   * lane mode is resolved by that same `resolveChartPlayVariant` rule over the given channels,
   * `chartExtension`, and `player`.
   */
  playVariant?: ChartPlayVariant;
}

export function resolveKeyChannel(event: KeyboardCodeLike, channels: ReadonlyArray<string>): string | undefined {
  for (const channel of channels) {
    if (CHANNEL_KEY_BINDINGS[channel]?.has(event.code)) {
      return channel;
    }
  }
  return undefined;
}

export function resolveSideKeySlot(channel: string, playVariant?: ChartPlayVariant): number {
  if (playVariant === '24' || playVariant === '48') {
    // Keyboard modes have no scratch, so slot `0` is never produced and `isScratchLaneForVariant` stays false for
    // every channel. Lanes are the plain 1-based column index within the side (`11` → 1, `19` → 9, `1A` → 10, …,
    // `1O` → 24), then the wheel: `1P` → 25 (up), `1Q` → 26 (down) — beatoraja's keyboard lane offsets.
    if (channel.length !== 2) return -1;
    if (channel[0] !== '1' && channel[0] !== '2') return -1;
    const laneIndex = resolveLaneIndex(channel[1]!);
    if (laneIndex === undefined || laneIndex > KEYBOARD_MODE_SIDE_LANE_COUNT) return -1;
    return laneIndex;
  }
  if (playVariant === '9') {
    if (channel.length !== 2) return -1;
    const digit = Number.parseInt(channel[1]!, 10);
    if (!Number.isFinite(digit)) return -1;
    if (channel.startsWith('1')) {
      if (digit >= 1 && digit <= 9) return digit;
      return -1;
    }
    if (channel.startsWith('2')) {
      if (digit >= 2 && digit <= 5) return digit + 4;
      return -1;
    }
    return -1;
  }
  if (channel === '16' || channel === '26') return 0;
  if (channel.length !== 2) return -1;
  const digit = Number.parseInt(channel[1]!, 10);
  if (!Number.isFinite(digit)) return -1;
  if (digit >= 1 && digit <= 5) return digit;
  // Channels 18/19 are valid LANE notes only on the 7-key family (`'7'` SP / `'14'` DP).
  // 5-key family variants (`'5'` SP / `'10'` DP — 5 keys per side, no 6/7-key columns) reject
  // them: a malformed BMS that authors notes on 18/19 in a 5K chart shouldn't trip the
  // adapter into stamping ghost-lane bomb / keybeam / LN-hold timers for slots 6/7 that the
  // mounted skin doesn't render. Returning `-1` here cascades through `resolveLane`'s
  // `slot < 0 → undefined` guard, which all the lane-timer helpers already check.
  if (playVariant === '5' || playVariant === '10') {
    return -1;
  }
  if (digit === 8) return 6;
  if (digit === 9) return 7;
  return -1;
}

export function resolveLr2LaneIndex(channel: string, playVariant?: ChartPlayVariant): number {
  const slot = resolveSideKeySlot(channel, playVariant);
  if (slot < 0) return -1;
  // LR2 skins only define the 20 IIDX lane rects (`0`/`10` scratch + `1..9`/`11..19` keys) — there is no
  // `play_24.lr2skin`. Returning `-1` routes keyboard-mode charts through the caller's fallback playfield instead of
  // squeezing 26 lanes into the 7-key rect table.
  if (playVariant === '24' || playVariant === '48') return -1;
  if (playVariant === '9') return slot;
  return channel.startsWith('2') ? 10 + slot : slot;
}

export function resolveSideRelativeLaneIndex(channel: string, playVariant?: ChartPlayVariant): number {
  const slot = resolveSideKeySlot(channel, playVariant);
  return slot < 0 ? 0 : slot;
}

/** The IIDX scratch lanes (`16` / `26`), whatever the play variant. */
const IIDX_SCRATCH_CHANNELS: ReadonlySet<string> = new Set(
  PLAY_MODE_LAYOUTS['14'].lanes.filter((lane) => lane.kind === 'scratch').map((lane) => lane.channel),
);

export function isScratch(channel: string): boolean {
  return IIDX_SCRATCH_CHANNELS.has(channel);
}

/**
 * Which way a keyboard-mode wheel lane turns: `'up'` for `1P` / `2P`, `'down'` for `1Q` / `2Q`, `undefined` for every
 * other lane and for every channel outside the 24 / 48 KEY modes. The wheel is judged like a key, but it sits on the
 * outer edge of its side and the lane options leave it in place.
 */
export function resolveWheelLaneDirection(channel: string, playVariant?: ChartPlayVariant): 'up' | 'down' | undefined {
  if (playVariant === undefined) return undefined;
  const kind = findPlayModeLane(playVariant, channel)?.kind;
  if (kind === 'wheel-up') return 'up';
  if (kind === 'wheel-down') return 'down';
  return undefined;
}

/**
 * The lanes of one side the lane options (MIRROR / RANDOM / S-RANDOM / …) permute, in lane order. The IIDX families
 * move the keys `11..15` / `18` / `19` (`21..` on 2P) and leave the scratch alone; the keyboard modes move their 24 keys
 * and leave the wheel alone. Lanes the chart does not use are the caller's to drop.
 */
export function resolveLaneOptionChannels(side: '1P' | '2P', playVariant?: ChartPlayVariant): readonly string[] {
  if (playVariant === '24' || playVariant === '48') {
    return side === '2P' && playVariant === '24' ? [] : KEYBOARD_MODE_KEY_CHANNELS[side];
  }
  return IIDX_LANE_OPTION_CHANNELS[side];
}

/** The keys of one side of a layout, by key number. */
function sideKeyChannels(layoutId: PlayModeLayoutId, side: '1P' | '2P'): readonly string[] {
  return PLAY_MODE_LAYOUTS[layoutId].lanes
    .filter((lane) => lane.side === side && lane.kind === 'key')
    .sort((left, right) => left.slot - right.slot)
    .map((lane) => lane.channel);
}

const IIDX_LANE_OPTION_CHANNELS: Record<'1P' | '2P', readonly string[]> = {
  '1P': sideKeyChannels('14', '1P'),
  '2P': sideKeyChannels('14', '2P'),
};

const KEYBOARD_MODE_KEY_CHANNELS: Record<'1P' | '2P', readonly string[]> = {
  '1P': sideKeyChannels('48', '1P'),
  '2P': sideKeyChannels('48', '2P'),
};

export function isPlayableInputChannel(channel: string): boolean {
  return channel.startsWith('1') || channel.startsWith('2');
}

export function resolveLaneChannels(notes: ReadonlyArray<ChannelLike>, playVariant?: ChartPlayVariant): string[] {
  const used = new Set(notes.map((note) => note.channel).filter(isPlayableInputChannel));
  return preferredLaneOrder(playVariant).filter((channel) => used.has(channel));
}

/**
 * The order lanes are indexed in, for every lane a play variant can use. The keyboard modes keep the table's drawing
 * order (1P wheel, 1P keys, 2P keys, 2P wheel). 9 KEY lists the BME-type `11..19`, then the PMS-STD `22..25`. The IIDX
 * families list each side by slot — the scratch first — so the 2P scratch `26` comes before `21` here; the skins put it
 * on the outer edge when they draw.
 */
function preferredLaneOrder(playVariant?: ChartPlayVariant): readonly string[] {
  if (playVariant === '24' || playVariant === '48') return KEYBOARD_LANE_ORDER[playVariant];
  if (playVariant === '9') return POPN_9KEY_LANE_ORDER;
  return IIDX_LANE_ORDER;
}

function layoutChannels(layout: PlayModeLayout): readonly string[] {
  return layout.lanes.map((lane) => lane.channel);
}

const IIDX_LANE_ORDER: readonly string[] = [...PLAY_MODE_LAYOUTS['14'].lanes]
  .sort((left, right) => left.side.localeCompare(right.side) || left.slot - right.slot)
  .map((lane) => lane.channel);
const KEYBOARD_LANE_ORDER: Record<'24' | '48', readonly string[]> = {
  '24': layoutChannels(PLAY_MODE_LAYOUTS['24']),
  '48': layoutChannels(PLAY_MODE_LAYOUTS['48']),
};
const POPN_9KEY_BME_LANES = layoutChannels(PLAY_MODE_LAYOUTS['9-bme']);
const POPN_9KEY_PMS_LANES = layoutChannels(PLAY_MODE_LAYOUTS['9-pms']);
const POPN_9KEY_LANE_ORDER: readonly string[] = [
  ...POPN_9KEY_BME_LANES,
  ...POPN_9KEY_PMS_LANES.filter((channel) => !POPN_9KEY_BME_LANES.includes(channel)),
];

/**
 * The full lane set of a chart's play variant, in rendering order — every lane of the 5 / 7 / 9 / 10 / 14 / 24 /
 * 48 KEY layout, whether or not the chart puts notes on it, so a chart that only uses a few lanes still plays on the
 * whole keyboard. 9 KEY takes the PMS layout (`22..25` on the right) when the chart uses any of those channels, the
 * BME layout (`11..19`) otherwise. Lanes the chart uses outside the variant's set are kept too, so no note loses its
 * lane. Without a variant this is {@link resolveLaneChannels}: just the lanes in use.
 */
export function resolvePlayVariantLaneChannels(
  notes: ReadonlyArray<ChannelLike>,
  playVariant?: ChartPlayVariant,
): string[] {
  const used = resolveLaneChannels(notes, playVariant);
  if (!playVariant) return used;
  let layoutId: PlayModeLayoutId;
  if (playVariant === '9') {
    const pms = used.some((channel) => POPN_9KEY_PMS_LANES.includes(channel) && !POPN_9KEY_BME_LANES.includes(channel));
    layoutId = pms ? '9-pms' : '9-bme';
  } else {
    layoutId = playVariant;
  }
  const lanes = new Set([...layoutChannels(PLAY_MODE_LAYOUTS[layoutId]), ...used]);
  return preferredLaneOrder(playVariant).filter((channel) => lanes.has(channel));
}

/** Default keys of the IIDX lanes: `Z S X D C F V` (1P) and `B H N J M K ,` (2P), the scratches on the Shift keys. */
const IIDX_DEFAULT_KEYS: Record<string, { keyLabel: string; token: string }> = {
  '16': { keyLabel: 'LShift', token: 'shift-left' },
  '11': { keyLabel: 'z', token: 'z' },
  '12': { keyLabel: 's', token: 's' },
  '13': { keyLabel: 'x', token: 'x' },
  '14': { keyLabel: 'd', token: 'd' },
  '15': { keyLabel: 'c', token: 'c' },
  '18': { keyLabel: 'f', token: 'f' },
  '19': { keyLabel: 'v', token: 'v' },
  '21': { keyLabel: 'b', token: 'b' },
  '22': { keyLabel: 'h', token: 'h' },
  '23': { keyLabel: 'n', token: 'n' },
  '24': { keyLabel: 'j', token: 'j' },
  '25': { keyLabel: 'm', token: 'm' },
  '28': { keyLabel: 'k', token: 'k' },
  '29': { keyLabel: ',', token: ',' },
  '26': { keyLabel: 'RShift', token: 'shift-right' },
};

/** Default keys of the 9 KEY layouts, by key number: `z s x d c f v g b`. */
const POPN_DEFAULT_KEYS = ['z', 's', 'x', 'd', 'c', 'f', 'v', 'g', 'b'];

/**
 * Default wheel keys. They sit on the outer edges of the keyboard, off the 24 / 48-key pool (`KEY_LAYOUT`, then
 * `f1`…): Tab / Left Shift for the 1P wheel up / down, Enter / Right Shift for the 2P wheel. The arrow keys stay free
 * for the in-play hi-speed controls.
 */
const KEYBOARD_WHEEL_DEFAULT_KEYS: Record<string, { keyLabel: string; token: string }> = {
  '1P': { keyLabel: 'Tab', token: 'tab' },
  '1Q': { keyLabel: 'LShift', token: 'shift-left' },
  '2P': { keyLabel: 'Enter', token: 'enter' },
  '2Q': { keyLabel: 'RShift', token: 'shift-right' },
};

/**
 * A layout's lanes with their default keys, in the table's lane order (the terminal player draws its lanes in this
 * order). The keyboard modes' keys take the `KEY_LAYOUT` pool in order across both sides, then `f1`…
 */
function createFixedBindings(layout: PlayModeLayout): FixedLaneDefinition[] {
  let poolIndex = 0;
  const defaultKey = (lane: PlayLane): { keyLabel: string; token: string } => {
    if (layout.variant === '24' || layout.variant === '48') {
      const wheel = KEYBOARD_WHEEL_DEFAULT_KEYS[lane.channel];
      if (wheel !== undefined) return wheel;
      const token = KEY_LAYOUT[poolIndex] ?? `f${poolIndex - KEY_LAYOUT.length + 1}`;
      poolIndex += 1;
      return { keyLabel: token, token };
    }
    if (layout.variant === '9') {
      const key = POPN_DEFAULT_KEYS[lane.slot - 1]!;
      return { keyLabel: key, token: key };
    }
    return IIDX_DEFAULT_KEYS[lane.channel]!;
  };
  return layout.lanes.map((lane) => {
    const key = defaultKey(lane);
    const definition: FixedLaneDefinition = {
      channel: lane.channel,
      keyLabel: key.keyLabel,
      inputTokens: [key.token],
      side: lane.side,
    };
    return lane.kind === 'scratch' ? { ...definition, isScratch: true } : definition;
  });
}

const FIXED_BINDINGS_BY_LAYOUT: Record<PlayModeLayoutId, FixedLaneDefinition[]> = {
  '5': createFixedBindings(PLAY_MODE_LAYOUTS['5']),
  '7': createFixedBindings(PLAY_MODE_LAYOUTS['7']),
  '9-pms': createFixedBindings(PLAY_MODE_LAYOUTS['9-pms']),
  '9-bme': createFixedBindings(PLAY_MODE_LAYOUTS['9-bme']),
  '10': createFixedBindings(PLAY_MODE_LAYOUTS['10']),
  '14': createFixedBindings(PLAY_MODE_LAYOUTS['14']),
  '24': createFixedBindings(PLAY_MODE_LAYOUTS['24']),
  '48': createFixedBindings(PLAY_MODE_LAYOUTS['48']),
};

export function createLaneBindings(channels: string[], options: LaneModeOptions = {}): LaneBinding[] {
  const existing = new Set(channels.map((channel) => normalizeChannel(channel)));
  if (existing.size === 0) {
    return [];
  }

  const modeBindings = FIXED_BINDINGS_BY_LAYOUT[resolveLaneLayout(existing, options)];
  const scratchReverseTokensByChannel = createScratchReverseTokensByChannel(modeBindings, options.platform);
  const bindings: LaneBinding[] = [];
  const usedTokens = new Set<string>();
  const definedChannels = new Set(modeBindings.map((definition) => definition.channel));

  for (const definition of modeBindings) {
    const inputTokens = [...definition.inputTokens, ...(scratchReverseTokensByChannel.get(definition.channel) ?? [])];
    bindings.push({
      channel: definition.channel,
      keyLabel: definition.keyLabel,
      inputTokens,
      side: definition.side,
      isScratch: definition.isScratch ?? false,
    });
    inputTokens.forEach((token) => usedTokens.add(token));
  }

  const unknownChannels = [...existing].filter((channel) => {
    if (definedChannels.has(channel)) {
      return false;
    }
    const scratchChannel = resolveFreeZoneScratchChannel(channel);
    if (scratchChannel && definedChannels.has(scratchChannel)) {
      return false;
    }
    return true;
  });
  unknownChannels.sort();

  let fallbackIndex = 0;
  for (const channel of unknownChannels) {
    let token = KEY_LAYOUT[fallbackIndex] ?? `f${fallbackIndex + 1}`;
    while (usedTokens.has(token)) {
      fallbackIndex += 1;
      token = KEY_LAYOUT[fallbackIndex] ?? `f${fallbackIndex + 1}`;
    }
    fallbackIndex += 1;
    usedTokens.add(token);
    bindings.push({
      channel,
      keyLabel: token,
      inputTokens: [token],
      side: 'OTHER',
      isScratch: false,
    });
  }

  return bindings;
}

export function appendFreeZoneInputChannels(
  inputTokenToChannels: Map<string, string[]>,
  bindings: LaneBinding[],
  channels: string[],
): void {
  const existing = new Set(channels.map((channel) => normalizeChannel(channel)));
  const definedChannels = new Set(bindings.map((binding) => binding.channel));

  const appendAlias = (freeZoneChannel: string, scratchChannel: string): void => {
    if (!existing.has(freeZoneChannel) || definedChannels.has(freeZoneChannel)) {
      return;
    }
    const scratchBinding = bindings.find((binding) => binding.channel === scratchChannel);
    if (!scratchBinding) {
      return;
    }
    for (const token of scratchBinding.inputTokens) {
      const normalizedToken = token.toLowerCase();
      const mappedChannels = inputTokenToChannels.get(normalizedToken) ?? [];
      if (!mappedChannels.includes(freeZoneChannel)) {
        mappedChannels.push(freeZoneChannel);
        inputTokenToChannels.set(normalizedToken, mappedChannels);
      }
    }
  };

  for (const zone of IIDX_FREE_ZONES) {
    appendAlias(zone.channel, zone.scratch);
  }
}

export function resolveLaneDisplayMode(channels: string[], options: LaneModeOptions = {}): string {
  const existing = new Set(channels.map((channel) => normalizeChannel(channel)));
  if (existing.size === 0) {
    return 'UNKNOWN';
  }
  return PLAY_MODE_LAYOUTS[resolveLaneLayout(existing, options)].label;
}

/**
 * Lane layout for a channel set. The play variant always comes from `resolveChartPlayVariant` (`@be-music/chart`), the
 * rule every host shares: the host-declared `playVariant` when there is one, otherwise the shared rule run over these
 * channels, `chartExtension`, and `player`. There is deliberately no second heuristic here, so the engine, the CLI, and
 * the web hosts cannot disagree on 5 KEY vs 7 KEY (and on the beatoraja judge windows that follow from it). 9 KEY then
 * picks its PMS-STD or BME-type layout from the channels.
 */
function resolveLaneLayout(existing: ReadonlySet<string>, options: LaneModeOptions): PlayModeLayoutId {
  const variant =
    options.playVariant ??
    resolveChartPlayVariant({
      chartPath: options.chartExtension,
      events: Array.from(existing, (channel) => ({ channel })),
      bms: { player: options.player },
    });
  if (variant !== '9') {
    return variant;
  }
  return resolvePms9KeyLayout(existing, options.chartExtension);
}

function createScratchReverseTokensByChannel(
  bindings: readonly FixedLaneDefinition[],
  platform: NodeJS.Platform = resolveDefaultPlatform(),
): Map<string, readonly string[]> {
  const scratchChannels = bindings.filter((binding) => binding.isScratch).map((binding) => binding.channel);
  const tokenMap = new Map<string, readonly string[]>();

  if (scratchChannels.includes('16')) {
    tokenMap.set('16', platform === 'darwin' ? ['option-left', 'alt-left'] : ['ctrl-left', 'control-left']);
  }
  if (scratchChannels.includes('26')) {
    tokenMap.set('26', platform === 'darwin' ? ['option-right', 'alt-right'] : ['ctrl-right', 'control-right']);
  }

  return tokenMap;
}

/**
 * Browser-safe `process.platform` lookup. Falls back to `'linux'` when running outside Node — the value is only
 * consulted by the scratch-reverse token mapping (option / ctrl modifier choice), and `'linux'` produces the
 * non-darwin tokens the engine's web-based callers expect. Bare `process.platform` would throw a
 * `ReferenceError` on first chart load in a browser bundle that doesn't ship a `process` polyfill.
 */
function resolveDefaultPlatform(): NodeJS.Platform {
  const proc = (globalThis as { process?: { platform?: NodeJS.Platform } }).process;
  return proc?.platform ?? ('linux' as NodeJS.Platform);
}

/** The keys only one 9 KEY layout has: PMS-STD's `22..25` and the BME type's `16..19`. */
const PMS_STD_ONLY_CHANNELS = POPN_9KEY_PMS_LANES.filter((channel) => !POPN_9KEY_BME_LANES.includes(channel));
const PMS_BME_ONLY_CHANNELS = POPN_9KEY_BME_LANES.filter((channel) => !POPN_9KEY_PMS_LANES.includes(channel));

function resolvePms9KeyLayout(existing: ReadonlySet<string>, chartExtension: string | undefined): '9-pms' | '9-bme' {
  const pmsLayoutScore = countExistingChannels(existing, PMS_STD_ONLY_CHANNELS);
  const bmeLayoutScore = countExistingChannels(existing, PMS_BME_ONLY_CHANNELS);

  if (pmsLayoutScore === 0 && bmeLayoutScore === 0) {
    return isPmsExtension(chartExtension) ? '9-pms' : '9-bme';
  }
  return pmsLayoutScore >= bmeLayoutScore ? '9-pms' : '9-bme';
}

function countExistingChannels(existing: ReadonlySet<string>, channels: readonly string[]): number {
  let count = 0;
  for (const channel of channels) {
    if (existing.has(channel)) {
      count += 1;
    }
  }
  return count;
}

function isPmsExtension(chartExtension: string | undefined): boolean {
  return typeof chartExtension === 'string' && chartExtension.trim().toLowerCase() === '.pms';
}

/** The IIDX FREE ZONE channels, each played on its side's scratch (`17` → `16`, `27` → `26`). */
const IIDX_FREE_ZONES = PLAY_MODE_LAYOUTS['14'].freeZones;

function resolveFreeZoneScratchChannel(channel: string): string | undefined {
  const normalized = normalizeChannel(channel);
  return IIDX_FREE_ZONES.find((zone) => zone.channel === normalized)?.scratch;
}

const EXTENDED_LANE_DIGITS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Lanes per side in the keyboard modes — the 24 keys, then the wheel up / down (`1P` / `1Q`). */
const KEYBOARD_MODE_SIDE_LANE_COUNT = PLAY_MODE_LAYOUTS['24'].lanes.length;

function resolveLaneIndex(lane: string): number | undefined {
  const index = EXTENDED_LANE_DIGITS.indexOf(lane.toUpperCase());
  if (index < 0) {
    return undefined;
  }
  return index + 1;
}

export function createInputTokenToChannelsMap(bindings: LaneBinding[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const binding of bindings) {
    for (const token of binding.inputTokens) {
      const normalized = token.toLowerCase();
      const channels = map.get(normalized) ?? [];
      channels.push(binding.channel);
      map.set(normalized, channels);
    }
  }
  return map;
}
