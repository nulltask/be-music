import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJSON } from '../../chart-source/src/index.ts';
import { stitchNonstopCourse } from '../../player-engine/src/course/nonstop/compose.ts';
import { parseChart, parseChartFile } from '../../chart-parser/src/index.ts';
import { describe, expect, test } from 'vite-plus/test';
import { collectSampleTriggers, createTimingResolver } from '@be-music/chart-model';
import { type RenderResult, renderJSON, renderSingleSample } from './index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDir = resolve(rootDir, 'test/fixtures');

function createSingleTriggerChart(samplePath: string) {
  const json = createEmptyJSON('json');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = samplePath;
  json.events = [{ measure: 0, channel: '01', position: [0, 1], value: '01' }];
  return json;
}

function createSingleTriggerBMSChart(samplePath: string, volWAV?: number) {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  if (typeof volWAV === 'number') {
    json.bms.volWAV = volWAV;
  }
  json.resources.wav['01'] = samplePath;
  json.events = [{ measure: 0, channel: '01', position: [0, 1], value: '01' }];
  return json;
}

function createSingleBMSNoteChart(
  noteChannel: string,
  notePosition: readonly [number, number],
  samplePath = 'not-found.wav',
) {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = samplePath;
  json.events = [{ measure: 0, channel: noteChannel, position: notePosition, value: '01' }];
  return json;
}

function createDynamicVolumeChangeChart(
  noteChannel: string,
  notePosition: readonly [number, number],
  changeChannel: '97' | '98',
  changePosition: readonly [number, number],
  changeValue = '80',
) {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [
    { measure: 0, channel: noteChannel, position: notePosition, value: '01' },
    { measure: 0, channel: changeChannel, position: changePosition, value: changeValue },
  ];
  return json;
}

function maxDeltaBetweenResults(left: RenderResult, right: RenderResult, startFrame: number, endFrame: number): number {
  const start = Math.max(0, startFrame);
  const end = Math.min(left.left.length, right.left.length, endFrame);
  let maxDelta = 0;

  for (let index = start; index < end; index += 1) {
    const deltaLeft = Math.abs(left.left[index] - right.left[index]);
    const deltaRight = Math.abs(left.right[index] - right.right[index]);
    if (deltaLeft > maxDelta) {
      maxDelta = deltaLeft;
    }
    if (deltaRight > maxDelta) {
      maxDelta = deltaRight;
    }
  }

  return maxDelta;
}

function scaleResultAfterFrame(result: RenderResult, startFrame: number, gain: number): RenderResult {
  const left = Float32Array.from(result.left);
  const right = Float32Array.from(result.right);
  for (let index = Math.max(0, startFrame); index < left.length; index += 1) {
    left[index] *= gain;
    right[index] *= gain;
  }
  return {
    ...result,
    left,
    right,
  };
}

const codecCases = [
  { label: 'MP3', path: 'render-codec-test.mp3' },
  { label: 'OGG (Vorbis)', path: 'render-codec-test.ogg' },
  { label: 'OPUS', path: 'render-codec-test.opus' },
] as const;

test.each(codecCases)('audio-renderer: decodes and mixes a $label sample', async ({ path }) => {
  const json = createSingleTriggerChart(path);
  const result = await renderJSON(json, {
    baseDir: fixtureDir,
    sampleRate: 44_100,
    normalize: false,
    tailSeconds: 0,
    fallbackToneSeconds: 0.01,
  });

  expect(result.durationSeconds).toBeGreaterThan(0.2);
  expect(result.durationSeconds).toBeLessThan(0.8);
  expect(result.peak).toBeGreaterThan(0.001);
});

test.each(codecCases)(
  'audio-renderer: renderSingleSample matches single-trigger renderJSON for $label',
  async ({ path }) => {
    const json = createSingleTriggerChart(path);
    const [mixed, single] = await Promise.all([
      renderJSON(json, {
        baseDir: fixtureDir,
        sampleRate: 44_100,
        gain: 0.75,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 0.01,
      }),
      renderSingleSample('01', path, {
        baseDir: fixtureDir,
        sampleRate: 44_100,
        gain: 0.75,
        fallbackToneSeconds: 0.01,
      }),
    ]);

    expect(single.left.length).toBe(mixed.left.length);
    expect(single.right.length).toBe(mixed.right.length);
    expect(Math.abs(single.durationSeconds - mixed.durationSeconds)).toBeLessThan(1e-9);
    expect(maxDeltaBetweenResults(single, mixed, 0, mixed.left.length)).toBeLessThan(1e-7);
  },
);

