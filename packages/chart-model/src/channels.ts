import { normalizeASCIIBase36Code } from '@be-music/shared-utils/core';
import { normalizeChannel, normalizeObjectKey } from '@be-music/chart-source';

/**
 * Bounds of the extended lane-code range. A `<side><lane>` channel's lane code is either a classic `1`-`9` column or one
 * of these `A`-`Z` columns, which together give 35 lanes per side — comfortably above the 24 the Keyboardmania modes
 * use, and the same span `laneIndexToChannel` (bmson `generic-Nkeys`) and `lane-layout.ts`'s `EXTENDED_LANE_DIGITS`
 * already emit.
 */
export const EXTENDED_LANE_CODE_MIN = 0x41; // 'A'
const EXTENDED_LANE_CODE_MAX = 0x5a; // 'Z'
const PACKED_CHANNEL_03 = 0x3033;
const PACKED_CHANNEL_08 = 0x3038;
const PACKED_CHANNEL_09 = 0x3039;
const PACKED_CHANNEL_97 = 0x3937;
const PACKED_CHANNEL_98 = 0x3938;
const PACKED_CHANNEL_SC = 0x5343;
const PACKED_CHANNEL_SP = 0x5350;

export function parseBPMFrom03Token(value: string): number {
  if (value.length === 2) {
    const high = parseHexDigitFast(value.charCodeAt(0));
    const low = parseHexDigitFast(value.charCodeAt(1));
    if (high >= 0 && low >= 0) {
      return (high << 4) + low;
    }
  }
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isTempoChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if (high === 0x30 && (low === 0x33 || low === 0x38)) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedTempoChannel, isTempoNormalizedChannel);
}

export function isStopChannel(channel: string): boolean {
  if (channel.length === 2 && channel.charCodeAt(0) === 0x30 && channel.charCodeAt(1) === 0x39) {
    return true;
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedStopChannel, isStopNormalizedChannel);
}

export function isScrollChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0) & 0xdf;
    const low = channel.charCodeAt(1) & 0xdf;
    if (high === 0x53 && low === 0x43) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedScrollChannel, isScrollNormalizedChannel);
}

export function isLandmineChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0) & 0xdf;
    const low = channel.charCodeAt(1);
    if ((high === 0x44 || high === 0x45) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedLandmineChannel, isLandmineNormalizedChannel);
}

export function isSampleTriggerChannel(channel: string): boolean {
  if (channel.length === 2) {
    const highCode = channel.charCodeAt(0);
    const lowCode = channel.charCodeAt(1);
    if (highCode === 0x30) {
      return lowCode === 0x31;
    }
    if (highCode === 0x39 && (lowCode === 0x37 || lowCode === 0x38)) {
      return false;
    }
    if ((highCode & 0xdf) === 0x41 && lowCode === 0x30) {
      return false;
    }
    if ((highCode & 0xdf) === 0x53 && (lowCode & 0xdf) === 0x43) {
      return false;
    }
    if ((highCode & 0xdf) === 0x53 && (lowCode & 0xdf) === 0x50) {
      return false;
    }
    return true;
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedSampleTriggerChannel, isSampleTriggerNormalizedChannel);
}

export function isPlayableChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    if ((high === 0x31 || high === 0x32) && isLaneCode(channel.charCodeAt(1))) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedPlayableChannel, isPlayableNormalizedChannel);
}

export function isBMSLongNoteChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    if ((high === 0x35 || high === 0x36) && isLaneCode(channel.charCodeAt(1))) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedBMSLongNoteChannel, isBMSLongNoteNormalizedChannel);
}

export function isPlayLaneSoundChannel(channel: string): boolean {
  return matchesPackedOrNormalizedChannel(channel, isPackedPlayLaneSoundChannel, isPlayLaneSoundNormalizedChannel);
}

export function isBmsBGMVolumeChangeChannel(channel: string): boolean {
  return matchesPackedOrNormalizedChannel(
    channel,
    isPackedBmsBGMVolumeChangeChannel,
    isBmsBGMVolumeChangeNormalizedChannel,
  );
}

export function isBMSKeyVolumeChangeChannel(channel: string): boolean {
  return matchesPackedOrNormalizedChannel(
    channel,
    isPackedBMSKeyVolumeChangeChannel,
    isBMSKeyVolumeChangeNormalizedChannel,
  );
}

export function isBMSDynamicVolumeChangeChannel(channel: string): boolean {
  return matchesPackedOrNormalizedChannel(
    channel,
    isPackedBMSDynamicVolumeChangeChannel,
    isBMSDynamicVolumeChangeNormalizedChannel,
  );
}

export function parseBMSDynamicVolumeGain(value: string): number | undefined {
  const normalized = normalizeObjectKey(value);
  const high = parseHexDigitFast(normalized.charCodeAt(0));
  const low = parseHexDigitFast(normalized.charCodeAt(1));
  if (high < 0 || low < 0) {
    return undefined;
  }
  const parsed = (high << 4) | low;
  if (parsed <= 0) {
    return undefined;
  }
  return parsed / 0xff;
}

export function mapBMSLongNoteChannelToPlayable(channel: string): string | undefined {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    if (!isPackedBMSLongNoteChannel(packed)) {
      return undefined;
    }
    const lane = String.fromCharCode(packed & 0xff);
    return ((packed >> 8) & 0xff) === 0x35 ? `1${lane}` : `2${lane}`;
  }
  return mapBMSLongNoteNormalizedChannelToPlayable(resolveNormalizedChannelForPredicate(channel));
}

function parseHexDigitFast(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }
  const uppercase = code & 0xdf;
  if (uppercase >= 0x41 && uppercase <= 0x46) {
    return uppercase - 0x41 + 10;
  }
  return -1;
}

