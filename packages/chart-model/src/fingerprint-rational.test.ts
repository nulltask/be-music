import { describe, expect, test } from 'vite-plus/test';
import {
  createRational,
  formatRational,
  parseDecimalRational,
  parseLeadingDecimalRational,
  rationalFromNumber,
  snapMeasureLength,
  snapToSmallDenominator,
  snapValue,
  type Rational,
} from './fingerprint-rational.ts';

function decimal(text: string): Rational {
  const parsed = parseDecimalRational(text);
  if (!parsed) {
    throw new Error(`not a decimal: ${text}`);
  }
  return parsed;
}

describe('fingerprint rationals', () => {
  test('parses decimal text exactly', () => {
    expect(formatRational(decimal('0.75'))).toBe('3/4');
    expect(formatRational(decimal('-1.5e-3'))).toBe('-3/2000');
    expect(formatRational(decimal('.5'))).toBe('1/2');
    expect(formatRational(decimal('2.5E+2'))).toBe('250');
    expect(formatRational(decimal('150.000'))).toBe('150');
    expect(parseDecimalRational('abc')).toBeUndefined();
    expect(parseDecimalRational('.')).toBeUndefined();
    expect(parseDecimalRational('1.2.3')).toBeUndefined();
  });

  test('reads the leading number of free text like parseFloat', () => {
    expect(formatRational(parseLeadingDecimalRational(' 37.5 ; note')!)).toBe('75/2');
    expect(parseLeadingDecimalRational('x1')).toBeUndefined();
  });

  test('converts doubles through their shortest round-trip text', () => {
    expect(formatRational(rationalFromNumber(0.1)!)).toBe('1/10');
    expect(formatRational(rationalFromNumber(1e-7)!)).toBe('1/10000000');
    expect(rationalFromNumber(Number.NaN)).toBeUndefined();
  });

  test('keeps lowest terms with the sign on the numerator', () => {
    expect(formatRational(createRational(6n, -8n))).toBe('-3/4');
    expect(formatRational(createRational(0n, -5n))).toBe('0');
    expect(() => createRational(1n, 0n)).toThrow();
  });

  test('snaps to the nearest small-denominator rational within the tolerance', () => {
    const tolerance = createRational(1n, 100n);
    expect(formatRational(snapToSmallDenominator(decimal('0.334'), 12, tolerance))).toBe('1/3');
    expect(formatRational(snapToSmallDenominator(decimal('0.36'), 12, tolerance))).toBe('4/11');
    // Nothing within the tolerance: the value itself.
    expect(formatRational(snapToSmallDenominator(decimal('0.3'), 2, tolerance))).toBe('3/10');
    // Small-denominator values are fixed points.
    expect(formatRational(snapToSmallDenominator(decimal('0.25'), 12, tolerance))).toBe('1/4');
    expect(formatRational(snapToSmallDenominator(decimal('-0.334'), 12, tolerance))).toBe('-1/3');
    // positiveOnly never returns 0.
    expect(formatRational(snapToSmallDenominator(decimal('0.001'), 12, tolerance, true))).toBe('1/1000');
    expect(formatRational(snapToSmallDenominator(decimal('0.001'), 12, tolerance))).toBe('0');
  });

  test.each([
    ['0.333333', '1/3'],
    ['0.3333', '1/3'],
    ['0.33333', '1/3'],
    // Too coarse: 3 decimals are 0.0013 beat off, beyond 1/4608 beat.
    ['0.333', '333/1000'],
    ['0.75', '3/4'],
    ['0.750000', '3/4'],
    ['0.3', '3/10'],
    ['0.005208', '1/192'],
    ['0.0052083', '1/192'],
    ['0.142857', '1/7'],
    // Not a small-denominator length: kept exact, whatever its size.
    ['0.1427083', '1427083/10000000'],
    ['16', '16'],
    ['16.001', '16001/1000'],
    // Tiny lengths stay exact (no jump to 0 or to a coarse grid).
    ['0.0001', '1/10000'],
    ['0.00001', '1/100000'],
  ])('snaps the measure length %s to %s', (input, expected) => {
    expect(formatRational(snapMeasureLength(decimal(input)))).toBe(expected);
  });

  test.each([
    ['149.99999999', '150'],
    ['150.00000001', '150'],
    ['133.333333', '400/3'],
    ['133.3333', '400/3'],
    ['133.333', '400/3'],
    ['166.667', '500/3'],
    ['142.857', '1000/7'],
    ['150.5', '301/2'],
    ['-0.5', '-1/2'],
    ['0.333333', '1/3'],
    ['0.01', '1/100'],
    ['287.12', '7178/25'],
    ['0', '0'],
    ['2000000', '2000000'],
  ])('snaps the value %s to %s', (input, expected) => {
    expect(formatRational(snapValue(decimal(input)))).toBe(expected);
  });
});

