import { resolve } from 'node:path';

export function resolveCliPath(path: string, cwd: string = process.env.INIT_CWD ?? process.cwd()): string {
  if (path.length === 0 || path === '.') {
    return cwd;
  }

  // Most CLI paths are simple relative paths without parent traversal.
  if (!path.includes('..') && !path.includes('\\')) {
    if (path.startsWith('./')) {
      const relativePath = path.slice(2);
      if (relativePath.length === 0) {
        return cwd;
      }
      return cwd.endsWith('/') ? `${cwd}${relativePath}` : `${cwd}/${relativePath}`;
    }
    const firstCode = path.charCodeAt(0);
    if (firstCode !== 0x2f && firstCode !== 0x2e) {
      return cwd.endsWith('/') ? `${cwd}${path}` : `${cwd}/${path}`;
    }
  }
  return resolve(cwd, path);
}

export function clamp(value: number, min: number, max: number): number {
  return value <= min ? min : value >= max ? max : value;
}

export function clampSignedUnit(value: number): number {
  return value <= -1 ? -1 : value >= 1 ? 1 : value;
}

export function floatToInt16(value: number): number {
  const clamped = value <= -1 ? -1 : value >= 1 ? 1 : value;
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
}

export function normalizeNonNegativeInt(value: number, fallback = 0): number {
  if (value !== value || value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : 0;
}

export function normalizePositiveInt(value: number, fallback = 1): number {
  if (value <= 0 || value !== value || value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 1 ? normalized : 1;
}

export function normalizeFractionNumerator(value: number, denominator: number, fallback = 0): number {
  if (value !== value || value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized <= 0) {
    return 0;
  }

  let safeDenominator = 1;
  if (denominator > 0 && denominator === denominator && denominator !== Number.POSITIVE_INFINITY) {
    safeDenominator = Math.trunc(denominator);
    if (safeDenominator < 1) {
      safeDenominator = 1;
    }
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
  if (leftScaled === rightScaled) {
    return 0;
  }
  if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
    return leftScaled < rightScaled ? -1 : 1;
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
    if (value <= 0) {
      normalized[normalizedLength] = 0;
    } else if (value < 0x8000_0000) {
      normalized[normalizedLength] = value | 0;
    } else {
      normalized[normalizedLength] = Math.floor(value);
    }
    normalizedLength += 1;
  }
  normalized.length = normalizedLength;
  if (normalizedLength <= 1) {
    return normalized;
  }

  if (normalizedLength <= 16) {
    for (let index = 1; index < normalizedLength; index += 1) {
      const current = normalized[index]!;
      let insertIndex = index - 1;
      while (insertIndex >= 0 && normalized[insertIndex]! > current) {
        normalized[insertIndex + 1] = normalized[insertIndex]!;
        insertIndex -= 1;
      }
      normalized[insertIndex + 1] = current;
    }
  } else {
    normalized.sort((left, right) => left - right);
  }

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
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = resolveValue(items[mid]!);
    if (value <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}

export function findLastIndexBefore<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = resolveValue(items[mid]!);
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}

export function normalizeAsciiBase36Code(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  const uppercase = code & 0xdf;
  if (uppercase >= 0x41 && uppercase <= 0x5a) {
    return uppercase;
  }
  return -1;
}

export * from './abort.ts';
export * from './path.ts';
export * from './pcm.ts';
export * from './workerize.ts';
