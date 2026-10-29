/** Two visible channel banks, each with lane codes 1–9 and A–Z. */
export const MAX_GENERIC_BMSON_KEYS = 70;

export type GenericBmsonPlayVariant = `generic-${number}`;

/** Undefined for other hints; reject numeric generic layouts that the internal lane domain cannot represent. */
export function resolveGenericBmsonKeyCount(modeHint: unknown): number | undefined {
  if (typeof modeHint !== 'string') return undefined;
  const match = /^generic-(\d+)keys?$/.exec(modeHint.trim());
  if (!match) {
    if (modeHint.trim().startsWith('generic-'))
      throw new TypeError(
        `Invalid generic bmson layout ${modeHint.trim()}: expected generic-Nkeys with an integer key count.`,
      );
    return undefined;
  }
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GENERIC_BMSON_KEYS) {
    throw new RangeError(
      `Unsupported bmson layout ${modeHint.trim()}: generic layouts require 1–${MAX_GENERIC_BMSON_KEYS} keys.`,
    );
  }
  return count;
}
