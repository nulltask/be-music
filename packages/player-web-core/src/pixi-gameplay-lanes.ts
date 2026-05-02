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

/**
 * Channel → 1P-side LR2 lane slot mapping. The IIDX-style default
 * collapses scratch (`16` / `26`) to slot `0`, keys 1..5 to slots
 * `1..5`, and keys 6 / 7 to slots `6` / `7` (the LR2 default's
 * `#SRC_NOTE,6/7,...` for `play_7.lr2skin`).
 *
 * For PMS / 9 KEY (Pop'n) the layout shifts:
 * - **COMPAT** (`.pms` channel layout shared with BME): `11..15`
 *   keep slots `1..5`; `16, 17, 18, 19` map to slots `6..9`.
 *   `play_9.lr2skin`'s `#SRC_NOTE,1..9` need to receive notes
 *   from these channels, not the IIDX-side scratch (slot 0).
 * - **STD** (canonical PMS layout): `11..15` keep slots `1..5`;
 *   `22..25` (the 1P-side block in `play_9.lr2skin`) map to
 *   slots `6..9`.
 */
export function resolveSideKeySlot(channel: string, playVariant?: '5' | '7' | '9' | '10' | '14'): number {
  if (playVariant === '9') {
    if (channel.length !== 2) return -1;
    const digit = Number.parseInt(channel[1]!, 10);
    if (!Number.isFinite(digit)) return -1;
    // PMS-COMPAT layout — channels `11..19` are the nine lanes.
    if (channel.startsWith('1')) {
      if (digit >= 1 && digit <= 5) return digit;
      if (digit >= 6 && digit <= 9) return digit;
      return -1;
    }
    // PMS-STD layout — channels `22..25` round out the 1P-side
    // 6..9 lane bank. We DON'T accept `21` because the PMS
    // skin's `#DST_NOTE,*` layout only places the 6..9 lanes on
    // `22..25`.
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
  if (digit === 8) return 6;
  if (digit === 9) return 7;
  return -1;
}

export function resolveLr2LaneIndex(channel: string, playVariant?: '5' | '7' | '9' | '10' | '14'): number {
  const slot = resolveSideKeySlot(channel, playVariant);
  if (slot < 0) return -1;
  // PMS / 9 KEY is single-side — every lane (whether sourced from
  // `1X` or `2X`) lives on the 1P-side `#DST_NOTE,1..9` rects.
  if (playVariant === '9') return slot;
  return channel.startsWith('2') ? 10 + slot : slot;
}

export function resolveSideRelativeLaneIndex(channel: string, playVariant?: '5' | '7' | '9' | '10' | '14'): number {
  const slot = resolveSideKeySlot(channel, playVariant);
  return slot < 0 ? 0 : slot;
}

export function isScratch(channel: string): boolean {
  return channel === '16' || channel === '26';
}

export function isPlayableInputChannel(channel: string): boolean {
  return channel.startsWith('1') || channel.startsWith('2');
}

/**
 * Returns the playable lane channels present in `notes`, ordered
 * for left-to-right rendering (1P scratch → 1P keyboard 1..7 →
 * 2P scratch → 2P keyboard 1..7).
 *
 * Pass `playVariant: '9'` for PMS / Pop'n charts so channels `17`
 * (PMS-COMPAT layout) and `22..25` (PMS-STD layout) participate as
 * lane notes instead of being filtered out as FREE ZONE / 2P
 * decorations. The IIDX-side default omits `17` because it's a
 * FREE ZONE channel for every other mode.
 */
export function resolveLaneChannels(
  notes: ReadonlyArray<ChannelLike>,
  playVariant?: '5' | '7' | '9' | '10' | '14',
): string[] {
  const preferred =
    playVariant === '9'
      ? ['11', '12', '13', '14', '15', '16', '17', '18', '19', '22', '23', '24', '25']
      : ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'];
  const used = new Set(notes.map((note) => note.channel).filter(isPlayableInputChannel));
  return preferred.filter((channel) => used.has(channel));
}
