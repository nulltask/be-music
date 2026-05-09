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
    expect(view.container.children).toHaveLength(1);
    expect(view.width).toBe(1280);
    expect(view.height).toBe(720);
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
    const children = view.container.children;
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
    expect(view.container.children).toHaveLength(1);
    view.dispose();
  });

  it('updates sprite props from the keyframe sample (Y-flipped from libGDX Y-UP into Pixi Y-DOWN)', () => {
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const sprite = view.container.children[0] as { x: number; y: number; visible: boolean; alpha: number };
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
    const sprite = view.container.children[0] as { visible: boolean };
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
    expect((view.container.children[0] as { visible: boolean }).visible).toBe(false);
    view.update({ activeOps: new Set([920]), getTimerStart: () => 0, nowMs: 0 });
    expect((view.container.children[0] as { visible: boolean }).visible).toBe(true);
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
    expect((view.container.children[0] as { visible: boolean }).visible).toBe(false);
    gauge = 80;
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    expect((view.container.children[0] as { visible: boolean }).visible).toBe(true);
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
    expect(view.container.children).toHaveLength(5);
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
    const sprites = view.container.children;
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
    expect(view.container.children).toHaveLength(1);
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
    expect(view.container.children).toHaveLength(3);
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
    const node = view.container.children[0] as { x: number; y: number; alpha: number; visible: boolean };
    expect(node.visible).toBe(true);
    expect(node.x).toBe(100);
    // dst.y=50, h=24 inside a 720-tall skin → Pixi y = 720 - 50 - 24 = 646.
    expect(node.y).toBe(646);
    expect(node.alpha).toBe(1);
    view.dispose();
  });

  it('shifts the text x by destination width for center / right alignment', () => {
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
    const [leftNode, centerNode, rightNode] = view.container.children as Array<{ x: number }>;
    expect(leftNode.x).toBe(100);
    expect(centerNode.x).toBe(200); // 100 + 200/2
    expect(rightNode.x).toBe(300); // 100 + 200
    view.dispose();
  });

  it('per-frame scales text uniformly to match dst rect height (mirrors upstream font.getData().setScale)', () => {
    // Beatoraja's `SkinTextFont.draw()` does `font.getData().setScale(region.height /
    // parameter.size)` per frame, so animated h shrinks/grows the text dynamically. Previously
    // we rasterized the text bitmap at `dst[0].h` and never updated, so a text element whose
    // dst.h animates would lock at the t=0 size forever.
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
    const node = view.container.children[0] as { scale: { x: number; y: number } };
    expect(node.scale.y).toBeCloseTo(2, 6);
    expect(node.scale.x).toBeCloseTo(2, 6);
    // t=1000: dst.h=12, size=24 → scale = 0.5.
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 1000 });
    expect(node.scale.y).toBeCloseTo(0.5, 6);
    expect(node.scale.x).toBeCloseTo(0.5, 6);
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
    expect((view.container.children[0] as { visible: boolean }).visible).toBe(false);
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
      expect(view.container.children).toHaveLength(2);
      // After update with non-zero bars, the histogram Graphics is visible; the cursor stays
      // hidden because type=1 doesn't carry a time axis.
      expect((view.container.children[0] as { visible: boolean }).visible).toBe(true);
      expect((view.container.children[1] as { visible: boolean }).visible).toBe(false);
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
      expect((view.container.children[0] as { visible: boolean }).visible).toBe(false);
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
      expect(view.container.children).toHaveLength(2);
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
      expect(view.noteLayerInsertIndex).toBe(view.container.children.length);
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
      expect(view.container.children).toHaveLength(2);
      // Lanecover is `children[0]`, bg is `children[1]` — declaration order preserved despite
      // lanecover's offset (4) being greater than bg's (3). Under the old z-by-offset sort
      // (`offset - offset || declarationOrder - declarationOrder`) the bg would have been
      // pulled in front of lanecover (lower offset wins). Identify the sprites by their unique
      // dst widths: lanecover authored w=100, bg w=1280.
      const widths = view.container.children.map((c) => Math.round((c as unknown as { width: number }).width));
      expect(widths[0]).toBe(100);
      expect(widths[1]).toBe(1280);
      // Notes anchor sat between the two destinations — index 1 (after lanecover, before bg).
      expect(view.noteLayerInsertIndex).toBe(1);
      view.dispose();
    });
  });

  it('dispose() detaches sprites from the container without throwing', () => {
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    expect(() => view.dispose()).not.toThrow();
    expect(view.container.destroyed).toBe(true);
  });
});
