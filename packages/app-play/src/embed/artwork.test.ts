import { createEmptyJSON } from '@be-music/chart-source';
import type { LibraryChart } from '@be-music/player-scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { previewArtworkPath } from './artwork.ts';

function chart(metadata: Partial<LibraryChart['chart']['metadata']>): LibraryChart {
  const base = createEmptyJSON();
  return {
    id: 'chart',
    sourceId: 'source',
    sourceLabel: 'track',
    sourceKind: 'zip',
    chartPath: 'song/chart.bms',
    directoryLabel: 'song',
    fileLabel: 'chart.bms',
    title: 'Chart',
    totalNotes: 1,
    chart: { ...base, metadata: { ...base.metadata, ...metadata } },
  };
}

describe('previewArtworkPath', () => {
  it('prefers the stage file and falls back to the banner', () => {
    expect(previewArtworkPath(chart({ stageFile: 'stage.png', banner: 'banner.png' }))).toBe('stage.png');
    expect(previewArtworkPath(chart({ stageFile: '  ', banner: 'banner.png' }))).toBe('banner.png');
    expect(previewArtworkPath(chart({}))).toBeUndefined();
  });
});
