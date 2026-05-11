import { normalizeChannel } from '@be-music/json';

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

export type ChartPlayVariant = '5' | '7' | '9' | '10' | '14';

export interface KeyboardCodeLike {
  code: string;
}

type LaneMode = '5-key-sp' | '5-key-dp' | '7-key-sp' | '14-key-dp' | '9-key' | '24-key-sp' | '48-key-dp';
type Pms9KeyLayout = 'standard' | 'compat';

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

const LANE_MODE_LABELS: Record<LaneMode, string> = {
  '5-key-sp': '5 KEY SP',
  '5-key-dp': '5 KEY DP',
  '7-key-sp': '7 KEY SP',
  '14-key-dp': '14 KEY DP',
  '9-key': '9 KEY',
  '24-key-sp': '24 KEY SP',
  '48-key-dp': '48 KEY DP',
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
   * Direct lane-mode override. When the host has already classified the chart's variant
   * (e.g. via `resolveChartPlayVariant` from `@be-music/chart`), pass it here to bypass the
   * content-based heuristic entirely. Useful for charts the heuristic under-classifies —
   * notably `.bme` POPN-9 charts authored with `#PLAYER 1` + channels 16/17/18/19, which the
   * heuristic would route to `7-key-sp`.
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
  if (playVariant === '9') return slot;
  return channel.startsWith('2') ? 10 + slot : slot;
}

export function resolveSideRelativeLaneIndex(channel: string, playVariant?: ChartPlayVariant): number {
  const slot = resolveSideKeySlot(channel, playVariant);
  return slot < 0 ? 0 : slot;
}

export function isScratch(channel: string): boolean {
  return channel === '16' || channel === '26';
}

export function isPlayableInputChannel(channel: string): boolean {
  return channel.startsWith('1') || channel.startsWith('2');
}

export function resolveLaneChannels(notes: ReadonlyArray<ChannelLike>, playVariant?: ChartPlayVariant): string[] {
  const preferred =
    playVariant === '9'
      ? ['11', '12', '13', '14', '15', '16', '17', '18', '19', '22', '23', '24', '25']
      : ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'];
  const used = new Set(notes.map((note) => note.channel).filter(isPlayableInputChannel));
  return preferred.filter((channel) => used.has(channel));
}

const IIDX_5KEY_SP_BINDINGS: FixedLaneDefinition[] = [
  { channel: '16', keyLabel: 'LShift', inputTokens: ['shift-left'], side: '1P', isScratch: true },
  { channel: '11', keyLabel: 'z', inputTokens: ['z'], side: '1P' },
  { channel: '12', keyLabel: 's', inputTokens: ['s'], side: '1P' },
  { channel: '13', keyLabel: 'x', inputTokens: ['x'], side: '1P' },
  { channel: '14', keyLabel: 'd', inputTokens: ['d'], side: '1P' },
  { channel: '15', keyLabel: 'c', inputTokens: ['c'], side: '1P' },
];

const IIDX_7KEY_SP_BINDINGS: FixedLaneDefinition[] = [
  ...IIDX_5KEY_SP_BINDINGS,
  { channel: '18', keyLabel: 'f', inputTokens: ['f'], side: '1P' },
  { channel: '19', keyLabel: 'v', inputTokens: ['v'], side: '1P' },
];

const IIDX_5KEY_DP_BINDINGS: FixedLaneDefinition[] = [
  ...IIDX_5KEY_SP_BINDINGS,
  { channel: '21', keyLabel: 'b', inputTokens: ['b'], side: '2P' },
  { channel: '22', keyLabel: 'h', inputTokens: ['h'], side: '2P' },
  { channel: '23', keyLabel: 'n', inputTokens: ['n'], side: '2P' },
  { channel: '24', keyLabel: 'j', inputTokens: ['j'], side: '2P' },
  { channel: '25', keyLabel: 'm', inputTokens: ['m'], side: '2P' },
  { channel: '26', keyLabel: 'RShift', inputTokens: ['shift-right'], side: '2P', isScratch: true },
];

const IIDX_14KEY_DP_BINDINGS: FixedLaneDefinition[] = [
  ...IIDX_7KEY_SP_BINDINGS,
  { channel: '21', keyLabel: 'b', inputTokens: ['b'], side: '2P' },
  { channel: '22', keyLabel: 'h', inputTokens: ['h'], side: '2P' },
  { channel: '23', keyLabel: 'n', inputTokens: ['n'], side: '2P' },
  { channel: '24', keyLabel: 'j', inputTokens: ['j'], side: '2P' },
  { channel: '25', keyLabel: 'm', inputTokens: ['m'], side: '2P' },
  { channel: '28', keyLabel: 'k', inputTokens: ['k'], side: '2P' },
  { channel: '29', keyLabel: ',', inputTokens: [','], side: '2P' },
  { channel: '26', keyLabel: 'RShift', inputTokens: ['shift-right'], side: '2P', isScratch: true },
];

