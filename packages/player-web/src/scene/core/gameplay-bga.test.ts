import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import {
  buildBgaTimeline,
  buildSkinBgaFrame,
  collectBgaTextureLoadKeys,
  isVideoExtension,
  pickActiveBgaCue,
  pickActiveBgaKey,
  resolveBgaImageRect,
  resolveNonstopBgaAlpha,
  splitNonstopBgaTimeline,
  toBrowserBgaTimeline,
} from './gameplay-bga.ts';

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

describe('collectBgaTextureLoadKeys', () => {
  it('includes source BMPs for referenced #BGA sub-region aliases', () => {
    const chart = createEmptyJson('bms');
    chart.bms.bga = {
      '01': '10 0 0 64 64 0 0',
      '02': '20 0 0 64 64 0 0',
      '03': '30 0 0 64 64 0 0',
    };
    const keys = collectBgaTextureLoadKeys(
      chart,
      {
        base: [{ seconds: 0, bmpKey: '01' }],
        layer: [{ seconds: 1, bmpKey: '02' }],
        poor: [{ seconds: 2, bmpKey: '04' }],
      },
      '00',
    );

    expect([...keys.base].sort()).toEqual(['00', '01', '04', '10']);
    expect([...keys.layer].sort()).toEqual(['02', '20']);
  });

  it('normalizes base-62 #BGA slots before matching timeline keys', () => {
    const chart = createEmptyJson('bms');
    chart.bms.base = 62;
    chart.bms.bga = {
      a: 'Zz 0 0 64 64 0 0',
    };
    const keys = collectBgaTextureLoadKeys(
      chart,
      {
        base: [{ seconds: 0, bmpKey: '0a' }],
        layer: [],
        poor: [],
      },
      undefined,
    );

    expect([...keys.base].sort()).toEqual(['0a', 'Zz']);
  });
});

describe('isVideoExtension', () => {
  it('recognizes browser/video BGA extensions case-insensitively', () => {
    expect(isVideoExtension('movie.MPG')).toBe(true);
    expect(isVideoExtension('movie.webm')).toBe(true);
    expect(isVideoExtension('image.png')).toBe(false);
  });
});

describe('buildSkinBgaFrame', () => {
  const images = {
    base: new Map([
      ['01', 'base-01'],
      ['CC', 'poor-CC'],
    ]),
    layer: new Map([['AA', 'layer-AA']]),
  };
  const resolve = (key: string, track: 'base' | 'layer') => images[track].get(key);

  it('hands over the base and layer images outside a POOR', () => {
    expect(buildSkinBgaFrame({ base: '01', layer: 'AA', poor: undefined }, resolve)).toEqual({
      base: 'base-01',
      layer: 'layer-AA',
      poorActive: false,
    });
  });

  it('reads the layer from the keyed layer map, not the base map', () => {
    expect(buildSkinBgaFrame({ base: undefined, layer: '01', poor: undefined }, resolve)).toEqual({
      poorActive: false,
    });
  });

  it('marks the POOR active only when its image is there', () => {
    expect(buildSkinBgaFrame({ base: '01', layer: undefined, poor: 'CC' }, resolve)).toEqual({
      base: 'base-01',
      poor: 'poor-CC',
      poorActive: true,
    });
    expect(buildSkinBgaFrame({ base: '01', layer: undefined, poor: 'ZZ' }, resolve)).toEqual({
      base: 'base-01',
      poorActive: false,
    });
  });
});

describe('toBrowserBgaTimeline', () => {
  it('keeps base and POOR cues and merges both layer channels in time order', () => {
    expect(
      toBrowserBgaTimeline({
        base: [{ seconds: 0, key: '01' }],
        layer: [{ seconds: 2, key: 'AA' }],
        layer2: [{ seconds: 1, key: 'BB' }, { seconds: 3 }],
        poor: [{ seconds: 4, key: 'CC' }],
      }),
    ).toEqual({
      base: [{ seconds: 0, bmpKey: '01' }],
      layer: [
        { seconds: 1, bmpKey: 'BB' },
        { seconds: 2, bmpKey: 'AA' },
        { seconds: 3, bmpKey: undefined },
      ],
      poor: [{ seconds: 4, bmpKey: 'CC' }],
    });
  });
});

