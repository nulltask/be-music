import { describe, expect, it } from 'vitest';
import type { BeMusicJson } from '@be-music/json';
import {
  computeBeatorajaChartNoteDistribution,
  NOTE_DISTRIBUTION_CATEGORIES,
} from './beatoraja-chart-note-distribution.ts';

function makeChart(
  events: ReadonlyArray<{ measure?: number; channel: string; value?: string; pos?: [number, number] }>,
  bpm = 120,
  resources?: { bpm?: Record<string, number>; stop?: Record<string, number> },
  lnObjs?: string[],
): BeMusicJson {
  return {
    metadata: { bpm, title: 'test' } as unknown as BeMusicJson['metadata'],
    events: events.map((e) => ({
      measure: e.measure ?? 0,
      channel: e.channel,
      position: (e.pos ?? [0, 1]) as unknown as BeMusicJson['events'][0]['position'],
      value: e.value ?? '01',
    })),
    measures: [],
    bms: { lnObjs: lnObjs ?? [] } as unknown as BeMusicJson['bms'],
    resources: { bpm: resources?.bpm ?? {}, stop: resources?.stop ?? {} } as unknown as BeMusicJson['resources'],
  } as unknown as BeMusicJson;
}

describe('computeBeatorajaChartNoteDistribution', () => {
  it('buckets every playable note into 1-second windows by category', () => {
    // 120 BPM = 0.5 sec/beat. Position `[N, D]` is `(N/D) * 4 beats` into its measure.
    // Notes at beat 0 / 2 / 4 (= ms 0 / 1000 / 2000) → buckets 0 / 1 / 2.
    const chart = makeChart([
      { channel: '11', pos: [0, 1] }, // beat 0
      { channel: '12', pos: [0, 1] }, // beat 0
      { channel: '11', pos: [2, 4] }, // beat 2
      { channel: '11', pos: [0, 1], measure: 1 }, // beat 4 (start of measure 1)
    ]);
    const out = computeBeatorajaChartNoteDistribution(chart);
    expect(out.buckets[0]?.[NOTE_DISTRIBUTION_CATEGORIES.KEY_NORMAL]).toBe(2);
    expect(out.buckets[1]?.[NOTE_DISTRIBUTION_CATEGORIES.KEY_NORMAL]).toBe(1);
    expect(out.buckets[2]?.[NOTE_DISTRIBUTION_CATEGORIES.KEY_NORMAL]).toBe(1);
  });

  it('classifies scratch (lane 6) separately from key lanes', () => {
    const chart = makeChart([
      { channel: '11', pos: [0, 1] }, // 1P key 1 → KEY_NORMAL
      { channel: '16', pos: [0, 1] }, // 1P scratch → SCRATCH_NORMAL
      { channel: '26', pos: [0, 1] }, // 2P scratch → SCRATCH_NORMAL
    ]);
    const out = computeBeatorajaChartNoteDistribution(chart);
    expect(out.buckets[0]?.[NOTE_DISTRIBUTION_CATEGORIES.KEY_NORMAL]).toBe(1);
    expect(out.buckets[0]?.[NOTE_DISTRIBUTION_CATEGORIES.SCRATCH_NORMAL]).toBe(2);
  });

  it('classifies mine notes (D / E channels) into the mine category', () => {
    const chart = makeChart([
      { channel: 'D1', pos: [0, 1] }, // 1P mine key 1
      { channel: 'E5', pos: [0, 1] }, // 2P mine key 5
    ]);
    const out = computeBeatorajaChartNoteDistribution(chart);
    expect(out.buckets[0]?.[NOTE_DISTRIBUTION_CATEGORIES.MINE]).toBe(2);
  });

  it('caps maxCount at 100 even when a single bucket has 200+ notes', () => {
    const events = Array.from({ length: 200 }, (_, i) => ({
      channel: '11',
      pos: [i, 200] as [number, number],
    }));
    const chart = makeChart(events);
    const out = computeBeatorajaChartNoteDistribution(chart);
    expect(out.maxCount).toBeLessThanOrEqual(100);
    expect(out.maxCount).toBeGreaterThanOrEqual(20);
  });

  it('floors maxCount at 20 for sparse charts', () => {
    const chart = makeChart([{ channel: '11', pos: [0, 1] }]);
    const out = computeBeatorajaChartNoteDistribution(chart);
    expect(out.maxCount).toBe(20);
  });

  it('emits BPM segments with the initial entry at timeMs=0', () => {
    // BPM change at beat 4 (= start of measure 1, pos [0, 1]). At 120 BPM that's 2000ms.
    const chart = makeChart(
      [
        { channel: '11', pos: [0, 1] },
        { channel: '08', value: 'XX', pos: [0, 1], measure: 1 },
      ],
      120,
      { bpm: { XX: 180 } },
    );
    const out = computeBeatorajaChartNoteDistribution(chart);
    expect(out.bpmSegments[0]).toEqual({ timeMs: 0, bpm: 120 });
    expect(out.bpmSegments[1]?.bpm).toBe(180);
    expect(out.bpmSegments[1]?.timeMs).toBeCloseTo(2000, 0);
  });

  it('picks mainBpm as the BPM with the highest note count', () => {
    // 1 note at 120 BPM, BPM change at beat 2, then 5 notes at 180.
    const chart = makeChart(
      [
        { channel: '11', pos: [0, 1] }, // beat 0 at 120 BPM
        { channel: '08', value: 'XX', pos: [2, 4] }, // BPM change at beat 2
        { channel: '11', pos: [3, 4] }, // 5 notes at 180 BPM, beat 3+
        { channel: '11', pos: [0, 1], measure: 1 }, // beat 4
        { channel: '11', pos: [1, 4], measure: 1 }, // beat 5
        { channel: '11', pos: [2, 4], measure: 1 }, // beat 6
        { channel: '11', pos: [3, 4], measure: 1 }, // beat 7
      ],
      120,
      { bpm: { XX: 180 } },
    );
    const out = computeBeatorajaChartNoteDistribution(chart);
    expect(out.mainBpm).toBe(180);
    expect(out.minBpm).toBe(120);
    expect(out.maxBpm).toBe(180);
  });

  it('emits stop pairs as `(stopStart, 0)` and `(stopEnd, prevBpm)` segments', () => {
    // STOP at beat 4 (start of measure 1) with `XX = 192` units (= 1 standard measure =
    // 4 beats). At 120 BPM: pre-stop time = 4*500 = 2000ms; stop duration = 4*500 = 2000ms;
    // restore at 4000ms.
    const chart = makeChart(
      [
        { channel: '09', value: 'XX', pos: [0, 1], measure: 1 },
        { channel: '11', pos: [0, 1], measure: 2 },
      ],
      120,
      { stop: { XX: 192 } },
    );
    const out = computeBeatorajaChartNoteDistribution(chart);
    const stopStart = out.bpmSegments.find((s) => s.bpm === 0);
    expect(stopStart).toBeDefined();
    expect(stopStart?.timeMs).toBeCloseTo(2000, 0);
    const restored = out.bpmSegments[out.bpmSegments.indexOf(stopStart!) + 1];
    expect(restored?.bpm).toBe(120);
    expect(restored?.timeMs).toBeCloseTo(4000, 0);
  });

  it('returns sane defaults for an empty chart', () => {
    const chart = makeChart([]);
    const out = computeBeatorajaChartNoteDistribution(chart);
    expect(out.buckets).toEqual([]);
    expect(out.maxCount).toBe(20);
    expect(out.totalMs).toBe(0);
  });
});
