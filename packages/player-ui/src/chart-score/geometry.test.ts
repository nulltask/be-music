import { describe, expect, it } from 'vite-plus/test';
import {
  chartScoreRowAt,
  DEFAULT_CHART_SCORE_METRICS,
  resolveChartScoreColumn,
  resolveChartScoreLanes,
} from './geometry.ts';

describe('resolveChartScoreLanes', () => {
  it('lays the lanes out after the label gutter, the scratch wider than a key', () => {
    const geometry = resolveChartScoreLanes([
      { kind: 'scratch', side: '1P' },
      { kind: 'key', side: '1P' },
      { kind: 'key', side: '1P' },
    ]);
    expect(geometry.lanes).toEqual([
      { x: 26, width: 16 },
      { x: 42, width: 10 },
      { x: 52, width: 10 },
    ]);
    expect(geometry.left).toBe(26);
    expect(geometry.right).toBe(62);
    expect(geometry.width).toBe(62 + DEFAULT_CHART_SCORE_METRICS.tempoWidth);
  });

  it('puts the side gap between the 1P and the 2P side', () => {
    const geometry = resolveChartScoreLanes([
      { kind: 'key', side: '1P' },
      { kind: 'key', side: '2P' },
      { kind: 'scratch', side: '2P' },
    ]);
    expect(geometry.lanes.map((lane) => lane.x)).toEqual([26, 42, 52]);
    expect(geometry.right).toBe(68);
  });
});

describe('resolveChartScoreColumn', () => {
  it('stacks the bars bottom to top in whole pixels', () => {
    const column = resolveChartScoreColumn(
      [
        { index: 0, beats: 4 },
        { index: 1, beats: 3 },
      ],
      16,
      16,
    );
    expect(column.height).toBe(256);
    expect(column.bars).toEqual([
      { index: 0, top: 192, bottom: 256 },
      { index: 1, top: 144, bottom: 192 },
    ]);
  });

  it('grows to hold a bar longer than a column', () => {
    expect(resolveChartScoreColumn([{ index: 0, beats: 20 }], 16, 10).height).toBe(200);
  });

  it('rounds odd beat lengths at their bar lines', () => {
    const column = resolveChartScoreColumn(
      [
        { index: 0, beats: 1.3 },
        { index: 1, beats: 1.3 },
      ],
      4,
      10,
    );
    expect(column.bars).toEqual([
      { index: 0, top: 27, bottom: 40 },
      { index: 1, top: 14, bottom: 27 },
    ]);
  });
});

describe('chartScoreRowAt', () => {
  it('reads a place in a bar as a pixel row, 0 at its bar line', () => {
    const box = { top: 192, bottom: 256 };
    expect(chartScoreRowAt(box, 0)).toBe(256);
    expect(chartScoreRowAt(box, 0.5)).toBe(224);
    expect(chartScoreRowAt(box, 1)).toBe(192);
    expect(chartScoreRowAt(box, 2)).toBe(192);
  });
});
