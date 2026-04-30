export interface ChannelLike {
  channel: string;
}

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

export function resolveKeyChannel(event: KeyboardEvent, channels: ReadonlyArray<string>): string | undefined {
  for (const channel of channels) {
    if (CHANNEL_KEY_BINDINGS[channel]?.has(event.code)) {
      return channel;
    }
  }
  return undefined;
}

export function resolveSideKeySlot(channel: string): number {
  if (channel === '16' || channel === '26') return 0;
  if (channel.length !== 2) return -1;
  const digit = Number.parseInt(channel[1]!, 10);
  if (!Number.isFinite(digit)) return -1;
  if (digit >= 1 && digit <= 5) return digit;
  if (digit === 8) return 6;
  if (digit === 9) return 7;
  return -1;
}

export function resolveLr2LaneIndex(channel: string): number {
  const slot = resolveSideKeySlot(channel);
  if (slot < 0) return -1;
  return channel.startsWith('2') ? 10 + slot : slot;
}

export function resolveSideRelativeLaneIndex(channel: string): number {
  const slot = resolveSideKeySlot(channel);
  return slot < 0 ? 0 : slot;
}

export function isScratch(channel: string): boolean {
  return channel === '16' || channel === '26';
}

export function isPlayableInputChannel(channel: string): boolean {
  return channel.startsWith('1') || channel.startsWith('2');
}

export function resolveLaneChannels(notes: ReadonlyArray<ChannelLike>): string[] {
  const preferred = ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'];
  const used = new Set(notes.map((note) => note.channel).filter(isPlayableInputChannel));
  return preferred.filter((channel) => used.has(channel));
}