test('audio-renderer: scales individual sample triggers with #WAVCMD 01 xx vv', async () => {
  // BMS spec — `#WAVCMD 01 xx vv` declares a per-slot volume override (0..127 byte). A trigger for that slot should
  // attenuate by `vv / 127`; everything else stays at full.
  const baseline = createSingleTriggerBMSChart('not-found.wav');
  const attenuated = createSingleTriggerBMSChart('not-found.wav');
  // 64 / 127 ≈ 50% — chosen so the multiplier is unambiguous even after the renderer's per-frame summing.
  attenuated.bms.wavCmds = ['01 01 64'];
  const [baselineRendered, attenuatedRendered] = await Promise.all([
    renderJSON(baseline, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
    renderJSON(attenuated, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
  ]);
  expect(attenuatedRendered.left.length).toBe(baselineRendered.left.length);
  expect(attenuatedRendered.peak).toBeCloseTo(baselineRendered.peak * (64 / 127), 6);
});

test('audio-renderer: scales individual sample triggers with #EXWAVxx v', async () => {
  // BMS spec — `#EXWAVxx [flags] params filename` exposes a centibel-units `v` (volume) trim that composes with the bus
  // / `#WAVCMD` chain. -600 cB = -6 dB ≈ 0.501 linear gain.
  const baseline = createSingleTriggerBMSChart('not-found.wav');
  const attenuated = createSingleTriggerBMSChart('not-found.wav');
  attenuated.bms.exWAV['01'] = 'pvf 0 -600 44100 not-found.wav';
  const [baselineRendered, attenuatedRendered] = await Promise.all([
    renderJSON(baseline, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
    renderJSON(attenuated, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
  ]);
  expect(attenuatedRendered.peak).toBeCloseTo(baselineRendered.peak * 0.501, 2);
});

test('audio-renderer: composes #EXWAVxx and #WAVCMD attenuation multiplicatively', async () => {
  // Stack a `#EXWAV01 v -600` (≈ 0.5x) on top of a `#WAVCMD 01 01 64` (≈ 0.504x) — the rendered peak should be the
  // product, not just one of them.
  const baseline = createSingleTriggerBMSChart('not-found.wav');
  const stacked = createSingleTriggerBMSChart('not-found.wav');
  stacked.bms.exWAV['01'] = 'v -600 not-found.wav';
  stacked.bms.wavCmds = ['01 01 64'];
  const [baselineRendered, stackedRendered] = await Promise.all([
    renderJSON(baseline, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
    renderJSON(stacked, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
  ]);
  // 0.501 × (64/127) ≈ 0.252.
  expect(stackedRendered.peak).toBeCloseTo(baselineRendered.peak * 0.501 * (64 / 127), 2);
});

test('audio-renderer: ignores non-volume #WAVCMD bytes (pitch / loop)', async () => {
  // Pitch / loop bytes are intentionally not applied yet (the offline renderer doesn't resample / loop dynamically).
  // They must NOT fall through to the volume code path either — a `#WAVCMD 00 01 12` line should leave the sample at
  // full volume, not at 12/127.
  const baseline = createSingleTriggerBMSChart('not-found.wav');
  const withPitch = createSingleTriggerBMSChart('not-found.wav');
  withPitch.bms.wavCmds = ['00 01 12'];
  const [baselineRendered, pitchRendered] = await Promise.all([
    renderJSON(baseline, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
    renderJSON(withPitch, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
  ]);
  expect(pitchRendered.peak).toBeCloseTo(baselineRendered.peak, 6);
});

test('audio-renderer: scales rendered chart audio with #VOLWAV', async () => {
  const normal = createSingleTriggerBMSChart('not-found.wav', 100);
  const boosted = createSingleTriggerBMSChart('not-found.wav', 150);
  const [normalRendered, boostedRendered] = await Promise.all([
    renderJSON(normal, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
    renderJSON(boosted, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
  ]);

  expect(boostedRendered.left.length).toBe(normalRendered.left.length);
  expect(boostedRendered.right.length).toBe(normalRendered.right.length);
  expect(boostedRendered.peak).toBeCloseTo(normalRendered.peak * 1.5, 6);
  expect(
    maxDeltaBetweenResults(
      boostedRendered,
      {
        ...normalRendered,
        left: Float32Array.from(normalRendered.left, (value) => value * 1.5),
        right: Float32Array.from(normalRendered.right, (value) => value * 1.5),
      },
      0,
      normalRendered.left.length,
    ),
  ).toBeLessThan(1e-7);
});

test('audio-renderer: renders #VOLWAV outside 0 < n < 200 at the original volume, like beatoraja', async () => {
  const options = { sampleRate: 44_100, gain: 1, normalize: false, tailSeconds: 0, fallbackToneSeconds: 0.05 };
  const [normalRendered, ...outOfRange] = await Promise.all(
    [100, 200, 400, 0].map((volWAV) => renderJSON(createSingleTriggerBMSChart('not-found.wav', volWAV), options)),
  );
  for (const rendered of outOfRange) {
    expect(rendered.peak).toBeCloseTo(normalRendered.peak, 6);
  }
});

test('audio-renderer: channel 97 does not change already-playing BGM samples', async () => {
  const baseline = createSingleBMSNoteChart('01', [0, 1]);
  const changed = createDynamicVolumeChangeChart('01', [0, 1], '97', [1, 8]);
  const [baselineRendered, changedRendered] = await Promise.all([
    renderJSON(baseline, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1,
    }),
    renderJSON(changed, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1,
    }),
  ]);

  expect(maxDeltaBetweenResults(baselineRendered, changedRendered, 0, baselineRendered.left.length)).toBeLessThan(1e-7);
});

test('audio-renderer: channel 97 changes the initial gain of later BGM samples', async () => {
  const baseline = createSingleBMSNoteChart('01', [1, 8]);
  const changed = createDynamicVolumeChangeChart('01', [1, 8], '97', [0, 1]);
  const [baselineRendered, changedRendered] = await Promise.all([
    renderJSON(baseline, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1,
    }),
    renderJSON(changed, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1,
    }),
  ]);

  const noteFrame = Math.round(0.25 * baselineRendered.sampleRate);
  const expected = scaleResultAfterFrame(baselineRendered, noteFrame, 0x80 / 0xff);
  expect(maxDeltaBetweenResults(expected, changedRendered, 0, baselineRendered.left.length)).toBeLessThan(1e-5);
});

test('audio-renderer: channel 98 does not change already-playing key samples', async () => {
  const baseline = createSingleBMSNoteChart('11', [0, 1]);
  const changed = createDynamicVolumeChangeChart('11', [0, 1], '98', [1, 8]);
  const [baselineRendered, changedRendered] = await Promise.all([
    renderJSON(baseline, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1,
    }),
    renderJSON(changed, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1,
    }),
  ]);

  expect(maxDeltaBetweenResults(baselineRendered, changedRendered, 0, baselineRendered.left.length)).toBeLessThan(1e-7);
});

test('audio-renderer: channel 98 changes the initial gain of later key samples', async () => {
  const baseline = createSingleBMSNoteChart('11', [1, 8]);
  const changed = createDynamicVolumeChangeChart('11', [1, 8], '98', [0, 1]);
  const [baselineRendered, changedRendered] = await Promise.all([
    renderJSON(baseline, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1,
    }),
    renderJSON(changed, {
      sampleRate: 44_100,
      gain: 1,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1,
    }),
  ]);

  const noteFrame = Math.round(0.25 * baselineRendered.sampleRate);
  const expected = scaleResultAfterFrame(baselineRendered, noteFrame, 0x80 / 0xff);
  expect(maxDeltaBetweenResults(expected, changedRendered, 0, baselineRendered.left.length)).toBeLessThan(1e-5);
});

test('audio-renderer: startSeconds trims leading timeline before rendering', async () => {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

  const [full, shifted] = await Promise.all([
    renderJSON(json, {
      sampleRate: 44_100,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
    renderJSON(json, {
      sampleRate: 44_100,
      normalize: false,
      tailSeconds: 0,
      startSeconds: 2,
      fallbackToneSeconds: 0.05,
    }),
  ]);

  expect(full.durationSeconds).toBeGreaterThan(2);
  expect(shifted.durationSeconds).toBeLessThan(0.2);
});

test('audio-renderer: renderJSON keeps BGM at the LR2 reversal tick and drops lane sounds there and behind it', async () => {
  // BPM 240 → measure = 1 s. The reversal (#BPM02 -240 via channel 08) sits at 2 s. LR2 sorts same-tick events by
  // op (`CMP_NotesByRealTimingOp`): BGM (op 1) fires BEFORE the negative BPM (op 8), lane sounds (op 10+) after it,
  // so the BGM at the boundary renders while the lane note beside it and anything strictly behind stay silent.
  const reference = createEmptyJSON('bms');
  reference.metadata.bpm = 240;
  reference.resources.bpm['02'] = -240;
  reference.resources.wav['01'] = 'not-found.wav';
  reference.events = [
    { measure: 1, channel: '01', position: [0, 1], value: '01' },
    { measure: 2, channel: '08', position: [0, 1], value: '02' },
    { measure: 2, channel: '01', position: [0, 1], value: '01' }, // exactly AT the reversal — op 1 fires
  ];

  const withFrozen = createEmptyJSON('bms');
  withFrozen.metadata.bpm = 240;
  withFrozen.resources.bpm['02'] = -240;
  withFrozen.resources.wav['01'] = 'not-found.wav';
  withFrozen.events = [
    ...reference.events,
    { measure: 2, channel: '11', position: [0, 1], value: '01' }, // lane note AT the reversal — op 11 is frozen
    { measure: 3, channel: '01', position: [0, 1], value: '01' }, // strictly behind it
  ];

  const renderOptions = {
    sampleRate: 44_100,
    normalize: false,
    tailSeconds: 0,
    fallbackToneSeconds: 0.05,
  };
  const [referenceResult, filtered] = await Promise.all([
    renderJSON(reference, renderOptions),
    renderJSON(withFrozen, renderOptions),
  ]);

  // Only the 1 s and 2 s BGM tones render in either chart: same length, same content.
  expect(filtered.left.length).toBe(referenceResult.left.length);
  expect(filtered.durationSeconds).toBeGreaterThan(2);
  expect(filtered.durationSeconds).toBeLessThan(3);
  expect(maxDeltaBetweenResults(referenceResult, filtered, 0, referenceResult.left.length)).toBe(0);
});

test('audio-renderer: renderJSON throws AbortError when signal is already aborted', async () => {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];
  const controller = new AbortController();
  controller.abort();

  await expect(
    renderJSON(json, {
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({
    name: 'AbortError',
  });
});

test('audio-renderer: renderJSON propagates AbortError during sample loading', async () => {
  const json = createSingleTriggerChart('render-codec-test.ogg');
  const controller = new AbortController();

  await expect(
    renderJSON(json, {
      baseDir: fixtureDir,
      sampleRate: 44_100,
      normalize: false,
      tailSeconds: 0,
      signal: controller.signal,
      onSampleLoadProgress: (progress) => {
        if (progress.stage === 'reading') {
          controller.abort();
        }
      },
    }),
  ).rejects.toMatchObject({
    name: 'AbortError',
  });
});
describe('chart-audio-renderer', () => {
  test('audio-renderer: falls back to mp3 when specified .wav is missing', async () => {
    const json = createSingleTriggerChart('render-codec-test.wav');
    const result = await renderJSON(json, {
      baseDir: fixtureDir,
      sampleRate: 44_100,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.01,
    });

    expect(result.durationSeconds).toBeGreaterThan(0.2);
    expect(result.durationSeconds).toBeLessThan(0.8);
  });

  test('audio-renderer: interprets sample-continue offsets from bmson notes.c', () => {
    const json = createEmptyJSON('bmson');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'sample.wav';
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { c: false } },
      { measure: 0, channel: '12', position: [1, 4], value: '01', bmson: { c: true } },
      { measure: 0, channel: '13', position: [2, 4], value: '01', bmson: { c: false } },
      { measure: 0, channel: '14', position: [3, 4], value: '01', bmson: { c: true } },
    ];

    const triggers = collectSampleTriggers(json);
    expect(triggers.map((trigger) => Number(trigger.sampleOffsetSeconds.toFixed(3)))).toEqual([0, 0.5, 0, 0.5]);
  });

  test('audio-renderer: cuts slice duration at every distinct pulse', () => {
    // Continuation selects the source offset; each distinct pulse still owns a separately triggered slice.
    const json = createEmptyJSON('bmson');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'sample.wav';
    json.events = [
      // Anchor at 0s, cut at the continuation at 0.5s.
      { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { c: false } },
      // c=true at 0.5s — should hold open until 1.0s.
      { measure: 0, channel: '12', position: [1, 4], value: '01', bmson: { c: true } },
      // Restart at 1.0s, cut at 1.5s.
      { measure: 0, channel: '13', position: [2, 4], value: '01', bmson: { c: false } },
      // Final continuation at 1.5s runs to EOF.
      { measure: 0, channel: '14', position: [3, 4], value: '01', bmson: { c: true } },
    ];

    const triggers = collectSampleTriggers(json);
    expect(triggers.map((trigger) => trigger.sampleDurationSeconds)).toEqual([0.5, 0.5, 0.5, undefined]);
  });

  test('audio-renderer: disjoint bmson continuation slices retain the original mix peak', async () => {
    // Slices of one source are adjacent, so perfect AUTO playback retains its peak.
    const anchorOnly = createEmptyJSON('bmson');
    anchorOnly.metadata.bpm = 120;
    anchorOnly.resources.wav['01'] = 'not-found.wav';
    anchorOnly.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { c: false } }];

    const withContinuation = createEmptyJSON('bmson');
    withContinuation.metadata.bpm = 120;
    withContinuation.resources.wav['01'] = 'not-found.wav';
    withContinuation.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { c: false } },
      // This continuation plays from the matching offset, without extending the source.
      { measure: 0, channel: '12', position: [1, 2], value: '01', bmson: { c: true } },
    ];

    const [anchorRendered, continuationRendered] = await Promise.all([
      renderJSON(anchorOnly, {
        sampleRate: 44_100,
        gain: 1,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 0.05,
      }),
      renderJSON(withContinuation, {
        sampleRate: 44_100,
        gain: 1,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 0.05,
      }),
    ]);
    expect(continuationRendered.peak).toBeCloseTo(anchorRendered.peak, 6);
  });

  test('audio-renderer: bmson chord at the same beat shares a single slice with shared duration', () => {
    // Two simultaneous notes at beat 0 form one chord; both must render against the same slice (offset / duration /
    // sliceId) so the runtime triggers the BufferSource only once.
    const json = createEmptyJSON('bmson');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'sample.wav';
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { c: false } },
      { measure: 0, channel: '12', position: [0, 1], value: '01', bmson: { c: true } },
      { measure: 0, channel: '13', position: [1, 2], value: '01', bmson: { c: false } },
    ];
    const triggers = collectSampleTriggers(json);
    expect(triggers).toHaveLength(3);
    expect(triggers[0]?.sampleSliceId).toBe(triggers[1]?.sampleSliceId);
    expect(triggers[0]?.sampleDurationSeconds).toBeCloseTo(1, 6);
    expect(triggers[1]?.sampleDurationSeconds).toBeCloseTo(1, 6);
  });

  test('audio-renderer: ignores landmine channels for sample triggering', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'sample.wav';
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: 'D1', position: [0, 1], value: '01' },
    ];

    const triggers = collectSampleTriggers(json);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.channel).toBe('11');
  });

  test('audio-renderer: ignores scroll channels for sample triggering', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'sample.wav';
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: 'SC', position: [0, 1], value: '01' },
    ];
    json.bms.scroll['01'] = 0.5;

    const triggers = collectSampleTriggers(json);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.channel).toBe('11');
  });

  test('audio-renderer: ignores dynamic EXRANK channels for sample triggering', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'sample.wav';
    json.resources.wav['AA'] = 'judge.wav';
    json.bms.exRank['AA'] = '48';
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: 'A0', position: [0, 1], value: 'AA' },
    ];

    const triggers = collectSampleTriggers(json);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.channel).toBe('11');
  });

  test('audio-renderer: ignores paired #LNOBJ end objects for sample triggering', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA'];
    json.resources.wav['01'] = 'start.wav';
    json.resources.wav['AA'] = 'end.wav';
    const start = { measure: 0, channel: '11', position: [0, 1] as const, value: '01' };
    const end = { measure: 0, channel: '11', position: [1, 2] as const, value: 'AA' };
    const orphan = { measure: 0, channel: '12', position: [3, 4] as const, value: 'AA' };
    json.events = [start, end, orphan];

    const triggers = collectSampleTriggers(json);
    expect(triggers.some((trigger) => trigger.event === start)).toBe(true);
    expect(triggers.some((trigger) => trigger.event === end)).toBe(false);
    expect(triggers.some((trigger) => trigger.event === orphan)).toBe(true);
  });

  test('audio-renderer: accepts multiple #LNOBJ declarations for end suppression', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA', 'BB'];
    json.resources.wav['01'] = 'start-a.wav';
    json.resources.wav['02'] = 'start-b.wav';
    json.resources.wav['AA'] = 'end-a.wav';
    json.resources.wav['BB'] = 'end-b.wav';
    const startA = { measure: 0, channel: '11', position: [0, 1] as const, value: '01' };
    const endA = { measure: 0, channel: '11', position: [1, 4] as const, value: 'AA' };
    const startB = { measure: 0, channel: '12', position: [0, 1] as const, value: '02' };
    const endB = { measure: 0, channel: '12', position: [1, 4] as const, value: 'BB' };
    json.events = [startA, endA, startB, endB];

    const triggers = collectSampleTriggers(json);
    expect(triggers.some((trigger) => trigger.event === startA)).toBe(true);
    expect(triggers.some((trigger) => trigger.event === startB)).toBe(true);
    expect(triggers.some((trigger) => trigger.event === endA)).toBe(false);
    expect(triggers.some((trigger) => trigger.event === endB)).toBe(false);
  });

  test('audio-renderer: prioritizes 51-69 over LNOBJ when same lane tick conflicts', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA'];
    json.resources.wav['01'] = 'start.wav';
    json.resources.wav['AA'] = 'lnobj.wav';
    json.resources.wav['02'] = 'legacy.wav';
    const start = { measure: 0, channel: '11', position: [0, 1] as const, value: '01' };
    const lnobjEnd = { measure: 0, channel: '11', position: [2, 4] as const, value: 'AA' };
    const legacy = { measure: 0, channel: '51', position: [2, 4] as const, value: '02' };
    json.events = [start, lnobjEnd, legacy];

    const triggers = collectSampleTriggers(json);
    expect(triggers.some((trigger) => trigger.event === lnobjEnd)).toBe(true);
  });

  test('audio-renderer: suppresses LNTYPE=1 long-note end markers from trigger list', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 1;
    json.resources.wav['01'] = 'start.wav';
    json.resources.wav['02'] = 'end.wav';
    const start = { measure: 0, channel: '51', position: [0, 4] as const, value: '01' };
    const end = { measure: 0, channel: '51', position: [2, 4] as const, value: '02' };
    const orphan = { measure: 0, channel: '51', position: [3, 4] as const, value: '01' };
    json.events = [start, end, orphan];

    const triggers = collectSampleTriggers(json);
    expect(triggers.some((trigger) => trigger.event === start)).toBe(true);
    expect(triggers.some((trigger) => trigger.event === end)).toBe(false);
    expect(triggers.some((trigger) => trigger.event === orphan)).toBe(true);
  });

  test('audio-renderer: suppresses LNTYPE=2 continuation markers from trigger list', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 2;
    json.resources.wav['01'] = 'start.wav';
    const runStart = { measure: 0, channel: '51', position: [0, 4] as const, value: '01' };
    const runContinue = { measure: 0, channel: '51', position: [1, 4] as const, value: '01' };
    const secondRun = { measure: 0, channel: '51', position: [3, 4] as const, value: '01' };
    json.events = [runStart, runContinue, secondRun];

    const triggers = collectSampleTriggers(json);
    expect(triggers.some((trigger) => trigger.event === runStart)).toBe(true);
    expect(triggers.some((trigger) => trigger.event === runContinue)).toBe(false);
    expect(triggers.some((trigger) => trigger.event === secondRun)).toBe(true);
  });

  test('audio-renderer: can infer LNTYPE=2 trigger suppression when #LNTYPE is omitted', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'start.wav';
    const start = { measure: 0, channel: '61', position: [0, 4] as const, value: '01' };
    const contA = { measure: 0, channel: '61', position: [1, 4] as const, value: '01' };
    const contB = { measure: 0, channel: '61', position: [2, 4] as const, value: '01' };
    json.events = [start, contA, contB];

    const defaultTriggers = collectSampleTriggers(json);
    expect(defaultTriggers.some((trigger) => trigger.event === start)).toBe(true);
    expect(defaultTriggers.some((trigger) => trigger.event === contA)).toBe(false);
    expect(defaultTriggers.some((trigger) => trigger.event === contB)).toBe(true);

    const inferredTriggers = collectSampleTriggers(json, undefined, { inferBmsLNTypeWhenMissing: true });
    expect(inferredTriggers.some((trigger) => trigger.event === start)).toBe(true);
    expect(inferredTriggers.some((trigger) => trigger.event === contA)).toBe(false);
    expect(inferredTriggers.some((trigger) => trigger.event === contB)).toBe(false);
  });

  test('audio-renderer: treats #STOP192 as one measure length at current BPM', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 192;
    json.events = [{ measure: 0, channel: '09', position: [0, 1], value: '01' }];

    const resolver = createTimingResolver(json);
    expect(resolver.stopPoints).toHaveLength(1);
    expect(resolver.stopPoints[0]?.seconds).toBeCloseTo(2, 9);
  });

  test('audio-renderer: supports LR2-style 100001x BPM stop compensation values', () => {
    const json = createEmptyJSON('bms');
    const baseBPM = 150;
    json.metadata.bpm = baseBPM;
    json.resources.bpm['01'] = baseBPM * 100001;
    json.resources.stop['01'] = 30000;
    json.events = [
      { measure: 0, channel: '08', position: [0, 1], value: '01' },
      { measure: 0, channel: '09', position: [0, 1], value: '01' },
    ];

    const resolver = createTimingResolver(json);
    expect(resolver.stopPoints).toHaveLength(1);
    // 30000 at 100001x BPM is used by LR2 gimmicks to compensate roughly 3/1920 measure.
    expect(resolver.stopPoints[0]?.seconds).toBeCloseTo((3 / 1920) * (240 / baseBPM), 6);
  });

  test('audio-renderer: interprets bemaniaDX-style STP as millisecond stops at sub-measure positions', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.stp = ['001.500 500', '001.500 4000', '002 250 trailing-comment'];

    const resolver = createTimingResolver(json);
    expect(resolver.stopPoints).toHaveLength(3);
    expect(resolver.stopPoints[0]?.beat).toBeCloseTo(6, 9);
    expect(resolver.stopPoints[0]?.seconds).toBeCloseTo(0.5, 9);
    expect(resolver.stopPoints[1]?.beat).toBeCloseTo(6, 9);
    expect(resolver.stopPoints[1]?.seconds).toBeCloseTo(4, 9);
    expect(resolver.stopPoints[2]?.beat).toBeCloseTo(8, 9);
    expect(resolver.stopPoints[2]?.seconds).toBeCloseTo(0.25, 9);
    expect(resolver.beatToSeconds(7)).toBeCloseTo(8, 9);
    expect(resolver.beatToSeconds(8.5)).toBeCloseTo(9, 9);
  });

  test('audio-renderer: bms retrigger on same key cuts previous voice immediately', async () => {
    const retrigger = createEmptyJSON('bms');
    retrigger.metadata.bpm = 120;
    retrigger.resources.wav['01'] = 'not-found.wav';
    retrigger.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [1, 8], value: '01' },
    ];

    const single = createEmptyJSON('bms');
    single.metadata.bpm = 120;
    single.resources.wav['01'] = 'not-found.wav';
    single.events = [{ measure: 0, channel: '11', position: [1, 8], value: '01' }];

    const [retriggerResult, singleResult] = await Promise.all([
      renderJSON(retrigger, {
        sampleRate: 44_100,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 1.2,
      }),
      renderJSON(single, {
        sampleRate: 44_100,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 1.2,
      }),
    ]);

    const startFrame = Math.round(0.3 * 44_100);
    const endFrame = Math.round(0.7 * 44_100);
    expect(maxDeltaBetweenResults(retriggerResult, singleResult, startFrame, endFrame)).toBeLessThan(1e-6);
  });

  test('audio-renderer: per-trigger gain keeps global retrigger behavior across channels', async () => {
    const mixed = createEmptyJSON('bms');
    mixed.metadata.bpm = 120;
    mixed.resources.wav['01'] = 'not-found.wav';
    mixed.events = [
      { measure: 0, channel: '01', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [1, 8], value: '01' },
    ];

    const single = createEmptyJSON('bms');
    single.metadata.bpm = 120;
    single.resources.wav['01'] = 'not-found.wav';
    single.events = [{ measure: 0, channel: '11', position: [1, 8], value: '01' }];

    const [mixedResult, singleResult] = await Promise.all([
      renderJSON(mixed, {
        sampleRate: 44_100,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 1.2,
        resolveTriggerGain: (trigger) => (trigger.channel === '01' ? 0.4 : 1),
      }),
      renderJSON(single, {
        sampleRate: 44_100,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 1.2,
      }),
    ]);

    const startFrame = Math.round(0.3 * 44_100);
    const endFrame = Math.round(0.7 * 44_100);
    expect(maxDeltaBetweenResults(mixedResult, singleResult, startFrame, endFrame)).toBeLessThan(1e-6);
  });

  test('audio-renderer: bms retrigger on different keys does not cut previous voice even with same file', async () => {
    const overlap = createEmptyJSON('bms');
    overlap.metadata.bpm = 120;
    overlap.resources.wav['01'] = 'render-codec-test.mp3';
    overlap.resources.wav['02'] = 'render-codec-test.mp3';
    overlap.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: '12', position: [1, 40], value: '02' },
    ];

    const single = createEmptyJSON('bms');
    single.metadata.bpm = 120;
    single.resources.wav['02'] = 'render-codec-test.mp3';
    single.events = [{ measure: 0, channel: '12', position: [1, 40], value: '02' }];

    const [overlapResult, singleResult] = await Promise.all([
      renderJSON(overlap, {
        baseDir: fixtureDir,
        sampleRate: 44_100,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 0.1,
      }),
      renderJSON(single, {
        baseDir: fixtureDir,
        sampleRate: 44_100,
        normalize: false,
        tailSeconds: 0,
        fallbackToneSeconds: 0.1,
      }),
    ]);

    const startFrame = Math.round(0.08 * 44_100);
    const endFrame = Math.round(0.2 * 44_100);
    expect(maxDeltaBetweenResults(overlapResult, singleResult, startFrame, endFrame)).toBeGreaterThan(1e-3);
  });
});

