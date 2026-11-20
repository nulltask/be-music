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

test('labels actual #SCROLL and #SPEED changes from a rate of 1, with up to two decimals', () => {
  const chart = createEmptyJSON('bms');
  chart.metadata.bpm = 120;
  const timing = resolveChart(chart).timing;
  const events = collectBPMGuideEvents(
    timing,
    [
      { beat: 4, speed: 1 },
      { beat: 8, speed: 0.5 },
      { beat: 12, speed: 0.5 },
      { beat: 16, speed: -1.256 },
    ],
    [
      { beat: 6, speed: 2 },
      { beat: 10, speed: 1 },
    ],
  );
  expect(events.map(({ beat, kind, text, seconds }) => ({ beat, kind, text, seconds }))).toEqual([
    { beat: 6, kind: 'speed', text: 'SPEED 2', seconds: 3 },
    { beat: 8, kind: 'scroll', text: 'SCROLL 0.5', seconds: 4 },
    { beat: 10, kind: 'speed', text: 'SPEED 1', seconds: 5 },
    { beat: 16, kind: 'scroll', text: 'SCROLL -1.26', seconds: 8 },
  ]);
});
