import { Rectangle, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  evaluateBeatorajaLuaSkin,
  isBeatorajaLuaFunctionValue,
  normalizeBeatorajaDestinations,
  type BeatorajaLuaFunctionValue,
} from '@be-music/beatoraja-skin';
import {
  applyBeatorajaStretchRect,
  BEATORAJA_STRETCH,
  blendCodeToPixi,
  createCroppedBeatorajaTexture,
  destinationToSpriteProps,
  flipRectToPixi,
} from './render.ts';

// Use a 1000-tall canvas so Y-flipped values are easy to eyeball: a `dst.y = 0, h = 50` rect
// lands at Pixi y = 1000 - 0 - 50 = 950 (anchored to the canvas bottom edge in screen coords).
const TEST_CANVAS_HEIGHT = 1000;

interface CtxOverrides {
  activeOps?: ReadonlySet<number>;
  getTimerStart?: (timerId: number) => number | undefined;
  nowMs?: number;
}

const ctx = (overrides: CtxOverrides = {}) => ({
  activeOps: overrides.activeOps ?? new Set<number>(),
  getTimerStart: overrides.getTimerStart ?? (() => 0),
  nowMs: overrides.nowMs ?? 0,
});

const groupOf = (overrides: Record<string, unknown> = {}) => {
  const [g] = normalizeBeatorajaDestinations([
    {
      id: 'demo',
      timer: 0,
      loop: -1,
      dst: [
        { time: 0, x: 0, y: 0, w: 100, h: 50, r: 255, g: 255, b: 255, a: 255 },
        { time: 1000, x: 100, a: 0 },
      ],
      ...overrides,
    },
  ]);
  return g;
};

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function texture(width = 64, height = 64): Texture {
  return new Texture({
    source: Texture.EMPTY.source,
    frame: new Rectangle(0, 0, width, height),
  });
}

function luaFunction(source: string): BeatorajaLuaFunctionValue {
  const result = evaluateBeatorajaLuaSkin({
    entry: enc(`return { fn = ${source} }`),
    modules: [],
    skinConfig: {},
  });
  if (!result.ok) throw new Error(result.error.message);
  const value = result.value as Record<string, unknown>;
  if (!isBeatorajaLuaFunctionValue(value.fn)) throw new Error('expected Lua function');
  return value.fn;
}

