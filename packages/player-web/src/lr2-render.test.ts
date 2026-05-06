import { Rectangle, Texture } from 'pixi.js';
import { describe, expect, test } from 'vitest';
import {
  evaluateElementDestination,
  makeLr2BargraphSprite,
  makeLr2SliderSprite,
  makeLr2StaticImageSprite,
} from './lr2-render.ts';
import type {
  Lr2BarGraphElement,
  Lr2DestinationRect,
  Lr2ImageElement,
  Lr2ImageRect,
  Lr2SliderElement,
} from '@be-music/lr2-skin';
import { LR2_SPECIAL_GRAPHIC } from '@be-music/lr2-skin';

function destination(overrides: Partial<Lr2DestinationRect> = {}): Lr2DestinationRect {
  return {
    time: 0,
    x: 10,
    y: 20,
    w: 30,
    h: 40,
    acc: 0,
    alpha: 1,
    r: 255,
    g: 255,
    b: 255,
    blend: 0,
    filter: 0,
    angle: 0,
    center: 0,
    loop: -1,
    timer: 0,
    ops: [],
    op4: 0,
    ...overrides,
  };
}

function source(overrides: Partial<Lr2ImageRect> = {}): Lr2ImageRect {
  return {
    imagePath: 'skin.png',
    x: 0,
    y: 0,
    w: 20,
    h: 20,
    divx: 1,
    divy: 1,
    cycle: 0,
    timer: 0,
    ...overrides,
  };
}

function texture(width = 64, height = 64): Texture {
  return new Texture({
    source: Texture.EMPTY.source,
    frame: new Rectangle(0, 0, width, height),
  });
}

describe('evaluateElementDestination', () => {
  test('returns static destinations without reading timer state', () => {
    const staticDestination = destination({ x: 12 });
    const element = {
      destination: staticDestination,
      keyframes: [staticDestination],
    };

    expect(evaluateElementDestination(element, () => 100)).toBe(staticDestination);
  });

  test('interpolates keyframes against the element destination timer', () => {
    const keyframes = [destination({ timer: 7, x: 0, time: 0 }), destination({ timer: 7, x: 100, time: 100 })];

    const resolved = evaluateElementDestination(
      {
        destination: keyframes[1]!,
        keyframes,
      },
      (timer) => (timer === 7 ? 25 : 0),
    );

    expect(resolved.x).toBe(25);
  });
});

describe('makeLr2StaticImageSprite', () => {
  test('uses the full runtime texture for LR2 special graphics', () => {
    const image: Lr2ImageElement = {
      source: source({ imagePath: LR2_SPECIAL_GRAPHIC.STAGEFILE, w: 0, h: 0 }),
      destination: destination({ w: 120, h: 90 }),
      keyframes: [],
      declarationOrder: 0,
    };

    const sprite = makeLr2StaticImageSprite(image, image.destination, {
      textures: new Map(),
      elapsedSinceTimer: () => 0,
      resolveSpecialGraphicTexture: () => texture(320, 240),
    });

    expect(sprite?.texture.width).toBe(320);
    expect(sprite?.width).toBe(120);
    expect(sprite?.height).toBe(90);
  });
});

describe('makeLr2BargraphSprite', () => {
  test('clips vertical bars from the bottom up', () => {
    const bargraph: Lr2BarGraphElement = {
      source: source({ h: 80 }),
      destination: destination({ h: 100 }),
      keyframes: [],
      type: 1,
      muki: 'vertical',
      declarationOrder: 0,
    };

    const sprite = makeLr2BargraphSprite(bargraph, bargraph.destination, 0.25, new Map([['skin.png', texture()]]));

    expect(sprite?.position.y).toBe(95);
    expect(sprite?.height).toBe(25);
    expect(sprite?.texture.frame.height).toBe(20);
  });
});

describe('makeLr2SliderSprite', () => {
  test('positions the knob along the configured slider axis', () => {
    const slider: Lr2SliderElement = {
      source: source({ divx: 2, w: 40 }),
      destination: destination(),
      keyframes: [],
      type: 1,
      muki: 'right',
      range: 100,
      declarationOrder: 0,
    };

    const sprite = makeLr2SliderSprite(slider, slider.destination, 0.3, new Map([['skin.png', texture()]]));

    expect(sprite?.position.x).toBe(40);
    expect(sprite?.position.y).toBe(20);
    expect(sprite?.texture.frame.width).toBe(20);
  });
});
