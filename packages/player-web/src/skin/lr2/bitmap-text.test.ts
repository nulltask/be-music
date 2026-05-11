import { Rectangle, Texture } from 'pixi.js';
import { describe, expect, test } from 'vitest';
import { makeLr2BitmapTextSprite, type Lr2LoadedFont } from './bitmap-text.ts';
import type { Lr2DestinationRect, Lr2TextElement } from '@be-music/lr2-skin';

function destination(overrides: Partial<Lr2DestinationRect> = {}): Lr2DestinationRect {
  return {
    time: 0,
    x: 120,
    y: 40,
    w: 200,
    h: 20,
    acc: 0,
    alpha: 0.75,
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

function textElement(alignment: Lr2TextElement['alignment']): Lr2TextElement {
  return {
    font: 0,
    st: 60,
    alignment,
    edit: 0,
    panel: 0,
    destination: destination(),
    keyframes: [],
    declarationOrder: 0,
  };
}

function loadedFont(): Lr2LoadedFont {
  const source = Texture.EMPTY.source;
  return {
    font: {
      baseSize: 20,
      spacing: 2,
      images: new Map([[0, 'font.png']]),
      glyphs: new Map([
        [65, { gr: 0, x: 0, y: 0, w: 10, h: 20 }],
        [66, { gr: 0, x: 10, y: 0, w: 16, h: 10 }],
      ]),
    },
    textures: new Map([
      [
        0,
        new Texture({
          source,
          frame: new Rectangle(0, 0, 32, 32),
        }),
      ],
    ]),
  };
}

describe('makeLr2BitmapTextSprite', () => {
  test('anchors right-aligned text at the destination x coordinate', () => {
    const root = makeLr2BitmapTextSprite('AB', textElement('right'), destination(), loadedFont());
    const inner = root.children[0]!;

    expect(root.position.x).toBe(120);
    // The first glyph starts left of the anchor. `B` has a shorter source height than the font base size, so its
    // measured width uses per-glyph scaling; this pins the alignment math that keeps LR2 option labels
    // centered/right-aligned correctly.
    expect(inner.children[0]!.position.x).toBe(-44);
  });

  test('shrinks horizontally when the rendered bitmap text exceeds dst.w', () => {
    const root = makeLr2BitmapTextSprite('ABAB', textElement('left'), destination({ w: 40 }), loadedFont());
    const inner = root.children[0]!;

    expect(inner.scale.x).toBeCloseTo(40 / 90);
    expect(inner.scale.y).toBe(1);
  });
});
