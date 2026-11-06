import {
  isInputSourceDevice,
  isInputSourceKind,
  isInputSourceLabel,
  isTurntableDirection,
  type IdentifiedInputSource,
} from '../core/input-source.ts';
import { expectNonNegativeInteger, expectRecord, ReplayParseError } from './parse.ts';

/**
 * One entry of a replay's input-source table (`play.inputSources`, #605): a physical input the play used, which every
 * input event names by `id` (`ReplayInputEvent.source`). See `core/input-source.ts`.
 */
export type ReplayInputSource = IdentifiedInputSource;

/**
 * How the host turned an analog turntable axis into the presses and releases the replay records: a named, versioned
 * algorithm and its parameters, for audit and display. The replay records the resulting events, never raw axis
 * samples, and simulators never re-run the algorithm.
 */
export interface ReplayAnalogScratch {
  /** The algorithm's versioned name (`'be-music/1'`). */
  algorithm: string;
  /** Axis ticks a turn must move before it counts as a press. */
  thresholdTicks?: number;
  /** How long (ms) the axis must stay still before the turn counts as released. */
  stopMs?: number;
}

/** Validates `play.inputSources`: well-formed entries, unique ids, and a `direction` exactly on turntable sources. */
export function parseReplayInputSources(value: unknown, path = 'play.inputSources'): ReplayInputSource[] {
  if (!Array.isArray(value)) throw new ReplayParseError(`${path}: expected an array`);
  const ids = new Set<number>();
  return value.map((entry, index) => {
    const at = `${path}[${index}]`;
    const record = expectRecord(entry, at);
    const id = expectNonNegativeInteger(record.id, `${at}.id`);
    if (ids.has(id)) throw new ReplayParseError(`${at}.id: duplicate id ${id}`);
    ids.add(id);
    if (!isInputSourceKind(record.kind)) {
      throw new ReplayParseError(`${at}.kind: expected 'key' | 'button' | 'turntable'`);
    }
    if (!isInputSourceDevice(record.device)) {
      throw new ReplayParseError(`${at}.device: expected 'keyboard' | 'controller' | 'touch'`);
    }
    if (!isInputSourceLabel(record.label)) {
      throw new ReplayParseError(`${at}.label: expected a lowercase name without whitespace (1 to 32 characters)`);
    }
    const source: ReplayInputSource = { id, kind: record.kind, device: record.device, label: record.label };
    if (record.kind === 'turntable') {
      if (!isTurntableDirection(record.direction)) {
        throw new ReplayParseError(`${at}.direction: expected 'up' | 'down' on a turntable source`);
      }
      source.direction = record.direction;
    } else if (record.direction !== undefined) {
      throw new ReplayParseError(`${at}.direction: only a turntable source has a direction`);
    }
    return source;
  });
}

/** Validates `play.analogScratch`. */
export function parseReplayAnalogScratch(value: unknown, path = 'play.analogScratch'): ReplayAnalogScratch {
  const record = expectRecord(value, path);
  if (typeof record.algorithm !== 'string' || record.algorithm.length === 0 || record.algorithm.length > 64) {
    throw new ReplayParseError(`${path}.algorithm: expected a non-empty string of at most 64 characters`);
  }
  const parsed: ReplayAnalogScratch = { algorithm: record.algorithm };
  if (record.thresholdTicks !== undefined) {
    parsed.thresholdTicks = expectNonNegativeInteger(record.thresholdTicks, `${path}.thresholdTicks`);
  }
  if (record.stopMs !== undefined) parsed.stopMs = expectNonNegativeInteger(record.stopMs, `${path}.stopMs`);
  return parsed;
}
