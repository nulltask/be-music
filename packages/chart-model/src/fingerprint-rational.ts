/**
 * Exact rational arithmetic and snapping for the Be-Music Fingerprint (`docs/fingerprint-spec.md`, sections 3.1 / 3.2).
 *
 * Values are `{ n, d }` BigInt pairs kept in lowest terms with a positive denominator, so two equal rationals always
 * share one representation and one canonical text.
 */
export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

export const RATIONAL_ZERO: Rational = { n: 0n, d: 1n };
export const RATIONAL_ONE: Rational = { n: 1n, d: 1n };

/**
 * Measure lengths snap to a rational whose length **in beats** has a denominator of at most this
 * (`docs/fingerprint-spec.md` section 3.2). 48 covers every measure written in 1/192 of a 4/4 measure, plus thirds,
 * fifths, sevenths, and ninths of a beat.
 */
export const MEASURE_BEAT_DENOMINATOR_LIMIT = 48;
/**
 * Snapping tolerance for measure lengths, in beats: `1/4608 = 1/(2 * 48^2)`. Two distinct candidates are at least
 * `1/(48 * 47) = 1/2256` beat apart, so no value is ever within the tolerance of two candidates.
 */
export const MEASURE_BEAT_TOLERANCE: Rational = { n: 1n, d: 4608n };
/** Values snap to a rational with a denominator of at most this (halves, thirds, … twelfths). */
export const VALUE_DENOMINATOR_LIMIT = 12;
/** Relative tolerance for snapped values (BPM, STOP, SCROLL, SPEED, …). */
export const VALUE_RELATIVE_TOLERANCE: Rational = { n: 1n, d: 100_000n };

const DECIMAL_TEXT_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const LEADING_DECIMAL_PATTERN = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function createRational(numerator: bigint, denominator: bigint = 1n): Rational {
  if (denominator === 0n) {
    throw new RangeError('Rational denominator must not be zero');
  }
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  if (divisor > 1n) {
    n /= divisor;
    d /= divisor;
  }
  return { n, d };
}

/**
 * Converts decimal text (`"0.333333"`, `"-1.5e-3"`, `"150"`) to the exact rational its digits spell. Returns
 * `undefined` for anything that is not a plain decimal number.
 */
export function parseDecimalRational(text: string): Rational | undefined {
  const match = DECIMAL_TEXT_PATTERN.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const [, sign, integerDigits = '', fractionDigits = '', exponentText] = match;
  if (integerDigits.length === 0 && fractionDigits.length === 0) {
    return undefined;
  }
  let numerator = BigInt(`${integerDigits}${fractionDigits}` || '0');
  let denominator = 10n ** BigInt(fractionDigits.length);
  const exponent = exponentText === undefined ? 0 : Number.parseInt(exponentText, 10);
  if (exponent > 0) {
    numerator *= 10n ** BigInt(exponent);
  } else if (exponent < 0) {
    denominator *= 10n ** BigInt(-exponent);
  }
  return createRational(sign === '-' ? -numerator : numerator, denominator);
}

/**
 * Reads the leading decimal number of free text the way `Number.parseFloat` does (`"100 ; comment"` → 100), but
 * exactly. Used for values the parser keeps as raw strings (`#EXRANKxx`, `#STP`).
 */
export function parseLeadingDecimalRational(text: string): Rational | undefined {
  const match = LEADING_DECIMAL_PATTERN.exec(text);
  return match ? parseDecimalRational(match[1]!) : undefined;
}

/** Exact rational of a stored double through its shortest round-trip decimal text (`String(n)`), per spec 3.1. */
export function rationalFromNumber(value: number): Rational | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return parseDecimalRational(String(value));
}

export function addRational(left: Rational, right: Rational): Rational {
  return createRational(left.n * right.d + right.n * left.d, left.d * right.d);
}

export function subtractRational(left: Rational, right: Rational): Rational {
  return createRational(left.n * right.d - right.n * left.d, left.d * right.d);
}

