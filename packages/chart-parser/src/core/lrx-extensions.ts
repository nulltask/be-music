import type { LRXEventExtensions, LRXExtensions } from '@be-music/chart-source';

const EVENT_NUMBERS = [
  'length',
  'volume',
  'pan',
  'frequency',
  'attackMs',
  'releaseMs',
  'offsetMs',
  'lengthMs',
  'damage',
  'recover',
] as const satisfies ReadonlyArray<keyof LRXEventExtensions>;
const EVENT_FLAGS = ['chain', 'reverse'] as const satisfies ReadonlyArray<keyof LRXEventExtensions>;

/** The LRX values of an event read back from Be-Music JSON: known fields of the right type, nothing else. */
export function normalizeLRXEventExtensions(value: unknown): LRXEventExtensions | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const extension: LRXEventExtensions = {};
  for (const key of EVENT_NUMBERS) {
    const field = raw[key];
    if (typeof field === 'number' && Number.isFinite(field)) extension[key] = field;
  }
  for (const key of EVENT_FLAGS) {
    if (raw[key] === true) extension[key] = true;
  }
  return Object.keys(extension).length > 0 ? extension : undefined;
}

const CHART_NUMBERS = [
  'laneType',
  'category',
  'level',
  'bmsLevel',
  'minBPM',
  'maxBPM',
  'baseBPM',
  'startBPM',
  'phase',
  'unlock',
  'songId',
  'endTick',
] as const satisfies ReadonlyArray<keyof LRXExtensions>;
const CHART_STRINGS = [
  'sequenceTitle',
  'sequenceArtist',
  'movieArtist',
  'labelImage',
  'moviePath',
] as const satisfies ReadonlyArray<keyof LRXExtensions>;

/** The chart-level LRX block read back from Be-Music JSON. */
export function normalizeLRXExtensions(value: unknown): LRXExtensions | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const lrx: LRXExtensions = {};
  for (const key of CHART_NUMBERS) {
    const field = raw[key];
    if (typeof field === 'number' && Number.isFinite(field)) lrx[key] = field;
  }
  for (const key of CHART_STRINGS) {
    const field = raw[key];
    if (typeof field === 'string') lrx[key] = field;
  }
  if (Array.isArray(raw.barTicks)) {
    lrx.barTicks = raw.barTicks.filter((tick): tick is number => typeof tick === 'number' && Number.isFinite(tick));
  }
  return lrx;
}
