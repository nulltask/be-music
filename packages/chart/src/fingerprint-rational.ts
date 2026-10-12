/**
 * Exact rational arithmetic for the Be-Music Fingerprint (`docs/fingerprint-spec.md`, sections 3.1 / 3.2).
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

/** Measure-grid tolerance: half a pulse of bmson resolution 240 (one 4/4 measure is 960 pulses). */
export const MEASURE_GRID_EPSILON: Rational = { n: 1n, d: 1920n };
/** Relative tolerance for snapped values (BPM, STOP, SCROLL, …). */
export const VALUE_RELATIVE_TOLERANCE: Rational = { n: 1n, d: 1_000_000n };

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

function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n !== denominator < 0n ? quotient - 1n : quotient;
}

function ceilRational(value: Rational): bigint {
  return -floorDiv(-value.n, value.d);
}

/**
 * The simplest rational in the closed interval `[low, high]`: the one with the smallest denominator, found by walking
 * the Stern–Brocot tree along the continued-fraction expansion (O(log) steps, not a search over denominators). Only
 * integers can tie on the denominator; when the interval holds several, the one nearest its centre wins (nearer zero
 * on a tie).
 */
export function simplestRationalInInterval(low: Rational, high: Rational): Rational {
  if (compareRational(low, high) > 0) {
    throw new RangeError('simplestRationalInInterval: low must not exceed high');
  }
  if (low.n <= 0n && high.n >= 0n) {
    return RATIONAL_ZERO;
  }
  if (high.n < 0n) {
    const mirrored = simplestPositiveRationalInInterval(negateRational(high), negateRational(low));
    return negateRational(mirrored);
  }
  return simplestPositiveRationalInInterval(low, high);
}

function negateRational(value: Rational): Rational {
  return { n: -value.n, d: value.d };
}

/** `0 < low <= high`. Iterative continued-fraction walk; the terms are folded back into a convergent at the end. */
function simplestPositiveRationalInInterval(low: Rational, high: Rational): Rational {
  const terms: bigint[] = [];
  let lo = low;
  let hi = high;
  for (;;) {
    const ceiling = ceilRational(lo);
    if (compareRational({ n: ceiling, d: 1n }, hi) <= 0) {
      // At the top level every integer has denominator 1, so several can tie: take the one nearest the centre. Deeper
      // down a larger term means a larger denominator, so the smallest term (the ceiling) is the unique choice.
      terms.push(terms.length === 0 ? nearestIntegerInInterval(lo, hi, ceiling) : ceiling);
      break;
    }
    // No integer in [lo, hi]: both sit strictly inside (a, a + 1). Recurse on the reciprocals of the fractional parts.
    const integerPart = floorDiv(lo.n, lo.d);
    terms.push(integerPart);
    const nextLow = createRational(hi.d, hi.n - integerPart * hi.d);
    const nextHigh = createRational(lo.d, lo.n - integerPart * lo.d);
    lo = nextLow;
    hi = nextHigh;
  }
  // Fold [a0; a1, …, ak] into p/q.
  let numerator = 1n;
  let denominator = 0n;
  for (let index = terms.length - 1; index >= 0; index -= 1) {
    const nextNumerator = terms[index]! * numerator + denominator;
    denominator = numerator;
    numerator = nextNumerator;
  }
  return createRational(numerator, denominator);
}

/**
 * Integer nearest the centre of `[low, high]` (the snapped value itself, since snapping intervals are symmetric), the
 * one nearer zero on a tie. `ceiling` is `ceil(low)`, already known to be inside the interval.
 */
function nearestIntegerInInterval(low: Rational, high: Rational, ceiling: bigint): bigint {
  const floorHigh = floorDiv(high.n, high.d);
  if (floorHigh === ceiling) {
    return ceiling;
  }
  const doubledCentre = addRational(low, high);
  // round-half-down(centre) = ceil(centre - 1/2) = ceil((2·centre - 1) / 2)
  const nearest = ceilRational(createRational(doubledCentre.n - doubledCentre.d, 2n * doubledCentre.d));
  return nearest < ceiling ? ceiling : nearest > floorHigh ? floorHigh : nearest;
}

/** Snaps a measure length or an in-measure position to the simplest rational within `±1/1920`. */
export function snapToMeasureGrid(value: Rational): Rational {
  return simplestRationalInInterval(
    subtractRational(value, MEASURE_GRID_EPSILON),
    addRational(value, MEASURE_GRID_EPSILON),
  );
}

/** Snaps a value to the simplest rational within a relative `1e-6` of it. `0` stays `0`. */
export function snapValue(value: Rational): Rational {
  if (value.n === 0n) {
    return RATIONAL_ZERO;
  }
  const delta = multiplyRational(value, VALUE_RELATIVE_TOLERANCE);
  const first = subtractRational(value, delta);
  const second = addRational(value, delta);
  return compareRational(first, second) <= 0
    ? simplestRationalInInterval(first, second)
    : simplestRationalInInterval(second, first);
}
