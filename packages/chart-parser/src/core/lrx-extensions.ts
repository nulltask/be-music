import type { LRXBGACue, LRXEventExtensions, LRXExtensions } from '@be-music/chart-source';

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
const EVENT_FLAGS = ['chain', 'reverse', 'keyVolume'] as const satisfies ReadonlyArray<keyof LRXEventExtensions>;
const EVENT_STRINGS = ['lane'] as const satisfies ReadonlyArray<keyof LRXEventExtensions>;

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
  for (const key of EVENT_STRINGS) {
    const field = raw[key];
    if (typeof field === 'string' && field.length > 0) extension[key] = field;
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
  if (Array.isArray(raw.bga)) {
    const bga = raw.bga.flatMap((value) => {
      const cue = normalizeLRXBGACue(value);
      return cue === undefined ? [] : [cue];
    });
    if (bga.length > 0) lrx.bga = bga;
  }
  return lrx;
}

const BGA_NUMBERS = ['endTick', 'blend', 'rotation', 'center', 'accel'] as const satisfies ReadonlyArray<
  keyof LRXBGACue
>;
const BGA_QUADS = ['src', 'dst', 'color'] as const satisfies ReadonlyArray<keyof LRXBGACue>;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** One LRX BGA cue read back from Be-Music JSON: its slot, tick, image and key, and the known fields of the right type. */
function normalizeLRXBGACue(value: unknown): LRXBGACue | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const { slot, tick, image, key } = raw;
  if (!isNumber(slot) || slot < 0 || slot > 5 || !isNumber(tick) || !isNumber(image) || typeof key !== 'string')
    return undefined;
  const cue: LRXBGACue = { slot, tick, image, key };
  if (raw.chain === true) cue.chain = true;
  for (const name of BGA_NUMBERS) {
    const field = raw[name];
    if (isNumber(field)) cue[name] = field;
  }
  for (const name of BGA_QUADS) {
    const field = raw[name];
    if (Array.isArray(field) && field.length === 4 && field.every(isNumber))
      cue[name] = [field[0], field[1], field[2], field[3]];
  }
  return cue;
}
