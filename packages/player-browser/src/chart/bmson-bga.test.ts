import { expect, test } from 'vite-plus/test';
import { buildBGATimelines, createTimingResolver } from '@be-music/chart-model';
import { parseBmson } from '@be-music/chart-parser';
import { collectBmsonBGAFrameKeys } from './bmson-bga.ts';
import { resolveBGAStacks, toBrowserBGATimeline } from './bga-timeline.ts';
import { collectPlayBGAResources } from './play-bga.ts';

const timeline = {
  base: [{ seconds: 0, bmpKey: 'base.png' }],
  layer: [{ seconds: 0, bmpKey: 'ordinary.png' }],
  poor: [{ seconds: 0, bmpKey: 'ordinary-poor.png' }],
};

test('collects every alternative on its display plane using sequence header indices and declared fallback ids', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [],
      bga: {
        bga_header: [
          { id: 20, name: 'a.png' },
          { id: 30, name: 'b.png' },
          { id: 40, name: 'c.png' },
          { id: 50, name: 'unused.png' },
        ],
        bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 0 }, { time: 100, id: 1 }, { time: 500 }] }],
        layer_events: [
          { y: 0, id_set: [10, 40, 999], condition: 'play' },
          { y: 240, id: 10, condition: 'miss' },
        ],
      },
    }),
  );
  const keys = collectBmsonBGAFrameKeys(chart);
  expect([...keys.layer]).toEqual(['a.png', 'b.png', 'c.png']);
  expect([...keys.poor]).toEqual(['a.png', 'b.png']);
  const resources = collectPlayBGAResources(chart, { base: [], layer: [], poor: [] }, undefined);
  expect(Object.fromEntries(resources.paths)).toEqual({ 'a.png': 'a.png', 'b.png': 'b.png', 'c.png': 'c.png' });
  expect(collectPlayBGAResources(chart, { base: [], layer: [], poor: [] }, undefined, false).paths.size).toBe(0);
});

test('engine MISS frames replace POOR beyond the fixed miss window and carry their movie start', () => {
  const stack = resolveBGAStacks({
    timeline,
    seconds: 4,
    inPoorWindow: false,
    bmsonBGA: { plane: 'poor', key: 'frame.webm', startedSeconds: 2, frameStartSeconds: 2.1 },
  })[0]!;
  expect(stack.poorKey).toBe('frame.webm');
  expect(stack.poorCue).toEqual({ seconds: 2.1, bmpKey: 'frame.webm' });
  expect(stack.baseCue?.bmpKey).toBe('base.png');
});

test('layer frames replace the ordinary layer, clear missing images and disappear when engine state ends', () => {
  const input = { timeline, seconds: 4, inPoorWindow: false };
  expect(
    resolveBGAStacks({
      ...input,
      bmsonBGA: { plane: 'layer', key: 'frame.png', startedSeconds: 3, frameStartSeconds: 3.1 },
    })[0]!.layerCue,
  ).toEqual({ seconds: 3.1, bmpKey: 'frame.png' });
  expect(
    resolveBGAStacks({ ...input, bmsonBGA: { plane: 'layer', startedSeconds: 3, frameStartSeconds: 3 } })[0]!.layerCue
      ?.bmpKey,
  ).toBeUndefined();
  expect(resolveBGAStacks(input)[0]!.layerCue?.bmpKey).toBe('ordinary.png');
});

test('conditional frames respect NO LAYER, NO POOR and POORBGA 2', () => {
  const bmsonBGA = { plane: 'poor' as const, key: 'frame.png', startedSeconds: 3, frameStartSeconds: 3 };
  for (const flags of [{ noPoor: true }, { poorBGAMode: 2 as const }])
    expect(
      resolveBGAStacks({ timeline, seconds: 4, inPoorWindow: false, bmsonBGA, ...flags })[0]!.poorKey,
    ).toBeUndefined();
  expect(
    resolveBGAStacks({
      timeline,
      seconds: 4,
      inPoorWindow: false,
      noLayer: true,
      bmsonBGA: { ...bmsonBGA, plane: 'layer' },
    })[0]!.layerCue,
  ).toBeUndefined();
});

test('NO POOR suppresses ordinary cues as well as a conditional frame', () => {
  const stack = resolveBGAStacks({
    timeline,
    seconds: 4,
    inPoorWindow: true,
    noPoor: true,
    bmsonBGA: { plane: 'poor', key: 'frame.png', startedSeconds: 3, frameStartSeconds: 3 },
  })[0]!;
  expect(stack.poorKey).toBeUndefined();
  expect(stack.poorCue).toBeUndefined();
});

test('an ended conditional MISS sequence cannot revive an earlier ordinary POOR image', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [],
      bga: {
        bga_header: [
          { id: 20, name: 'old-poor.png' },
          { id: 30, name: 'sequence.png' },
        ],
        bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 1 }, { time: 200 }] }],
        poor_events: [{ y: 0, id: 20 }],
        layer_events: [{ y: 480, id: 10, condition: 'miss' }],
      },
    }),
  );
  const timeline = toBrowserBGATimeline(buildBGATimelines(chart, createTimingResolver(chart)));
  expect(resolveBGAStacks({ timeline, seconds: 0.5, inPoorWindow: true })[0]!.poorKey).toBe('old-poor.png');
  expect(resolveBGAStacks({ timeline, seconds: 1.3, inPoorWindow: true })[0]!.poorKey).toBeUndefined();
  chart.bmson.bga.layerEvents = [{ y: 480, id: 30 }];
  const ordinary = toBrowserBGATimeline(buildBGATimelines(chart, createTimingResolver(chart)));
  expect(resolveBGAStacks({ timeline: ordinary, seconds: 1.3, inPoorWindow: true })[0]!.poorKey).toBe('old-poor.png');
});
