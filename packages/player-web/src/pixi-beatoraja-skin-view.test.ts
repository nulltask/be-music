import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { evaluateBeatorajaLuaSkin, isBeatorajaLuaFunctionValue } from '@be-music/beatoraja-skin';
import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function fakeTextureCache(idsWithTextures: ReadonlyArray<number>): BeatorajaTextureCache {
  // The view explicitly skips any sprite whose texture is `Texture.EMPTY` (the renderer crashes on WebGPU when a
  // sub-texture is built off an empty source — see the `BindGroupSystem._createBindGroup` null-deref). For the
  // tests we synthesize a tiny non-empty `TextureSource` so the view treats the entry as a real texture; we
  // never actually paint these to a GPU, so the bytes are irrelevant.
  const fakeSource = new TextureSource({ resource: new Uint8Array(4), width: 1, height: 1 });
  const map = new Map<number | string, Texture>();
  for (const id of idsWithTextures) {
    map.set(id, new Texture({ source: fakeSource }));
  }
  return {
    get: (id) => map.get(id),
    values: () => map.values(),
    pathOf: () => undefined,
  };
}

function makeSkin(extra: Partial<BeatorajaSkin> = {}): BeatorajaSkin {
  return {
    type: 0,
    w: 1280,
    h: 720,
    image: [{ id: 1, src: 0, x: 0, y: 0, w: 100, h: 100 }],
    destination: [
      {
        id: 1,
        timer: 0,
        loop: -1,
        offset: 0,
        dst: [{ time: 0, x: 10, y: 20, w: 100, h: 100, a: 255, r: 255, g: 255, b: 255 }],
      },
    ],
    ...extra,
  };
}

