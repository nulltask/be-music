import type { LRXEventExtensions } from '@be-music/chart-source';

/** How one LRX note plays its sample, in the units of `TimedSampleTrigger`; each field is absent at its default. */
export interface LRXSamplePlayback {
  /** Where playback starts in the sample, in seconds of the sample (`ost`). */
  offsetSeconds?: number;
  /** How much of the sample plays, in seconds of the sample (`len`). */
  durationSeconds?: number;
  /** Linear gain (`vol / 127`). */
  gain?: number;
  /** Stereo balance from −1 to 1 (`(pan − 64) / 64`). */
  pan?: number;
  /** Rate the sample plays at (`frq / 44100`). */
  playbackRate?: number;
  /** Fade-in from the start, in seconds of the sample (`atk`). */
  attackSeconds?: number;
  /** Fade-out past the end of `durationSeconds`, in seconds of the sample (`rls`). */
  releaseSeconds?: number;
}

/** plugout's reference rate: `frq` 44100 plays a sample at its own rate. */
const LRX_BASE_FREQUENCY = 44100;
const LRX_FULL_VOLUME = 127;
const LRX_CENTRE_PAN = 64;

/**
 * The sample playback of an LRX note's sound values, as plugout sets up its FMOD channel (0x4dc880): volume, pan and
 * frequency on the channel, the start at `ost` milliseconds into the sample, and `len` / `atk` / `rls` as sounding
 * time, each multiplied by the integer part of `44100 / frq` (0x4dcb44), so they stretch only at half rate or below.
 * Above 44100 Hz that factor is 0 in plugout, which would silence the note; Be-Music keeps it at 1.
 */
export function resolveLRXSamplePlayback(lrx: LRXEventExtensions | undefined): LRXSamplePlayback | undefined {
  if (lrx === undefined) return undefined;
  const playback: LRXSamplePlayback = {};
  const frequency = lrx.frequency !== undefined && lrx.frequency > 0 ? lrx.frequency : LRX_BASE_FREQUENCY;
  const rate = frequency / LRX_BASE_FREQUENCY;
  const stretch = Math.max(1, Math.floor(LRX_BASE_FREQUENCY / frequency));
  /** Sounding milliseconds, stretched as plugout does, in seconds of the sample. */
  const toSampleSeconds = (milliseconds: number) => ((Math.max(0, milliseconds) * stretch) / 1000) * rate;
  if (rate !== 1) playback.playbackRate = rate;
  if (lrx.volume !== undefined) playback.gain = Math.max(0, lrx.volume) / LRX_FULL_VOLUME;
  if (lrx.pan !== undefined) playback.pan = Math.max(-1, Math.min(1, (lrx.pan - LRX_CENTRE_PAN) / LRX_CENTRE_PAN));
  if (lrx.offsetMs !== undefined && lrx.offsetMs > 0) playback.offsetSeconds = lrx.offsetMs / 1000;
  if (lrx.lengthMs !== undefined) playback.durationSeconds = toSampleSeconds(lrx.lengthMs);
  if (lrx.attackMs !== undefined && lrx.attackMs > 0) playback.attackSeconds = toSampleSeconds(lrx.attackMs);
  if (lrx.releaseMs !== undefined && lrx.releaseMs > 0) playback.releaseSeconds = toSampleSeconds(lrx.releaseMs);
  return Object.keys(playback).length > 0 ? playback : undefined;
}
