import { expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '@be-music/chart-source';
import { resolveChart } from '@be-music/chart-model';
import { collectBPMGuideEvents } from './bpm-guide.ts';

test('shows actual BPM changes and STOP milliseconds, omitting unchanged BPM declarations', () => {
  const chart = createEmptyJSON('bms');
  chart.metadata.bpm = 120;
  chart.resources.bpm = { '01': 240, '02': 180 };
  chart.resources.stop = { '01': 192 };
  chart.events = [
    { channel: '08', measure: 1, position: [0, 1], value: '01' },
    { channel: '08', measure: 2, position: [0, 1], value: '01' },
    { channel: '09', measure: 2, position: [0, 1], value: '01' },
    { channel: '08', measure: 3, position: [0, 1], value: '02' },
  ];
  const events = collectBPMGuideEvents(resolveChart(chart).timing);
  expect(events.map(({ beat, text }) => ({ beat, text }))).toEqual([
    { beat: 4, text: 'BPM240' },
    { beat: 8, text: 'STOP 1000ms' },
    { beat: 12, text: 'BPM180' },
  ]);
  expect(collectBPMGuideEvents(resolveChart(createEmptyJSON('bms')).timing)).toEqual([]);
});
