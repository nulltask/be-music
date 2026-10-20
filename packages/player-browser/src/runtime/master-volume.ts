/**
 * The player's master volume: one level applied to every sound it makes — gameplay keysounds and BGM, select BGM,
 * chart previews and system sounds, result BGM, and theme sounds — whichever `AudioContext` they play on.
 *
 * Every audible path ends in {@link masterOutput} instead of `context.destination`: one gain node per context, all set
 * to the same level by {@link setMasterVolume}. The gameplay recorder taps the mix before it, so a recording keeps its
 * level whatever the listening volume.
 */

/** Highest master volume (linear): the user can boost up to 2x. */
export const MAX_MASTER_VOLUME = 2;

let masterVolume = 1;
const outputs = new Map<BaseAudioContext, GainNode>();

/** Clamps a master volume to `0..MAX_MASTER_VOLUME`; a non-finite value means unity. */
export function sanitizeMasterVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_MASTER_VOLUME, Math.max(0, value));
}

/** Sets the master volume (linear, 1 = unity) on every sound, playing or to come. */
export function setMasterVolume(value: number): void {
  masterVolume = sanitizeMasterVolume(value);
  for (const [context, gain] of outputs) {
    if (context.state === 'closed') {
      outputs.delete(context);
      continue;
    }
    gain.gain.value = masterVolume;
  }
}

export function getMasterVolume(): number {
  return masterVolume;
}

/**
 * The node an audible path should end in on `context`: a gain at the master volume, wired to `context.destination`
 * (created on first use, shared by everything on that context).
 */
export function masterOutput(context: BaseAudioContext): AudioNode {
  let gain = outputs.get(context);
  if (!gain) {
    gain = context.createGain();
    gain.gain.value = masterVolume;
    gain.connect(context.destination);
    outputs.set(context, gain);
    context.addEventListener?.('statechange', () => {
      if (context.state === 'closed') outputs.delete(context);
    });
  }
  return gain;
}
