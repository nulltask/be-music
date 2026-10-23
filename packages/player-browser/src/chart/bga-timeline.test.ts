import type { TimingResolver } from '@be-music/chart-model';
import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, it } from 'vite-plus/test';
import {
  buildBGATimeline,
  buildSkinBGAFrame,
  collectBGATextureLoadKeys,
  isMissLayerShown,
  isVideoExtension,
  pickActiveBGACue,
  pickActiveBGAKey,
  resolveBGAImageRect,
  resolveBGAStacks,
  resolveNonstopBGAAlpha,
  splitNonstopBGATimeline,
  toBrowserBGATimeline,
} from './bga-timeline.ts';

const resolver = {
  eventToSeconds: (event) => event.measure * 10 + event.position[0] / event.position[1],
  beatToSeconds: (beat) => beat * 2,
} satisfies Pick<TimingResolver, 'eventToSeconds' | 'beatToSeconds'> as TimingResolver;

describe('buildBGATimeline', () => {
  it('collects BMS base, layer, layer2, and poor cues in time order', () => {
    const chart = createEmptyJSON('bms');
    chart.events = [
      { measure: 2, position: [0, 1], channel: '04', value: '02' },
      { measure: 0, position: [0, 1], channel: '04', value: '01' },
      { measure: 1, position: [0, 1], channel: '07', value: 'AA' },
      { measure: 1, position: [1, 2], channel: '0A', value: 'BB' },
      { measure: 3, position: [0, 1], channel: '06', value: 'CC' },
      { measure: 4, position: [0, 1], channel: '11', value: 'DD' },
    ];

    const timeline = buildBGATimeline(chart, resolver);

    expect(timeline.base.map((cue) => cue.bmpKey)).toEqual(['01', '02']);
    expect(timeline.base.map((cue) => cue.seconds)).toEqual([0, 20]);
    expect(timeline.layer.map((cue) => cue.bmpKey)).toEqual(['AA', 'BB']);
    expect(timeline.poor.map((cue) => cue.bmpKey)).toEqual(['CC']);
  });

  it('treats 00 as a clear cue', () => {
    const chart = createEmptyJSON('bms');
    chart.events = [{ measure: 0, position: [0, 1], channel: '04', value: '00' }];

    expect(buildBGATimeline(chart, resolver).base).toEqual([{ seconds: 0, bmpKey: undefined }]);
  });

  it('collects bmson BGA events using header ids and pulse resolution', () => {
    const chart: BeMusicJSON = createEmptyJSON('bmson');
    chart.bmson.info = { ...chart.bmson.info, resolution: 240 };
    chart.bmson.bga.header = [{ id: 1, name: 'intro.png' }];
    chart.bmson.bga.events = [
      { y: 240, id: 1 },
      { y: 480, id: 0 },
    ];
    chart.bmson.bga.layerEvents = [{ y: 120, id: 1 }];
    chart.bmson.bga.poorEvents = [{ y: 360, id: 1 }];

    const timeline = buildBGATimeline(chart, resolver);

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
    expect(pickActiveBGACue(cues, 0.5)).toBeUndefined();
    expect(pickActiveBGAKey(cues, 1)).toBe('a');
    expect(pickActiveBGAKey(cues, 4)).toBe('b');
    expect(pickActiveBGAKey(cues, 6)).toBeUndefined();
  });
});

