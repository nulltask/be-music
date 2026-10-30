import { resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import { parseBMSExWAV, parseBmsWAVCmd } from './wav-directives.ts';

/** Authored sample effects, before the host's tempo and output sample-rate conversion. */
export interface BmsWAVPlaybackModifiers {
  /** Semitones relative to the sample's original pitch. */
  semitones?: number;
  frequencyHz?: number;
  pan?: number;
  /** Maximum sounding time after pitch conversion; absent means natural sample end. */
  durationSeconds?: number;
}

/**
 * Be-Music composes MacBeat pitch with nanasigroove frequency. Last command wins per slot/parameter.
 * Out-of-range values clamp to the documented dialect bounds. Zero duration restores the natural end.
 */
export function collectBmsWAVPlaybackModifiers(json: Pick<BeMusicJSON, 'bms'>): Map<string, BmsWAVPlaybackModifiers> {
  const result = new Map<string, BmsWAVPlaybackModifiers>();
  const entryFor = (key: string): BmsWAVPlaybackModifiers => {
    let entry = result.get(key);
    if (!entry) {
      entry = {};
      result.set(key, entry);
    }
    return entry;
  };
  for (const raw of json.bms.wavCmds) {
    const command = parseBmsWAVCmd(raw, resolveBMSBase(json));
    if (!command || command.param === 'volume') continue;
    const entry = entryFor(command.slot);
    if (command.param === 'pitch') entry.semitones = Math.max(0, Math.min(127, command.value)) - 60;
    else entry.durationSeconds = command.value > 0 ? command.value / 2000 : undefined;
  }
  for (const [key, raw] of Object.entries(json.bms.exWAV)) {
    const parsed = parseBMSExWAV(raw);
    if (!parsed || (parsed.pan === undefined && parsed.frequencyHz === undefined)) continue;
    const entry = entryFor(key);
    if (parsed.pan !== undefined) entry.pan = Math.max(-10000, Math.min(10000, parsed.pan));
    if (parsed.frequencyHz !== undefined) entry.frequencyHz = Math.max(100, Math.min(100000, parsed.frequencyHz));
  }
  return result;
}

/** Resolve native-rate pitch and DirectSound-style channel attenuation without crossfeeding stereo channels. */
export function resolveBmsWAVPlayback(
  modifiers: BmsWAVPlaybackModifiers,
  nativeSampleRate: number,
): {
  playbackRate: number;
  leftGain: number;
  rightGain: number;
  maxDurationSeconds?: number;
} {
  if (!Number.isFinite(nativeSampleRate) || nativeSampleRate <= 0)
    throw new RangeError('A positive native sample rate is required');
  if (Object.values(modifiers).some((value) => value !== undefined && !Number.isFinite(value)))
    throw new RangeError('Sample modifiers must be finite');
  const pan = modifiers.pan ?? 0;
  const attenuation = (value: number): number => (value >= 10000 ? 0 : 10 ** (-value / 2000));
  return {
    playbackRate:
      2 ** ((modifiers.semitones ?? 0) / 12) *
      (modifiers.frequencyHz === undefined ? 1 : modifiers.frequencyHz / nativeSampleRate),
    leftGain: pan > 0 ? attenuation(pan) : 1,
    rightGain: pan < 0 ? attenuation(-pan) : 1,
    maxDurationSeconds: modifiers.durationSeconds,
  };
}
