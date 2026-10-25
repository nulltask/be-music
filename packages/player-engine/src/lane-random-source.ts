/** A supplied random source; seeded beatoraja modifiers use Java's bounded integer draws. */
export interface LaneRandomSource {
  (): number;
  nextInt?(bound: number): number;
}

/** Source replay seeds are signed Java longs; -1 requests a fresh modifier seed. */
export function parseLaneRandomSeed(value: unknown): string | undefined {
  const text =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? String(value)
        : '';
  if (!/^-?\d+$/.test(text)) return undefined;
  const seed = BigInt(text);
  return seed >= -1n && seed <= 0x7fff_ffff_ffff_ffffn ? seed.toString() : undefined;
}

/** java.util.Random's 48-bit LCG, as used by beatoraja 0.8.9 lane and note modifiers. */
export function createBeatorajaLaneRandom(seed: string): LaneRandomSource {
  const parsed = parseLaneRandomSeed(seed);
  if (parsed === undefined || parsed === '-1')
    throw new RangeError('A resolved non-negative Java-long seed is required.');
  let state = (BigInt(parsed) ^ 0x5deece66dn) & 0xffff_ffff_ffffn;
  const next = (bits: number): number => {
    state = (state * 0x5deece66dn + 0xbn) & 0xffff_ffff_ffffn;
    return Number(state >> BigInt(48 - bits));
  };
  const random: LaneRandomSource = () => (next(26) * 134217728 + next(27)) / 9007199254740992;
  random.nextInt = (bound) => {
    if (!Number.isInteger(bound) || bound < 1 || bound > 2147483647)
      throw new RangeError('Java nextInt bound must be a positive signed int.');
    if ((bound & (bound - 1)) === 0) return Math.floor(next(31) / 2 ** (31 - Math.log2(bound)));
    let bits: number, value: number;
    do {
      bits = next(31);
      value = bits % bound;
    } while (bits - value + (bound - 1) >= 2147483648);
    return value;
  };
  return random;
}

/** Draw uniformly using the supplied source's integer API when it has one. */
export function drawLaneRandomIndex(bound: number, random: LaneRandomSource): number {
  if (!Number.isSafeInteger(bound) || bound < 1) throw new RangeError('A positive lane count is required.');
  if (random.nextInt) {
    const index = random.nextInt(bound);
    if (!Number.isInteger(index) || index < 0 || index >= bound) throw new RangeError('Invalid bounded lane draw.');
    return index;
  }
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('Lane randomness must be in [0, 1).');
  return Math.floor(draw * bound);
}
