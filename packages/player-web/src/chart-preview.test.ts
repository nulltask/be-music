import type { BeMusicJson } from '@be-music/json';
import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import {
  collectChartPreviewTriggers,
  DEFAULT_CHART_PREVIEW_FALLBACK_DURATION_SECONDS,
  findFirstAudibleOffsetSeconds,
  LR2_PREVIEW_FOCUS_DELAY_MS,
  resolveChartPreviewPath,
} from './chart-preview.ts';

/**
 * Pure helpers for the chart-preview engine — testable without a real `AudioContext` because they only inspect the
 * chart JSON.
 *
 * The engine itself is only meaningful in a browser AudioContext environment so it isn't tested here; the wiring it
 * depends on (`resolveChartAudioAsset`) is already covered in `library`-level tests.
 */

function makeBmsChart(preview: string | undefined): BeMusicJson {
  const json = createEmptyJson('bms');
  if (preview !== undefined) {
    json.bms.preview = preview;
  }
  return json;
}

function makeBmsonChart(previewMusic: string | undefined): BeMusicJson {
  const json = createEmptyJson('bmson');
  if (previewMusic !== undefined) {
    json.bmson.info = { ...json.bmson.info, previewMusic };
  }
  return json;
}

describe('resolveChartPreviewPath', () => {
  test('returns `#PREVIEW` from a BMS chart', () => {
    const chart = makeBmsChart('preview.ogg');
    expect(resolveChartPreviewPath(chart)).toBe('preview.ogg');
  });

  test('returns `info.preview_music` from a bmson chart', () => {
    const chart = makeBmsonChart('preview/intro.wav');
    expect(resolveChartPreviewPath(chart)).toBe('preview/intro.wav');
  });

  test('prefers BMS `#PREVIEW` over bmson `previewMusic` if both fields are populated', () => {
        // Charts can theoretically be re-serialised from one format to another and end up with both populated; pin the
    // priority so the behaviour stays predictable.
    const chart = createEmptyJson('bms');
    chart.bms.preview = 'bms.wav';
    chart.bmson.info = { ...chart.bmson.info, previewMusic: 'bmson.wav' };
    expect(resolveChartPreviewPath(chart)).toBe('bms.wav');
  });

  test('returns undefined when neither field is set', () => {
    expect(resolveChartPreviewPath(createEmptyJson('bms'))).toBeUndefined();
    expect(resolveChartPreviewPath(createEmptyJson('bmson'))).toBeUndefined();
  });

  test('treats an empty string as "unset"', () => {
        // The parser preserves the literal value; an empty `#PREVIEW` line shouldn't masquerade as a preview path. The
    // engine uses this helper directly so the empty-string check has to live here, not in the engine.
    const chart = makeBmsChart('');
    expect(resolveChartPreviewPath(chart)).toBeUndefined();
  });
});

describe('collectChartPreviewTriggers', () => {
  test('returns an empty array for a non-positive cutoff', () => {
        // Exposed as a guard so a misconfigured engine (`fallbackDurationSeconds: 0`) silently does no work rather than
    // scheduling every trigger up to t=0.
    const chart = createEmptyJson('bms');
    expect(collectChartPreviewTriggers(chart, 0)).toEqual([]);
    expect(collectChartPreviewTriggers(chart, -5)).toEqual([]);
    expect(collectChartPreviewTriggers(chart, Number.NaN)).toEqual([]);
  });

  test('returns an empty array for a chart with no events', () => {
    expect(collectChartPreviewTriggers(createEmptyJson('bms'), 30)).toEqual([]);
  });

  test('filters triggers strictly inside the cutoff window and sorts them by seconds', () => {
        // Build a tiny chart with a few BGM events. We don't need the parser to wire the resolver — `collectSampleTriggers`
    // walks the events array and the timing resolver maps measure positions to seconds. With BPM 120 and the default
    // measure length 1 (= 4 beats = 2 s), each measure adds 2 s.
    const chart = createEmptyJson('bms');
    chart.metadata.bpm = 120;
    chart.measures = [
      { index: 0, length: 1 },
      { index: 1, length: 1 },
      { index: 2, length: 1 },
    ];
    chart.events = [
      { measure: 0, channel: '01', position: [0, 1], value: 'AA' },
      { measure: 1, channel: '01', position: [0, 1], value: 'BB' },
      { measure: 2, channel: '01', position: [0, 1], value: 'CC' },
    ];
    chart.resources.wav = { AA: 'a.wav', BB: 'b.wav', CC: 'c.wav' };
    // Cutoff at 3 s = first two triggers (t=0, t=2). The third trigger sits at t=4 s which is outside the window.
    const triggers = collectChartPreviewTriggers(chart, 3);
    expect(triggers.map((trigger) => trigger.sampleKey)).toEqual(['AA', 'BB']);
    // Sorted by seconds ascending.
    expect(triggers[0]!.seconds).toBeLessThan(triggers[1]!.seconds);
  });
});