const POPN_9KEY_BME_BINDINGS: FixedLaneDefinition[] = [
  { channel: '11', keyLabel: 'z', inputTokens: ['z'], side: '1P' },
  { channel: '12', keyLabel: 's', inputTokens: ['s'], side: '1P' },
  { channel: '13', keyLabel: 'x', inputTokens: ['x'], side: '1P' },
  { channel: '14', keyLabel: 'd', inputTokens: ['d'], side: '1P' },
  { channel: '15', keyLabel: 'c', inputTokens: ['c'], side: '1P' },
  { channel: '16', keyLabel: 'f', inputTokens: ['f'], side: '1P' },
  { channel: '17', keyLabel: 'v', inputTokens: ['v'], side: '1P' },
  { channel: '18', keyLabel: 'g', inputTokens: ['g'], side: '1P' },
  { channel: '19', keyLabel: 'b', inputTokens: ['b'], side: '1P' },
];

const POPN_9KEY_PMS_BINDINGS: FixedLaneDefinition[] = [
  { channel: '11', keyLabel: 'z', inputTokens: ['z'], side: '1P' },
  { channel: '12', keyLabel: 's', inputTokens: ['s'], side: '1P' },
  { channel: '13', keyLabel: 'x', inputTokens: ['x'], side: '1P' },
  { channel: '14', keyLabel: 'd', inputTokens: ['d'], side: '1P' },
  { channel: '15', keyLabel: 'c', inputTokens: ['c'], side: '1P' },
  { channel: '22', keyLabel: 'f', inputTokens: ['f'], side: '1P' },
  { channel: '23', keyLabel: 'v', inputTokens: ['v'], side: '1P' },
  { channel: '24', keyLabel: 'g', inputTokens: ['g'], side: '1P' },
  { channel: '25', keyLabel: 'b', inputTokens: ['b'], side: '1P' },
];

const EXTENDED_LANE_DIGITS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const KEYBOARDMANIA_SIDE_CHANNELS = EXTENDED_LANE_DIGITS.slice(0, 24);

const KBM_24KEY_SP_BINDINGS = createKeyboardModeBindings([['1', '1P']], KEYBOARDMANIA_SIDE_CHANNELS);
const KBM_48KEY_DP_BINDINGS = createKeyboardModeBindings(
  [
    ['1', '1P'],
    ['2', '2P'],
  ],
  KEYBOARDMANIA_SIDE_CHANNELS,
);

const FIXED_BINDINGS_BY_MODE: Record<LaneMode, FixedLaneDefinition[]> = {
  '5-key-sp': IIDX_5KEY_SP_BINDINGS,
  '5-key-dp': IIDX_5KEY_DP_BINDINGS,
  '7-key-sp': IIDX_7KEY_SP_BINDINGS,
  '14-key-dp': IIDX_14KEY_DP_BINDINGS,
  '9-key': POPN_9KEY_BME_BINDINGS,
  '24-key-sp': KBM_24KEY_SP_BINDINGS,
  '48-key-dp': KBM_48KEY_DP_BINDINGS,
};

export function createLaneBindings(channels: string[], options: LaneModeOptions = {}): LaneBinding[] {
  const existing = new Set(channels.map((channel) => normalizeChannel(channel)));
  if (existing.size === 0) {
    return [];
  }

  const mode = resolveLaneMode(existing, options);
  const modeBindings = resolveModeBindings(mode, existing, options);
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

  appendAlias('17', '16');
  appendAlias('27', '26');
}

export function resolveLaneDisplayMode(channels: string[], options: LaneModeOptions = {}): string {
  const existing = new Set(channels.map((channel) => normalizeChannel(channel)));
  if (existing.size === 0) {
    return 'UNKNOWN';
  }
  const mode = resolveLaneMode(existing, options);
  const label = LANE_MODE_LABELS[mode];
  if (mode !== '9-key') {
    return label;
  }
  const layout = resolvePms9KeyLayout(existing, options.chartExtension);
  return `${label} (${layout === 'standard' ? 'PMS-STD' : 'PMS-COMPAT'})`;
}

