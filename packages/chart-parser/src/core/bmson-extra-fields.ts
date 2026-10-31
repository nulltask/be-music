import {
  cloneJSONFields,
  collectBmsonExtraFields,
  type BmsonFieldScope,
  type BmsonExtraFields,
  type JSONFields,
} from '@be-music/chart-source';

/** Native fields and Be-Music annotation envelopes are distinct boundaries, even for a source key named extraFields. */
export function readBmsonExtraFields(input: unknown, scope: BmsonFieldScope, fromIR = false): BmsonExtraFields {
  const fields =
    fromIR && input && typeof input === 'object'
      ? cloneJSONFields((input as Record<string, unknown>).extraFields)
      : fromIR
        ? undefined
        : collectBmsonExtraFields(input, scope);
  return fields ? { extraFields: fields } : {};
}

export function normalizeBmsonExtraFieldMap(input: unknown): Record<string, JSONFields> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const entries = Object.entries(input).flatMap(([key, value]) => {
    const fields = cloneJSONFields(value);
    return fields ? [[key, fields] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}
