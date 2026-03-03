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
  { channel: '16', keyLabel: 'LShift', inputTokens: ['shift-left', 'a'], side: '1P', isScratch: true },
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
  { channel: '26', keyLabel: 'RShift', inputTokens: ['shift-right', ']'], side: '2P', isScratch: true },
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
  { channel: '26', keyLabel: 'RShift', inputTokens: ['shift-right', ']'], side: '2P', isScratch: true },
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

interface KittyKeyboardEvent {
  keyCode: number;
  shiftedKeyCode?: number;
  baseKeyCode?: number;
  modifiers: number;
  eventType: number;
}

export interface ResolvedInputTokenEvent {
  tokens: string[];
  releaseTokens: string[];
  kittyProtocolEvent: boolean;
}

const KITTY_KEYBOARD_PROTOCOL_ENABLE_FLAGS = 11;
const KITTY_KEYBOARD_PROTOCOL_ENABLE_SEQUENCE = `\u001b[>${KITTY_KEYBOARD_PROTOCOL_ENABLE_FLAGS}u`;
const KITTY_KEYBOARD_PROTOCOL_DISABLE_SEQUENCE = '\u001b[<u';
const KITTY_MODIFIER_SHIFT_MASK = 1;
const KITTY_MODIFIER_CTRL_MASK = 4;
const KITTY_EVENT_TYPE_RELEASE = 3;
const KITTY_LEFT_SHIFT_KEY_CODES = new Set([57_441, 441]);
const KITTY_RIGHT_SHIFT_KEY_CODES = new Set([57_447, 447]);

export function beginKittyKeyboardProtocolOptIn(stdout: NodeJS.WriteStream = process.stdout): () => void {
  if (!stdout.isTTY || !process.stdin.isTTY) {
    return () => undefined;
  }
  stdout.write(KITTY_KEYBOARD_PROTOCOL_ENABLE_SEQUENCE);
  let ended = false;
  return () => {
    if (ended) {
      return;
    }
    ended = true;
    stdout.write(KITTY_KEYBOARD_PROTOCOL_DISABLE_SEQUENCE);
  };
}

export function resolveInputTokenEvent(chunk: string, key: readline.Key): ResolvedInputTokenEvent {
  const kittyEvents = parseKittyKeyboardEvents(chunk, key);
  if (kittyEvents.length > 0) {
    const tokens = new Set<string>();
    const releaseTokens = new Set<string>();
    for (const kittyEvent of kittyEvents) {
      const kittyTokens = resolveKittyInputTokens(kittyEvent);
      if (kittyEvent.eventType === KITTY_EVENT_TYPE_RELEASE) {
        kittyTokens.forEach((token) => releaseTokens.add(token));
        continue;
      }
      kittyTokens.forEach((token) => tokens.add(token));
    }
    return {
      tokens: [...tokens],
      releaseTokens: [...releaseTokens],
      kittyProtocolEvent: true,
    };
  }

  return {
    tokens: resolveLegacyInputTokens(chunk, key),
    releaseTokens: [],
    kittyProtocolEvent: false,
  };
}

export function resolveInputTokens(chunk: string, key: readline.Key): string[] {
  return resolveInputTokenEvent(chunk, key).tokens;
}

function resolveLegacyInputTokens(chunk: string, key: readline.Key): string[] {
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

function parseKittyKeyboardEvents(chunk: string, key: readline.Key): KittyKeyboardEvent[] {
  const sequence = chunk.length > 0 ? chunk : (key.sequence ?? '');
  if (sequence.length === 0) {
    return [];
  }

  const events: KittyKeyboardEvent[] = [];
  const normalizedSequence = sequence.replaceAll('\u001b[', '');
  const regex = /([0-9]+(?::[0-9]+){0,2})(?:;([0-9]+(?::[0-9]+)?))?u/g;

  for (const match of normalizedSequence.matchAll(regex)) {
    const keyPart = match[1];
    if (typeof keyPart !== 'string') {
      continue;
    }
    const keyCodeParts = keyPart.split(':');
    const keyCode = parseNumericPart(keyCodeParts[0]);
    if (keyCode === undefined) {
      continue;
    }
    const shiftedKeyCode = parseNumericPart(keyCodeParts[1]);
    const baseKeyCode = parseNumericPart(keyCodeParts[2]);
    let modifiers = 1;
    let eventType = 1;
    const modifierPart = match[2];
    if (typeof modifierPart === 'string') {
      const [rawModifiers, rawEventType] = modifierPart.split(':');
      const parsedModifiers = parseNumericPart(rawModifiers);
      if (parsedModifiers !== undefined) {
        modifiers = parsedModifiers;
      }
      const parsedEventType = parseNumericPart(rawEventType);
      if (parsedEventType !== undefined) {
        eventType = parsedEventType;
      }
    }
    events.push({
      keyCode,
      shiftedKeyCode,
      baseKeyCode,
      modifiers,
      eventType,
    });
  }
  return events;
}

function parseNumericPart(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value.length === 0 || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveKittyInputTokens(event: KittyKeyboardEvent): Set<string> {
  const tokens = new Set<string>();
  const modifierBits = Math.max(0, event.modifiers - 1);
  const hasShift = (modifierBits & KITTY_MODIFIER_SHIFT_MASK) !== 0;
  const hasCtrl = (modifierBits & KITTY_MODIFIER_CTRL_MASK) !== 0;
  const hasNonShiftModifier = (modifierBits & ~KITTY_MODIFIER_SHIFT_MASK) !== 0;
  const implicitShiftByKeyCode = event.keyCode >= 65 && event.keyCode <= 90;

  if (KITTY_LEFT_SHIFT_KEY_CODES.has(event.keyCode)) {
    tokens.add('shift-left');
    tokens.add('shift');
    return tokens;
  }
  if (KITTY_RIGHT_SHIFT_KEY_CODES.has(event.keyCode)) {
    tokens.add('shift-right');
    tokens.add('shift');
    return tokens;
  }

  if (event.keyCode === 27) {
    tokens.add('escape');
  } else if (event.keyCode === 13) {
    tokens.add('enter');
    tokens.add('return');
  } else if (event.keyCode === 32) {
    tokens.add('space');
  } else if (event.keyCode === 9) {
    tokens.add('tab');
  }

  const printableToken = resolveKittyPrintableToken(event);
  if (printableToken && !hasNonShiftModifier) {
    tokens.add(printableToken);
    if ((hasShift || implicitShiftByKeyCode) && /^[a-z]$/.test(printableToken)) {
      tokens.add(`shift+${printableToken}`);
    }
  }
  if (hasCtrl && printableToken) {
    tokens.add('ctrl');
    tokens.add('control');
    tokens.add(`ctrl+${printableToken}`);
  }

  return tokens;
}

function resolveKittyPrintableToken(event: KittyKeyboardEvent): string | undefined {
  const codePoint = event.baseKeyCode ?? event.keyCode;
  if (!Number.isFinite(codePoint) || codePoint < 32 || codePoint > 126) {
    return undefined;
  }
  const value = String.fromCodePoint(codePoint);
  if (!value) {
    return undefined;
  }
  return normalizeKey(value);
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
