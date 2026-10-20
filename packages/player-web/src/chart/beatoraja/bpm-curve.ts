// Compute a step-shaped BPM polyline from a parsed BMS chart, ready for the bpmgraph renderer.
//
// Beatoraja's `bpmgraph` plots how the song's BPM evolves over chart time — visually, a vertical
// strip with a step curve that jumps at each BPM-change event. The renderer expects normalized
// `{ x, y }` points in `[0, 1]²` (x = chart progress, y = (bpm − minBPM) / (maxBPM − minBPM), with
// `y = 1` collapsed to a flat line when the song is constant-BPM).
//
// The transform here is purely chart-data-driven — no engine state, no playhead. Result is cached
// once per chart by the caller (`view/beatoraja/play-view.ts`) and handed to the skin view via the
// `resolveBPMGraphPoints` resolver. Without this resolver the bpmgraph hides itself.

import type { BeMusicJSON } from '@be-music/json';
import {
  beatorajaEventBeat,
  computeBeatorajaMeasureLayout,
  hasBeatorajaEventValue,
  resolveBeatorajaBPMEventValue,
} from './timing.ts';

/** Polyline point in normalized destination-box coordinates. */
export interface BPMCurvePoint {
  /** Chart progress in `[0, 1]` — left edge of the dst box at 0, right edge at 1. */
  x: number;
  /** Normalized BPM in `[0, 1]` — bottom edge at 0 (minBPM), top edge at 1 (maxBPM). */
  y: number;
}

/**
 * Build the step polyline. Returns `[]` when the chart has no BPM data — the caller hides the
 * graph in that case.
 */
export function computeBeatorajaBPMCurve(chart: BeMusicJSON): ReadonlyArray<BPMCurvePoint> {
  const layout = computeBeatorajaMeasureLayout(chart);
  if (layout.measureBaseBeat.length === 0) return [];

  // Total chart beats = end of the final measure. Curve x = 0 at chart start, x = 1 at chart end.
  const totalBeats = layout.totalBeats;
  if (totalBeats <= 0) return [];

  const measureBaseBeat = layout.measureBaseBeat;

  // Walk events in beat order, collecting BPM changes. The chart's `metadata.bpm` is the initial
  // BPM (channel `03` / `08` events override it from their event beat onward).
  const initialBPM = chart.metadata.bpm > 0 ? chart.metadata.bpm : 130;
  const segments: { beat: number; bpm: number }[] = [{ beat: 0, bpm: initialBPM }];
  for (const event of chart.events ?? []) {
    if (!hasBeatorajaEventValue(event.value)) continue;
    if (event.channel !== '03' && event.channel !== '08') continue;
    const beat = beatorajaEventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;
    const raw = resolveBeatorajaBPMEventValue(event.channel, event.value, chart.resources.bpm);
    // Negative `#BPMxx` (channel 08, the LR2 reverse-scroll gimmick) integrates at |BPM| — the timeline never
    // runs backwards — so the graph plots the magnitude. Zero / non-finite slots still drop out.
    if (raw === undefined || !Number.isFinite(raw) || raw === 0) continue;
    segments.push({ beat, bpm: Math.abs(raw) });
  }
  segments.sort((a, b) => a.beat - b.beat);

  // Determine min / max so we can normalize. With a single BPM the song is constant-tempo —
  // the polyline is flat at y = 1, drawn at the top of the box (matches beatoraja's reference
  // behavior of showing a centered horizontal line).
  let minBPM = Number.POSITIVE_INFINITY;
  let maxBPM = 0;
  for (const seg of segments) {
    if (seg.bpm < minBPM) minBPM = seg.bpm;
    if (seg.bpm > maxBPM) maxBPM = seg.bpm;
  }
  if (!Number.isFinite(minBPM) || maxBPM <= 0) return [];
  const denom = maxBPM - minBPM;
  const normalize = (bpm: number): number => (denom > 0 ? (bpm - minBPM) / denom : 1);

  // Emit a step polyline. Each segment contributes two points — start and pre-step — so the
  // line goes horizontally to the next change beat then vertically to the new BPM.
  const points: BPMCurvePoint[] = [];
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
