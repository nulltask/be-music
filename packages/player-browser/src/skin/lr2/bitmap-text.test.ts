import { Rectangle, Texture } from 'pixi.js';
import { describe, expect, test } from 'vite-plus/test';
import { makeLR2BitmapTextSprite, type LR2LoadedFont } from './bitmap-text.ts';
import type { LR2DestinationRect, LR2TextElement } from '@be-music/skin-lr2';

function destination(overrides: Partial<LR2DestinationRect> = {}): LR2DestinationRect {
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

function textElement(alignment: LR2TextElement['alignment']): LR2TextElement {
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

function loadedFont(): LR2LoadedFont {
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

describe('makeLR2BitmapTextSprite', () => {
  test('fades missing-glyph boxes together with the bitmap text', () => {
    const root = makeLR2BitmapTextSprite('AZ', textElement('left'), { ...destination(), alpha: 0 }, loadedFont());
    expect(root.alpha).toBe(0);
    const inner = root.children[0]!;
    expect(inner.children).toHaveLength(2);
  });

  test('anchors right-aligned text at the destination x coordinate', () => {
    const root = makeLR2BitmapTextSprite('AB', textElement('right'), destination(), loadedFont());
    const inner = root.children[0]!;

    expect(root.position.x).toBe(120);
    // The first glyph starts left of the anchor. `B` has a shorter source height than the font base size, so its
    // measured width uses per-glyph scaling; this pins the alignment math that keeps LR2 option labels
    // centered/right-aligned correctly.
    expect(inner.children[0]!.position.x).toBe(-44);
  });

  test('shrinks horizontally when the rendered bitmap text exceeds dst.w', () => {
    const root = makeLR2BitmapTextSprite('ABAB', textElement('left'), destination({ w: 40 }), loadedFont());
    const inner = root.children[0]!;

    expect(inner.scale.x).toBeCloseTo(40 / 90);
    expect(inner.scale.y).toBe(1);
  });
});
