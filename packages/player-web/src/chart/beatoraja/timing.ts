import type { BeMusicJson } from '@be-music/json';

/** Standard 4-beat measure baseline. Authors override measure length at the measure boundary. */
export const BEATS_PER_STANDARD_MEASURE = 4;

/** STOP table units (channel `09` references). 192 units = one 4-beat measure. */
export const STOP_UNITS_PER_MEASURE = 192;

export interface BeatorajaMeasureLayout {
  /** Beat offset for each measure index present in the chart. */
  measureBaseBeat: number[];
  /** Beat offset immediately after the final known measure. */
  totalBeats: number;
}

export function hasBeatorajaEventValue(value: string): boolean {
  return value !== '00' && value !== '';
}

export function computeBeatorajaMeasureLayout(chart: BeMusicJson): BeatorajaMeasureLayout {
  const lengths = new Map<number, number>();
  let maxMeasure = 0;
  for (const event of chart.events ?? []) {
    if (event.measure > maxMeasure) maxMeasure = event.measure;
  }
  for (const measure of chart.measures ?? []) {
    const idx = Math.max(0, Math.floor(measure.index));
    if (idx > maxMeasure) maxMeasure = idx;
    if (Number.isFinite(measure.length) && measure.length > 0) {
      lengths.set(idx, measure.length);
    }
  }
  const measureBaseBeat: number[] = [];
  let beat = 0;
  for (let m = 0; m <= maxMeasure; m += 1) {
    measureBaseBeat.push(beat);
    const length = lengths.get(m) ?? 1;
    beat += length * BEATS_PER_STANDARD_MEASURE;
  }
  return { measureBaseBeat, totalBeats: beat };
}

export function computeBeatorajaMeasureBaseBeats(chart: BeMusicJson): number[] {
  return computeBeatorajaMeasureLayout(chart).measureBaseBeat;
}

export function beatorajaEventBeat(
  event: { measure: number; position: readonly [number, number] },
  measureBaseBeat: readonly number[],
): number | undefined {
  const base = measureBaseBeat[event.measure];
  if (base === undefined) return undefined;
  const [num, denom] = event.position;
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return base;
  return base + (num / denom) * BEATS_PER_STANDARD_MEASURE;
}

export function resolveBeatorajaBpmEventValue(
  channel: string,
  value: string,
  table: Readonly<Record<string, unknown>> = {},
): number | undefined {
  if (channel === '03') {
    const parsed = parseInt(value, 16);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (channel === '08') {
    return resolveBeatorajaTableNumber(value, table);
  }
  return undefined;
}

export function resolveBeatorajaStopDurationBeats(
  value: string,
  table: Readonly<Record<string, unknown>> = {},
): number | undefined {
  const stopUnits = resolveBeatorajaTableNumber(value, table);
  if (stopUnits === undefined || stopUnits <= 0) return undefined;
  return (stopUnits / STOP_UNITS_PER_MEASURE) * BEATS_PER_STANDARD_MEASURE;
}

function resolveBeatorajaTableNumber(key: string, table: Readonly<Record<string, unknown>>): number | undefined {
  const looked = table[key] ?? table[key.toLowerCase()] ?? table[key.toUpperCase()];
  if (typeof looked === 'number' && Number.isFinite(looked)) return looked;
  if (typeof looked === 'string') {
    const parsed = Number.parseFloat(looked);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
