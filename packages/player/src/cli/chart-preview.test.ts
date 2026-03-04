import { createEmptyJson } from '../../../json/src/index.ts';
import { describe, expect, test } from 'vitest';
import { resolvePreviewContinueKeyFromChart } from './chart-preview.ts';

describe('player chart preview', () => {
  test('returns chart-based continue key when #PREVIEW is missing', async () => {
    const chart = createEmptyJson('bms');
    const continueKey = await resolvePreviewContinueKeyFromChart(chart, '/songs/example/test.bms');
    expect(continueKey).toBe('chart:/songs/example/test.bms');
  });

  test('returns chart-based continue key when #PREVIEW file is unresolved', async () => {
    const chart = createEmptyJson('bms');
    chart.bms.preview = 'missing-preview.ogg';
    const continueKey = await resolvePreviewContinueKeyFromChart(chart, '/songs/example/test.bms');
    expect(continueKey).toBe('chart:/songs/example/test.bms');
  });
});
