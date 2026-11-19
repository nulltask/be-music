import { expect, test } from 'vite-plus/test';
import { createSampleLoader, measurePeak, renderSingleSample, type RenderSampleLoadProgress } from './index.ts';

test('reuses the same sample key within one render', async () => {
  const stages: RenderSampleLoadProgress['stage'][] = [];
  const load = createSampleLoader({
    sampleRate: 8000,
    baseDir: '.',
    fallbackToneSeconds: 0,
    onSampleLoadProgress: ({ stage }) => stages.push(stage),
  });
  const first = await load('01');
  expect(await load('01')).toBe(first);
  expect(stages).toEqual(['fallback', 'cached']);
});

test('reports the stereo peak across both channels', () => {
  expect(measurePeak(Float32Array.of(-0.25, 0.5), Float32Array.of(-0.75, 0))).toBe(0.75);
});

test('missing samples default to one silent frame', async () => {
  const sample = await renderSingleSample('01', undefined, { sampleRate: 8000 });
  expect(sample).toEqual({
    sampleRate: 8000,
    left: Float32Array.of(0),
    right: Float32Array.of(0),
    peak: 0,
    durationSeconds: 1 / 8000,
  });
});
