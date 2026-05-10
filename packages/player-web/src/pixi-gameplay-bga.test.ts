import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, it } from 'vitest';
import { buildBgaTimeline, isVideoExtension, pickActiveBgaCue, pickActiveBgaKey } from './pixi-gameplay-bga.ts';

const resolver = {
  eventToSeconds: (event) => event.measure * 10 + event.position[0] / event.position[1],
  beatToSeconds: (beat) => beat * 2,
} satisfies Pick<TimingResolver, 'eventToSeconds' | 'beatToSeconds'> as TimingResolver;

describe('buildBgaTimeline', () => {
  it('collects BMS base, layer, layer2, and poor cues in time order', () => {
    const chart = createEmptyJson('bms');
    chart.events = [
      { measure: 2, position: [0, 1], channel: '04', value: '02' },
      { measure: 0, position: [0, 1], channel: '04', value: '01' },
      { measure: 1, position: [0, 1], channel: '07', value: 'AA' },
      { measure: 1, position: [1, 2], channel: '0A', value: 'BB' },
      { measure: 3, position: [0, 1], channel: '06', value: 'CC' },
      { measure: 4, position: [0, 1], channel: '11', value: 'DD' },
    ];

    const timeline = buildBgaTimeline(chart, resolver);

    expect(timeline.base.map((cue) => cue.bmpKey)).toEqual(['01', '02']);
    expect(timeline.base.map((cue) => cue.seconds)).toEqual([0, 20]);
    expect(timeline.layer.map((cue) => cue.bmpKey)).toEqual(['AA', 'BB']);
    expect(timeline.poor.map((cue) => cue.bmpKey)).toEqual(['CC']);
  });

  it('treats 00 as a clear cue', () => {
    const chart = createEmptyJson('bms');
    chart.events = [{ measure: 0, position: [0, 1], channel: '04', value: '00' }];

    expect(buildBgaTimeline(chart, resolver).base).toEqual([{ seconds: 0, bmpKey: undefined }]);
  });

  it('collects bmson BGA events using header ids and pulse resolution', () => {
    const chart: BeMusicJson = createEmptyJson('bmson');
    chart.bmson.info = { ...chart.bmson.info, resolution: 240 };
    chart.bmson.bga.header = [{ id: 1, name: 'intro.png' }];
    chart.bmson.bga.events = [
      { y: 240, id: 1 },
      { y: 480, id: 0 },
    ];
    chart.bmson.bga.layerEvents = [{ y: 120, id: 1 }];
    chart.bmson.bga.poorEvents = [{ y: 360, id: 1 }];

    const timeline = buildBgaTimeline(chart, resolver);

    expect(timeline.base).toEqual([
      { seconds: 2, bmpKey: 'intro.png' },
      { seconds: 4, bmpKey: undefined },
    ]);
    expect(timeline.layer).toEqual([{ seconds: 1, bmpKey: 'intro.png' }]);
    expect(timeline.poor).toEqual([{ seconds: 3, bmpKey: 'intro.png' }]);
  });
});

describe('BGA cue helpers', () => {
  const cues = [
    { seconds: 1, bmpKey: 'a' },
    { seconds: 3, bmpKey: 'b' },
    { seconds: 5, bmpKey: undefined },
  ];

  it('picks the last cue at or before the requested time', () => {
    expect(pickActiveBgaCue(cues, 0.5)).toBeUndefined();
    expect(pickActiveBgaKey(cues, 1)).toBe('a');
    expect(pickActiveBgaKey(cues, 4)).toBe('b');
    expect(pickActiveBgaKey(cues, 6)).toBeUndefined();
  });
});


describe('isVideoExtension', () => {
  it('recognizes browser/video BGA extensions case-insensitively', () => {
    expect(isVideoExtension('movie.MPG')).toBe(true);
    expect(isVideoExtension('movie.webm')).toBe(true);
    expect(isVideoExtension('image.png')).toBe(false);
  });
});
