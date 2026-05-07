import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaDestinations } from '@be-music/beatoraja-skin';
import { blendCodeToPixi, destinationToSpriteProps, flipRectToPixi } from './beatoraja-render.ts';

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

  it('hides when the referenced timer has not fired yet', () => {
    const g = groupOf({ timer: 51, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] });
    const props = destinationToSpriteProps(g, ctx({ getTimerStart: () => undefined, nowMs: 5000 }), TEST_CANVAS_HEIGHT);
    expect(props.visible).toBe(false);
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
  it('maps LR2/beatoraja codes to PixiJS v8 BlendMode strings', () => {
    expect(blendCodeToPixi(0)).toBe('normal');
    expect(blendCodeToPixi(1)).toBe('normal');
    expect(blendCodeToPixi(2)).toBe('add');
    expect(blendCodeToPixi(3)).toBe('screen');
    expect(blendCodeToPixi(4)).toBe('multiply');
    expect(blendCodeToPixi(9)).toBe('erase');
    expect(blendCodeToPixi(99)).toBe('normal'); // unknown code falls back
  });
});
