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
type Pms9KeyLayout = 'standard' | 'compat';

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
  platform: NodeJS.Platform = process.platform,
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

function resolvePms9KeyBindings(
  existing: ReadonlySet<string>,
  chartExtension: string | undefined,
): FixedLaneDefinition[] {
  if (resolvePms9KeyLayout(existing, chartExtension) === 'standard') {
    return POPN_9KEY_PMS_BINDINGS;
  }
  return POPN_9KEY_BME_BINDINGS;
}

function resolvePms9KeyLayout(
  existing: ReadonlySet<string>,
  chartExtension: string | undefined,
): Pms9KeyLayout {
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

interface KittyKeyboardEvent {
  keyCode: number;
  shiftedKeyCode?: number;
  baseKeyCode?: number;
  modifiers: number;
  eventType: number;
}

export interface ResolvedInputTokenEvent {
  tokens: string[];
  repeatTokens: string[];
  releaseTokens: string[];
  protocol: 'legacy' | 'kitty' | 'win32';
  kittyProtocolEvent: boolean;
}

export interface InputProtocolInspection {
  protocol: 'legacy' | 'kitty' | 'win32';
  detected: boolean;
  tokens: string[];
  repeatTokens: string[];
  releaseTokens: string[];
}

export interface InspectedInputTokenEvent {
  selected: ResolvedInputTokenEvent;
  protocols: {
    legacy: InputProtocolInspection;
    kitty: InputProtocolInspection;
    win32: InputProtocolInspection;
  };
}

const KITTY_KEYBOARD_PROTOCOL_ENABLE_FLAGS = 11;
const KITTY_KEYBOARD_PROTOCOL_ENABLE_SEQUENCE = `\u001b[>${KITTY_KEYBOARD_PROTOCOL_ENABLE_FLAGS}u`;
const KITTY_KEYBOARD_PROTOCOL_DISABLE_SEQUENCE = '\u001b[<u';
const KITTY_MODIFIER_SHIFT_MASK = 1;
const KITTY_MODIFIER_ALT_MASK = 2;
const KITTY_MODIFIER_CTRL_MASK = 4;
const KITTY_EVENT_TYPE_REPEAT = 2;
const KITTY_EVENT_TYPE_RELEASE = 3;
const KITTY_LEFT_SHIFT_KEY_CODES = new Set([57_441, 441]);
const KITTY_RIGHT_SHIFT_KEY_CODES = new Set([57_447, 447]);
const KITTY_LEFT_CTRL_KEY_CODES = new Set([57_442, 442]);
const KITTY_RIGHT_CTRL_KEY_CODES = new Set([57_448, 448]);
const KITTY_LEFT_ALT_KEY_CODES = new Set([57_443, 443]);
const KITTY_RIGHT_ALT_KEY_CODES = new Set([57_449, 449]);
const WIN32_INPUT_MODE_ENABLE_SEQUENCE = '\u001b[?9001h';
const WIN32_INPUT_MODE_DISABLE_SEQUENCE = '\u001b[?9001l';
const WIN32_CONTROL_STATE_RIGHT_ALT = 0x0001;
const WIN32_CONTROL_STATE_LEFT_ALT = 0x0002;
const WIN32_CONTROL_STATE_RIGHT_CTRL = 0x0004;
const WIN32_CONTROL_STATE_LEFT_CTRL = 0x0008;
const WIN32_CONTROL_STATE_SHIFT = 0x0010;
const WIN32_VK_SHIFT = 0x10;
const WIN32_VK_CONTROL = 0x11;
const WIN32_VK_MENU = 0x12;
const WIN32_VK_RETURN = 0x0d;
const WIN32_VK_ESCAPE = 0x1b;
const WIN32_VK_SPACE = 0x20;
const WIN32_VK_TAB = 0x09;

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

export function beginWin32InputModeOptIn(stdout: NodeJS.WriteStream = process.stdout): () => void {
  if (!stdout.isTTY || !process.stdin.isTTY) {
    return () => undefined;
  }
  stdout.write(WIN32_INPUT_MODE_ENABLE_SEQUENCE);
  let ended = false;
  return () => {
    if (ended) {
      return;
    }
    ended = true;
    stdout.write(WIN32_INPUT_MODE_DISABLE_SEQUENCE);
  };
}

export function beginStatefulKeyboardProtocolOptIn(
  stdout: NodeJS.WriteStream = process.stdout,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  const protocols = resolveEnabledStatefulKeyboardProtocols(platform, env);
  const stopKitty = protocols.kitty ? beginKittyKeyboardProtocolOptIn(stdout) : () => undefined;
  const stopWin32 = protocols.win32 ? beginWin32InputModeOptIn(stdout) : () => undefined;
  let ended = false;
  return () => {
    if (ended) {
      return;
    }
    ended = true;
    stopWin32();
    stopKitty();
  };
}

function resolveEnabledStatefulKeyboardProtocols(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { kitty: boolean; win32: boolean } {
  const override = env.BE_MUSIC_KEYBOARD_PROTOCOLS?.trim().toLowerCase();
  if (override) {
    const values = new Set(
      override
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    );
    return {
      kitty: values.has('kitty'),
      win32: values.has('win32'),
    };
  }

  if (platform === 'win32') {
    return {
      kitty: false,
      win32: true,
    };
  }

  return {
    kitty: true,
    win32: false,
  };
}

export function resolveInputTokenEvent(chunk: string, key: readline.Key): ResolvedInputTokenEvent {
  return inspectInputTokenEvent(chunk, key).selected;
}

export function inspectInputTokenEvent(chunk: string, key: readline.Key): InspectedInputTokenEvent {
  const kittyResolved = resolveKittyInputTokenEvent(chunk, key);
  const win32Resolved = resolveWin32InputTokenEvent(chunk, key);
  const legacyResolved = resolveLegacyInputTokenEvent(chunk, key);

  const selected =
    kittyResolved.detected
      ? kittyResolved
      : win32Resolved.detected
        ? win32Resolved
        : legacyResolved;

  return {
    selected: {
      tokens: [...selected.tokens],
      repeatTokens: [...selected.repeatTokens],
      releaseTokens: [...selected.releaseTokens],
      protocol: selected.protocol,
      kittyProtocolEvent: selected.protocol === 'kitty',
    },
    protocols: {
      legacy: legacyResolved,
      kitty: kittyResolved,
      win32: win32Resolved,
    },
  };
}

function resolveKittyInputTokenEvent(chunk: string, key: readline.Key): InputProtocolInspection {
  const kittyEvents = parseKittyKeyboardEvents(chunk, key);
  if (kittyEvents.length === 0) {
    return {
      protocol: 'kitty',
      detected: false,
      tokens: [],
      repeatTokens: [],
      releaseTokens: [],
    };
  }

  const tokens = new Set<string>();
  const repeatTokens = new Set<string>();
  const releaseTokens = new Set<string>();
  for (const kittyEvent of kittyEvents) {
    const kittyTokens = resolveKittyInputTokens(kittyEvent);
    if (kittyEvent.eventType === KITTY_EVENT_TYPE_RELEASE) {
      kittyTokens.forEach((token) => releaseTokens.add(token));
      continue;
    }
    if (kittyEvent.eventType === KITTY_EVENT_TYPE_REPEAT) {
      kittyTokens.forEach((token) => repeatTokens.add(token));
      continue;
    }
    kittyTokens.forEach((token) => tokens.add(token));
  }
  return {
    protocol: 'kitty',
    detected: true,
    tokens: [...tokens],
    repeatTokens: [...repeatTokens],
    releaseTokens: [...releaseTokens],
  };
}

function resolveWin32InputTokenEvent(chunk: string, key: readline.Key): InputProtocolInspection {
  const win32Events = parseWin32InputEvents(chunk, key);
  if (win32Events.length === 0) {
    return {
      protocol: 'win32',
      detected: false,
      tokens: [],
      repeatTokens: [],
      releaseTokens: [],
    };
  }

  const tokens = new Set<string>();
  const repeatTokens = new Set<string>();
  const releaseTokens = new Set<string>();
  for (const event of win32Events) {
    const eventTokens = resolveWin32InputTokens(event);
    if (event.keyDown) {
      const target = event.repeatCount > 1 ? repeatTokens : tokens;
      eventTokens.forEach((token) => target.add(token));
      continue;
    }
    eventTokens.forEach((token) => releaseTokens.add(token));
  }
  return {
    protocol: 'win32',
    detected: true,
    tokens: [...tokens],
    repeatTokens: [...repeatTokens],
    releaseTokens: [...releaseTokens],
  };
}

function resolveLegacyInputTokenEvent(chunk: string, key: readline.Key): InputProtocolInspection {
  return {
    protocol: 'legacy',
    detected: true,
    tokens: resolveLegacyInputTokens(chunk, key),
    repeatTokens: [],
    releaseTokens: [],
  };
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

  if (key.meta) {
    tokens.add('alt');
    tokens.add('option');
    const altKeyToken = resolveLegacyModifierKeyToken(normalizedChunk, key.name);
    if (altKeyToken) {
      tokens.add(`alt+${altKeyToken}`);
      tokens.add(`option+${altKeyToken}`);
    }
  }

  return [...tokens];
}

interface Win32InputEvent {
  virtualKeyCode: number;
  unicodeChar: number;
  keyDown: boolean;
  controlState: number;
  repeatCount: number;
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

function parseWin32InputEvents(chunk: string, key: readline.Key): Win32InputEvent[] {
  const sequence = chunk.length > 0 ? chunk : (key.sequence ?? '');
  if (sequence.length === 0) {
    return [];
  }

  const events: Win32InputEvent[] = [];
  const regex = /\u001b\[([0-9]+);([0-9]+);([0-9]+);([01]);([0-9]+);([0-9]+)_/g;
  for (const match of sequence.matchAll(regex)) {
    const virtualKeyCode = parseNumericPart(match[1]);
    const unicodeChar = parseNumericPart(match[3]);
    const keyDown = match[4] === '1';
    const controlState = parseNumericPart(match[5]);
    const repeatCount = parseNumericPart(match[6]);
    if (
      virtualKeyCode === undefined ||
      unicodeChar === undefined ||
      controlState === undefined ||
      repeatCount === undefined
    ) {
      continue;
    }
    events.push({
      virtualKeyCode,
      unicodeChar,
      keyDown,
      controlState,
      repeatCount,
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
  const hasAlt = (modifierBits & KITTY_MODIFIER_ALT_MASK) !== 0;
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
  if (KITTY_LEFT_CTRL_KEY_CODES.has(event.keyCode)) {
    tokens.add('ctrl-left');
    tokens.add('control-left');
    tokens.add('ctrl');
    tokens.add('control');
    return tokens;
  }
  if (KITTY_RIGHT_CTRL_KEY_CODES.has(event.keyCode)) {
    tokens.add('ctrl-right');
    tokens.add('control-right');
    tokens.add('ctrl');
    tokens.add('control');
    return tokens;
  }
  if (KITTY_LEFT_ALT_KEY_CODES.has(event.keyCode)) {
    tokens.add('alt-left');
    tokens.add('option-left');
    tokens.add('alt');
    tokens.add('option');
    return tokens;
  }
  if (KITTY_RIGHT_ALT_KEY_CODES.has(event.keyCode)) {
    tokens.add('alt-right');
    tokens.add('option-right');
    tokens.add('alt');
    tokens.add('option');
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
  if (hasAlt && printableToken) {
    tokens.add('alt');
    tokens.add('option');
    tokens.add(`alt+${printableToken}`);
    tokens.add(`option+${printableToken}`);
  }

  return tokens;
}

function resolveWin32InputTokens(event: Win32InputEvent): Set<string> {
  const tokens = new Set<string>();
  const hasLeftAlt = (event.controlState & WIN32_CONTROL_STATE_LEFT_ALT) !== 0;
  const hasRightAlt = (event.controlState & WIN32_CONTROL_STATE_RIGHT_ALT) !== 0;
  const hasLeftCtrl = (event.controlState & WIN32_CONTROL_STATE_LEFT_CTRL) !== 0;
  const hasRightCtrl = (event.controlState & WIN32_CONTROL_STATE_RIGHT_CTRL) !== 0;
  const hasShift = (event.controlState & WIN32_CONTROL_STATE_SHIFT) !== 0;
  const hasAlt = hasLeftAlt || hasRightAlt;
  const hasCtrl = hasLeftCtrl || hasRightCtrl;

  if (event.virtualKeyCode === WIN32_VK_SHIFT) {
    if (hasRightAlt || hasRightCtrl) {
      tokens.add('shift-right');
    } else {
      tokens.add('shift-left');
    }
    tokens.add('shift');
    return tokens;
  }
  if (event.virtualKeyCode === WIN32_VK_CONTROL) {
    if (hasRightCtrl && !hasLeftCtrl) {
      tokens.add('ctrl-right');
      tokens.add('control-right');
    } else {
      tokens.add('ctrl-left');
      tokens.add('control-left');
    }
    tokens.add('ctrl');
    tokens.add('control');
    return tokens;
  }
  if (event.virtualKeyCode === WIN32_VK_MENU) {
    if (hasRightAlt && !hasLeftAlt) {
      tokens.add('alt-right');
      tokens.add('option-right');
    } else {
      tokens.add('alt-left');
      tokens.add('option-left');
    }
    tokens.add('alt');
    tokens.add('option');
    return tokens;
  }

  if (event.virtualKeyCode === WIN32_VK_ESCAPE) {
    tokens.add('escape');
  } else if (event.virtualKeyCode === WIN32_VK_RETURN) {
    tokens.add('enter');
    tokens.add('return');
  } else if (event.virtualKeyCode === WIN32_VK_SPACE) {
    tokens.add('space');
  } else if (event.virtualKeyCode === WIN32_VK_TAB) {
    tokens.add('tab');
  }

  const printableToken = resolveWin32PrintableToken(event);
  if (printableToken) {
    tokens.add(printableToken);
    if (hasShift && /^[a-z]$/.test(printableToken)) {
      tokens.add(`shift+${printableToken}`);
    }
  }
  if (hasLeftCtrl) {
    tokens.add('ctrl-left');
    tokens.add('control-left');
  }
  if (hasRightCtrl) {
    tokens.add('ctrl-right');
    tokens.add('control-right');
  }
  if (hasCtrl) {
    tokens.add('ctrl');
    tokens.add('control');
    if (printableToken) {
      tokens.add(`ctrl+${printableToken}`);
    }
  }
  if (hasLeftAlt) {
    tokens.add('alt-left');
    tokens.add('option-left');
  }
  if (hasRightAlt) {
    tokens.add('alt-right');
    tokens.add('option-right');
  }
  if (hasAlt) {
    tokens.add('alt');
    tokens.add('option');
    if (printableToken) {
      tokens.add(`alt+${printableToken}`);
      tokens.add(`option+${printableToken}`);
    }
  }

  return tokens;
}

function resolveWin32PrintableToken(event: Win32InputEvent): string | undefined {
  if (event.unicodeChar >= 32 && event.unicodeChar <= 126) {
    return normalizeKey(String.fromCodePoint(event.unicodeChar));
  }
  if (event.virtualKeyCode >= 65 && event.virtualKeyCode <= 90) {
    return String.fromCodePoint(event.virtualKeyCode).toLowerCase();
  }
  if (event.virtualKeyCode >= 48 && event.virtualKeyCode <= 57) {
    return String.fromCodePoint(event.virtualKeyCode);
  }
  return undefined;
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

function resolveLegacyModifierKeyToken(chunk: string | undefined, keyName: string | undefined): string | undefined {
  if (typeof chunk === 'string' && chunk.length === 1) {
    return chunk;
  }
  if (typeof keyName !== 'string' || keyName.length === 0) {
    return undefined;
  }
  const lowered = keyName.toLowerCase();
  if (lowered.length === 1) {
    return lowered;
  }
  if (lowered === 'comma') {
    return ',';
  }
  if (lowered === 'period') {
    return '.';
  }
  if (lowered === 'slash') {
    return '/';
  }
  if (lowered === 'semicolon') {
    return ';';
  }
  if (lowered === 'quote') {
    return "'";
  }
  if (lowered === 'leftbracket') {
    return '[';
  }
  if (lowered === 'rightbracket') {
    return ']';
  }
  return undefined;
}
