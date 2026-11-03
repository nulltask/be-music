import { describe, expect, test } from 'vite-plus/test';
import type { LibraryChart } from '@be-music/player-scene-model';
import {
  applyChartLevelEdits,
  chartLevelKey,
  readChartLevelEdits,
  stepChartLevel,
  writeChartLevelEdits,
} from './chart-level-edits.ts';

const chart = (playLevel: number | string | undefined, difficulty?: number) =>
  ({
    chartPath: 'pack/a.bms',
    title: 'A',
    playLevel,
    chart: { metadata: difficulty !== undefined ? { difficulty } : {} },
  }) as unknown as LibraryChart;

describe('stepChartLevel', () => {
  test('steps the difficulty through 1-5, wrapping, and the level by 1 within 0-99', () => {
    expect(stepChartLevel(chart(3, 5), 'difficulty', 1)).toEqual({ difficulty: 1 });
    expect(stepChartLevel(chart(3, 1), 'difficulty', -1)).toEqual({ difficulty: 5 });
    expect(stepChartLevel(chart(3), 'difficulty', 1)).toEqual({ difficulty: 1 });
    expect(stepChartLevel(chart('★12', 2), 'level', 1)).toEqual({ difficulty: 2, playLevel: 13 });
    expect(stepChartLevel(chart(0), 'level', -1)).toEqual({ playLevel: 0 });
    expect(stepChartLevel(chart(99), 'level', 1)).toEqual({ playLevel: 99 });
  });
});

describe('the kept edits', () => {
  test('round-trip through storage, dropping what is out of range, and go over the charts', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const target = chart(3, 2);
    writeChartLevelEdits(storage, {
      [chartLevelKey(target)]: { difficulty: 4, playLevel: 12 },
      bad: { difficulty: 9 },
    });
    const edits = readChartLevelEdits(storage);
    expect(edits).toEqual({ [chartLevelKey(target)]: { difficulty: 4, playLevel: 12 } });
    applyChartLevelEdits([target], edits);
    expect(target.playLevel).toBe(12);
    expect(target.chart.metadata.difficulty).toBe(4);
    expect(readChartLevelEdits({ getItem: () => 'not json', setItem: () => {} })).toEqual({});
  });
});
