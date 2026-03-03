import readline from 'node:readline';
import { normalizeChannel } from '@be-music/json';

export interface LaneBinding {
  channel: string;
  keyLabel: string;
  inputTokens: string[];
  side: '1P' | '2P' | 'OTHER';
  isScratch: boolean;
}

type LaneMode = '5-key-sp' | '5-key-dp' | '7-key-sp' | '14-key-dp' | '9-key' | '24-key-sp' | '48-key-dp';

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
}

const IIDX_5KEY_SP_BINDINGS: FixedLaneDefinition[] = [
  { channel: '16', keyLabel: 'a', inputTokens: ['a'], side: '1P', isScratch: true },
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
  { channel: '21', keyLabel: ',', inputTokens: [','], side: '2P' },
  { channel: '22', keyLabel: 'l', inputTokens: ['l'], side: '2P' },
  { channel: '23', keyLabel: '.', inputTokens: ['.'], side: '2P' },
  { channel: '24', keyLabel: ';', inputTokens: [';'], side: '2P' },
  { channel: '25', keyLabel: '/', inputTokens: ['/'], side: '2P' },
  { channel: '26', keyLabel: ']', inputTokens: [']'], side: '2P', isScratch: true },
];

const IIDX_14KEY_DP_BINDINGS: FixedLaneDefinition[] = [
  ...IIDX_7KEY_SP_BINDINGS,
  { channel: '21', keyLabel: ',', inputTokens: [','], side: '2P' },
  { channel: '22', keyLabel: 'l', inputTokens: ['l'], side: '2P' },
  { channel: '23', keyLabel: '.', inputTokens: ['.'], side: '2P' },
  { channel: '24', keyLabel: ';', inputTokens: [';'], side: '2P' },
  { channel: '25', keyLabel: '/', inputTokens: ['/'], side: '2P' },
  { channel: '28', keyLabel: ':', inputTokens: [':'], side: '2P' },
  { channel: '29', keyLabel: '_', inputTokens: ['_'], side: '2P' },
  { channel: '26', keyLabel: ']', inputTokens: [']'], side: '2P', isScratch: true },
];

const POPN_9KEY_BINDINGS: FixedLaneDefinition[] = [
  { channel: '11', keyLabel: 'a', inputTokens: ['a'], side: '1P' },
  { channel: '12', keyLabel: 's', inputTokens: ['s'], side: '1P' },
  { channel: '13', keyLabel: 'd', inputTokens: ['d'], side: '1P' },
  { channel: '14', keyLabel: 'f', inputTokens: ['f'], side: '1P' },
  { channel: '15', keyLabel: 'g', inputTokens: ['g'], side: '1P' },
  { channel: '16', keyLabel: 'h', inputTokens: ['h'], side: '1P' },
  { channel: '17', keyLabel: 'j', inputTokens: ['j'], side: '1P' },
  { channel: '18', keyLabel: 'k', inputTokens: ['k'], side: '1P' },
  { channel: '19', keyLabel: 'l', inputTokens: ['l'], side: '1P' },
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
  '9-key': POPN_9KEY_BINDINGS,
  '24-key-sp': KBM_24KEY_SP_BINDINGS,
  '48-key-dp': KBM_48KEY_DP_BINDINGS,
};

export function createLaneBindings(channels: string[], options: LaneModeOptions = {}): LaneBinding[] {
  const existing = new Set(channels.map((channel) => normalizeChannel(channel)));
  if (existing.size === 0) {
    return [];
  }

  const mode = resolveLaneMode(existing, options);
  const modeBindings = FIXED_BINDINGS_BY_MODE[mode];
  const bindings: LaneBinding[] = [];
  const usedTokens = new Set<string>();
  const definedChannels = new Set(modeBindings.map((definition) => definition.channel));

  for (const definition of modeBindings) {
    bindings.push({
      channel: definition.channel,
      keyLabel: definition.keyLabel,
      inputTokens: [...definition.inputTokens],
      side: definition.side,
      isScratch: definition.isScratch ?? false,
    });
    definition.inputTokens.forEach((token) => usedTokens.add(token));
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
  return LANE_MODE_LABELS[resolveLaneMode(existing, options)];
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

  if (hasExtendedLane) {
    return has2P ? '48-key-dp' : '24-key-sp';
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
  if (typeof chartExtension !== 'string') {
    return undefined;
  }
  const normalized = chartExtension.trim().toLowerCase();
  if (normalized === '.pms') {
    return '9-key';
  }
  if (normalized === '.bme') {
    return has2P ? '14-key-dp' : '7-key-sp';
  }
  if (normalized === '.bms') {
    return has2P ? '5-key-dp' : '5-key-sp';
  }
  return undefined;
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

export function resolveInputTokens(chunk: string, key: readline.Key): string[] {
  const tokens = new Set<string>();
  const normalizedChunk = normalizeKey(chunk);
  if (normalizedChunk) {
    tokens.add(normalizedChunk);
  }

  if (isStandaloneShiftKeypress(chunk, key)) {
    tokens.add('shift');
    return [...tokens];
  }

  if (isStandaloneControlKeypress(chunk, key)) {
    tokens.add('ctrl');
    tokens.add('control');
    return [...tokens];
  }

  if (key.name) {
    const normalizedName = key.name.toLowerCase();
    tokens.add(normalizedName);
    if (normalizedName === 'return') {
      tokens.add('enter');
    } else if (normalizedName === 'enter') {
      tokens.add('return');
    } else if (normalizedName === 'ctrl') {
      tokens.add('control');
    } else if (normalizedName === 'control') {
      tokens.add('ctrl');
    }
  }

  return [...tokens];
}

function isStandaloneShiftKeypress(chunk: string, key: readline.Key): boolean {
  if (key.name === 'shift') {
    return true;
  }

  const sequence = key.sequence ?? '';
  return chunk.length === 0 && sequence.length === 0 && Boolean(key.shift) && !key.ctrl && !key.meta && !key.name;
}

function isStandaloneControlKeypress(chunk: string, key: readline.Key): boolean {
  if (key.name === 'ctrl' || key.name === 'control') {
    return true;
  }

  const sequence = key.sequence ?? '';
  return chunk.length === 0 && sequence.length === 0 && Boolean(key.ctrl) && !key.shift && !key.meta && !key.name;
}

function normalizeKey(value: string): string {
  return value.length === 1 ? value.toLowerCase() : value;
}
