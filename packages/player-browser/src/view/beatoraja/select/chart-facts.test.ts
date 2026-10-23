import { createEmptyJSON } from '@be-music/chart-source';
import type { LibraryChart } from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { selectChartFacts } from './chart-facts.ts';

describe('select LN mode facts', () => {
  test('reads BMS and bmson chart modes through the shared chart resolver', () => {
    for (const format of ['bms', 'bmson'] as const) {
      for (const mode of [1, 2, 3]) {
        const chart = createEmptyJSON(format);
        if (format === 'bms') chart.bms.lnMode = mode;
        else chart.bmson.info.lnType = mode;
        const entry: LibraryChart = {
          id: `${format}-${mode}`,
          sourceId: 'source',
          sourceLabel: 'Source',
          sourceKind: 'directory',
          chartPath: 'chart.bms',
          directoryLabel: '',
          fileLabel: 'chart.bms',
          title: 'Chart',
          totalNotes: 0,
          chart,
        };
        expect(selectChartFacts(entry).lnMode).toBe(mode);
      }
    }
  });
});
