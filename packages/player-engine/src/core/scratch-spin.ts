/**
 * Which way a scratch press spins the turntable (#940), for display: the turntable's animation, live and in a replay.
 * Judging does not read it: a back-spin scratch (`isBackSpinScratch` in `ruleset/long-note.ts`) ends on a press from
 * another input source than the one that hit its head (`input-source.ts`, #605).
 *
 * - A controller that reports rotation (a turntable or an analog axis) sends the direction it actually turned.
 * - A keyboard uses odd-even: a scratch lane's keys alternate as the two directions, so its first key spins
 *   clockwise, its second counterclockwise, its third clockwise again, and so on ({@link createScratchSpinByToken}).
 * - Input with no direction (a touch lane) sends none.
 */
export type ScratchSpin = 'cw' | 'ccw';

/** True for the two values a {@link ScratchSpin} takes (replay validation). */
export function isScratchSpin(value: unknown): value is ScratchSpin {
  return value === 'cw' || value === 'ccw';
}

/** The part of a lane binding the odd-even rule reads (`LaneBinding` in `lane-layout.ts`). */
export interface ScratchSpinBinding {
  readonly isScratch: boolean;
  /**
   * The lane's physical keys in order, each as the tokens it may arrive as (`['ctrl-left', 'control-left']`). Absent
   * on a lane with a single key.
   */
  readonly inputKeys?: readonly (readonly string[])[];
}

/**
 * The spin each scratch key gives under the odd-even rule: the lane's keys at even positions spin `'cw'`, those at odd
 * positions `'ccw'`. Tokens are lowercased, as the input maps key them. Keys of non-scratch lanes have no spin.
 */
export function createScratchSpinByToken(bindings: readonly ScratchSpinBinding[]): ReadonlyMap<string, ScratchSpin> {
  const spins = new Map<string, ScratchSpin>();
  for (const binding of bindings) {
    if (!binding.isScratch || binding.inputKeys === undefined) continue;
    binding.inputKeys.forEach((tokens, index) => {
      const spin: ScratchSpin = index % 2 === 0 ? 'cw' : 'ccw';
      for (const token of tokens) {
        const normalized = token.toLowerCase();
        if (!spins.has(normalized)) spins.set(normalized, spin);
      }
    });
  }
  return spins;
}

/** The spin of a keyboard press: that of its first token bound to a scratch key, or `undefined` for any other key. */
export function resolveScratchSpin(
  tokens: readonly string[],
  spinByToken: ReadonlyMap<string, ScratchSpin>,
): ScratchSpin | undefined {
  for (const token of tokens) {
    const spin = spinByToken.get(token.toLowerCase());
    if (spin !== undefined) return spin;
  }
  return undefined;
}

/**
 * The spin of a `lane-input` press: the one the input reported, none when it reported `null` (input with no direction,
 * such as a touch lane, whatever key token it names), or else the keyboard's odd-even spin of its tokens.
 */
export function resolvePressSpin(
  reported: ScratchSpin | null | undefined,
  tokens: readonly string[],
  spinByToken: ReadonlyMap<string, ScratchSpin>,
): ScratchSpin | undefined {
  if (reported === null) return undefined;
  return reported ?? resolveScratchSpin(tokens, spinByToken);
}
