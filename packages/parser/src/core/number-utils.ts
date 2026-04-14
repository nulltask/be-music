export function normalizeAsciiBase36Code(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  const upperCode = code & 0xdf;
  if (upperCode >= 0x41 && upperCode <= 0x5a) {
    return upperCode;
  }
  return -1;
}

export function normalizeNonNegativeInt(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : 0;
}

export function normalizePositiveInt(value: number, fallback = 1): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 1 ? normalized : 1;
}

export function normalizeFractionNumerator(value: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  if (normalized <= 0) {
    return 0;
  }
  const safeDenominator = normalizePositiveInt(denominator);
  const maxNumerator = safeDenominator - 1;
  return normalized > maxNumerator ? maxNumerator : normalized;
}

export function normalizeSortedUniqueNonNegativeIntegers(values: ReadonlyArray<number>): number[] {
  const normalized = new Array<number>(values.length);
  let normalizedLength = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!Number.isFinite(value)) {
      continue;
    }
    normalized[normalizedLength] = value <= 0 ? 0 : Math.floor(value);
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
