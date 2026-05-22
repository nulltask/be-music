import type { BeMusicEvent, BeMusicJson } from '@be-music/json';

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

export type BeatorajaChartTimingEntry =
  | { beat: number; kind: 'bpm'; bpm: number }
  | { beat: number; kind: 'stop'; durationBeats: number };

export type BeatorajaChartTimedEntry<TNote> = BeatorajaChartTimingEntry | { beat: number; kind: 'note'; note: TNote };

export function hasBeatorajaEventValue(value: string): boolean {
  return value !== '00' && value !== '';
}

export function resolveBeatorajaInitialBpm(chart: BeMusicJson): number {
  return chart.metadata.bpm > 0 ? chart.metadata.bpm : 130;
}

export function isBeatorajaBpmEventChannel(channel: string): boolean {
  return channel === '03' || channel === '08';
}

export function isBeatorajaStopEventChannel(channel: string): boolean {
  return channel === '09';
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

export function collectBeatorajaChartTimingEntries(
  chart: BeMusicJson,
  measureBaseBeat: readonly number[] = computeBeatorajaMeasureBaseBeats(chart),
): BeatorajaChartTimingEntry[] {
  return collectBeatorajaChartTimedEntries<never>(chart, measureBaseBeat, () => undefined).filter(
    (entry): entry is BeatorajaChartTimingEntry => entry.kind !== 'note',
  );
}

export function collectBeatorajaChartTimedEntries<TNote>(
  chart: BeMusicJson,
  measureBaseBeat: readonly number[],
  resolveNote: (event: BeMusicEvent) => TNote | undefined,
): BeatorajaChartTimedEntry<TNote>[] {
  const entries: BeatorajaChartTimedEntry<TNote>[] = [];
  const bpmTable = chart.resources?.bpm ?? {};
  const stopTable = chart.resources?.stop ?? {};

  for (const event of chart.events ?? []) {
    if (!hasBeatorajaEventValue(event.value)) continue;
    const beat = beatorajaEventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;

    if (isBeatorajaBpmEventChannel(event.channel)) {
      const bpm = resolveBeatorajaBpmEventValue(event.channel, event.value, bpmTable);
      if (bpm !== undefined && bpm > 0) {
        entries.push({ beat, kind: 'bpm', bpm });
      }
      continue;
    }

    if (isBeatorajaStopEventChannel(event.channel)) {
      const durationBeats = resolveBeatorajaStopDurationBeats(event.value, stopTable);
      if (durationBeats !== undefined) {
        entries.push({ beat, kind: 'stop', durationBeats });
      }
      continue;
    }

    const note = resolveNote(event);
    if (note !== undefined) {
      entries.push({ beat, kind: 'note', note });
    }
  }

  entries.sort(compareBeatorajaChartTimedEntries);
  return entries;
}

function compareBeatorajaChartTimedEntries(
  left: { beat: number; kind: string },
  right: { beat: number; kind: string },
): number {
  if (left.beat !== right.beat) return left.beat - right.beat;
  return beatorajaTimedEntryOrder(left.kind) - beatorajaTimedEntryOrder(right.kind);
}

function beatorajaTimedEntryOrder(kind: string): number {
  if (kind === 'bpm') return 0;
  if (kind === 'stop') return 1;
  return 2;
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