export function multiplyRational(left: Rational, right: Rational): Rational {
  return createRational(left.n * right.n, left.d * right.d);
}

export function divideRational(left: Rational, right: Rational): Rational {
  return createRational(left.n * right.d, left.d * right.n);
}

export function compareRational(left: Rational, right: Rational): number {
  const delta = left.n * right.d - right.n * left.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

export function isRationalEqual(left: Rational, right: Rational): boolean {
  return left.n === right.n && left.d === right.d;
}

/** Canonical text: `"n"` for integers, `"p/q"` in lowest terms with the sign on the numerator. */
export function formatRational(value: Rational): string {
  return value.d === 1n ? value.n.toString() : `${value.n.toString()}/${value.d.toString()}`;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** `round(n / d)` with halves rounded down (toward negative infinity), `d > 0`. */
function roundHalfDown(numerator: bigint, denominator: bigint): bigint {
  // ceil(x - 1/2) = -floor(1/2 - x) = -floor((d - 2n) / 2d)
  const twice = 2n * denominator;
  const shifted = denominator - 2n * numerator;
  const quotient = shifted / twice;
  const floor = shifted % twice !== 0n && shifted < 0n ? quotient - 1n : quotient;
  return -floor;
}

/**
 * The rational `a/q` nearest to `value` with `1 <= q <= maxDenominator` and `|a/q - value| <= tolerance`, or `value`
 * itself when there is none. Ties go to the smaller denominator, then the smaller value. With `positiveOnly`, only
 * `a >= 1` is considered (measure lengths, where 0 is not a length). Exact candidates (`value` already has a small
 * denominator) are fixed points.
 */
export function snapToSmallDenominator(
  value: Rational,
  maxDenominator: number,
  tolerance: Rational,
  positiveOnly = false,
): Rational {
  let best: Rational | undefined;
  // Distance kept as an unreduced fraction `distN / distD` for cheap comparison.
  let bestDistN = 0n;
  let bestDistD = 1n;
  for (let q = 1n; q <= BigInt(maxDenominator); q += 1n) {
    let a = roundHalfDown(value.n * q, value.d);
    if (positiveOnly && a < 1n) {
      a = 1n;
    }
    const distN = absBigInt(a * value.d - value.n * q);
    const distD = q * value.d;
    // within tolerance: distN / distD <= tolerance.n / tolerance.d
    if (distN * tolerance.d > tolerance.n * distD) {
      continue;
    }
    if (best === undefined || distN * bestDistD < bestDistN * distD) {
      best = createRational(a, q);
      bestDistN = distN;
      bestDistD = distD;
    }
  }
  return best ?? value;
}

/**
 * Snaps a positive measure length (in 4/4 measures) per spec 3.2: to the nearest length whose beat count `4x` has a
 * denominator of at most 48, when within 1/4608 beat; otherwise the exact value.
 */
export function snapMeasureLength(length: Rational): Rational {
  const beats = multiplyRational(length, { n: 4n, d: 1n });
  const snapped = snapToSmallDenominator(beats, MEASURE_BEAT_DENOMINATOR_LIMIT, MEASURE_BEAT_TOLERANCE, true);
  return divideRational(snapped, { n: 4n, d: 1n });
}

/**
 * Snaps a value per spec 3.2: to the nearest rational with a denominator of at most 12 within a relative `1e-5` of it;
 * otherwise the exact value. `0` stays `0`.
 */
export function snapValue(value: Rational): Rational {
  if (value.n === 0n) {
    return RATIONAL_ZERO;
  }
  const tolerance = createRational(
    absBigInt(value.n) * VALUE_RELATIVE_TOLERANCE.n,
    value.d * VALUE_RELATIVE_TOLERANCE.d,
  );
  return snapToSmallDenominator(value, VALUE_DENOMINATOR_LIMIT, tolerance);
}
