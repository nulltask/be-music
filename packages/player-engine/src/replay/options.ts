import { expectRecord, ReplayParseError } from './parse.ts';

/** Lossless selected option values; effective chart/engine state remains in the replay's typed fields. */
export type ReplayOptionState = Record<string, string | number | boolean | null>;
/** An option change on the chart clock, including changes made while paused at the same chart time. */
export interface ReplayOptionChange {
  timeUs: number;
  values: ReplayOptionState;
}

/** Reads an option snapshot without coercing or dropping unknown source-specific option names. */
export function parseReplayOptionState(raw: unknown, path = 'play.options'): ReplayOptionState {
  const object = expectRecord(raw, path);
  const entries = Object.entries(object);
  for (const [key, value] of entries) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      continue;
    throw new ReplayParseError(`${path}.${key}: expected a string, finite number, boolean or null`);
  }
  return Object.fromEntries(entries) as ReplayOptionState;
}

/** Reads a nondecreasing option timeline, preserving the order of edits made at one timestamp. */
export function parseReplayOptionChanges(raw: unknown, path = 'play.optionChanges'): ReplayOptionChange[] {
  if (!Array.isArray(raw)) throw new ReplayParseError(`${path}: expected an array`);
  let previous = 0;
  return raw.map((value, index) => {
    const entry = expectRecord(value, `${path}[${index}]`);
    const timeUs = entry.timeUs;
    if (typeof timeUs !== 'number' || !Number.isSafeInteger(timeUs) || timeUs < previous)
      throw new ReplayParseError(`${path}[${index}].timeUs: expected nondecreasing non-negative integer microseconds`);
    previous = timeUs;
    return { timeUs, values: parseReplayOptionState(entry.values, `${path}[${index}].values`) };
  });
}

/** Reconstructs option values at a chart time; also used after seeking backwards. */
export function resolveReplayOptionsAt(
  initial: Readonly<ReplayOptionState> | undefined,
  changes: readonly ReplayOptionChange[] | undefined,
  timeUs: number,
): ReplayOptionState {
  let state = { ...initial };
  for (const change of changes ?? []) {
    if (change.timeUs > timeUs) break;
    state = { ...state, ...change.values };
  }
  return state;
}

/** Only values that changed, without mutating or retaining the caller's snapshot. */
export function diffReplayOptions(
  previous: Readonly<ReplayOptionState>,
  next: Readonly<ReplayOptionState>,
): ReplayOptionState | undefined {
  const entries = Object.entries(next).filter(
    ([key, value]) => !Object.hasOwn(previous, key) || previous[key] !== value,
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}
