import { LR2_SPECIAL_GRAPHIC, type Lr2ImageRect, type Lr2Skin } from '@be-music/lr2-skin';
import { describe, expect, test } from 'vitest';
import {
  collectDecideSkinTexturePaths,
  collectResultSkinTexturePaths,
  collectSelectSkinTexturePaths,
} from './scene-textures.ts';

function source(imagePath: string): Lr2ImageRect {
  return {
    imagePath,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    divx: 1,
    divy: 1,
    cycle: 0,
    timer: 0,
  };
}

function element(imagePath: string): { source: Lr2ImageRect } {
  return { source: source(imagePath) };
}

function skinWith(overrides: { barLayout?: Record<string, unknown>; [key: string]: unknown } = {}): Lr2Skin {
  const { barLayout, ...skinOverrides } = overrides;
  return {
    images: [],
    numbers: [],
    bargraphs: [],
    sliders: [],
    buttons: [],
    onMouseElements: [],
    mouseCursors: [],
    ...skinOverrides,
    barLayout: {
      bodies: [],
      slots: [],
      center: 0,
      available: 0,
      levels: [],
      levelKeyframes: [],
      lamps: [],
      lampKeyframes: [],
      ranks: [],
      rankKeyframes: [],
      rivalIndicators: [],
      rivalKeyframes: [],
      rivalLamps: {
        myLamps: [],
        myLampKeyframes: [],
        rivalLamps: [],
        rivalLampKeyframes: [],
      },
      declarationOrder: undefined,
      ...barLayout,
    },
  } as unknown as Lr2Skin;
}

function expectTexturePaths(paths: Set<string>, expected: string[]): void {
  expect([...paths].sort()).toEqual([...expected].sort());
}

describe('collectDecideSkinTexturePaths', () => {
  test('collects image and number textures only', () => {
    const skin = skinWith({
      images: [element('image.png'), element(LR2_SPECIAL_GRAPHIC.BANNER)],
      numbers: [element('number.png')],
      bargraphs: [element('bargraph.png')],
      sliders: [element('slider.png')],
    });

    expectTexturePaths(collectDecideSkinTexturePaths(skin), ['image.png', 'number.png']);
  });
});

describe('collectResultSkinTexturePaths', () => {
  test('collects base scene texture groups', () => {
    const skin = skinWith({
      images: [element('image.png')],
      numbers: [element('number.png')],
      bargraphs: [element('bargraph.png')],
      sliders: [element('slider.png'), element(LR2_SPECIAL_GRAPHIC.STAGEFILE)],
      buttons: [element('button.png')],
    });

    expectTexturePaths(collectResultSkinTexturePaths(skin), ['bargraph.png', 'image.png', 'number.png', 'slider.png']);
  });
});

describe('collectSelectSkinTexturePaths', () => {
  test('collects song-select chrome and bar texture groups', () => {
    const skin = skinWith({
      images: [element('image.png'), element(LR2_SPECIAL_GRAPHIC.BACKBMP)],
      numbers: [element('number.png')],
      bargraphs: [element('bargraph.png')],
      sliders: [element('slider.png')],
      buttons: [element('button.png')],
      onMouseElements: [element('on-mouse.png')],
      mouseCursors: [element('cursor.png')],
      barLayout: {
        bodies: [element('bar-body.png')],
        levels: [element('bar-level.png')],
        lamps: [element('bar-lamp.png')],
        ranks: [element('bar-rank.png')],
        flash: element('bar-flash.png'),
      },
    });

    expectTexturePaths(collectSelectSkinTexturePaths(skin), [
      'bar-body.png',
      'bar-flash.png',
      'bar-lamp.png',
      'bar-level.png',
      'bar-rank.png',
      'button.png',
      'cursor.png',
      'image.png',
      'number.png',
      'on-mouse.png',
      'slider.png',
    ]);
  });
});
