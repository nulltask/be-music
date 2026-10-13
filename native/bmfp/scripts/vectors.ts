/**
 * Test vectors for the C port, computed by the TypeScript implementation it must match
 * (packages/chart/src/fingerprint-rational.ts) and by JavaScript's own Number / String. `vectors.test.ts` keeps the
 * committed files in tests/vectors/ equal to what this produces; the C test runner (tests/test_main.c) reads them.
 *
 * One case per line, fields separated by tabs. Text inputs are hex-encoded UTF-8, so white space and non-ASCII survive.
 * Rationals are canonical text (`-7`, `400/3`); `!` means "no value" (undefined in the TypeScript).
 */
import {
  addRational,
  compareRational,
  createRational,
  divideRational,
  formatRational,
  multiplyRational,
  parseDecimalRational,
  parseLeadingDecimalRational,
  rationalFromNumber,
  snapMeasureLength,
  snapValue,
  subtractRational,
  type Rational,
} from '../../../packages/chart/src/fingerprint-rational.ts';

/** mulberry32: small, deterministic, good enough to spread test inputs. */
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

const hex = (text: string): string => Buffer.from(text, 'utf8').toString('hex');
const show = (value: Rational | undefined): string => (value === undefined ? '!' : formatRational(value));

function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function randomDigits(random: () => number, count: number): string {
  let text = '';
  for (let i = 0; i < count; i++) text += String(randomInt(random, i === 0 && count > 1 ? 1 : 0, 9));
  return text;
}

function randomBigInt(random: () => number, maxDigits: number): bigint {
  const value = BigInt(randomDigits(random, randomInt(random, 1, maxDigits)));
  return random() < 0.5 ? -value : value;
}

function randomRational(random: () => number, maxDigits: number): Rational {
  const n = random() < 0.05 ? 0n : randomBigInt(random, maxDigits);
  let d = BigInt(randomDigits(random, randomInt(random, 1, maxDigits)));
  if (d === 0n) d = 1n;
  return createRational(n, d);
}

/** Decimal text a chart might hold: signs, missing integer or fraction digits, exponents. */
function randomDecimalText(random: () => number): string {
  const sign = ['', '', '-', '+'][randomInt(random, 0, 3)]!;
  const intDigits = random() < 0.15 ? '' : randomDigits(random, randomInt(random, 1, 6));
  const hasFraction = random() < 0.7 || intDigits === '';
  const fraction = hasFraction ? `.${randomDigits(random, randomInt(random, intDigits === '' ? 1 : 0, 9))}` : '';
  const exponent =
    random() < 0.2
      ? `${random() < 0.5 ? 'e' : 'E'}${['', '+', '-'][randomInt(random, 0, 2)]}${randomInt(random, 0, 25)}`
      : '';
  return `${sign}${intDigits}${fraction}${exponent}`;
}

const SPACES = [' ', '\t', '\n', '\r', '\v', '\f', ' ', '　', '﻿', ' ', ' ', ' ', ' '];

function withSpaces(random: () => number, text: string): string {
  const pad = () => (random() < 0.4 ? SPACES[randomInt(random, 0, SPACES.length - 1)]! : '');
  return `${pad()}${pad()}${text}${pad()}`;
}

const PARSE_CASES = [
  '0',
  '-0',
  '+0',
  '150',
  '0.333333',
  '-1.5e-3',
  '1.',
  '.5',
  '+.5',
  '-.5e2',
  '1e',
  '1e+',
  'e5',
  '.',
  '',
  ' ',
  '+',
  '-',
  '1.2.3',
  '1e5.5',
  '0x10',
  'Infinity',
  'NaN',
  '１２',
  '1_000',
  '00012.3400',
  '1E-0',
  '7e+010',
  ' 12 ',
  '12a',
  ' 133.333　',
  '﻿42',
  '1​',
];

const LEADING_CASES = [
  '100 ; comment',
  '  -4.5e2xyz',
  '.5.5',
  '1e',
  '1e+',
  '1e+2e3',
  '+.e3',
  '-.5',
  'abc',
  '',
  '   12',
  '1.e3',
  '1..2',
  '+-1',
  '3/4',
  '120,5',
  '　　7',
];

