/** Two visible channel banks, each with lane codes 1–9 and A–Z. */
export const MAX_GENERIC_BMSON_KEYS = 70;

export type GenericBmsonPlayVariant = `generic-${number}`;

/**
 * The key count of a `generic-Nkeys` hint with 1–70 keys; undefined for any other hint. A malformed or out-of-range
 * `generic-` hint is an unknown hint like any other, so the chart is read as `beat-7k` where its lanes fit, as beatoraja
 * reads an unsupported `mode_hint` (BMSONDecoder warns and uses BEAT_7K).
 */
export function resolveGenericBmsonKeyCount(modeHint: unknown): number | undefined {
  if (typeof modeHint !== 'string') return undefined;
  const match = /^generic-(\d+)keys?$/.exec(modeHint.trim());
  if (!match) return undefined;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_GENERIC_BMSON_KEYS ? count : undefined;
}