describe('resolveBgaImageRect', () => {
  const rect = { x: 100, y: 50, w: 512, h: 512 };

  it('fills the rect with a 256x256 image', () => {
    expect(resolveBgaImageRect(256, 256, rect)).toEqual(rect);
  });

  it('keeps a short image at its pixel size, top-aligned', () => {
    expect(resolveBgaImageRect(256, 161, rect)).toEqual({ x: 100, y: 50, w: 512, h: 322 });
  });

  it('centers a narrow image horizontally, flooring the canvas offset', () => {
    // (256 - 117) / 2 = 69.5 → 69 canvas px, ×2 for the 512 px rect.
    expect(resolveBgaImageRect(117, 130, rect)).toEqual({ x: 238, y: 50, w: 234, h: 260 });
  });

  it('scales the canvas to a non-square rect', () => {
    expect(resolveBgaImageRect(128, 128, { x: 0, y: 0, w: 256, h: 128 })).toEqual({ x: 64, y: 0, w: 128, h: 64 });
  });

  it('stretches an image whose long edge exceeds the canvas over the rect', () => {
    expect(resolveBgaImageRect(512, 384, rect)).toEqual(rect);
    expect(resolveBgaImageRect(300, 100, rect)).toEqual(rect);
  });

  it('places a sub-region at its authored origin instead of centering it', () => {
    expect(resolveBgaImageRect(64, 32, rect, { x: 10, y: 20 })).toEqual({ x: 120, y: 90, w: 128, h: 64 });
  });

  it('falls back to the rect for an empty image', () => {
    expect(resolveBgaImageRect(0, 0, rect)).toEqual(rect);
  });
});

describe('NONSTOP BGA', () => {
  const stages = [
    { windowStart: 0, windowEnd: 20, bmpKeys: ['01', '02'], bgaFadeOut: { start: 20, end: 23 } },
    { windowStart: 20, windowEnd: Number.POSITIVE_INFINITY, bmpKeys: ['03'], bgaFadeIn: { start: 17, end: 20 } },
  ];

  it('splits the base, layer and POOR cues by the stage that owns each BMP key', () => {
    const split = splitNonstopBgaTimeline(
      {
        base: [
          { seconds: 1, bmpKey: '01' },
          { seconds: 18, bmpKey: '03' },
          { seconds: 19, bmpKey: '02' },
        ],
        layer: [
          { seconds: 2, bmpKey: '02' },
          { seconds: 25, bmpKey: undefined },
        ],
        poor: [
          { seconds: 0, bmpKey: '01' },
          { seconds: 17, bmpKey: '03' },
          { seconds: 21, bmpKey: undefined },
        ],
      },
      stages,
    );
    expect(split[0]).toEqual({
      base: [
        { seconds: 1, bmpKey: '01' },
        { seconds: 19, bmpKey: '02' },
      ],
      layer: [{ seconds: 2, bmpKey: '02' }],
      poor: [{ seconds: 0, bmpKey: '01' }],
    });
    expect(split[1]).toEqual({
      base: [{ seconds: 18, bmpKey: '03' }],
      layer: [{ seconds: 25, bmpKey: undefined }],
      poor: [
        { seconds: 17, bmpKey: '03' },
        { seconds: 21, bmpKey: undefined },
      ],
    });
  });

  it('crossfades the stages over 3 s around the boundary', () => {
    expect(resolveNonstopBgaAlpha(stages[0]!, 10)).toBe(1);
    expect(resolveNonstopBgaAlpha(stages[0]!, 21.5)).toBeCloseTo(0.5);
    expect(resolveNonstopBgaAlpha(stages[0]!, 24)).toBe(0);
    expect(resolveNonstopBgaAlpha(stages[1]!, 16)).toBe(0);
    expect(resolveNonstopBgaAlpha(stages[1]!, 18.5)).toBeCloseTo(0.5);
    expect(resolveNonstopBgaAlpha(stages[1]!, 30)).toBe(1);
  });
});