describe('audio-renderer: test/fixtures chart fixtures', () => {
  const SAMPLE_RATE = 44_100;

  async function renderFixture(name: string, dropFirstEvent = false) {
    const json = await parseChartFile(resolve(fixtureDir, name));
    if (dropFirstEvent) {
      json.events = json.events.slice(1);
    }
    return renderJSON(json, {
      baseDir: fixtureDir,
      sampleRate: SAMPLE_RATE,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0,
    });
  }

  function peakBetween(result: RenderResult, startSeconds: number, endSeconds: number): number {
    const start = Math.max(0, Math.round(startSeconds * SAMPLE_RATE));
    const end = Math.min(result.left.length, Math.round(endSeconds * SAMPLE_RATE));
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(result.left[index]), Math.abs(result.right[index]));
    }
    return peak;
  }

  test('retrigger-same-key-cut.bms cuts the previous voice on the same lane', async () => {
    // `#00011:0101` is the same #WAV01 twice on lane 1, at beat 0 and beat 2 (0 s and 1 s at 120 BPM), and
    // retrigger_a.wav runs 2.2 s. Under BMS monophonic playback the second trigger has to cut the first, so
    // everything from 1 s onwards must be indistinguishable from a render of the second note alone.
    const [full, secondOnly] = await Promise.all([
      renderFixture('retrigger-same-key-cut.bms'),
      renderFixture('retrigger-same-key-cut.bms', true),
    ]);

    expect(peakBetween(full, 0, 1)).toBeGreaterThan(0);
    expect(
      maxDeltaBetweenResults(full, secondOnly, Math.round(1 * SAMPLE_RATE), Math.round(2.2 * SAMPLE_RATE)),
    ).toBeLessThan(1e-6);
  });

  test('retrigger-different-key-overlap.bms keeps both voices even with the same file', async () => {
    // Lane 1 fires #WAV01 at 0 s and lane 2 fires #WAV02 at 0.5 s. Both slots point at retrigger_a.wav, but a
    // different lane must not cut, so the overlap window has to differ from the later-notes-only render.
    const [full, withoutFirst] = await Promise.all([
      renderFixture('retrigger-different-key-overlap.bms'),
      renderFixture('retrigger-different-key-overlap.bms', true),
    ]);

    expect(
      maxDeltaBetweenResults(full, withoutFirst, Math.round(0.5 * SAMPLE_RATE), Math.round(2.2 * SAMPLE_RATE)),
    ).toBeGreaterThan(1e-3);
  });

  test('ogg-test.bms decodes its #WAV through the Vorbis path', async () => {
    // `#WAV01 ogg-test.ogg` — the only fixture that names a non-wav codec from the chart itself rather than from a
    // hand-built IR, so it is what proves the loader reaches the Vorbis decoder off a real chart file.
    const result = await renderFixture('ogg-test.bms');

    expect(result.durationSeconds).toBeGreaterThan(0);
    expect(peakBetween(result, 0, result.durationSeconds)).toBeGreaterThan(0);
  });
});