describe('destinationToSpriteProps', () => {
  it('returns the head keyframe at scene start, Y-flipped from libGDX Y-UP into Pixi Y-DOWN', () => {
    const props = destinationToSpriteProps(groupOf(), ctx({ nowMs: 0 }), TEST_CANVAS_HEIGHT);
    expect(props.visible).toBe(true);
    expect(props.x).toBe(0);
    // dst.y=0, h=50 with Y-UP origin at canvas bottom → Pixi top-left y = 1000 - 0 - 50 = 950.
    expect(props.y).toBe(950);
    expect(props.width).toBe(100);
    expect(props.height).toBe(50);
    expect(props.alpha).toBe(1);
  });

  it('linearly interpolates between adjacent keyframes (X axis unchanged by the flip)', () => {
    const props = destinationToSpriteProps(groupOf(), ctx({ nowMs: 500 }), TEST_CANVAS_HEIGHT);
    expect(props.x).toBe(50);
    expect(props.alpha).toBeCloseTo(0.5, 5);
  });

  it('Y-flips dst rects against canvasHeight (libGDX Y-UP → Pixi Y-DOWN)', () => {
    // dst.y=720 with h=580 inside a 720-tall canvas: Pixi y = 720 - 720 - 580 = -580 (off-screen
    // above). This is the lanecover home position in beatoraja's reference theme — the cover
    // sits ABOVE the canvas in Y-DOWN so the slider can drag it down into view.
    const g = groupOf({ dst: [{ time: 0, x: 0, y: 720, w: 1280, h: 580, a: 255 }] });
    const props = destinationToSpriteProps(g, ctx({ nowMs: 0 }), 720);
    expect(props.y).toBe(-580);
    expect(props.height).toBe(580);
  });

  it('hides past the last keyframe when loop=-1 (default)', () => {
    const props = destinationToSpriteProps(groupOf(), ctx({ nowMs: 1500 }), TEST_CANVAS_HEIGHT);
    expect(props.visible).toBe(false);
    expect(props.alpha).toBe(0);
  });

  it('hides when alpha hits zero exactly', () => {
    const props = destinationToSpriteProps(groupOf(), ctx({ nowMs: 1000 }), TEST_CANVAS_HEIGHT);
    expect(props.visible).toBe(false);
  });

  it('negates the authored angle to convert libGDX CCW-positive into Pixi CW-positive (audit 1.8)', () => {
    // libGDX rotates counter-clockwise on positive angles (Y-UP convention); Pixi rotates
    // clockwise on positive angles (Y-DOWN). The Y-flip on the position alone doesn't
    // re-handle the rotation handedness — we have to negate the angle so authored "CCW 30°"
    // ends up as "CCW 30°" on screen, not "CW 30°".
    const g = groupOf({ dst: [{ time: 0, x: 0, y: 0, w: 100, h: 50, a: 255, angle: 30 }] });
    const props = destinationToSpriteProps(g, ctx({ nowMs: 0 }), TEST_CANVAS_HEIGHT);
    expect(props.angle).toBe(-30);
  });

  it('negates negative angles too — full handedness flip', () => {
    const g = groupOf({ dst: [{ time: 0, x: 0, y: 0, w: 100, h: 50, a: 255, angle: -45 }] });
    const props = destinationToSpriteProps(g, ctx({ nowMs: 0 }), TEST_CANVAS_HEIGHT);
    expect(props.angle).toBe(45);
  });

  it('hides when ifCodes are unsatisfied', () => {
    const props = destinationToSpriteProps(
      groupOf({ if: [920], values: [{ id: 'demo', timer: 0, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] }] }),
      ctx({ activeOps: new Set([900]) }),
      TEST_CANVAS_HEIGHT,
    );
    expect(props.visible).toBe(false);
  });

  it('hides when group op codes are unsatisfied', () => {
    const g = groupOf({ op: [901] });
    const props = destinationToSpriteProps(g, ctx({ activeOps: new Set() }), TEST_CANVAS_HEIGHT);
    expect(props.visible).toBe(false);
  });

  it('honors runtime Lua draw functions before op gates', () => {
    const draw = luaFunction('function() return true end');
    try {
      const g = groupOf({ op: [901], draw });
      const props = destinationToSpriteProps(g, ctx({ activeOps: new Set(), nowMs: 0 }), TEST_CANVAS_HEIGHT);
      expect(props.visible).toBe(true);
    } finally {
      draw.dispose();
    }
  });

  it('hides when a runtime Lua draw function returns false', () => {
    const draw = luaFunction('function() return false end');
    try {
      const g = groupOf({ draw });
      const props = destinationToSpriteProps(g, ctx({ activeOps: new Set([901]), nowMs: 0 }), TEST_CANVAS_HEIGHT);
      expect(props.visible).toBe(false);
    } finally {
      draw.dispose();
    }
  });

  it('hides when the referenced timer has not fired yet', () => {
    const g = groupOf({ timer: 51, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] });
    const props = destinationToSpriteProps(g, ctx({ getTimerStart: () => undefined, nowMs: 5000 }), TEST_CANVAS_HEIGHT);
    expect(props.visible).toBe(false);
  });

  it('uses runtime Lua timer functions as microsecond start times', () => {
    const timer = luaFunction('function() return 500000 end');
    try {
      const g = groupOf({ timer });
      const props = destinationToSpriteProps(
        g,
        ctx({ getTimerStart: () => undefined, nowMs: 750 }),
        TEST_CANVAS_HEIGHT,
      );
      expect(props.visible).toBe(true);
      expect(props.x).toBe(25);
    } finally {
      timer.dispose();
    }
  });

  it('respects negated op codes', () => {
    const g = groupOf({ op: [-905] });
    expect(destinationToSpriteProps(g, ctx({ activeOps: new Set() }), TEST_CANVAS_HEIGHT).visible).toBe(true);
    expect(destinationToSpriteProps(g, ctx({ activeOps: new Set([905]) }), TEST_CANVAS_HEIGHT).visible).toBe(false);
  });

  it('packs RGB tint as 0xRRGGBB', () => {
    const props = destinationToSpriteProps(
      groupOf({
        dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1, r: 64, g: 192, b: 192 }, { time: 1000 }],
      }),
      ctx({ nowMs: 0 }),
      TEST_CANVAS_HEIGHT,
    );
    expect(props.tint).toBe((64 << 16) | (192 << 8) | 192);
  });

  it('applies the singular `offset` field as a user-adjustable shift (treated as offsets[offset])', () => {
    // Reference theme uses `"offset":3` (= OFFSET_LIFT) on lane chrome so the lift slider
    // shifts the rect. Until this fix the singular form was parsed but never resolved against
    // the offset table — only the plural `offsets[]` triggered the resolver.
    const g = groupOf({
      offset: 3,
      dst: [{ time: 0, x: 50, y: 100, w: 100, h: 50, a: 255 }],
    });
    const lift = { x: 0, y: -200, w: 0, h: 0, r: 0, a: 255 };
    const props = destinationToSpriteProps(
      g,
      {
        ...ctx({ nowMs: 0 }),
        resolveOffset: (id) => (id === 3 ? lift : undefined),
      },
      TEST_CANVAS_HEIGHT,
    );
    expect(props.visible).toBe(true);
    // dst.y=100 + offset.y=-200 → -100 in Y-UP space; Pixi y = 1000 - (-100) - 50 = 1050.
    expect(props.y).toBe(1050);
    expect(props.x).toBe(50);
  });

  it('handles ModernChic black-overlay pattern: keyframe.a=0 + offset.a=+192 → alpha 0.75', () => {
    // ModernChic stages a transparent black image (`MAIN.IMAGE.BLACK` with `a=0` in the
    // keyframe) and uses an `offset.a` slider to dim the playfield by adding alpha. Under
    // the previous multiplicative impl, the keyframe alpha 0 multiplied any offset.a to 0,
    // so the dimmer was inert. With additive math: keyframe.a/255 + offset.a/255 = 0 + 0.75
    // = 0.75. Reproduces the ModernChic background.lua / lane.lua / info.lua pattern.
    const g = groupOf({
      offset: 3,
      dst: [{ time: 0, x: 0, y: 0, w: 100, h: 50, a: 0 }], // transparent black overlay
    });
    const props = destinationToSpriteProps(
      g,
      {
        ...ctx({ nowMs: 0 }),
        // Brighten by ~75% — typical "darkness" slider value the ModernChic config exposes.
        resolveOffset: (id) => (id === 3 ? { x: 0, y: 0, w: 0, h: 0, r: 0, a: 192 } : undefined),
      },
      TEST_CANVAS_HEIGHT,
    );
    expect(props.alpha).toBeCloseTo(0.752, 2);
    expect(props.visible).toBe(true);
  });

  it('adds offset.a to keyframe.a (matches SkinObject.prepareColor additive math)', () => {
    // Beatoraja's `prepareColor` does `color.a = clamp(color.a + off.a / 255)`. A skin
    // authoring `offset.a = -64` to dim an element should subtract ~25% from the keyframe
    // alpha, not multiply by 0.25 (which the previous impl did, causing dimming offsets to
    // collapse elements to near-invisible).
    const g = groupOf({
      offset: 3,
      dst: [{ time: 0, x: 0, y: 0, w: 100, h: 50, a: 255 }], // keyframe alpha = 1.0
    });
    const dimProps = destinationToSpriteProps(
      g,
      {
        ...ctx({ nowMs: 0 }),
        // -64 = additive -0.25 delta. 1.0 + (-0.25) = 0.75.
        resolveOffset: (id) => (id === 3 ? { x: 0, y: 0, w: 0, h: 0, r: 0, a: -64 } : undefined),
      },
      TEST_CANVAS_HEIGHT,
    );
    expect(dimProps.alpha).toBeCloseTo(0.749, 2);
    // Default offset.a = 0 leaves the keyframe alpha untouched (additive no-op).
    const noopProps = destinationToSpriteProps(
      g,
      {
        ...ctx({ nowMs: 0 }),
        resolveOffset: (id) => (id === 3 ? { x: 0, y: 0, w: 0, h: 0, r: 0, a: 0 } : undefined),
      },
      TEST_CANVAS_HEIGHT,
    );
    expect(noopProps.alpha).toBe(1);
  });

  it('center-anchors the rect when `offset.w/h` are non-zero (matches SkinObject.prepareDraw)', () => {
    // Beatoraja's `prepareDraw` does `region.x += off.x - off.w/2; width += off.w` — the rect
    // grows around its CENTER, not the top-left corner. ModernChic / GdbG cover slabs depend on
    // this for "breathing" expansions where the user's lift slider widens the cover without
    // dragging it off the lane edge. Verify a pure +w expansion doesn't shift the visible center.
    const g = groupOf({
      offset: 3,
      // 100x50 rect centered at (50, 25) in libGDX-Y-UP space (= visual center on canvas).
      dst: [{ time: 0, x: 0, y: 0, w: 100, h: 50, a: 255 }],
    });
    // Offset adds 40px to width and 20px to height, no x/y translation. With centering:
    //   x' = 0 + 0 - 40/2 = -20
    //   y' = 0 + 0 - 20/2 = -10  (still in libGDX-Y-UP)
    //   width' = 100 + 40 = 140
    //   height' = 50 + 20 = 70
    //   center of rect' = (-20 + 70, -10 + 35) = (50, 25)  ← unchanged
    const props = destinationToSpriteProps(
      g,
      {
        ...ctx({ nowMs: 0 }),
        resolveOffset: (id) => (id === 3 ? { x: 0, y: 0, w: 40, h: 20, r: 0, a: 255 } : undefined),
      },
      TEST_CANVAS_HEIGHT,
    );
    expect(props.x).toBe(-20);
    expect(props.width).toBe(140);
    // libGDX-Y-bottom = -10; Pixi-Y-top = 1000 - (-10) - 70 = 940.
    expect(props.y).toBe(940);
    expect(props.height).toBe(70);
  });

  it('honors `relative: true` to skip the centering shift (judgement-digit numbers)', () => {
    // beatoraja's `JsonPlaySkinObjectLoader` calls `setRelative(true)` on per-digit numbers in
    // the judgement-detail value — those digits are positioned at fixed slot offsets and must
    // NOT re-center when the parent number's offset.w/h grows. With `relative=true` the rect
    // grows from the top-left corner instead.
    const g = groupOf({
      offset: 3,
      relative: true,
      dst: [{ time: 0, x: 0, y: 0, w: 100, h: 50, a: 255 }],
    });
    const props = destinationToSpriteProps(
      g,
      {
        ...ctx({ nowMs: 0 }),
        resolveOffset: (id) => (id === 3 ? { x: 0, y: 0, w: 40, h: 20, r: 0, a: 255 } : undefined),
      },
      TEST_CANVAS_HEIGHT,
    );
    // No centering shift. x = 0, width = 140. Pixi-Y-top = 1000 - 0 - 70 = 930.
    expect(props.x).toBe(0);
    expect(props.width).toBe(140);
    expect(props.y).toBe(930);
    expect(props.height).toBe(70);
  });

  it('combines the singular `offset` and plural `offsets[]` additively', () => {
    const g = groupOf({
      offset: 3,
      offsets: [10],
      dst: [{ time: 0, x: 0, y: 0, w: 100, h: 50, a: 255 }],
    });
    const props = destinationToSpriteProps(
      g,
      {
        ...ctx({ nowMs: 0 }),
        // Lift shifts y by 100, "ALL" shift shifts x by 25 — both apply.
        resolveOffset: (id) => {
          if (id === 3) return { x: 0, y: 100, w: 0, h: 0, r: 0, a: 255 };
          if (id === 10) return { x: 25, y: 0, w: 0, h: 0, r: 0, a: 255 };
          return undefined;
        },
      },
      TEST_CANVAS_HEIGHT,
    );
    expect(props.x).toBe(25);
    // y=0 + 100 → 100 in Y-UP; Pixi = 1000 - 100 - 50 = 850.
    expect(props.y).toBe(850);
  });

  it('normalizes negative `w` to positive width with adjusted x and surfaces mirrorX', () => {
    // Reference play7 skin uses `w = -lanes_w` on the lane background when scratch is on the
    // right — the rect is authored at the RIGHT edge with negative width, meaning it spans
    // LEFT from `x`. Beatoraja's libGDX renderer mirrors the texture in that direction.
    // The renderer should normalize the geometry to positive width with the x at the actual
    // left edge, and surface `mirrorX = true` so the consumer can flip the texture via scale.
    const g = groupOf({
      dst: [{ time: 0, x: 410, y: 0, w: -390, h: 580, a: 255 }],
    });
    const props = destinationToSpriteProps(g, ctx({ nowMs: 0 }), 720);
    expect(props.visible).toBe(true);
    // Authored x=410 with w=-390 → actual left edge at 410 + (-390) = 20.
    expect(props.x).toBe(20);
    expect(props.width).toBe(390);
    expect(props.mirrorX).toBe(true);
    expect(props.mirrorY).toBe(false);
    // y=0 (libGDX bottom edge of rect) with h=580: Pixi y = 720 - 0 - 580 = 140.
    expect(props.y).toBe(140);
    expect(props.height).toBe(580);
  });

  it('does not flag mirrorX for normal positive-width destinations', () => {
    const g = groupOf({ dst: [{ time: 0, x: 50, y: 100, w: 100, h: 50, a: 255 }] });
    const props = destinationToSpriteProps(g, ctx({ nowMs: 0 }), TEST_CANVAS_HEIGHT);
    expect(props.mirrorX).toBe(false);
    expect(props.mirrorY).toBe(false);
  });

  it('treats `offset === 0` as the no-offset sentinel (does not resolve id 0)', () => {
    let lookups = 0;
    const g = groupOf({ offset: 0, dst: [{ time: 0, x: 0, y: 0, w: 100, h: 50, a: 255 }] });
    destinationToSpriteProps(
      g,
      {
        ...ctx({ nowMs: 0 }),
        resolveOffset: () => {
          lookups += 1;
          return undefined;
        },
      },
      TEST_CANVAS_HEIGHT,
    );
    expect(lookups).toBe(0);
  });

  describe('mouseRect hover-visibility gate (audit C-12)', () => {
    // Mirrors `SkinObject.java:513-517` — when `mouseRect != null` AND the cursor is OUTSIDE
    // the relative rect, the destination hides. Coords are in libGDX Y-UP space relative to
    // `region.x / region.y` (= the destination's bottom-left after offset).
    //
    // Test fixture: dst rect at libGDX (100, 200), size (300, 100). canvasH = 1000.
    //   - Pixi top-left of rect = (100, canvasH - 200 - 100) = (100, 700).
    //   - Pixi bottom-right of rect = (400, 800).
    //   - mouseRect = {x: 50, y: 25, w: 100, h: 50} (libGDX, relative to region's bottom-left).
    //     In libGDX absolute coords, the rect occupies [150, 250] × [225, 275].
    //     In Pixi screen coords, the rect occupies [150, 250] × [725, 775].
    const fixture = () =>
      normalizeBeatorajaDestinations([
        {
          id: 'tooltip',
          loop: 0,
          dst: [{ time: 0, x: 100, y: 200, w: 300, h: 100, a: 255 }],
          mouseRect: { x: 50, y: 25, w: 100, h: 50 },
        },
      ])[0]!;

    it('paints when the cursor is INSIDE the libGDX-relative mouseRect', () => {
      const props = destinationToSpriteProps(
        fixture(),
        { ...ctx({ nowMs: 0 }), mousePosition: { x: 200, y: 750 } }, // Pixi (200, 750) — inside the rect.
        TEST_CANVAS_HEIGHT,
      );
      expect(props.visible).toBe(true);
    });

    it('hides when the cursor is OUTSIDE the libGDX-relative mouseRect', () => {
      const props = destinationToSpriteProps(
        fixture(),
        { ...ctx({ nowMs: 0 }), mousePosition: { x: 50, y: 100 } }, // Pixi (50, 100) — way outside.
        TEST_CANVAS_HEIGHT,
      );
      expect(props.visible).toBe(false);
    });

    it('paints when no mousePosition is supplied (gate is opt-in)', () => {
      // Hosts that don't track the cursor pass `mousePosition: undefined`. The gate
      // short-circuits and the destination paints unconditionally — same as upstream
      // when `mouseRect` was omitted (we have a rect but no cursor to test against).
      const props = destinationToSpriteProps(fixture(), ctx({ nowMs: 0 }), TEST_CANVAS_HEIGHT);
      expect(props.visible).toBe(true);
    });

    it('paints unconditionally when no mouseRect is authored', () => {
      const noRect = normalizeBeatorajaDestinations([
        { id: 'plain', loop: 0, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1, a: 255 }] },
      ])[0]!;
      const props = destinationToSpriteProps(
        noRect,
        { ...ctx({ nowMs: 0 }), mousePosition: { x: 9999, y: 9999 } }, // far outside any rect.
        TEST_CANVAS_HEIGHT,
      );
      expect(props.visible).toBe(true);
    });
  });
});