describe('collectBGATextureLoadKeys', () => {
  it('includes source BMPs for referenced #BGA sub-region aliases', () => {
    const chart = createEmptyJSON('bms');
    chart.bms.bga = {
      '01': '10 0 0 64 64 0 0',
      '02': '20 0 0 64 64 0 0',
      '03': '30 0 0 64 64 0 0',
    };
    const keys = collectBGATextureLoadKeys(
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
    const chart = createEmptyJSON('bms');
    chart.bms.base = 62;
    chart.bms.bga = {
      a: 'Zz 0 0 64 64 0 0',
    };
    const keys = collectBGATextureLoadKeys(
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

describe('buildSkinBGAFrame', () => {
  const images = {
    base: new Map([
      ['01', 'base-01'],
      ['CC', 'poor-CC'],
    ]),
    layer: new Map([['AA', 'layer-AA']]),
  };
  const resolve = (key: string, track: 'base' | 'layer') => images[track].get(key);

  it('hands over the base and layer images outside a POOR', () => {
    expect(buildSkinBGAFrame({ base: '01', layer: 'AA', poor: undefined }, resolve)).toEqual({
      base: 'base-01',
      layer: 'layer-AA',
      poorActive: false,
    });
  });

  it('reads the layer from the keyed layer map, not the base map', () => {
    expect(buildSkinBGAFrame({ base: undefined, layer: '01', poor: undefined }, resolve)).toEqual({
      poorActive: false,
    });
  });

  it('marks the POOR active only when its image is there', () => {
    expect(buildSkinBGAFrame({ base: '01', layer: undefined, poor: 'CC' }, resolve)).toEqual({
      base: 'base-01',
      poor: 'poor-CC',
      poorActive: true,
    });
    expect(buildSkinBGAFrame({ base: '01', layer: undefined, poor: 'ZZ' }, resolve)).toEqual({
      base: 'base-01',
      poorActive: false,
    });
  });
});

describe('toBrowserBGATimeline', () => {
  it('keeps base and POOR cues and merges both layer channels in time order', () => {
    expect(
      toBrowserBGATimeline({
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

describe('resolveBGAImageRect', () => {
  const rect = { x: 100, y: 50, w: 512, h: 512 };

  it('fills the rect with a 256x256 image', () => {
    expect(resolveBGAImageRect(256, 256, rect)).toEqual(rect);
  });

  it('keeps a short image at its pixel size, top-aligned', () => {
    expect(resolveBGAImageRect(256, 161, rect)).toEqual({ x: 100, y: 50, w: 512, h: 322 });
  });

  it('centers a narrow image horizontally, flooring the canvas offset', () => {
    // (256 - 117) / 2 = 69.5 → 69 canvas px, ×2 for the 512 px rect.
    expect(resolveBGAImageRect(117, 130, rect)).toEqual({ x: 238, y: 50, w: 234, h: 260 });
  });

  it('scales the canvas to a non-square rect', () => {
    expect(resolveBGAImageRect(128, 128, { x: 0, y: 0, w: 256, h: 128 })).toEqual({ x: 64, y: 0, w: 128, h: 64 });
  });

  it('stretches an image whose long edge exceeds the canvas over the rect', () => {
    expect(resolveBGAImageRect(512, 384, rect)).toEqual(rect);
    expect(resolveBGAImageRect(300, 100, rect)).toEqual(rect);
  });

  it('places a sub-region at its authored origin instead of centering it', () => {
    expect(resolveBGAImageRect(64, 32, rect, { x: 10, y: 20 })).toEqual({ x: 120, y: 90, w: 128, h: 64 });
  });

  it('falls back to the rect for an empty image', () => {
    expect(resolveBGAImageRect(0, 0, rect)).toEqual(rect);
  });
});

describe('NONSTOP BGA', () => {
  const stages = [
    { windowStart: 0, windowEnd: 20, bmpKeys: ['01', '02'], bgaFadeOut: { start: 20, end: 23 } },
    { windowStart: 20, windowEnd: Number.POSITIVE_INFINITY, bmpKeys: ['03'], bgaFadeIn: { start: 17, end: 20 } },
  ];

  it('splits the base, layer and POOR cues by the stage that owns each BMP key', () => {
    const split = splitNonstopBGATimeline(
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
    expect(resolveNonstopBGAAlpha(stages[0]!, 10)).toBe(1);
    expect(resolveNonstopBGAAlpha(stages[0]!, 21.5)).toBeCloseTo(0.5);
    expect(resolveNonstopBGAAlpha(stages[0]!, 24)).toBe(0);
    expect(resolveNonstopBGAAlpha(stages[1]!, 16)).toBe(0);
    expect(resolveNonstopBGAAlpha(stages[1]!, 18.5)).toBeCloseTo(0.5);
    expect(resolveNonstopBGAAlpha(stages[1]!, 30)).toBe(1);
  });

  it('resolves one stack per stage at its crossfade opacity, earlier stages first', () => {
    const timelines = [
      {
        base: [{ seconds: 0, bmpKey: '01' }],
        layer: [{ seconds: 1, bmpKey: '02' }],
        poor: [{ seconds: 0, bmpKey: '01' }],
      },
      { base: [{ seconds: 18, bmpKey: '03' }], layer: [], poor: [] },
    ];
    const at = (seconds: number, inPoorWindow = false) =>
      resolveBGAStacks({ timeline: { base: [], layer: [] }, nonstop: { stages, timelines }, seconds, inPoorWindow });
    expect(at(10)).toEqual([
      { alpha: 1, baseCue: { seconds: 0, bmpKey: '01' }, layerCue: { seconds: 1, bmpKey: '02' } },
    ]);
    const seam = at(21.5);
    expect(seam.map((stack) => stack.baseCue?.bmpKey)).toEqual(['01', '03']);
    expect(seam[0]!.alpha).toBeCloseTo(0.5);
    expect(seam[1]!.alpha).toBe(1);
    expect(at(30).map((stack) => stack.baseCue?.bmpKey)).toEqual(['03']);
    // During a POOR each stage shows its own POOR image; a stage without one has none.
    expect(at(21.5, true).map((stack) => stack.poorKey)).toEqual(['01', undefined]);
  });
});

describe('resolveBGAStacks', () => {
  const timeline = {
    base: [{ seconds: 0, bmpKey: '01' }],
    layer: [{ seconds: 0, bmpKey: '02' }],
    poor: [{ seconds: 0, bmpKey: '03' }],
  };

  it('resolves a chart that is not stitched to one opaque stack', () => {
    expect(resolveBGAStacks({ timeline, seconds: 1, inPoorWindow: false })).toEqual([
      { alpha: 1, baseCue: { seconds: 0, bmpKey: '01' }, layerCue: { seconds: 0, bmpKey: '02' } },
    ]);
  });

  it('picks the POOR cue only during a POOR and only when POOR cues are given', () => {
    expect(resolveBGAStacks({ timeline, seconds: 1, inPoorWindow: true })[0]!.poorKey).toBe('03');
    expect(resolveBGAStacks({ timeline, seconds: 1, inPoorWindow: false })[0]).not.toHaveProperty('poorKey');
    const withoutPoor = { base: timeline.base, layer: timeline.layer };
    expect(resolveBGAStacks({ timeline: withoutPoor, seconds: 1, inPoorWindow: true })[0]).not.toHaveProperty(
      'poorKey',
    );
  });

  it('leaves out the base or layer the BGA rect hides', () => {
    const [stack] = resolveBGAStacks({ timeline, seconds: 1, noBase: true, noLayer: true, inPoorWindow: false });
    expect(stack).toEqual({ alpha: 1, baseCue: undefined, layerCue: undefined });
  });
});

describe('isMissLayerShown', () => {
  it('shows from the miss for the duration, and never before a miss', () => {
    expect(isMissLayerShown(undefined, 1, 0.5)).toBe(false);
    expect(isMissLayerShown(10, 9.9, 0.5)).toBe(false);
    expect(isMissLayerShown(10, 10, 0.5)).toBe(true);
    expect(isMissLayerShown(10, 10.49, 0.5)).toBe(true);
    expect(isMissLayerShown(10, 10.5, 0.5)).toBe(false);
  });
});

it('carries overlay policy to skin frames', () => {
  expect(buildSkinBGAFrame({ base: 'b', layer: 'l', poor: 'p', poorOverlays: true }, (key) => key)).toEqual({
    base: 'b',
    layer: 'l',
    poor: 'p',
    poorActive: true,
    poorOverlays: true,
  });
});

it('resolves POOR overlay and hidden modes for explicit cues, including per-stage NONSTOP policy', () => {
  const timeline = { base: [{ seconds: 0, bmpKey: 'b' }], layer: [], poor: [{ seconds: 0, bmpKey: 'p' }] };
  expect(resolveBGAStacks({ timeline, seconds: 1, inPoorWindow: true, poorBGAMode: 1 })[0]).toMatchObject({
    poorKey: 'p',
    poorOverlays: true,
  });
  expect(resolveBGAStacks({ timeline, seconds: 1, inPoorWindow: true, poorBGAMode: 2 })[0]).not.toHaveProperty(
    'poorKey',
  );
  const stages = [
    { windowStart: 0, windowEnd: 10, bmpKeys: ['b', 'p'], poorBGAMode: 1 as const },
    { windowStart: 0, windowEnd: 10, bmpKeys: ['b', 'p'], poorBGAMode: 2 as const },
    { windowStart: 0, windowEnd: 10, bmpKeys: ['b', 'p'] },
  ];
  const stacks = resolveBGAStacks({
    timeline,
    seconds: 1,
    inPoorWindow: true,
    poorBGAMode: 2,
    nonstop: { stages, timelines: [timeline, timeline, timeline] },
  });
  expect(stacks[0]).toMatchObject({ poorKey: 'p', poorOverlays: true });
  expect(stacks[1]).not.toHaveProperty('poorKey');
  expect(stacks[2]?.poorKey).toBe('p');
  expect(stacks[2]).not.toHaveProperty('poorOverlays');
});
