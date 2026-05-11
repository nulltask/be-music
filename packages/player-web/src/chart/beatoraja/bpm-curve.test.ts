import { describe, expect, it } from 'vitest';
import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { computeBeatorajaBpmCurve } from './bpm-curve.ts';

function chartWith(overrides: Partial<BeMusicJson>): BeMusicJson {
  return { ...createEmptyJson(), ...overrides };
}

describe('computeBeatorajaBpmCurve', () => {
  it('falls back to a default-BPM flat line when the chart has no measures or BPM events', () => {
    // `createEmptyJson()` carries `metadata.bpm = 130`. With a single segment the curve collapses
    // to a flat top edge — caller can show this as-is or hide it; both are sensible defaults.
    expect(computeBeatorajaBpmCurve(createEmptyJson())).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('emits a flat line at the top of the box for constant-BPM songs', () => {
    const chart = chartWith({
      metadata: { bpm: 130, extras: {} },
      measures: [{ index: 0, length: 1 }],
    });
    const curve = computeBeatorajaBpmCurve(chart);
    // Two points: (0, 1) → (1, 1). minBpm == maxBpm collapses to a flat top edge.
    expect(curve).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('emits a step polyline for multi-BPM songs (channel 03 inline)', () => {
    // Chart spans 2 measures (= 8 beats). At measure 1 (= beat 4), BPM jumps 60 → 240.
    // minBpm=60, maxBpm=240, range=180. 60 normalizes to 0; 240 normalizes to 1.
    const chart = chartWith({
      metadata: { bpm: 60, extras: {} },
      measures: [
        { index: 0, length: 1 },
        { index: 1, length: 1 },
      ],
      events: [
        // Standard 4/4 measure at index 1, position (0/1) = beat 4.
        { measure: 1, channel: '03', position: [0, 1], value: 'F0' }, // 0xF0 = 240
      ],
    });
    const curve = computeBeatorajaBpmCurve(chart);
    // total beats = 8 (2 measures × 4 beats). Segments: [0..4] @ 60, [4..8] @ 240. Normalized
    // x = beat / 8 → step at 0.5.
    expect(curve).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('resolves channel 08 BPM-table references through chart.resources.bpm', () => {
    const chart = chartWith({
      metadata: { bpm: 100, extras: {} },
      resources: {
        wav: {},
        bmp: {},
        bpm: { ZZ: 200 },
        stop: {},
        text: {},
      },
      measures: [
        { index: 0, length: 1 },
        { index: 1, length: 1 },
      ],
      events: [{ measure: 1, channel: '08', position: [0, 1], value: 'ZZ' }],
    });
    const curve = computeBeatorajaBpmCurve(chart);
    // Two segments: 100 → 200. Normalizes to 0 → 1.
    expect(curve.at(0)).toEqual({ x: 0, y: 0 });
    expect(curve.at(-1)).toEqual({ x: 1, y: 1 });
  });

  it('drops events with empty / `00` value', () => {
    const chart = chartWith({
      metadata: { bpm: 130, extras: {} },
      measures: [{ index: 0, length: 1 }],
      events: [
        { measure: 0, channel: '03', position: [1, 2], value: '00' },
        { measure: 0, channel: '03', position: [3, 4], value: '' },
      ],
    });
    const curve = computeBeatorajaBpmCurve(chart);
    // Only the initial 130 BPM segment survives → flat top edge.
    expect(curve).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });
});