describe('flipRectToPixi', () => {
  it('flips the Y axis, leaves X / width / height alone', () => {
    expect(flipRectToPixi({ x: 100, y: 50, w: 200, h: 30 }, 1000)).toEqual({
      x: 100,
      y: 920,
      w: 200,
      h: 30,
    });
  });
});

describe('blendCodeToPixi', () => {
  it('maps LR2/beatoraja codes to PixiJS v8 BlendMode strings (audit 2.13)', () => {
    expect(blendCodeToPixi(0)).toBe('normal');
    expect(blendCodeToPixi(1)).toBe('normal');
    expect(blendCodeToPixi(2)).toBe('add');
    // Code 3 = beatoraja's GL_FUNC_SUBTRACT — Pixi's 'subtract' (advanced-blend-modes) matches
    // exactly. Previous mapping was 'screen' (brighten-only), the opposite operation.
    expect(blendCodeToPixi(3)).toBe('subtract');
    expect(blendCodeToPixi(4)).toBe('multiply');
    // Code 9 = beatoraja's `(GL_ONE_MINUS_DST_COLOR, GL_ZERO)` — no exact Pixi match;
    // 'difference' is the closest visual approximation. Previous mapping was 'erase'
    // (alpha hole-punch), a fundamentally different operation.
    expect(blendCodeToPixi(9)).toBe('difference');
    expect(blendCodeToPixi(99)).toBe('normal'); // unknown code falls back
  });
});