/** Decimal text of `n / d` with `digits` fraction digits, rounded half up or truncated. */
function printDecimal(n: bigint, d: bigint, digits: number, mode: 'round' | 'truncate'): string {
  const scale = 10n ** BigInt(digits);
  const negative = n < 0n;
  const magnitude = negative ? -n : n;
  let scaled = (magnitude * scale) / d;
  if (mode === 'round' && ((magnitude * scale) % d) * 2n >= d) {
    scaled += 1n;
  }
  const text = scaled.toString().padStart(digits + 1, '0');
  const body = digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  return negative ? `-${body}` : body;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('snapping stability', () => {
  test('every printing of a small-denominator measure length snaps back to it', () => {
    const random = createRandom(7);
    for (let trial = 0; trial < 4000; trial += 1) {
      // Intended length: a beat count k/q with q <= 48, between 1/48 beat and 64 beats.
      const q = 1 + Math.floor(random() * 48);
      const k = 1 + Math.floor(random() * 64 * q);
      const intended = createRational(BigInt(k), BigInt(q) * 4n);
      const results = new Set<string>();
      for (const [digits, mode] of [
        [4, 'round'],
        [5, 'round'],
        [5, 'truncate'],
        [6, 'round'],
        [6, 'truncate'],
        [8, 'round'],
        [12, 'truncate'],
      ] as const) {
        results.add(formatRational(snapMeasureLength(decimal(printDecimal(intended.n, intended.d, digits, mode)))));
      }
      results.add(formatRational(snapMeasureLength(rationalFromNumber(Number(intended.n) / Number(intended.d))!)));
      expect([...results], `intended ${formatRational(intended)}`).toEqual([formatRational(intended)]);
    }
  });

  test('every printing of a small-denominator value snaps back to it', () => {
    const random = createRandom(11);
    for (let trial = 0; trial < 4000; trial += 1) {
      const q = 1 + Math.floor(random() * 12);
      // BPM-like values from 50 to 1000, and SCROLL-like values from 0.05 to 5.
      const large = random() < 0.5;
      const k = large ? Math.floor((50 + random() * 950) * q) : Math.max(1, Math.floor((0.05 + random() * 5) * q));
      const intended = createRational(BigInt(k), BigInt(q));
      const value = Number(intended.n) / Number(intended.d);
      const printings: Array<[number, 'round' | 'truncate']> = [
        [6, 'round'],
        [6, 'truncate'],
        [8, 'round'],
        [10, 'truncate'],
      ];
      if (value >= 5) {
        printings.push([4, 'round']);
      }
      if (value >= 50) {
        printings.push([3, 'round']);
      }
      const results = new Set<string>();
      for (const [digits, mode] of printings) {
        results.add(formatRational(snapValue(decimal(printDecimal(intended.n, intended.d, digits, mode)))));
      }
      results.add(formatRational(snapValue(rationalFromNumber(value)!)));
      expect([...results], `intended ${formatRational(intended)}`).toEqual([formatRational(intended)]);
    }
  });

  test('snapping is idempotent', () => {
    const random = createRandom(3);
    for (let trial = 0; trial < 2000; trial += 1) {
      const value = createRational(
        BigInt(1 + Math.floor(random() * 1_000_000)),
        BigInt(1 + Math.floor(random() * 100_000)),
      );
      const length = snapMeasureLength(value);
      expect(snapMeasureLength(length)).toEqual(length);
      const snapped = snapValue(value);
      expect(snapValue(snapped)).toEqual(snapped);
    }
  });
});
