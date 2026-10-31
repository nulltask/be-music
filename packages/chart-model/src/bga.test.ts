import { expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '@be-music/chart-source';
import { buildBGATimelines } from './bga.ts';

test('a conditional MISS replaces an older POOR definition while ordinary and PLAY layers keep it independent', () => {
  const chart = createEmptyJSON('bmson');
  chart.bmson.bga.header = [
    { id: 20, name: 'old-poor.png' },
    { id: 30, name: 'layer.png' },
  ];
  chart.bmson.bga.poorEvents = [{ y: 0, id: 20 }];
  const clock = { eventToSeconds: () => 0, beatToSeconds: (beat: number) => beat };
  for (const condition of [undefined, 'play', 'miss']) {
    chart.bmson.bga.layerEvents = [{ y: 480, id: 30, ...(condition !== undefined ? { condition } : {}) }];
    const timeline = buildBGATimelines(chart, clock);
    expect(timeline.poor).toEqual(
      condition === 'miss'
        ? [
            { seconds: 0, key: 'old-poor.png' },
            { seconds: 2, key: undefined },
          ]
        : [{ seconds: 0, key: 'old-poor.png' }],
    );
    expect(timeline.layer[0]!.key).toBe(condition === undefined ? 'layer.png' : undefined);
  }
});
