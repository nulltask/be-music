// Compute a step-shaped BPM polyline from a parsed BMS chart, ready for the bpmgraph renderer.
//
// Beatoraja's `bpmgraph` plots how the song's BPM evolves over chart time — visually, a vertical
// strip with a step curve that jumps at each BPM-change event. The renderer expects normalized
// `{ x, y }` points in `[0, 1]²` (x = chart progress, y = (bpm − minBpm) / (maxBpm − minBpm), with
// `y = 1` collapsed to a flat line when the song is constant-BPM).
//
// The transform here is purely chart-data-driven — no engine state, no playhead. Result is cached
// once per chart by the caller (`scene/beatoraja/gameplay.ts`) and handed to the view via the
// `resolveBpmGraphPoints` resolver. Without this resolver the bpmgraph hides itself.

import type { BeMusicJson } from '@be-music/json';

/** Polyline point in normalized destination-box coordinates. */
export interface BpmCurvePoint {
  /** Chart progress in `[0, 1]` — left edge of the dst box at 0, right edge at 1. */
  x: number;
  /** Normalized BPM in `[0, 1]` — bottom edge at 0 (minBpm), top edge at 1 (maxBpm). */
  y: number;
}

const BEATS_PER_STANDARD_MEASURE = 4;

/**
 * Build the step polyline. Returns `[]` when the chart has no BPM data — the caller hides the
 * graph in that case.
 */
export function computeBeatorajaBpmCurve(chart: BeMusicJson): ReadonlyArray<BpmCurvePoint> {
  const layout = computeMeasureLayout(chart);
  if (layout.measureBaseBeat.length === 0) return [];

  // Total chart beats = end of the final measure. Curve x = 0 at chart start, x = 1 at chart end.
  const totalBeats = layout.totalBeats;
  if (totalBeats <= 0) return [];

  const measureBaseBeat = layout.measureBaseBeat;

  // Walk events in beat order, collecting BPM changes. The chart's `metadata.bpm` is the initial
  // BPM (channel `03` / `08` events override it from their event beat onward).
  const initialBpm = chart.metadata.bpm > 0 ? chart.metadata.bpm : 130;
  const segments: { beat: number; bpm: number }[] = [{ beat: 0, bpm: initialBpm }];
  for (const event of chart.events ?? []) {
    if (event.value === '00' || event.value === '') continue;
    if (event.channel !== '03' && event.channel !== '08') continue;
    const beat = eventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;
    const bpm = resolveBpmEventValue(event.channel, event.value, chart.resources.bpm);
    if (bpm === undefined || bpm <= 0) continue;
    segments.push({ beat, bpm });
  }
  segments.sort((a, b) => a.beat - b.beat);

  // Determine min / max so we can normalize. With a single BPM the song is constant-tempo —
  // the polyline is flat at y = 1, drawn at the top of the box (matches beatoraja's reference
  // behavior of showing a centered horizontal line).
  let minBpm = Number.POSITIVE_INFINITY;
  let maxBpm = 0;
  for (const seg of segments) {
    if (seg.bpm < minBpm) minBpm = seg.bpm;
    if (seg.bpm > maxBpm) maxBpm = seg.bpm;
  }
  if (!Number.isFinite(minBpm) || maxBpm <= 0) return [];
  const denom = maxBpm - minBpm;
  const normalize = (bpm: number): number => (denom > 0 ? (bpm - minBpm) / denom : 1);

  // Emit a step polyline. Each segment contributes two points — start and pre-step — so the
  // line goes horizontally to the next change beat then vertically to the new BPM.
  const points: BpmCurvePoint[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const next = segments[i + 1];
    const endBeat = next?.beat ?? totalBeats;
    points.push({ x: clampUnit(seg.beat / totalBeats), y: clampUnit(normalize(seg.bpm)) });
    points.push({ x: clampUnit(endBeat / totalBeats), y: clampUnit(normalize(seg.bpm)) });
  }
  return points;
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function computeMeasureLayout(chart: BeMusicJson): { measureBaseBeat: number[]; totalBeats: number } {
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

function eventBeat(
  event: { measure: number; position: readonly [number, number] },
  measureBaseBeat: number[],
): number | undefined {
  const base = measureBaseBeat[event.measure];
  if (base === undefined) return undefined;
  const [num, denom] = event.position;
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return base;
  // Same approximation as `computeBeatorajaChartMarkers` — assume standard 4-beat measure for the
  // intra-measure fraction. Custom-length measures are visually approximate; refinable later.
  return base + (num / denom) * BEATS_PER_STANDARD_MEASURE;
}

/**
 * Resolve a BPM event value into a numeric BPM. Channel `03` carries an inline hex byte
 * (0x00..0xFF — but skin authors use plain numbers up to 255 BPM); channel `08` references the
 * `#BPMxx` table on the chart's resources.
 */
function resolveBpmEventValue(
  channel: string,
  value: string,
  table: Readonly<Record<string, unknown>>,
): number | undefined {
  if (channel === '03') {
    const parsed = parseInt(value, 16);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (channel === '08') {
    const looked = table[value] ?? table[value.toLowerCase()] ?? table[value.toUpperCase()];
    if (typeof looked === 'number' && Number.isFinite(looked)) return looked;
    if (typeof looked === 'string') {
      const parsed = Number.parseFloat(looked);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }
  return undefined;
}
