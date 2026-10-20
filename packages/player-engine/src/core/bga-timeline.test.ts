import { describe, expect, test } from 'vite-plus/test';
import { buildBGATimelines } from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import { pickActiveBGACue, pickActiveBGAKey } from './bga-timeline.ts';

const resolver = {
  eventToSeconds: (event: { measure: number }): number => event.measure,
  beatToSeconds: (beat: number): number => beat * 2,
};

describe('bga-timeline', () => {
  test('collects BMS base, layer, layer2, and poor cues using the chart base', () => {
    const chart = createEmptyJSON('bms');
    chart.bms.base = 62;
    chart.events = [
      { measure: 0, channel: '04', position: [0, 1], value: '01' },
      { measure: 2, channel: '04', position: [0, 1], value: '02' },
      { measure: 1, channel: '07', position: [0, 1], value: 'AA' },
      { measure: 3, channel: '0A', position: [0, 1], value: 'BB' },
      { measure: 4, channel: '06', position: [0, 1], value: 'CC' },
    ];

    const timeline = buildBGATimelines(chart, resolver);

    expect(timeline.base.map((cue) => cue.key)).toEqual(['01', '02']);
    expect(timeline.layer.map((cue) => cue.key)).toEqual(['AA']);
    expect(timeline.layer2.map((cue) => cue.key)).toEqual(['BB']);
    expect(timeline.poor.map((cue) => cue.key)).toEqual(['CC']);
  });

  test('treats BMS key 00 as a clear cue', () => {
    const chart = createEmptyJSON('bms');
    chart.events = [{ measure: 0, channel: '04', position: [0, 1], value: '00' }];

    expect(buildBGATimelines(chart, resolver).base).toEqual([{ seconds: 0, key: undefined }]);
  });

  test('collects bmson BGA events using header ids and pulse resolution', () => {
    const chart = createEmptyJSON('bmson');
    chart.bmson.info.resolution = 120;
    chart.bmson.bga.header = [{ id: 1, name: 'intro.png' }];
    chart.bmson.bga.events = [
      { y: 120, id: 1 },
      { y: 240, id: 0 },
    ];
    chart.bmson.bga.layerEvents = [{ y: 60, id: 1 }];
    chart.bmson.bga.poorEvents = [{ y: 180, id: 1 }];

    const timeline = buildBGATimelines(chart, resolver);

    expect(timeline.base).toEqual([
      { seconds: 2, key: 'intro.png' },
      { seconds: 4, key: undefined },
    ]);
    expect(timeline.layer).toEqual([{ seconds: 1, key: 'intro.png' }]);
    expect(timeline.poor).toEqual([{ seconds: 3, key: 'intro.png' }]);
  });

  test('picks the latest active cue at or before the requested time', () => {
    const cues = [
      { seconds: 1, key: 'a' },
      { seconds: 3, key: 'b' },
      { seconds: 5, key: undefined },
    ];

    expect(pickActiveBGACue(cues, 0.5)).toBeUndefined();
    expect(pickActiveBGAKey(cues, 1)).toBe('a');
    expect(pickActiveBGAKey(cues, 4)).toBe('b');
    expect(pickActiveBGAKey(cues, 6)).toBeUndefined();
  });
});
