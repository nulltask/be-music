import type { BeMusicJSON } from '@be-music/chart-source';

/** bmson's customary resolution, and the step the exact resolution grows in. */
export const DEFAULT_BMSON_RESOLUTION = 240;

/**
 * The highest resolution {@link resolveExactBmsonResolution} picks: 240 × 256. beatoraja reads bmson `y` as a 32-bit
 * integer, and 1,000 4/4 measures at this resolution stay under a quarter of that range.
 */
export const MAX_EXACT_BMSON_RESOLUTION = DEFAULT_BMSON_RESOLUTION * 256;

/** Largest denominator a measure length is read back to: lengths are decimals such as `0.75` or `1.234375`. */
const MAX_LENGTH_DENOMINATOR = 1_000_000;

/**
 * The bmson resolution that puts every object and measure boundary of a BMS chart on a whole pulse: the least multiple
 * of 240 at which each position's beat is an integer, from the position fractions and measure lengths. A chart whose
 * grid needs more than {@link MAX_EXACT_BMSON_RESOLUTION}, or whose measure length is no exact fraction, gets that cap
 * and rounds to it, keeping the error under half a pulse there.
 */
export function resolveExactBmsonResolution(json: Pick<BeMusicJSON, 'events' | 'measures'>): number {
  const lengths = new Map<number, Fraction>();
  for (const measure of json.measures) {
    const length = toFraction(measure.length);
    if (length === undefined) return MAX_EXACT_BMSON_RESOLUTION;
    lengths.set(measure.index, length);
  }
  let lastMeasure = 0;
  for (const event of json.events) lastMeasure = Math.max(lastMeasure, event.measure);
  for (const index of lengths.keys()) lastMeasure = Math.max(lastMeasure, index);

  // Beats are 4 × length per measure; the resolution must clear every denominator a measure start or position has.
  let denominator = 1n;
  let start: Fraction = [0n, 1n];
  const starts: Fraction[] = [];
  for (let measure = 0; measure <= lastMeasure + 1; measure += 1) {
    starts.push(start);
    denominator = lcm(denominator, start[1]);
    if (denominator > BigInt(MAX_EXACT_BMSON_RESOLUTION)) return MAX_EXACT_BMSON_RESOLUTION;
    const [lengthNumerator, lengthDenominator] = lengths.get(measure) ?? [1n, 1n];
    start = add(start, [4n * lengthNumerator, lengthDenominator]);
  }
  for (const event of json.events) {
    const [numerator, positionDenominator] = event.position;
    if (!Number.isInteger(numerator) || !Number.isInteger(positionDenominator) || positionDenominator <= 0) {
      return MAX_EXACT_BMSON_RESOLUTION;
    }
    const [lengthNumerator, lengthDenominator] = lengths.get(event.measure) ?? [1n, 1n];
    const offset = reduce([4n * lengthNumerator * BigInt(numerator), lengthDenominator * BigInt(positionDenominator)]);
    denominator = lcm(denominator, add(starts[event.measure] ?? [0n, 1n], offset)[1]);
    if (denominator > BigInt(MAX_EXACT_BMSON_RESOLUTION)) return MAX_EXACT_BMSON_RESOLUTION;
  }
  const resolution = lcm(BigInt(DEFAULT_BMSON_RESOLUTION), denominator);
  return resolution > BigInt(MAX_EXACT_BMSON_RESOLUTION) ? MAX_EXACT_BMSON_RESOLUTION : Number(resolution);
}

/** A non-negative rational `[numerator, denominator]` in lowest terms. */
type Fraction = [bigint, bigint];

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b;
}

function reduce([numerator, denominator]: Fraction): Fraction {
  const divisor = gcd(numerator, denominator) || 1n;
  return [numerator / divisor, denominator / divisor];
}

function add(left: Fraction, right: Fraction): Fraction {
  return reduce([left[0] * right[1] + right[0] * left[1], left[1] * right[1]]);
}

/** `value` as an exact fraction (continued fraction, denominator ≤ 1,000,000), or `undefined` when it is none. */
function toFraction(value: number): Fraction | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let x = value;
  for (let step = 0; step < 32; step += 1) {
    const a = Math.floor(x);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > MAX_LENGTH_DENOMINATOR) return undefined;
    if (Math.abs(h1 / k1 - value) <= Number.EPSILON * Math.max(1, value)) return reduce([BigInt(h1), BigInt(k1)]);
    const rest = x - a;
    if (rest === 0) break;
    x = 1 / rest;
  }
  return Math.abs(h1 / k1 - value) <= Number.EPSILON * Math.max(1, value)
    ? reduce([BigInt(h1), BigInt(k1)])
    : undefined;
}