function resolveLaneMode(existing: ReadonlySet<string>, options: LaneModeOptions): LaneMode {
  const hasExtendedLane = [...existing].some((channel) => {
    if (channel.length !== 2) {
      return false;
    }
    if (channel[0] !== '1' && channel[0] !== '2') {
      return false;
    }
    const laneIndex = resolveLaneIndex(channel[1]);
    return laneIndex !== undefined && laneIndex > 9;
  });
  const has2P = [...existing].some((channel) => is2PSideLaneChannel(channel));
  const has7KeyMarker = existing.has('18') || existing.has('19');
  const has14KeyMarker = has7KeyMarker || existing.has('28') || existing.has('29');

  // **Direct host override** — when the caller already classified the variant (e.g. the
  // gameplay scene's `resolveChartPlayVariant`-derived `chartVariant`), trust it and bypass
  // the heuristic.  Especially important for `.bme` POPN-9 charts authored with `#PLAYER 1`
  // + channels 16/17/18/19: the heuristic below routes those to `7-key-sp` (channel 16 →
  // scratch, 17 → FREE ZONE), dropping the `f/v/g/b` POPN-9 key bindings and the channel-17
  // notes from `scorableNotes`.  Host-driven classification — even when based on the same
  // heuristic — gives the rest of the pipeline a single source of truth.
  if (options.playVariant !== undefined) {
    switch (options.playVariant) {
      case '5':
        return '5-key-sp';
      case '7':
        return '7-key-sp';
      case '9':
        return '9-key';
      case '10':
        return '5-key-dp';
      case '14':
        return '14-key-dp';
    }
  }

  if (hasExtendedLane) {
    return has2P ? '48-key-dp' : '24-key-sp';
  }

  if (isPmsExtension(options.chartExtension)) {
    return '9-key';
  }

  if (has2P && has14KeyMarker) {
    return '14-key-dp';
  }

  if (options.player === 3 && existing.has('17')) {
    return '9-key';
  }

  if (has7KeyMarker) {
    return '7-key-sp';
  }

  const fallback = resolveLaneModeByExtension(options.chartExtension, has2P);
  if (fallback) {
    return fallback;
  }

  if (has2P) {
    return '5-key-dp';
  }

  return '5-key-sp';
}

function resolveLaneModeByExtension(chartExtension: string | undefined, has2P: boolean): LaneMode | undefined {
  if (isPmsExtension(chartExtension)) {
    return '9-key';
  }
  if (typeof chartExtension !== 'string') {
    return undefined;
  }
  const normalized = chartExtension.trim().toLowerCase();
  if (normalized === '.bme') {
    return has2P ? '14-key-dp' : '7-key-sp';
  }
  if (normalized === '.bms') {
    return has2P ? '5-key-dp' : '5-key-sp';
  }
  return undefined;
}

function resolveModeBindings(
  mode: LaneMode,
  existing: ReadonlySet<string>,
  options: LaneModeOptions,
): FixedLaneDefinition[] {
  if (mode !== '9-key') {
    return FIXED_BINDINGS_BY_MODE[mode];
  }
  return resolvePms9KeyBindings(existing, options.chartExtension);
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

function resolvePms9KeyBindings(
  existing: ReadonlySet<string>,
  chartExtension: string | undefined,
): FixedLaneDefinition[] {
  if (resolvePms9KeyLayout(existing, chartExtension) === 'standard') {
    return POPN_9KEY_PMS_BINDINGS;
  }
  return POPN_9KEY_BME_BINDINGS;
}

function resolvePms9KeyLayout(existing: ReadonlySet<string>, chartExtension: string | undefined): Pms9KeyLayout {
  const pmsLayoutChannels = ['22', '23', '24', '25'];
  const bmeLayoutChannels = ['16', '17', '18', '19'];
  const pmsLayoutScore = countExistingChannels(existing, pmsLayoutChannels);
  const bmeLayoutScore = countExistingChannels(existing, bmeLayoutChannels);

  if (pmsLayoutScore === 0 && bmeLayoutScore === 0) {
    return isPmsExtension(chartExtension) ? 'standard' : 'compat';
  }
  return pmsLayoutScore >= bmeLayoutScore ? 'standard' : 'compat';
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

function resolveFreeZoneScratchChannel(channel: string): string | undefined {
  const normalized = normalizeChannel(channel);
  if (normalized === '17') {
    return '16';
  }
  if (normalized === '27') {
    return '26';
  }
  return undefined;
}

function is2PSideLaneChannel(channel: string): boolean {
  if (channel.length !== 2) {
    return false;
  }
  if (channel[0] !== '2') {
    return false;
  }
  return resolveLaneIndex(channel[1]) !== undefined;
}

function resolveLaneIndex(lane: string): number | undefined {
  const index = EXTENDED_LANE_DIGITS.indexOf(lane.toUpperCase());
  if (index < 0) {
    return undefined;
  }
  return index + 1;
}

function createKeyboardModeBindings(
  sides: Array<[prefix: '1' | '2', side: '1P' | '2P']>,
  laneChars: string,
): FixedLaneDefinition[] {
  const bindings: FixedLaneDefinition[] = [];
  let fallbackIndex = 0;

  const nextToken = (): string => {
    const token = KEY_LAYOUT[fallbackIndex] ?? `f${fallbackIndex - KEY_LAYOUT.length + 1}`;
    fallbackIndex += 1;
    return token;
  };

  for (const [prefix, side] of sides) {
    for (const lane of laneChars) {
      const token = nextToken();
      bindings.push({
        channel: `${prefix}${lane}`,
        keyLabel: token,
        inputTokens: [token],
        side,
      });
    }
  }

  return bindings;
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
