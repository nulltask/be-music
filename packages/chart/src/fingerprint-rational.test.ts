import { describe, expect, test } from 'vite-plus/test';
import {
  createRational,
  formatRational,
  parseDecimalRational,
  parseLeadingDecimalRational,
  rationalFromNumber,
  simplestRationalInInterval,
  snapToMeasureGrid,
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

  test('finds the simplest rational of a closed interval', () => {
    expect(formatRational(simplestRationalInInterval(decimal('0.3'), decimal('0.4')))).toBe('1/3');
    expect(formatRational(simplestRationalInInterval(decimal('0.34'), decimal('0.36')))).toBe('5/14');
    expect(formatRational(simplestRationalInInterval(decimal('-0.4'), decimal('-0.3')))).toBe('-1/3');
    expect(formatRational(simplestRationalInInterval(decimal('-0.1'), decimal('0.2')))).toBe('0');
    // Closed: an end point counts.
    expect(formatRational(simplestRationalInInterval(decimal('0.5'), decimal('0.6')))).toBe('1/2');
    // Several integers: the one nearest the centre, nearer zero on a tie.
    expect(formatRational(simplestRationalInInterval(decimal('1.2'), decimal('4.4')))).toBe('3');
    expect(formatRational(simplestRationalInInterval(decimal('1.5'), decimal('3.5')))).toBe('2');
    expect(formatRational(simplestRationalInInterval(decimal('-3.5'), decimal('-1.5')))).toBe('-2');
    expect(() => simplestRationalInInterval(decimal('1'), decimal('0'))).toThrow();
  });

  test('handles deep continued fractions without searching denominators', () => {
    const value = createRational(123456789n, 987654321n * 1000n);
    expect(formatRational(simplestRationalInInterval(value, value))).toBe(formatRational(value));
  });

  test.each([
    ['0.333333', '1/3'],
    ['0.3333', '1/3'],
    ['0.333', '1/3'],
    [String(137 / 960), '1/7'],
    ['0.3', '3/10'],
    ['0.75', '3/4'],
    ['0.750000', '3/4'],
    // Too far from 1/3; ±1/1920 still reaches a denominator below 100.
    ['0.33', '29/88'],
    ['0.0001', '0'],
  ])('snaps %s to the measure grid as %s', (input, expected) => {
    expect(formatRational(snapToMeasureGrid(decimal(input)))).toBe(expected);
  });

  test.each([
    ['149.99999999', '150'],
    ['150.00000001', '150'],
    ['133.333333', '400/3'],
    ['150.5', '301/2'],
    ['-0.5', '-1/2'],
    ['0', '0'],
    ['2000000', '2000000'],
  ])('snaps the value %s to %s', (input, expected) => {
    expect(formatRational(snapValue(decimal(input)))).toBe(expected);
  });
});
