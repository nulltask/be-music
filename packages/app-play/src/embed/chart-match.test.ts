import { describe, expect, it } from 'vite-plus/test';
import type { LibraryChart } from '@be-music/player-scene-model';
import { findEmbedChart } from './chart-match.ts';

const chart = (chartPath: string): LibraryChart => ({ chartPath }) as LibraryChart;
const charts = [
  chart('mukashi_bms/robita/codebmp.bms'),
  chart('mukashi_bms/robita/CODEBMP_Another.bms'),
  chart('top.bme'),
];

describe('findEmbedChart', () => {
  it('matches a file name anywhere in the track, ignoring case', () => {
    expect(findEmbedChart(charts, 'codebmp.bms')).toBe(charts[0]);
    expect(findEmbedChart(charts, 'codebmp_another.BMS')).toBe(charts[1]);
    expect(findEmbedChart(charts, 'top.bme')).toBe(charts[2]);
  });

  it('matches a longer path by its end, with either separator', () => {
    expect(findEmbedChart(charts, 'robita/codebmp.bms')).toBe(charts[0]);
    expect(findEmbedChart(charts, 'robita\\codebmp.bms')).toBe(charts[0]);
    expect(findEmbedChart(charts, './mukashi_bms/robita/codebmp.bms')).toBe(charts[0]);
  });

  it('does not match part of a file name', () => {
    expect(findEmbedChart(charts, 'bmp.bms')).toBeUndefined();
    expect(findEmbedChart(charts, 'other/codebmp.bms')).toBeUndefined();
  });

  it('matches nothing for an empty query', () => {
    expect(findEmbedChart(charts, '  ')).toBeUndefined();
  });
});
