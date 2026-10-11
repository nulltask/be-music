import { bandLevel } from '@be-music/skin-sdk';

/** The kick / bass-drum range: the three lowest spectrum bands (about 30–90 Hz). */
const KICK_BANDS = [0, 1, 2] as const;
/** How long (s) the envelope takes to get used to a new low-end level. */
const KICK_ADAPT_S = 1.2;
/** Time constant (s) of a kick's flicker: gone within about 0.15 s. */
const KICK_DECAY_S = 0.07;
/** After a kick the envelope waits this long (s) before it can fire again. */
const KICK_COOLDOWN_S = 0.12;
/** A rise of the low end this big within one step counts as a kick. */
const KICK_RISE = 0.06;

/** A kick envelope: what the low end is used to, where it was last step, and the flicker of the latest kick. */
export interface KickState {
  mean: number;
  low: number;
  /** 0..1, flicking up on each kick and gone again within about 0.15 s. */
  swell: number;
  cooldown: number;
}

export const KICK_REST: KickState = Object.freeze({ mean: 0, low: 0, swell: 0, cooldown: 0 });

/** Average display level ({@link bandLevel}) of the kick range in `bands` (the 16 spectrum bands, 0..1). */
export function kickLevel(bands: readonly number[]): number {
  let sum = 0;
  for (const band of KICK_BANDS) sum += bandLevel(bands, band, 16);
  return sum / KICK_BANDS.length;
}

/**
 * Advances the kick envelope by `dt` seconds. It fires only on the attack of a kick — the low end leaping up within a
 * step, or an onset (0..1) landing while the low end stands above what it is used to — never on a sustained level, so
 * a bass line or the analyser's slow release cannot hold it up. Each kick flicks the swell up, scaled by how hard it
 * hit, and the swell falls straight back within about 0.15 s. Pure.
 */
export function stepKick(previous: KickState, bands: readonly number[], onset: number, dt: number): KickState {
  const low = kickLevel(bands);
  const mean = previous.mean + (low - previous.mean) * (1 - Math.exp(-dt / KICK_ADAPT_S));
  const rise = low - previous.low;
  const ready = previous.cooldown <= 0;
  const attack = rise > KICK_RISE || (onset > 0.6 && low > previous.mean + 0.05);
  const hit = ready && attack ? Math.min(1, 0.55 + Math.max(rise, low - previous.mean) * 2) : 0;
  const swell = Math.max(hit, previous.swell * Math.exp(-dt / KICK_DECAY_S));
  const cooldown = hit > 0 ? KICK_COOLDOWN_S : Math.max(0, previous.cooldown - dt);
  return { mean, low, swell, cooldown };
}
