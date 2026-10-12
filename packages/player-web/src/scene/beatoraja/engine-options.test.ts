import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { composeBeatorajaEngineOptions } from './engine-options.ts';

describe('composeBeatorajaEngineOptions', () => {
  test('infers the lane-mode extension and play variant unless the host set them', () => {
    expect(composeBeatorajaEngineOptions({ chartPath: 'Song.v1/chart.PMS', variant: '9' })).toMatchObject({
      laneModeExtension: '.pms',
      playVariant: '9',
    });
    expect(
      composeBeatorajaEngineOptions({
        chartPath: 'chart.pms',
        variant: '9',
        engineOptions: { laneModeExtension: '.bme', playVariant: '7' },
      }),
    ).toMatchObject({ laneModeExtension: '.bme', playVariant: '7' });
    expect(composeBeatorajaEngineOptions({ chartPath: 'dir.with.dots/chart' }).laneModeExtension).toBeUndefined();
  });

  test('records the resolved outcomes, the DP-flip intent and the chart path next to the host fields', () => {
    const options = composeBeatorajaEngineOptions({
      chartPath: 'song/chart.bms',
      dpFlip: true,
      randomOutcomes: [2, 1],
      engineOptions: { recordPlaylog: { gauge: 'HARD', chartSha256: 'abc', native: { skin: 'x' } } },
    });
    expect(options.recordPlaylog).toEqual({
      gauge: 'HARD',
      chartSha256: 'abc',
      dpFlip: true,
      randomOutcomes: [2, 1],
      native: { skin: 'x', chartPath: 'song/chart.bms' },
    });
  });

  test('passes the source chart through for the fingerprints', () => {
    const sourceChart = createEmptyJson('bms');
    const options = composeBeatorajaEngineOptions({ sourceChart, randomOutcomes: [1] });
    expect(options.recordPlaylog?.sourceChart).toBe(sourceChart);
    expect(options.recordPlaylog?.randomOutcomes).toEqual([1]);
  });

  test('records no outcomes for a chart resolved without control flow', () => {
    expect(composeBeatorajaEngineOptions({ randomOutcomes: [] }).recordPlaylog).toEqual({});
    expect(composeBeatorajaEngineOptions({}).recordPlaylog).toEqual({});
  });

  test('copies the outcomes so the host array can change afterwards', () => {
    const randomOutcomes = [3];
    const options = composeBeatorajaEngineOptions({ randomOutcomes });
    randomOutcomes[0] = 1;
    expect(options.recordPlaylog?.randomOutcomes).toEqual([3]);
  });
});
