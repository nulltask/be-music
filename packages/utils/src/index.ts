import { resolve } from 'node:path';

export function resolveCliPath(path: string, cwd: string = process.env.INIT_CWD ?? process.cwd()): string {
  return resolve(cwd, path);
}

export function clamp(value: number, min: number, max: number): number {
  if (value <= min) {
    return min;
  }
  if (value >= max) {
    return max;
  }
  return value;
}

export function clampSignedUnit(value: number): number {
  if (value <= -1) {
    return -1;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

export function floatToInt16(value: number): number {
  const clamped = clampSignedUnit(value);
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
}

export function normalizeNonNegativeInt(value: number, fallback = 0): number {
  if (value >= 0 && value < Number.POSITIVE_INFINITY) {
    return Math.floor(value);
  }
  if (value === Number.NEGATIVE_INFINITY || value !== value || value === Number.POSITIVE_INFINITY) {
    return fallback;
  }
  return 0;
}

export function normalizePositiveInt(value: number, fallback = 1): number {
  if (value > 0 && value < Number.POSITIVE_INFINITY) {
    const normalized = Math.floor(value);
    return normalized >= 1 ? normalized : 1;
  }
  return fallback;
}

export function normalizeFractionNumerator(value: number, denominator: number, fallback = 0): number {
  const safeDenominator = normalizePositiveInt(denominator, 1);
  if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY || value !== value) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return 0;
  }
  const maxNumerator = safeDenominator - 1;
  if (normalized > maxNumerator) {
    return maxNumerator;
  }
  return normalized;
}

export function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

export function lcm(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return Math.abs((left * right) / gcd(left, right));
}

export function compareFractions(
  leftNumerator: number,
  leftDenominator: number,
  rightNumerator: number,
  rightDenominator: number,
): number {
  if (leftDenominator === rightDenominator) {
    return leftNumerator - rightNumerator;
  }

  const leftScaled = leftNumerator * rightDenominator;
  const rightScaled = rightNumerator * leftDenominator;
  if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
    if (leftScaled < rightScaled) {
      return -1;
    }
    if (leftScaled > rightScaled) {
      return 1;
    }
    return 0;
  }

  const leftScaledBigInt = BigInt(leftNumerator) * BigInt(rightDenominator);
  const rightScaledBigInt = BigInt(rightNumerator) * BigInt(leftDenominator);
  if (leftScaledBigInt < rightScaledBigInt) {
    return -1;
  }
  if (leftScaledBigInt > rightScaledBigInt) {
    return 1;
  }
  return 0;
}

export function normalizeSortedUniqueNonNegativeIntegers(values: ReadonlyArray<number>): number[] {
  const normalized = new Array<number>(values.length);
  let normalizedLength = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY || value !== value) {
      continue;
    }
    const floored = Math.floor(value);
    normalized[normalizedLength] = floored < 0 ? 0 : floored;
    normalizedLength += 1;
  }
  normalized.length = normalizedLength;
  if (normalizedLength <= 1) {
    return normalized;
  }

  normalized.sort((left, right) => left - right);
  let writeIndex = 1;
  let previous = normalized[0]!;
  for (let readIndex = 1; readIndex < normalized.length; readIndex += 1) {
    const current = normalized[readIndex]!;
    if (current === previous) {
      continue;
    }
    normalized[writeIndex] = current;
    writeIndex += 1;
    previous = current;
  }
  normalized.length = writeIndex;
  return normalized;
}

export function findLastIndexAtOrBefore<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (resolveValue(items[mid]!) <= target) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

export function findLastIndexBefore<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (resolveValue(items[mid]!) < target) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

export function normalizeAsciiBase36Code(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  if (code >= 0x41 && code <= 0x5a) {
    return code;
  }
  if (code >= 0x61 && code <= 0x7a) {
    return code - 0x20;
  }
  return -1;
}

export * from './abort.ts';
export * from './path.ts';
export * from './pcm.ts';
export * from './workerize.ts';