describe('findFirstAudibleOffsetSeconds', () => {
    // Mini stand-in for the parts of `AudioBuffer` the helper actually consults. Web Audio's real buffer isn't available
  // in the node test env, so we feed in a duck-typed stub.
  function makeBuffer(
    channels: Float32Array[],
    sampleRate: number,
  ): Parameters<typeof findFirstAudibleOffsetSeconds>[0] {
    return {
      numberOfChannels: channels.length,
      sampleRate,
      length: channels[0]?.length ?? 0,
      getChannelData: (channel) => channels[channel]!,
    };
  }

  test('returns 0 when the buffer starts above the silence threshold', () => {
    // No leading silence to skip — playback should begin at sample 0.
    const buffer = makeBuffer([new Float32Array([0.5, 0.5, 0.5, 0])], 44_100);
    expect(findFirstAudibleOffsetSeconds(buffer)).toBe(0);
  });

  test('returns the time of the first sample above threshold (mono)', () => {
    // 100 silent samples at 1 kHz → 0.1 s of leading silence.
    const data = new Float32Array(200);
    data[100] = 0.7;
    const buffer = makeBuffer([data], 1000);
    expect(findFirstAudibleOffsetSeconds(buffer)).toBeCloseTo(0.1);
  });

  test('treats either channel crossing threshold as audible (stereo)', () => {
        // Left silent throughout, right audible at frame 50 → trim to 50 / sampleRate. Real charts often have one-sided
    // "intro tone" hits we still want to hear.
    const left = new Float32Array(200);
    const right = new Float32Array(200);
    right[50] = 0.3;
    const buffer = makeBuffer([left, right], 1000);
    expect(findFirstAudibleOffsetSeconds(buffer)).toBeCloseTo(0.05);
  });

  test('returns 0 when the entire buffer is below threshold', () => {
        // Nothing to skip — the helper falls back to `0` so the engine still plays whatever (silent) buffer the source gave
    // it. Avoids an infinite "no audio at all" loop where we keep advancing the offset past the end.
    const data = new Float32Array(100);
    const buffer = makeBuffer([data], 1000);
    expect(findFirstAudibleOffsetSeconds(buffer)).toBe(0);
  });

  test('returns 0 for a 0-channel or 0-length buffer', () => {
    expect(findFirstAudibleOffsetSeconds(makeBuffer([], 1000))).toBe(0);
    expect(findFirstAudibleOffsetSeconds(makeBuffer([new Float32Array(0)], 1000))).toBe(0);
  });

  test('uses the supplied threshold to filter quiet noise', () => {
    // A `0.0005` peak qualifies under the default `0.0001` threshold but should be ignored at `0.001`.
    const data = new Float32Array(100);
    data[10] = 0.0005;
    data[20] = 0.5;
    const buffer = makeBuffer([data], 1000);
    expect(findFirstAudibleOffsetSeconds(buffer)).toBeCloseTo(0.01);
    expect(findFirstAudibleOffsetSeconds(buffer, 0.001)).toBeCloseTo(0.02);
  });
});

describe('exported constants', () => {
  test('LR2 focus delay defaults to 1000 ms', () => {
        // The constant ships with this default to match LR2's song-select preview wait. Lock the value so a future
    // accidental tweak surfaces in code review rather than silently changing UX feel for every demo deploy.
    expect(LR2_PREVIEW_FOCUS_DELAY_MS).toBe(1000);
  });

  test('fallback preview cap defaults to 30 s', () => {
        // Same rationale as above — used for the in-place chart playback when a chart didn't ship `#PREVIEW`. 30 s gives
    // intro + first verse without scheduling thousands of triggers up-front.
    expect(DEFAULT_CHART_PREVIEW_FALLBACK_DURATION_SECONDS).toBe(30);
  });
});
