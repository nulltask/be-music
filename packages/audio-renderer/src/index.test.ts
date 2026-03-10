import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJson } from '../../json/src/index.ts';
import { describe, expect, test } from 'vitest';
import { type RenderResult, collectSampleTriggers, createTimingResolver, renderJson, renderSingleSample } from './index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDir = resolve(rootDir, 'examples/test');

function createSingleTriggerChart(samplePath: string) {
  const json = createEmptyJson('json');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = samplePath;
  json.events = [{ measure: 0, channel: '01', position: [0, 1], value: '01' }];
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

const codecCases = [
  { label: 'MP3', path: 'render-codec-test.mp3' },
  { label: 'OGG (Vorbis)', path: 'render-codec-test.ogg' },
  { label: 'OPUS', path: 'render-codec-test.opus' },
] as const;

test.each(codecCases)('audio-renderer: $label サンプルを読み込んでミックスできる', async ({ path }) => {
  const json = createSingleTriggerChart(path);
  const result = await renderJson(json, {
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

test.each(codecCases)('audio-renderer: renderSingleSample matches single-trigger renderJson for $label', async ({ path }) => {
  const json = createSingleTriggerChart(path);
  const [mixed, single] = await Promise.all([
    renderJson(json, {
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
});

test('audio-renderer: startSeconds trims leading timeline before rendering', async () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

  const [full, shifted] = await Promise.all([
    renderJson(json, {
      sampleRate: 44_100,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.05,
    }),
    renderJson(json, {
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

test('audio-renderer: renderJson throws AbortError when signal is already aborted', async () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];
  const controller = new AbortController();
  controller.abort();

  await expect(
    renderJson(json, {
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({
    name: 'AbortError',
  });
});

test('audio-renderer: renderJson propagates AbortError during sample loading', async () => {
  const json = createSingleTriggerChart('render-codec-test.ogg');
  const controller = new AbortController();

  await expect(
    renderJson(json, {
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
describe('audio-renderer', () => {


test('audio-renderer: falls back to mp3 when specified .wav is missing', async () => {
  const json = createSingleTriggerChart('render-codec-test.wav');
  const result = await renderJson(json, {
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
  const json = createEmptyJson('bmson');
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

test('audio-renderer: ignores landmine channels for sample triggering', () => {
  const json = createEmptyJson('bms');
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
  const json = createEmptyJson('bms');
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
  const json = createEmptyJson('bms');
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
  const json = createEmptyJson('bms');
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
  const json = createEmptyJson('bms');
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
  const json = createEmptyJson('bms');
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
  const json = createEmptyJson('bms');
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
  const json = createEmptyJson('bms');
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
  const json = createEmptyJson('bms');
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

  const inferredTriggers = collectSampleTriggers(json, undefined, { inferBmsLnTypeWhenMissing: true });
  expect(inferredTriggers.some((trigger) => trigger.event === start)).toBe(true);
  expect(inferredTriggers.some((trigger) => trigger.event === contA)).toBe(false);
  expect(inferredTriggers.some((trigger) => trigger.event === contB)).toBe(false);
});

test('audio-renderer: treats #STOP192 as one measure length at current BPM', () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.resources.stop['01'] = 192;
  json.events = [{ measure: 0, channel: '09', position: [0, 1], value: '01' }];

  const resolver = createTimingResolver(json);
  expect(resolver.stopPoints).toHaveLength(1);
  expect(resolver.stopPoints[0]?.seconds).toBeCloseTo(2, 9);
});

test('audio-renderer: supports LR2-style 100001x BPM stop compensation values', () => {
  const json = createEmptyJson('bms');
  const baseBpm = 150;
  json.metadata.bpm = baseBpm;
  json.resources.bpm['01'] = baseBpm * 100001;
  json.resources.stop['01'] = 30000;
  json.events = [
    { measure: 0, channel: '08', position: [0, 1], value: '01' },
    { measure: 0, channel: '09', position: [0, 1], value: '01' },
  ];

  const resolver = createTimingResolver(json);
  expect(resolver.stopPoints).toHaveLength(1);
  // 30000 at 100001x BPM is used by LR2 gimmicks to compensate roughly 3/1920 measure.
  expect(resolver.stopPoints[0]?.seconds).toBeCloseTo((3 / 1920) * (240 / baseBpm), 6);
});

test('audio-renderer: bms retrigger on same key cuts previous voice immediately', async () => {
  const retrigger = createEmptyJson('bms');
  retrigger.metadata.bpm = 120;
  retrigger.resources.wav['01'] = 'not-found.wav';
  retrigger.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [1, 8], value: '01' },
  ];

  const single = createEmptyJson('bms');
  single.metadata.bpm = 120;
  single.resources.wav['01'] = 'not-found.wav';
  single.events = [{ measure: 0, channel: '11', position: [1, 8], value: '01' }];

  const [retriggerResult, singleResult] = await Promise.all([
    renderJson(retrigger, {
      sampleRate: 44_100,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1.2,
    }),
    renderJson(single, {
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
  const mixed = createEmptyJson('bms');
  mixed.metadata.bpm = 120;
  mixed.resources.wav['01'] = 'not-found.wav';
  mixed.events = [
    { measure: 0, channel: '01', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [1, 8], value: '01' },
  ];

  const single = createEmptyJson('bms');
  single.metadata.bpm = 120;
  single.resources.wav['01'] = 'not-found.wav';
  single.events = [{ measure: 0, channel: '11', position: [1, 8], value: '01' }];

  const [mixedResult, singleResult] = await Promise.all([
    renderJson(mixed, {
      sampleRate: 44_100,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 1.2,
      resolveTriggerGain: (trigger) => (trigger.channel === '01' ? 0.4 : 1),
    }),
    renderJson(single, {
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
  const overlap = createEmptyJson('bms');
  overlap.metadata.bpm = 120;
  overlap.resources.wav['01'] = 'render-codec-test.mp3';
  overlap.resources.wav['02'] = 'render-codec-test.mp3';
  overlap.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: '12', position: [1, 40], value: '02' },
  ];

  const single = createEmptyJson('bms');
  single.metadata.bpm = 120;
  single.resources.wav['02'] = 'render-codec-test.mp3';
  single.events = [{ measure: 0, channel: '12', position: [1, 40], value: '02' }];

  const [overlapResult, singleResult] = await Promise.all([
    renderJson(overlap, {
      baseDir: fixtureDir,
      sampleRate: 44_100,
      normalize: false,
      tailSeconds: 0,
      fallbackToneSeconds: 0.1,
    }),
    renderJson(single, {
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