test('audio-renderer: a stitched bmson stage preserves its source audio slices', async () => {
  const source = parseChart(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 1200, resolution: 240 },
      sound_channels: [
        {
          name: 'render-codec-test.mp3',
          notes: [
            { x: 1, y: 0 },
            { x: 2, y: 240, c: true },
            { x: 3, y: 480, c: true },
            { x: 4, y: 960 },
          ],
        },
      ],
    }),
    'bmson',
  );
  const result = stitchNonstopCourse([{ chart: source }], { connections: [] });
  if (!result.ok) throw new Error(result.reason);
  const options = { baseDir: fixtureDir, sampleRate: 8000, normalize: false, tailSeconds: 0 };
  const expected = await renderJSON(source, options);
  const actual = await renderJSON(result.chart, options);
  expect(actual.peak).toBeGreaterThan(0);
  expect(actual.left.length).toBe(expected.left.length);
  expect(actual.right.length).toBe(expected.right.length);
  for (let frame = 0; frame < actual.left.length; frame += 1) {
    expect(actual.left[frame]).toBeCloseTo(expected.left[frame]!, 5);
    expect(actual.right[frame]).toBeCloseTo(expected.right[frame]!, 5);
  }
});

test('renderSingleSample applies PATH_WAV with slash normalization and bare-path fallback', async () => {
  const reference = await renderSingleSample('01', 'sample.wav', { baseDir: fixtureDir, sampleRate: 8000 });
  const prefixed = await renderSingleSample('01', 'sample.wav', {
    baseDir: resolve(fixtureDir, '..'),
    pathPrefix: 'fixtures\\',
    sampleRate: 8000,
  });
  const fallback = await renderSingleSample('01', 'sample.wav', {
    baseDir: fixtureDir,
    pathPrefix: 'absent/',
    sampleRate: 8000,
  });
  expect(reference.peak).toBeGreaterThan(0);
  expect(prefixed).toEqual(reference);
  expect(fallback).toEqual(reference);
});
