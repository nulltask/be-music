import { isBeatorajaLuaFunctionValue, type BeatorajaLuaFunctionValue } from '../lua.ts';
import type { BeatorajaSkinSourceId } from '../types.ts';

export type BeatorajaNumericPropertyRef = number | BeatorajaLuaFunctionValue;

export function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function numberArrayField(record: Readonly<Record<string, unknown>>, key: string): ReadonlyArray<number> {
  const v = record[key];
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
  }
  return out;
}

export function stringField(record: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const v = record[key];
  return typeof v === 'string' ? v : fallback;
}

export function sourceIdField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback: BeatorajaSkinSourceId,
): BeatorajaSkinSourceId {
  return sourceIdValueField(record[key], fallback);
}

export function sourceIdValueField(value: unknown, fallback: BeatorajaSkinSourceId): BeatorajaSkinSourceId {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) return value;
  return fallback;
}

export function boolField(record: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const v = record[key];
  if (typeof v === 'boolean') return v;
  // Lua serializes booleans into JS booleans, but JSON skin authors sometimes write `1` / `0`
  // for boolean fields. Honor both shapes — `1` truthy, `0` falsy, anything else falls back.
  if (typeof v === 'number') return v !== 0;
  return fallback;
}

export function positiveIntField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const truncated = Math.trunc(v);
  return truncated >= 1 ? truncated : fallback;
}

export function integerPropertyField(value: unknown): BeatorajaNumericPropertyRef | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isBeatorajaLuaFunctionValue(value)) return value;
  return undefined;
}

export function floatPropertyField(value: unknown): BeatorajaNumericPropertyRef | undefined {
  return integerPropertyField(value);
}

export function pickHex(record: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>): string {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}
