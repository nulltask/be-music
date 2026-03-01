import readline from 'node:readline';
import { normalizeChannel } from '@be-music/json';

export interface LaneBinding {
  channel: string;
  keyLabel: string;
  inputTokens: string[];
  side: '1P' | '2P' | 'OTHER';
}

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

const FIXED_BINDINGS: Array<{
  channel: string;
  keyLabel: string;
  inputTokens: string[];
  side: '1P' | '2P';
}> = [
  { channel: '16', keyLabel: 'Ctrl', inputTokens: ['ctrl', 'control'], side: '1P' },
  { channel: '11', keyLabel: 'z', inputTokens: ['z'], side: '1P' },
  { channel: '12', keyLabel: 's', inputTokens: ['s'], side: '1P' },
  { channel: '13', keyLabel: 'x', inputTokens: ['x'], side: '1P' },
  { channel: '14', keyLabel: 'd', inputTokens: ['d'], side: '1P' },
  { channel: '15', keyLabel: 'c', inputTokens: ['c'], side: '1P' },
  { channel: '18', keyLabel: 'f', inputTokens: ['f'], side: '1P' },
  { channel: '19', keyLabel: 'v', inputTokens: ['v'], side: '1P' },
  { channel: '21', keyLabel: ',', inputTokens: [','], side: '2P' },
  { channel: '22', keyLabel: 'l', inputTokens: ['l'], side: '2P' },
  { channel: '23', keyLabel: '.', inputTokens: ['.'], side: '2P' },
  { channel: '24', keyLabel: ';', inputTokens: [';'], side: '2P' },
  { channel: '25', keyLabel: '/', inputTokens: ['/'], side: '2P' },
  { channel: '28', keyLabel: ':', inputTokens: [':'], side: '2P' },
  { channel: '29', keyLabel: '_', inputTokens: ['_'], side: '2P' },
  { channel: '26', keyLabel: 'Enter', inputTokens: ['enter', 'return'], side: '2P' },
];

export function createLaneBindings(channels: string[]): LaneBinding[] {
  const existing = new Set(channels.map((channel) => normalizeChannel(channel)));
  const bindings: LaneBinding[] = [];
  const usedTokens = new Set<string>();

  for (const definition of FIXED_BINDINGS) {
    if (!existing.has(definition.channel)) {
      continue;
    }
    bindings.push({
      channel: definition.channel,
      keyLabel: definition.keyLabel,
      inputTokens: [...definition.inputTokens],
      side: definition.side,
    });
    definition.inputTokens.forEach((token) => usedTokens.add(token));
  }

  const unknownChannels = [...existing].filter(
    (channel) => !FIXED_BINDINGS.some((definition) => definition.channel === channel),
  );
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
    });
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