describe('createCroppedBeatorajaTexture', () => {
  it('reuses valid crops but rejects non-finite beatoraja frames', () => {
    const base = texture();
    const first = createCroppedBeatorajaTexture(base, { x: 1, y: 2, w: 16, h: 24 });
    const second = createCroppedBeatorajaTexture(base, { x: 1, y: 2, w: 16, h: 24 });

    expect(first).toBe(second);
    expect(createCroppedBeatorajaTexture(base, { x: Number.NaN, y: 0, w: 1, h: 1 })).toBeUndefined();
  });
});

describe('applyBeatorajaStretchRect', () => {
  // Standard test case: 100×100 destination rect with a wider 200×100 source — aspect 2:1.
  // Expected behavior per mode summarized in the comments below.
  const dst = { x: 50, y: 50, width: 100, height: 100 };
  const wideSource = { width: 200, height: 100 }; // aspect 2:1
  const tallSource = { width: 100, height: 200 }; // aspect 1:2

  it('STRETCH (0) is a pass-through', () => {
    expect(applyBeatorajaStretchRect(dst, wideSource, BEATORAJA_STRETCH.STRETCH)).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      trim: false,
    });
  });

  it('FIT_INNER (1) shrinks one axis to preserve aspect, recenters', () => {
    // Wide source (200×100) into 100×100 dst → height shrinks to 50, width unchanged. Recenter
    // vertically: dst center y = 100, new height 50 → y = 75.
    expect(applyBeatorajaStretchRect(dst, wideSource, BEATORAJA_STRETCH.FIT_INNER)).toEqual({
      x: 50,
      y: 75,
      width: 100,
      height: 50,
      trim: false,
    });
    // Tall source (100×200) → width shrinks to 50, height unchanged. Recenter horizontally.
    expect(applyBeatorajaStretchRect(dst, tallSource, BEATORAJA_STRETCH.FIT_INNER)).toEqual({
      x: 75,
      y: 50,
      width: 50,
      height: 100,
      trim: false,
    });
  });

  it('FIT_OUTER (2) expands one axis to cover the dst, recenters', () => {
    // Wide source → height grows to 200 (overflows top + bottom), width 200 (overflows left+right).
    // Wait — wide source means scaleX > scaleY (100/200=0.5 vs 100/100=1.0); FIT_OUTER picks the
    // LARGER ratio → 1.0 → height stays 100, width becomes 200, recenter horizontally.
    expect(applyBeatorajaStretchRect(dst, wideSource, BEATORAJA_STRETCH.FIT_OUTER)).toEqual({
      x: 0, // 100 dst center - 100 half-width
      y: 50,
      width: 200,
      height: 100,
      trim: false,
    });
  });

  it('FIT_OUTER_TRIMMED (3) returns same geometry as FIT_OUTER but flags trim=true', () => {
    expect(applyBeatorajaStretchRect(dst, wideSource, BEATORAJA_STRETCH.FIT_OUTER_TRIMMED)).toEqual({
      x: 0,
      y: 50,
      width: 200,
      height: 100,
      trim: true,
    });
  });

  it('FIT_WIDTH (4) matches dst width, height scales proportionally', () => {
    // Wide source 200×100 → matches dst.width = 100, height = 100 × 100/200 = 50, recenter.
    expect(applyBeatorajaStretchRect(dst, wideSource, BEATORAJA_STRETCH.FIT_WIDTH)).toEqual({
      x: 50,
      y: 75,
      width: 100,
      height: 50,
      trim: false,
    });
  });

  it('FIT_HEIGHT (6) matches dst height, width scales proportionally', () => {
    // Wide source 200×100 → matches dst.height = 100, width = 200 × 100/100 = 200, recenter.
    expect(applyBeatorajaStretchRect(dst, wideSource, BEATORAJA_STRETCH.FIT_HEIGHT)).toEqual({
      x: 0,
      y: 50,
      width: 200,
      height: 100,
      trim: false,
    });
  });

  it('NO_RESIZE (9) keeps source dimensions verbatim, recenters', () => {
    // 200×100 source recentered on the 100×100 dst at center (100, 100) → x = 0, y = 50.
    expect(applyBeatorajaStretchRect(dst, wideSource, BEATORAJA_STRETCH.NO_RESIZE)).toEqual({
      x: 0,
      y: 50,
      width: 200,
      height: 100,
      trim: false,
    });
  });

  it('NO_EXPANDING (8) only shrinks (uses min(1, fit-inner-scale))', () => {
    // Smaller source than dst → scale=1 → keeps source dimensions.
    const smallSource = { width: 50, height: 50 };
    expect(applyBeatorajaStretchRect(dst, smallSource, BEATORAJA_STRETCH.NO_EXPANDING)).toEqual({
      x: 75,
      y: 75,
      width: 50,
      height: 50,
      trim: false,
    });
    // Larger source than dst → scale = min(100/200, 100/100) = 0.5 → 100×50 recentered.
    expect(applyBeatorajaStretchRect(dst, wideSource, BEATORAJA_STRETCH.NO_EXPANDING)).toEqual({
      x: 50,
      y: 75,
      width: 100,
      height: 50,
      trim: false,
    });
  });

  it('falls through to STRETCH for unknown / negative stretch codes', () => {
    expect(applyBeatorajaStretchRect(dst, wideSource, 99)).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      trim: false,
    });
    expect(applyBeatorajaStretchRect(dst, wideSource, -1)).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      trim: false,
    });
  });

  it('falls through to STRETCH when source dimensions are zero (degenerate texture)', () => {
    expect(applyBeatorajaStretchRect(dst, { width: 0, height: 100 }, BEATORAJA_STRETCH.FIT_INNER)).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      trim: false,
    });
  });
});