function resolveNormalizedChannelForPredicate(channel: string): string {
  if (channel.length === 2) {
    const code0 = channel.charCodeAt(0);
    const code1 = channel.charCodeAt(1);
    if (isNormalizedBase36Code(code0) && isNormalizedBase36Code(code1)) {
      return channel;
    }
  }
  return normalizeChannel(channel);
}

function matchesPackedOrNormalizedChannel(
  channel: string,
  packedMatcher: (packed: number) => boolean,
  normalizedMatcher: (normalized: string) => boolean,
): boolean {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packedMatcher(packed);
  }
  return normalizedMatcher(resolveNormalizedChannelForPredicate(channel));
}

function isNormalizedBase36Code(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a);
}

function tryPackChannel(channel: string): number {
  if (channel.length !== 2) {
    return -1;
  }
  const sourceHigh = channel.charCodeAt(0);
  const sourceLow = channel.charCodeAt(1);
  if (isNormalizedBase36Code(sourceHigh) && isNormalizedBase36Code(sourceLow)) {
    return (sourceHigh << 8) | sourceLow;
  }
  const high = normalizeASCIIBase36Code(sourceHigh);
  const low = normalizeASCIIBase36Code(sourceLow);
  if (high < 0 || low < 0) {
    return -1;
  }
  return (high << 8) | low;
}

function isTempoNormalizedChannel(normalized: string): boolean {
  return normalized === '03' || normalized === '08';
}

function isPackedTempoChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_03 || packed === PACKED_CHANNEL_08;
}

function isStopNormalizedChannel(normalized: string): boolean {
  return normalized === '09';
}

function isPackedStopChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_09;
}

function isScrollNormalizedChannel(normalized: string): boolean {
  return normalized === 'SC';
}

function isPackedScrollChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_SC;
}

function isLandmineNormalizedChannel(normalized: string): boolean {
  return /^[DE][1-9A-Z]$/.test(normalized);
}

function isSampleTriggerNormalizedChannel(normalized: string): boolean {
  if (/^0[0-9A-Z]$/.test(normalized)) {
    return normalized === '01';
  }
  return (
    normalized !== '97' && normalized !== '98' && normalized !== 'A0' && normalized !== 'SC' && normalized !== 'SP'
  );
}

export function isPlayableNormalizedChannel(normalized: string): boolean {
  return /^[12][1-9A-Z]$/.test(normalized);
}

function isBMSLongNoteNormalizedChannel(normalized: string): boolean {
  return /^[56][1-9A-Z]$/.test(normalized);
}

function isPlayLaneSoundNormalizedChannel(normalized: string): boolean {
  return /^[1-6][1-9A-Z]$/.test(normalized);
}

function isBmsBGMVolumeChangeNormalizedChannel(normalized: string): boolean {
  return normalized === '97';
}

function isBMSKeyVolumeChangeNormalizedChannel(normalized: string): boolean {
  return normalized === '98';
}

function isBMSDynamicVolumeChangeNormalizedChannel(normalized: string): boolean {
  return isBmsBGMVolumeChangeNormalizedChannel(normalized) || isBMSKeyVolumeChangeNormalizedChannel(normalized);
}

export function mapBMSLongNoteNormalizedChannelToPlayable(normalized: string): string | undefined {
  if (!isBMSLongNoteNormalizedChannel(normalized)) {
    return undefined;
  }
  const lane = normalized[1]!;
  return normalized.charCodeAt(0) === 0x35 ? `1${lane}` : `2${lane}`;
}

/**
 * Lane channels span two code ranges: the classic `1`-`9` columns and the extended `A`-`Z` columns the 24-key
 * (Keyboardmania) modes author lanes 10..24 on. Both are valid for every `<side><lane>` channel family — playable
 * (`1X` / `2X`), invisible (`3X` / `4X`), legacy long note (`5X` / `6X`), and landmine (`DX` / `EX`).
 */
function isLaneCode(code: number): boolean {
  return (code >= 0x31 && code <= 0x39) || (code >= EXTENDED_LANE_CODE_MIN && code <= EXTENDED_LANE_CODE_MAX);
}

function isPackedLaneRange(packed: number, highStart: number, highEnd: number): boolean {
  const high = (packed >> 8) & 0xff;
  return high >= highStart && high <= highEnd && isLaneCode(packed & 0xff);
}

function isPackedLandmineChannel(packed: number): boolean {
  return isPackedLaneRange(packed, 0x44, 0x45);
}

function isPackedSampleTriggerChannel(packed: number): boolean {
  if (((packed >> 8) & 0xff) === 0x30) {
    return (packed & 0xff) === 0x31;
  }
  if (
    packed === PACKED_CHANNEL_97 ||
    packed === PACKED_CHANNEL_98 ||
    packed === PACKED_CHANNEL_SC ||
    packed === PACKED_CHANNEL_SP
  ) {
    return false;
  }
  return packed !== 0x4130;
}

function isPackedPlayableChannel(packed: number): boolean {
  return isPackedLaneRange(packed, 0x31, 0x32);
}

function isPackedBMSLongNoteChannel(packed: number): boolean {
  return isPackedLaneRange(packed, 0x35, 0x36);
}

function isPackedPlayLaneSoundChannel(packed: number): boolean {
  return isPackedLaneRange(packed, 0x31, 0x36);
}

function isPackedBmsBGMVolumeChangeChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_97;
}

function isPackedBMSKeyVolumeChangeChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_98;
}

function isPackedBMSDynamicVolumeChangeChannel(packed: number): boolean {
  return isPackedBmsBGMVolumeChangeChannel(packed) || isPackedBMSKeyVolumeChangeChannel(packed);
}