export function generateRationalVectors(): string {
  const random = createRandom(0x62_6d_66_70);
  const lines: string[] = [];
  for (const text of PARSE_CASES) lines.push(`parse\t${hex(text)}\t${show(parseDecimalRational(text))}`);
  for (let i = 0; i < 300; i++) {
    const text = random() < 0.5 ? withSpaces(random, randomDecimalText(random)) : randomDecimalText(random);
    lines.push(`parse\t${hex(text)}\t${show(parseDecimalRational(text))}`);
  }
  for (const text of LEADING_CASES) lines.push(`leading\t${hex(text)}\t${show(parseLeadingDecimalRational(text))}`);
  for (let i = 0; i < 150; i++) {
    const tail = [' ;x', 'abc', '.', 'e', 'e+', '', '  9', '/2'][randomInt(random, 0, 7)]!;
    const text = withSpaces(random, `${randomDecimalText(random)}${tail}`);
    lines.push(`leading\t${hex(text)}\t${show(parseLeadingDecimalRational(text))}`);
  }
  const operations: Array<[string, (a: Rational, b: Rational) => Rational | number]> = [
    ['add', addRational],
    ['sub', subtractRational],
    ['mul', multiplyRational],
    ['div', divideRational],
    ['cmp', compareRational],
  ];
  for (const [name, operation] of operations) {
    for (let i = 0; i < 160; i++) {
      const a = randomRational(random, i < 120 ? 12 : 40);
      let b = randomRational(random, i < 120 ? 12 : 40);
      if (name === 'div' && b.n === 0n) b = createRational(7n, 3n);
      if (name === 'cmp' && random() < 0.1) b = a;
      const result = operation(a, b);
      lines.push(
        `${name}\t${formatRational(a)}\t${formatRational(b)}\t${typeof result === 'number' ? String(result) : formatRational(result)}`,
      );
    }
  }
  // Measure lengths: small-denominator lengths printed with a few decimals, and plain random lengths.
  for (let i = 0; i < 250; i++) {
    let text: string;
    if (random() < 0.7) {
      const beats = randomInt(random, 1, 48 * 16) / randomInt(random, 1, 48);
      text = (beats / 4).toFixed(randomInt(random, 2, 9));
    } else {
      text = `${randomInt(random, 0, 8)}.${randomDigits(random, randomInt(random, 1, 8))}`;
    }
    const length = parseDecimalRational(text)!;
    if (length.n <= 0n) continue;
    lines.push(`snapm\t${formatRational(length)}\t${formatRational(snapMeasureLength(length))}`);
  }
  // Values: BPM-like and SCROLL-like numbers, small-denominator values printed at various precisions, negatives, 0.
  for (let i = 0; i < 300; i++) {
    let text: string;
    const pick = random();
    if (pick < 0.5) {
      const value = randomInt(random, -2000, 50000) / randomInt(random, 1, 12);
      text = value.toFixed(randomInt(random, 1, 8));
    } else if (pick < 0.9) {
      text = `${random() < 0.2 ? '-' : ''}${randomInt(random, 0, 999)}.${randomDigits(random, randomInt(random, 1, 10))}`;
    } else {
      text = ['0', '0.0', '1000000', '149.99999999', '0.01', '0.00001', '133.333', '142.857'][randomInt(random, 0, 7)]!;
    }
    const value = parseDecimalRational(text)!;
    lines.push(`snapv\t${formatRational(value)}\t${formatRational(snapValue(value))}`);
  }
  return `${lines.join('\n')}\n`;
}

const view = new DataView(new ArrayBuffer(8));

function bitsOf(value: number): string {
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

function fromBits(bits: bigint): number {
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

/** Exact decimal text of p * 2^k (every binary fraction has a finite decimal expansion). */
function exactDecimal(p: bigint, k: number): string {
  if (k >= 0) return (p << BigInt(k)).toString();
  const scale = -k;
  const digits = (p * 5n ** BigInt(scale)).toString().padStart(scale + 1, '0');
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}

/** The exact midpoint between a positive finite double and the next one up, as decimal text. */
function midpointText(bits: bigint): string {
  const exponentField = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponentField === 0 ? fraction : fraction | (1n << 52n);
  const exp2 = exponentField === 0 ? -1074 : exponentField - 1075;
  return exactDecimal(2n * mantissa + 1n, exp2 - 1);
}

const DOUBLE_CASES = [
  '0',
  '-0',
  '0.1',
  '0.2',
  '0.3',
  '1',
  '-1',
  '133.333333',
  '1e21',
  '1e-7',
  '123456789012345678901234567890',
  '9007199254740993',
  '9007199254740995',
  '5e-324',
  '4.9406564584124654e-324',
  '2.4703282292062327e-324',
  '2.4703282292062328e-324',
  '2.2250738585072011e-308',
  '2.2250738585072014e-308',
  '1.7976931348623157e308',
  '1.7976931348623158e308',
  '1.7976931348623159e308',
  '1e309',
  '-1e400',
  '1e-400',
  '0.000001',
  '0.0000001',
  '100000000000000000000',
  '999999999999999999999',
  '3.141592653589793238462643383279',
];

export function generateBinary64Vectors(): string {
  const random = createRandom(0x66_36_34);
  const lines: string[] = [];
  const emit = (text: string) => {
    const value = Number(text);
    if (parseDecimalRational(text) === undefined || Number.isNaN(value)) return;
    const shortest = Number.isFinite(value) ? show(rationalFromNumber(value)) : '!';
    lines.push(`f64\t${hex(text)}\t${Number.isFinite(value) ? bitsOf(value) : 'inf'}\t${shortest}`);
  };
  for (const text of DOUBLE_CASES) emit(text);
  for (let i = 0; i < 700; i++) {
    // Random finite doubles across the whole range, printed shortest, at 17 digits and in long exponent form.
    let bits: bigint;
    do {
      bits = (BigInt(Math.floor(random() * 2 ** 32)) << 32n) | BigInt(Math.floor(random() * 2 ** 32));
      if (random() < 0.5) bits &= 0x7fffffffffffffffn;
    } while (!Number.isFinite(fromBits(bits)));
    const value = fromBits(bits);
    emit(String(value));
    if (i % 2 === 0) emit(value.toPrecision(17));
    if (i % 3 === 0) emit(value.toExponential(randomInt(random, 18, 30)));
  }
  for (let i = 0; i < 300; i++) {
    // Midpoints between neighbours exercise ties-to-even; mostly moderate exponents, some subnormal.
    const exponentField = i % 25 === 0 ? 0 : randomInt(random, 1023 - 80, 1023 + 80);
    const fraction = BigInt(Math.floor(random() * 2 ** 26)) * 2n ** 26n + BigInt(Math.floor(random() * 2 ** 26));
    const bits = (BigInt(exponentField) << 52n) | (fraction === 0n && exponentField === 0 ? 1n : fraction);
    emit(midpointText(bits));
  }
  for (let i = 0; i < 400; i++) {
    // Long decimals, more digits than a double holds.
    emit(
      `${random() < 0.3 ? '-' : ''}${randomDigits(random, randomInt(random, 1, 25))}.${randomDigits(random, randomInt(random, 0, 25))}e${randomInt(random, -330, 310)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