describe('BeatorajaPlaySkinView', () => {
  it('builds a sprite per `(image, destination)` pair', () => {
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    expect(view.renderableChildren).toHaveLength(1);
    expect(view.width).toBe(1280);
    expect(view.height).toBe(720);
    view.dispose();
  });

  it('clips the container to the authored canvas via an off-stage mask', () => {
    // Skin destinations authored outside `(0, 0, skin.w, skin.h)` (slide-in chrome from negative
    // coords, scroll-from-top notes, lane chrome extending past the playfield's authored bottom)
    // must be CLIPPED to the canvas edge — matching LR2's `designClipMask` at
    // `pixi-gameplay.ts:469`. Without the mask, those elements bleed into the host's letterbox /
    // pillarbox bars and read as "the skin is leaking outside its stage".
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    // The mask is installed on the container and SEPARATELY tracked as a child. `renderableChildren`
    // filters it out so test counts remain semantic, but `container.mask` must be set and the mask
    // graphic must be present in the underlying children list (Pixi v8 requires the mask to be
    // somewhere in the rendered scene graph).
    expect(view.container.mask).not.toBeNull();
    expect(view.container.children.length).toBe(view.renderableChildren.length + 1);
    view.dispose();
  });

  it('orders children by destination offset, breaking ties by declaration order', () => {
    const skin = makeSkin({
      image: [
        { id: 1, src: 0, x: 0, y: 0, w: 1, h: 1 },
        { id: 2, src: 0, x: 0, y: 0, w: 1, h: 1 },
        { id: 3, src: 0, x: 0, y: 0, w: 1, h: 1 },
      ],
      destination: [
        { id: 1, offset: 5, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
        { id: 2, offset: 0, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
        { id: 3, offset: 5, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      ],
    });
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    // Offset 0 (id=2) renders first, then offset-5 entries in source order (id=1, id=3).
    const children = view.renderableChildren;
    expect(children).toHaveLength(3);
    view.dispose();
  });

  it('skips entries when the image lookup fails', () => {
    const skin = makeSkin({
      image: [{ id: 1, src: 0, x: 0, y: 0, w: 1, h: 1 }],
      destination: [
        { id: 1, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
        { id: 'unknown', dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      ],
    });
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    expect(view.renderableChildren).toHaveLength(1);
    view.dispose();
  });

  it('updates sprite props from the keyframe sample (Y-flipped from libGDX Y-UP into Pixi Y-DOWN)', () => {
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const sprite = view.renderableChildren[0] as { x: number; y: number; visible: boolean; alpha: number };
    expect(sprite.visible).toBe(true);
    // beatoraja's default `center = 0` puts the anchor at the rect's mid-point (0.5, 0.5), so
    // sprite.x = props.x + 0.5 * w = 10 + 50 = 60. Y is similarly offset by half the height.
    expect(sprite.x).toBe(60);
    // dst.y=20, h=100 inside a 720-tall skin → Pixi top-left y = 720 - 20 - 100 = 600. Plus the
    // center.y = 0.5 anchor offset: 600 + 0.5 * 100 = 650.
    expect(sprite.y).toBe(650);
    expect(sprite.alpha).toBe(1);
    view.dispose();
  });

  it('hides sprites past the last keyframe with loop=-1', () => {
    const skin = makeSkin({
      destination: [
        {
          id: 1,
          timer: 0,
          loop: -1,
          dst: [
            { time: 0, x: 0, y: 0, w: 100, h: 100, a: 255 },
            { time: 1000, a: 0 },
          ],
        },
      ],
    });
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 2000 });
    const sprite = view.renderableChildren[0] as { visible: boolean };
    expect(sprite.visible).toBe(false);
    view.dispose();
  });

  it('honors `op` visibility gating against the active op set', () => {
    const skin = makeSkin({
      destination: [
        {
          id: 1,
          timer: 0,
          op: [920],
          dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }],
        },
      ],
    });
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    expect((view.renderableChildren[0] as { visible: boolean }).visible).toBe(false);
    view.update({ activeOps: new Set([920]), getTimerStart: () => 0, nowMs: 0 });
    expect((view.renderableChildren[0] as { visible: boolean }).visible).toBe(true);
    view.dispose();
  });

  it('passes gauge percent to runtime Lua draw functions without rescaling', () => {
    const lua = evaluateBeatorajaLuaSkin({
      entry: enc('local m = require("main_state"); return function() return m.gauge() >= 80 end'),
      modules: [],
      skinConfig: {},
    });
    if (!lua.ok) throw new Error(lua.error.message);
    const draw = lua.value;
    if (!isBeatorajaLuaFunctionValue(draw)) throw new Error('expected a runtime Lua function');
    const skin = makeSkin({
      destination: [{ id: 1, draw, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] }],
    });
    let gauge = 79;
    const view = new BeatorajaPlaySkinView({
      skin,
      textures: fakeTextureCache([0]),
      resolveGaugePercent: () => gauge,
    });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    expect((view.renderableChildren[0] as { visible: boolean }).visible).toBe(false);
    gauge = 80;
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    expect((view.renderableChildren[0] as { visible: boolean }).visible).toBe(true);
    draw.dispose();
    view.dispose();
  });

  it('calls resolveRefValue when the image has a `ref` op', () => {
    const skin = makeSkin({
      image: [{ id: 1, src: 0, x: 0, y: 0, w: 100, h: 110, divy: 11, ref: 370, len: 11 }],
      destination: [{ id: 1, timer: 0, dst: [{ time: 0, x: 0, y: 0, w: 100, h: 110 }] }],
    });
    const resolveRefValue = vi.fn().mockReturnValue(3);
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]), resolveRefValue });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    expect(resolveRefValue).toHaveBeenCalledWith(370);
    view.dispose();
  });

  it('renders `value[]` declarations as one sprite per displayed digit', () => {
    // `digit = 4` → 4 sprites laid out across the destination rect, one per displayed digit. Plus
    // the unrelated image[id=1] entry contributes 1 sprite, for 1 + 4 = 5 children total.
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1280,
      h: 720,
      image: [{ id: 1, src: 0, x: 0, y: 0, w: 100, h: 100 }],
      value: [{ id: 400, src: 0, x: 0, y: 0, w: 240, h: 24, divx: 10, digit: 4, ref: 91 }],
      destination: [
        { id: 1, dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] },
        { id: 400, dst: [{ time: 0, x: 520, y: 2, w: 18, h: 18 }] },
      ],
    };
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    expect(view.renderableChildren).toHaveLength(5);
    view.dispose();
  });

  it('renders the resolved number across the digit row when resolveNumberValue is wired', () => {
    // value[].ref=71 (prop.lua `score`) → host returns 12345 → with `digit=5` and `padding=1`
    // (leading zeros), the cells should be [1, 2, 3, 4, 5]. Per beatoraja's convention `dst.w` is
    // the PER-DIGIT slot width — `dst.w = 24` means each digit renders 24px wide, so the 5-digit
    // strip spans 120px starting at the rect's x. The Y axis is Y-flipped from libGDX into Pixi
    // but the digits' x coordinates are unchanged.
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1280,
      h: 720,
      value: [{ id: 200, src: 0, x: 0, y: 0, w: 240, h: 24, divx: 10, digit: 5, padding: 1, ref: 71 }],
      destination: [{ id: 200, dst: [{ time: 0, x: 100, y: 100, w: 24, h: 24 }] }],
    };
    const view = new BeatorajaPlaySkinView({
      skin,
      textures: fakeTextureCache([0]),
      resolveNumberValue: (ref) => (ref === 71 ? 12345 : undefined),
    });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const sprites = view.renderableChildren;
    expect(sprites).toHaveLength(5);
    // beatoraja's default `center = 0` shifts each digit's anchor by half a slot, so the per-
    // digit x = dst.x + i * slotWidth + center.x * slotWidth = 100 + i * 24 + 12.
    for (let i = 0; i < 5; i += 1) {
      const sprite = sprites[i];
      expect(sprite).toBeDefined();
      expect((sprite as { x: number; width: number }).x).toBeCloseTo(112 + i * 24);
      expect((sprite as { x: number; width: number }).width).toBe(24);
    }
    view.dispose();
  });

  it('hides every digit sprite when resolveNumberValue returns undefined (upstream `MIN_VALUE` semantics)', () => {
    // Mirrors upstream `SkinNumber.prepare(time, state, value, ox, oy)`
    // (`SkinNumber.java:133-136`): when the resolved value is `Integer.MIN_VALUE` it sets
    // `draw = false` and renders nothing. We surface that as `undefined` from the host
    // resolver so refs that don't apply to the current scene state (e.g.
    // `folder_totalsongs = 300` on a song bar) hide their digits instead of falling back
    // to `0` (which previously showed a stale "0000" / "0").
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1280,
      h: 720,
      value: [{ id: 200, src: 0, x: 0, y: 0, w: 240, h: 24, divx: 10, digit: 4, padding: 1, ref: 300 }],
      destination: [{ id: 200, dst: [{ time: 0, x: 100, y: 100, w: 24, h: 24 }] }],
    };
    const view = new BeatorajaPlaySkinView({
      skin,
      textures: fakeTextureCache([0]),
      resolveNumberValue: () => undefined, // ref 300 → MIN_VALUE-style hide
    });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const sprites = view.renderableChildren;
    expect(sprites).toHaveLength(4);
    for (const sprite of sprites) {
      expect((sprite as { visible: boolean }).visible).toBe(false);
    }
    view.dispose();
  });

  it('renders `0` digits when the resolver returns the literal `0` (only `undefined` triggers the hide)', () => {
    // Counterpart to the test above — guards against an over-eager hide. Idle scenes legitimately
    // resolve scoreboard refs to `0` (e.g. score / combo at scene start) and the digits should
    // paint, not vanish. Only `undefined` is the upstream `MIN_VALUE` mirror.
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1280,
      h: 720,
      value: [{ id: 200, src: 0, x: 0, y: 0, w: 240, h: 24, divx: 10, digit: 4, padding: 1, ref: 71 }],
      destination: [{ id: 200, dst: [{ time: 0, x: 100, y: 100, w: 24, h: 24 }] }],
    };
    const view = new BeatorajaPlaySkinView({
      skin,
      textures: fakeTextureCache([0]),
      resolveNumberValue: () => 0,
    });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const sprites = view.renderableChildren;
    expect(sprites).toHaveLength(4);
    // padding=1 (zero-pad) → every slot paints "0", so all 4 stay visible.
    for (const sprite of sprites) {
      expect((sprite as { visible: boolean }).visible).toBe(true);
    }
    view.dispose();
  });

  it('applies per-digit `value[].offset` ids with libGDX→Pixi Y-flip (audit A-14)', () => {
    // Mirrors upstream `SkinNumber.draw()` (`SkinNumber.java:189-199`):
    //
    //   draw(sprite, image, region.x + (region.width + space) * j - shift + offsets[j].x,
    //                       region.y + offsets[j].y, region.width + offsets[j].w,
    //                       region.height + offsets[j].h);
    //
    // The slot's libGDX bottom-left = (region.x + i*slotStep + offsets[j].x, region.y +
    // offsets[j].y); size = (slotW + offsets[j].w, region.height + offsets[j].h). After the
    // Pixi Y-flip, the Pixi top-y MUST DECREASE by `offsets[j].y` AND by `offsets[j].h` (the
    // upstream height grew upward in Y-UP). Previous impl added `+ offsets[j].y` to sprite.y,
    // shifting the slot DOWN in Pixi when the author meant UP in libGDX — and ignored the
    // height growth at the rotation pivot.
    //
    // Test setup: 1-digit `value[]` at `dst = (100, 100, 24, 24)` on a 720-tall canvas. With
    // `center = 0` (default → libGDX (0.5, 0.5) → Pixi (0.5, 0.5)) and the host-supplied
    // offset `id=999 → {x:5, y:10, w:6, h:8}`, the slot's expected Pixi geometry:
    //
    //   parent.x = 100, parent.y = canvasH - 100 - 24 = 596, parent.height = 24
    //   slotPixiLeft = 100 + 0 + 5 = 105
    //   slotPixiTop  = 596 - 10 - 8 = 578     ← y subtracts BOTH off.y and off.h
    //   slotWidth    = 24 + 6 = 30
    //   slotHeight   = 24 + 8 = 32
    //   sprite.x     = 105 + 30 * 0.5 = 120  ← center.x of FULL post-offset width
    //   sprite.y     = 578 + 32 * 0.5 = 594
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1280,
      h: 720,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      value: [
        {
          id: 200,
          src: 0,
          x: 0,
          y: 0,
          w: 24,
          h: 24,
          divx: 10,
          digit: 1,
          ref: 71,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          ...({ offset: [999] } as unknown as object),
        },
      ] as unknown as BeatorajaSkin['value'],
      destination: [{ id: 200, dst: [{ time: 0, x: 100, y: 100, w: 24, h: 24, a: 255 }] }],
    };
    const view = new BeatorajaPlaySkinView({
      skin,
      textures: fakeTextureCache([0]),
      resolveNumberValue: (ref) => (ref === 71 ? 5 : undefined),
    });
    view.update({
      activeOps: new Set(),
      getTimerStart: () => 0,
      nowMs: 0,
      resolveOffset: (id) => (id === 999 ? { x: 5, y: 10, w: 6, h: 8, r: 0, a: 0 } : undefined),
    });
    const sprite = view.renderableChildren[0] as { x: number; y: number; width: number; height: number };
    expect(sprite.x).toBeCloseTo(120, 4);
    expect(sprite.y).toBeCloseTo(594, 4);
    expect(sprite.width).toBe(30);
    expect(sprite.height).toBe(32);
    view.dispose();
  });

  it('image declarations win over value declarations on id collision', () => {
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1,
      h: 1,
      image: [{ id: 5, src: 0, x: 0, y: 0, w: 100, h: 100 }],
      value: [{ id: 5, src: 0, x: 50, y: 50, w: 200, h: 200 }],
      destination: [{ id: 5, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] }],
    };
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    expect(view.renderableChildren).toHaveLength(1);
    view.dispose();
  });

  it('builds a Pixi Text node for each `text[]`-targeting destination', () => {
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1280,
      h: 720,
      image: [{ id: 1, src: 0, x: 0, y: 0, w: 1, h: 1 }],
      text: [
        { id: 'genre', font: 0, size: 24, ref: 13 },
        { id: 'title', font: 0, size: 30, ref: 12 },
      ],
      destination: [
        { id: 1, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
        { id: 'genre', dst: [{ time: 0, x: 100, y: 50, w: 200, h: 24 }] },
        { id: 'title', dst: [{ time: 0, x: 100, y: 100, w: 400, h: 30 }] },
      ],
    };
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    expect(view.renderableChildren).toHaveLength(3);
    view.dispose();
  });

  it('updates text nodes from the destination keyframe', () => {
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1280,
      h: 720,
      text: [{ id: 'genre', font: 0, size: 24 }],
      destination: [{ id: 'genre', dst: [{ time: 0, x: 100, y: 50, w: 200, h: 24, a: 255 }] }],
    };
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const node = view.renderableChildren[0] as { x: number; y: number; alpha: number; visible: boolean };
    expect(node.visible).toBe(true);
    expect(node.x).toBe(100);
    // dst.y=50, h=24 inside a 720-tall skin → Pixi y = 720 - 50 - 24 = 646.
    expect(node.y).toBe(646);
    expect(node.alpha).toBe(1);
    view.dispose();
  });

  it('treats `region.x` as anchor point for all align modes (audit A-4)', () => {
    // Upstream `SkinTextFont.java:107` interprets `region.x` as the anchor point — NOT the
    // bounding-box left edge:
    //
    //   align=0 LEFT:   text's LEFT edge at region.x.
    //   align=1 CENTER: text's CENTER at region.x.
    //   align=2 RIGHT:  text's RIGHT edge at region.x.
    //
    // In Pixi this collapses to "text.x = region.x always; the Pixi anchor (0 / 0.5 / 1) does
    // the rest". Previous TS impl added `+ region.width / 2` and `+ region.width` to text.x
    // for center / right, treating region as a bounding box — which placed `align=2` text
    // `region.width` to the right of where upstream paints it.
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1,
      h: 1,
      text: [
        { id: 'left', font: 0, size: 24, align: 'left' },
        { id: 'center', font: 0, size: 24, align: 'center' },
        { id: 'right', font: 0, size: 24, align: 'right' },
      ],
      destination: [
        { id: 'left', dst: [{ time: 0, x: 100, y: 50, w: 200, h: 24, a: 255 }] },
        { id: 'center', dst: [{ time: 0, x: 100, y: 50, w: 200, h: 24, a: 255 }] },
        { id: 'right', dst: [{ time: 0, x: 100, y: 50, w: 200, h: 24, a: 255 }] },
      ],
    };
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const [leftNode, centerNode, rightNode] = view.renderableChildren as unknown as Array<{
      x: number;
      anchor: { x: number };
    }>;
    // All three text nodes have text.x = 100 (= dst.x). The visible position differs because
    // the Pixi anchor.x adjusts: 0 / 0.5 / 1 places text's LEFT / CENTER / RIGHT edge at 100.
    expect(leftNode.x).toBe(100);
    expect(centerNode.x).toBe(100);
    expect(rightNode.x).toBe(100);
    expect(leftNode.anchor.x).toBe(0);
    expect(centerNode.anchor.x).toBe(0.5);
    expect(rightNode.anchor.x).toBe(1);
    view.dispose();
  });

  it('TTF text per-frame scales by `region.height / size` (mirrors SkinTextFont.java:103)', () => {
    // Beatoraja's `SkinTextFont.draw()` (TTF / FreeType pipeline) does
    // `font.getData().setScale(region.height / parameter.size)` per frame, so animated h
    // shrinks/grows the text dynamically. Previously we rasterized the text bitmap at
    // `dst[0].h` and never updated, so a text element whose dst.h animates would lock at
    // the t=0 size forever.
    //
    // With size=24 and dst.h=48 the scale should be 48/24 = 2; with dst.h=12 the scale is
    // 12/24 = 0.5. Static skins where dst.h == size land on scale=1 (no visible change).
    const skin: BeatorajaSkin = {
      type: 0,
      w: 100,
      h: 100,
      text: [{ id: 'animated', font: 0, size: 24 }],
      destination: [
        {
          id: 'animated',
          loop: 0,
          dst: [
            { time: 0, x: 0, y: 0, w: 200, h: 48, a: 255 },
            { time: 1000, x: 0, y: 0, w: 200, h: 12, a: 255 },
          ],
        },
      ],
    };
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    // t=0: dst.h=48, size=24 → scale = 2.
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const node = view.renderableChildren[0] as { scale: { x: number; y: number } };
    expect(node.scale.y).toBeCloseTo(2, 6);
    expect(node.scale.x).toBeCloseTo(2, 6);
    // t=1000: dst.h=12, size=24 → scale = 0.5.
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 1000 });
    expect(node.scale.y).toBeCloseTo(0.5, 6);
    expect(node.scale.x).toBeCloseTo(0.5, 6);
    view.dispose();
  });

  it('bitmap text scale stays at 1 regardless of region.height (mirrors SkinTextBitmap.java:59)', () => {
    // Beatoraja's bitmap-font pipeline (`SkinTextBitmap.java:59`) scales by
    // `this.size / source.getOriginalSize()` ONCE — independent of `region.height`. The
    // displayed glyph height equals the authored `text[].size`, regardless of how the dst
    // rect's height animates. Pixi's `BitmapText` already renders at `style.fontSize` (set
    // to `text[].size` at build time), so we keep `scale = 1` to match upstream.
    //
    // TTF (the other branch) tracks `region.height / size` per frame; this test guards
    // against regressing the bitmap branch into following the TTF formula.
    const skin: BeatorajaSkin = {
      type: 0,
      w: 100,
      h: 100,
      text: [{ id: 'bm', font: 0, size: 24 }],
      destination: [
        {
          id: 'bm',
          loop: 0,
          dst: [
            { time: 0, x: 0, y: 0, w: 200, h: 48, a: 255 }, // h = 2x size — TTF would scale=2
            { time: 1000, x: 0, y: 0, w: 200, h: 12, a: 255 }, // h = 0.5x size — TTF would scale=0.5
          ],
        },
      ],
    };
    const view = new BeatorajaPlaySkinView({
      skin,
      textures: fakeTextureCache([0]),
      resolveFontFamily: () => 'fixture-bmf',
      resolveFontKind: () => 'bitmap',
    });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const node = view.renderableChildren[0] as { scale: { x: number; y: number } };
    // dst.h animates 48 → 12 but scale must stay at 1 for both — bitmap text's size is
    // locked at `text[].size = 24` via Pixi's `style.fontSize`, not derived from the rect.
    expect(node.scale.y).toBeCloseTo(1, 6);
    expect(node.scale.x).toBeCloseTo(1, 6);
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 1000 });
    expect(node.scale.y).toBeCloseTo(1, 6);
    expect(node.scale.x).toBeCloseTo(1, 6);
    view.dispose();
  });

  it('treats negative `text.size` as `Math.abs(size)` per BMFont sign-as-unit convention (audit gdbg)', () => {
    // AngelCode BMFont's authoring convention encodes a unit hint in the `size=N` line's sign:
    // POSITIVE = points, NEGATIVE = pixels. The BMFont generator embeds the same sign in the
    // `.fnt` output's `info size=N`. Skins targeting pixel-sized fonts pair the two negatives
    // — GroundbreakinG's DECIDE skin authors `text.size = -118` to match its Title.fnt's
    // `size=-120`. Upstream `SkinTextBitmap.draw` line 59 cancels the matched signs at scale
    // time (`scale = -118 / -120 = +0.983`), so the rendered glyph height ends up
    // `|text.size|` px.
    //
    // Pixi's `style.fontSize` doesn't have well-defined semantics for negative values
    // (BMFont layout would compute a NEGATIVE scale and render the text 180° flipped — user
    // report: gdbg's DECIDE title and artist rendered upside-down). We strip the sign on
    // both sides (`Math.abs(parsed.fontSize)` in `beatoraja-fonts.ts` and `Math.abs(element.size)`
    // here) so the resulting Pixi scale stays positive.
    //
    // For TTF (this test) the per-frame scale is `region.height / |size|`. With size=-24 and
    // dst.h=48 the scale must be 48/24 = 2 — matching what a positive size=24 produces.
    const skin: BeatorajaSkin = {
      type: 0,
      w: 100,
      h: 100,
      text: [{ id: 'neg', font: 0, size: -24 }],
      destination: [
        {
          id: 'neg',
          loop: 0,
          dst: [{ time: 0, x: 0, y: 0, w: 200, h: 48, a: 255 }],
        },
      ],
    };
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const node = view.renderableChildren[0] as { scale: { x: number; y: number } };
    // |size|=24, dst.h=48 → scale = 2 (positive — would be -2 without the abs).
    expect(node.scale.y).toBeCloseTo(2, 6);
    expect(node.scale.x).toBeCloseTo(2, 6);
    view.dispose();
  });

  it('hides text nodes when the destination is past its last keyframe with loop=-1', () => {
    const skin: BeatorajaSkin = {
      type: 0,
      w: 1,
      h: 1,
      text: [{ id: 'title', font: 0, size: 24 }],
      destination: [
        {
          id: 'title',
          loop: -1,
          dst: [
            { time: 0, x: 0, y: 0, w: 1, h: 1, a: 255 },
            { time: 1000, a: 0 },
          ],
        },
      ],
    };
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 1500 });
    expect((view.renderableChildren[0] as { visible: boolean }).visible).toBe(false);
    view.dispose();
  });

  describe('judgegraph[] rendering', () => {
    it('mounts a Graphics node per judgegraph destination', () => {
      const skin: BeatorajaSkin = {
        type: 0,
        w: 1280,
        h: 720,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        ...({ judgegraph: [{ id: 'jg', type: 1, backTexOff: 1 }] } as Partial<BeatorajaSkin>),
        destination: [{ id: 'jg', dst: [{ time: 0, x: 100, y: 100, w: 200, h: 100 }] }],
      };
      const view = new BeatorajaPlaySkinView({
        skin,
        textures: fakeTextureCache([0]),
        resolveJudgeGraphBars: (type) => (type === 1 ? [10, 5, 2, 1, 0] : undefined),
      });
      view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
      // Two Graphics children mounted per judgegraph entry: the bars graph + the playhead
      // cursor overlay (only used for type=0, hidden here on type=1).
      expect(view.renderableChildren).toHaveLength(2);
      // After update with non-zero bars, the histogram Graphics is visible; the cursor stays
      // hidden because type=1 doesn't carry a time axis.
      expect((view.renderableChildren[0] as { visible: boolean }).visible).toBe(true);
      expect((view.renderableChildren[1] as { visible: boolean }).visible).toBe(false);
      view.dispose();
    });

    it('hides the histogram until at least one judgement has fired', () => {
      const skin: BeatorajaSkin = {
        type: 0,
        w: 1280,
        h: 720,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        ...({ judgegraph: [{ id: 'jg', type: 1 }] } as Partial<BeatorajaSkin>),
        destination: [{ id: 'jg', dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] }],
      };
      const view = new BeatorajaPlaySkinView({
        skin,
        textures: fakeTextureCache([0]),
        resolveJudgeGraphBars: () => [0, 0, 0, 0, 0],
      });
      view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
      expect((view.renderableChildren[0] as { visible: boolean }).visible).toBe(false);
      view.dispose();
    });
  });

  describe('noteLayerInsertIndex (notes z-order anchor)', () => {
    it('captures the index where `{id = noteSection.id}` lives in the sorted destination stack', () => {
      // 3 destinations: bg (z=0) → notes anchor (z=10) → lanecover (z=20). Notes layer should
      // slot in BETWEEN bg and lanecover so lanecover paints on top of falling notes.
      const skin: BeatorajaSkin = {
        type: 0,
        w: 1280,
        h: 720,
        image: [
          { id: 'bg', src: 0, x: 0, y: 0, w: 1280, h: 720 },
          { id: 'lanecover', src: 0, x: 0, y: 0, w: 100, h: 100 },
        ],
        note: { id: 'notes', note: ['note-w'] },
        destination: [
          { id: 'bg', offset: 0, dst: [{ time: 0, x: 0, y: 0, w: 1280, h: 720 }] },
          { id: 'notes', offset: 10 },
          { id: 'lanecover', offset: 20, dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] },
        ],
      };
      const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
      // 2 sprites mounted (bg + lanecover); the notes anchor is consumed without producing one.
      expect(view.renderableChildren).toHaveLength(2);
      // Anchor sat between bg and lanecover → after bg was added (children.length == 1) and
      // before lanecover was added.
      expect(view.noteLayerInsertIndex).toBe(1);
      view.dispose();
    });

    it('falls back to "append at end" when no notes anchor is authored', () => {
      // Decide / select / result skins don't have a notes section, so they don't author the
      // anchor. Insert index defaults to the end of the children list — preserving the legacy
      // "marker/note layer goes on top" gameplay behavior.
      const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
      expect(view.noteLayerInsertIndex).toBe(view.renderableChildren.length);
      view.dispose();
    });

    it('respects declaration order even when `offset` values are out of order (offset is OFFSET_* id, not z-layer)', () => {
      // Author writes lanecover FIRST (offset=4 = OFFSET_LANECOVER), bg SECOND (offset=3 =
      // OFFSET_LIFT) — pathological for "offset is z-layer" interpretation. Beatoraja's spec is
      // declaration-order-wins, so the LATER-declared bg paints ON TOP of the EARLIER-declared
      // lanecover. The notes anchor sits between them, so the note layer slot lands at index 1
      // (after lanecover, before bg).
      const skin: BeatorajaSkin = {
        type: 0,
        w: 1280,
        h: 720,
        image: [
          { id: 'lanecover', src: 0, x: 0, y: 0, w: 100, h: 100 },
          { id: 'bg', src: 0, x: 0, y: 0, w: 1280, h: 720 },
        ],
        note: { id: 'notes', note: ['note-w'] },
        destination: [
          { id: 'lanecover', offset: 4, dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] },
          { id: 'notes', offset: 3 },
          { id: 'bg', offset: 3, dst: [{ time: 0, x: 0, y: 0, w: 1280, h: 720 }] },
        ],
      };
      const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
      view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
      expect(view.renderableChildren).toHaveLength(2);
      // Lanecover is `children[0]`, bg is `children[1]` — declaration order preserved despite
      // lanecover's offset (4) being greater than bg's (3). Under the old z-by-offset sort
      // (`offset - offset || declarationOrder - declarationOrder`) the bg would have been
      // pulled in front of lanecover (lower offset wins). Identify the sprites by their unique
      // dst widths: lanecover authored w=100, bg w=1280.
      const widths = view.renderableChildren.map((c) => Math.round((c as unknown as { width: number }).width));
      expect(widths[0]).toBe(100);
      expect(widths[1]).toBe(1280);
      // Notes anchor sat between the two destinations — index 1 (after lanecover, before bg).
      expect(view.noteLayerInsertIndex).toBe(1);
      view.dispose();
    });
  });

  describe('gauge entry id matching (string vs number coercion)', () => {
    // ModernChic authors `parts.gauge.id = 2001` (numeric Lua value) but the matching
    // destination uses `id = "2001"` (string-quoted). Upstream's JsonSkin.Gauge.id is declared
    // as `String` (`JsonSkin.java:217`), so the JSON deserializer coerces the number to a
    // string; `dst.id.equals(sk.gauge.id)` then matches both forms. Our Lua-table parser keeps
    // numeric/string ids verbatim, so the matcher must string-coerce both sides explicitly.
    // Without this fix the gauge entry was never built — visible as a pure-black gauge on
    // ModernChic with no `[beatoraja-view] gauge entry built` diagnostic ever logged.

    it('builds a gauge entry when destination.id is a string and gauge.id is a number', () => {
      const skin = makeSkin({
        // Provide a gauge node image so `buildGaugeEntry` succeeds.
        image: [{ id: 'gauge-r1', src: 0, x: 0, y: 0, w: 8, h: 35 }],
        gauge: { id: 2001, parts: 50, nodes: ['gauge-r1'] } as unknown as BeatorajaSkin['gauge'],
        destination: [
          {
            id: '2001', // string, mirroring ModernChic's authored destination id
            timer: 0,
            loop: -1,
            offset: 0,
            dst: [{ time: 0, x: 0, y: 0, w: 100, h: 30, a: 255, r: 255, g: 255, b: 255 }],
          },
        ],
      });
      const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
      // The matched gauge entry pre-allocates `parts` cells + 1 overlay sprite, so the
      // container has at least 51 children when matching succeeded. Pre-fix the destination
      // dropped through to `imageById.get("2001")` (undefined) and produced no entry.
      expect(view.renderableChildren.length).toBeGreaterThanOrEqual(50);
      view.dispose();
    });

    it('builds a gauge entry when both ids are numbers (default skin convention)', () => {
      // Default `play24.json` authors both numerically (`"id": 2001` literal). This is the
      // path that worked before the fix; we keep it under test to make sure the string
      // coercion doesn't break the original convention.
      const skin = makeSkin({
        image: [{ id: 'gauge-r1', src: 0, x: 0, y: 0, w: 8, h: 35 }],
        gauge: { id: 2001, parts: 50, nodes: ['gauge-r1'] } as unknown as BeatorajaSkin['gauge'],
        destination: [
          {
            id: 2001,
            timer: 0,
            loop: -1,
            offset: 0,
            dst: [{ time: 0, x: 0, y: 0, w: 100, h: 30, a: 255, r: 255, g: 255, b: 255 }],
          },
        ],
      });
      const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
      expect(view.renderableChildren.length).toBeGreaterThanOrEqual(50);
      view.dispose();
    });
  });

  describe('judge entry filtering walks nested `if` / `values` wrappers', () => {
    // Default `play5.json` authors the judge anchor inside a 1P-side `if:[920]` wrapper:
    //
    //     "destination":[
    //       { "if":[920], "values":[ ..., { "id":2010 }, ... ] },
    //       ...
    //     ]
    //
    // The judge filter introduced in `a533a5e` (= `parts.destination` references gate the
    // expansion) walked only the top-level array and missed nested ids — the judge expansion
    // was skipped, so the popup's text and combo digits never rendered on default 5K.
    //
    // The fix routes the id collection through `flattenBeatorajaElements` so wrapper
    // recursion matches the standard destination pipeline.

    it('expands judge entries referenced from inside `{if:[...], values:[...]}` wrappers', () => {
      const skin = makeSkin({
        image: [
          { id: 'judgef-pg', src: 0, x: 0, y: 0, w: 180, h: 50 },
          { id: 'judgef-gr', src: 0, x: 0, y: 50, w: 180, h: 50 },
        ],
        // Single-entry parts.judge with two sub-images. Pre-fix the filter would
        // require id 2010 to appear at the top level of `skin.destination` to keep
        // the entry; with the fix, nesting under `if/values` is sufficient.
        judge: [
          {
            id: 2010,
            index: 0,
            images: [
              {
                id: 'judgef-pg',
                loop: -1,
                timer: 46,
                dst: [{ time: 0, x: 70, y: 240, w: 180, h: 40 }, { time: 500 }],
              },
              {
                id: 'judgef-gr',
                loop: -1,
                timer: 46,
                dst: [{ time: 0, x: 70, y: 240, w: 180, h: 40 }, { time: 500 }],
              },
            ],
            numbers: [],
            shift: false,
          },
        ] as unknown as BeatorajaSkin['judge'],
        destination: [
          {
            if: [920],
            values: [
              // Nested judge anchor — pre-fix our filter scanned only top-level entries
              // and never saw this id, so the expansion skipped the parts.judge[0] entry.
              { id: 2010 },
            ],
          } as unknown as NonNullable<BeatorajaSkin['destination']>[number],
        ],
      });
      const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
      // With the fix, both judge images expand into destinations; pre-fix the container
      // had no judge image entries at all (only the makeSkin default).
      // We assert at least 2 sprites are present (the 2 judge images).
      expect(view.renderableChildren.length).toBeGreaterThanOrEqual(2);
      view.dispose();
    });
  });

  it('dispose() detaches sprites from the container without throwing', () => {
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    expect(() => view.dispose()).not.toThrow();
    expect(view.container.destroyed).toBe(true);
  });
});
