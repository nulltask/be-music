import { describe, expect, it } from 'vitest';
import {
  centerToAnchor,
  normalizeBeatorajaDestinations,
  sampleBeatorajaDestination,
} from './beatoraja-skin-destination.ts';

describe('normalizeBeatorajaDestinations', () => {
  it('fills in default group fields and carries forward keyframe state', () => {
    const out = normalizeBeatorajaDestinations([
      {
        id: 'keybeam1',
        timer: 101,
        loop: 100,
        offset: 3,
        dst: [
          { time: 0, x: 121, y: 140, w: 18, h: 580 },
          // No `y` / `h` — must inherit from the previous keyframe.
          { time: 100, x: 112, w: 36 },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    const g = out[0];
    expect(g.id).toBe('keybeam1');
    expect(g.timer).toBe(101);
    expect(g.loop).toBe(100);
    expect(g.offset).toBe(3);
    expect(g.blend).toBe(0);
    expect(g.filter).toBe(0);
    expect(g.op).toEqual([]);
    expect(g.ifCodes).toEqual([]);
    expect(g.dst).toHaveLength(2);
    expect(g.dst[0]).toMatchObject({ time: 0, x: 121, y: 140, w: 18, h: 580, r: 255, g: 255, b: 255, a: 255 });
    // y / h inherited from keyframe 0; x / w overridden.
    expect(g.dst[1]).toMatchObject({ time: 100, x: 112, y: 140, w: 36, h: 580 });
  });

  it('drops entries without id or dst', () => {
    expect(normalizeBeatorajaDestinations([{ id: 1 }, { dst: [{ time: 0 }] }])).toEqual([]);
  });

  it('honors authored op / blend / loop fields and the global if codes', () => {
    const out = normalizeBeatorajaDestinations([
      {
        if: [920],
        values: [
          {
            id: 5,
            timer: 0,
            loop: -1,
            blend: 2,
            op: [901, -905],
            dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }],
          },
        ],
      },
    ]);
    expect(out[0].ifCodes).toEqual([920]);
    expect(out[0].op).toEqual([901, -905]);
    expect(out[0].blend).toBe(2);
    expect(out[0].loop).toBe(-1);
  });

  it('records declarationOrder for source-order rendering', () => {
    const out = normalizeBeatorajaDestinations([
      { id: 'a', dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      { id: 'b', dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      { id: 'c', dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
    ]);
    expect(out.map((g) => g.declarationOrder)).toEqual([0, 1, 2]);
  });
});

describe('sampleBeatorajaDestination', () => {
  const group = normalizeBeatorajaDestinations([
    {
      id: 'demo',
      timer: 0,
      loop: -1,
      dst: [
        { time: 0, x: 0, y: 0, w: 100, h: 100 },
        { time: 1000, x: 100 },
      ],
    },
  ])[0];

  it('returns the head keyframe before time 0', () => {
    const sampled = sampleBeatorajaDestination(group, -50);
    expect(sampled?.x).toBe(0);
  });

  it('linearly interpolates between adjacent keyframes', () => {
    const half = sampleBeatorajaDestination(group, 500);
    expect(half?.x).toBe(50);
    expect(half?.y).toBe(0);
    expect(half?.w).toBe(100);
  });

  it('returns undefined past the last keyframe when loop is -1', () => {
    expect(sampleBeatorajaDestination(group, 1500)).toBeUndefined();
  });

  it('treats single-keyframe destinations as static (always visible regardless of loop)', () => {
    const staticGroup = normalizeBeatorajaDestinations([
      { id: 'static-bg', loop: -1, dst: [{ time: 0, x: 10, y: 20, w: 100, h: 100, a: 255 }] },
    ])[0];
    expect(sampleBeatorajaDestination(staticGroup, 0)?.x).toBe(10);
    expect(sampleBeatorajaDestination(staticGroup, 1000)?.x).toBe(10);
    expect(sampleBeatorajaDestination(staticGroup, 9999)?.x).toBe(10);
  });

  it('wraps when loop is set', () => {
    const looping = normalizeBeatorajaDestinations([
      {
        id: 'loop',
        loop: 0,
        dst: [
          { time: 0, x: 0, y: 0, w: 1, h: 1 },
          { time: 1000, x: 100 },
        ],
      },
    ])[0];
    const wrapped = sampleBeatorajaDestination(looping, 1500);
    expect(wrapped?.x).toBe(50); // 1500 % 1000 = 500 → halfway between x=0 and x=100
  });

  describe('acc easing curves', () => {
    function makeGroup(acc: number) {
      return normalizeBeatorajaDestinations([
        {
          id: 'eased',
          loop: -1,
          dst: [
            { time: 0, x: 0, y: 0, w: 1, h: 1, a: 255, acc },
            { time: 1000, x: 100 },
          ],
        },
      ])[0];
    }

    it('treats acc=0 as linear (identity)', () => {
      const linear = makeGroup(0);
      expect(sampleBeatorajaDestination(linear, 250)?.x).toBe(25);
      expect(sampleBeatorajaDestination(linear, 500)?.x).toBe(50);
      expect(sampleBeatorajaDestination(linear, 750)?.x).toBe(75);
    });

    it('accelerates with acc=1 (slow start, fast end — u²)', () => {
      const accel = makeGroup(1);
      // u = 0.25 → u² = 0.0625 → x = 6.25
      expect(sampleBeatorajaDestination(accel, 250)?.x).toBeCloseTo(6.25, 6);
      // u = 0.5 → 0.25 → x = 25
      expect(sampleBeatorajaDestination(accel, 500)?.x).toBeCloseTo(25, 6);
      // u = 0.75 → 0.5625 → x = 56.25
      expect(sampleBeatorajaDestination(accel, 750)?.x).toBeCloseTo(56.25, 6);
    });

    it('decelerates with acc=2 (fast start, slow end — u·(2-u))', () => {
      const decel = makeGroup(2);
      // u = 0.25 → 0.25·1.75 = 0.4375 → x = 43.75
      expect(sampleBeatorajaDestination(decel, 250)?.x).toBeCloseTo(43.75, 6);
      // u = 0.5 → 0.5·1.5 = 0.75 → x = 75
      expect(sampleBeatorajaDestination(decel, 500)?.x).toBeCloseTo(75, 6);
      // u = 0.75 → 0.75·1.25 = 0.9375 → x = 93.75
      expect(sampleBeatorajaDestination(decel, 750)?.x).toBeCloseTo(93.75, 6);
    });

    it('holds the FROM frame with acc=3 (step) until the segment ends', () => {
      const step = makeGroup(3);
      // u in (0,1) → eased to 0 → returns FROM frame's value
      expect(sampleBeatorajaDestination(step, 250)?.x).toBe(0);
      expect(sampleBeatorajaDestination(step, 500)?.x).toBe(0);
      expect(sampleBeatorajaDestination(step, 999)?.x).toBe(0);
    });

    it('always starts at the FROM frame regardless of curve', () => {
      // Endpoint `t = lastKeyframe.time` falls past the segment with `loop = -1` (returns
      // undefined per the loop semantics), so we check `u → 0` and `u → 1` from inside the
      // segment instead. The interpolation lands exactly on FROM at u=0 for every curve.
      for (const acc of [0, 1, 2, 3]) {
        const group = makeGroup(acc);
        expect(sampleBeatorajaDestination(group, 0)?.x).toBe(0);
      }
    });

    it('carries acc forward to subsequent keyframes (matches JSONSkinLoader semantics)', () => {
      // Segment 0→1000 has acc=2 (decelerate); segment 1000→2000 has no acc — beatoraja's
      // setDestination keeps the previous frame's `acc` when the next is `MIN_VALUE`, so both
      // segments use acc=2 here. Authors author long fades by declaring acc once on the FROM
      // frame and omitting it on the rest.
      const mixed = normalizeBeatorajaDestinations([
        {
          id: 'mixed',
          loop: -1,
          dst: [
            { time: 0, x: 0, y: 0, w: 1, h: 1, a: 255, acc: 2 },
            { time: 1000, x: 100 },
            { time: 2000, x: 0 },
          ],
        },
      ])[0];
      // First half-segment: acc=2 decelerate at u=0.5 → x = 75
      expect(sampleBeatorajaDestination(mixed, 500)?.x).toBeCloseTo(75, 6);
      // Second half-segment: also acc=2 (carried forward). u=0.5 from 100 → 0 with decel.
      // Decel curve `u·(2-u)` at 0.5 = 0.75 → x = 100 - 0.75·100 = 25.
      expect(sampleBeatorajaDestination(mixed, 1500)?.x).toBeCloseTo(25, 6);
    });

    it('still defaults to acc=0 (linear) when no keyframe specifies acc', () => {
      const linear = normalizeBeatorajaDestinations([
        {
          id: 'linear',
          loop: -1,
          dst: [
            { time: 0, x: 0, y: 0, w: 1, h: 1, a: 255 },
            { time: 1000, x: 100 },
          ],
        },
      ])[0];
      expect(sampleBeatorajaDestination(linear, 500)?.x).toBeCloseTo(50, 6);
    });
  });
});

describe('centerToAnchor (beatoraja convention, mapped into Pixi Y-DOWN)', () => {
  // Source: `SkinObject.java` CENTERX/CENTERY arrays (10 entries, 0=default mid-point, 1..9 are
  // a 1-indexed grid in libGDX Y-UP). We Y-flip so 1 (libGDX bottom-left) lands at Pixi anchor
  // (0, 1) — Pixi's bottom-left.
  it('treats 0 as the rect mid-point (beatoraja default for unset center)', () => {
    expect(centerToAnchor(0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('maps 1..9 to the Y-flipped grid (1 = bottom-left, 9 = top-right in Pixi visual space)', () => {
    expect(centerToAnchor(1)).toEqual({ x: 0, y: 1 }); // libGDX bottom-left → Pixi bottom-left
    expect(centerToAnchor(2)).toEqual({ x: 0.5, y: 1 });
    expect(centerToAnchor(3)).toEqual({ x: 1, y: 1 }); // bottom-right
    expect(centerToAnchor(4)).toEqual({ x: 0, y: 0.5 });
    expect(centerToAnchor(5)).toEqual({ x: 0.5, y: 0.5 }); // middle (same as 0)
    expect(centerToAnchor(6)).toEqual({ x: 1, y: 0.5 });
    expect(centerToAnchor(7)).toEqual({ x: 0, y: 0 }); // libGDX top-left → Pixi top-left
    expect(centerToAnchor(8)).toEqual({ x: 0.5, y: 0 });
    expect(centerToAnchor(9)).toEqual({ x: 1, y: 0 }); // top-right
  });

  it('clamps out-of-range / NaN to 0 (mid-point)', () => {
    expect(centerToAnchor(-1)).toEqual({ x: 0.5, y: 0.5 });
    expect(centerToAnchor(10)).toEqual({ x: 0.5, y: 0.5 });
    expect(centerToAnchor(Number.NaN)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('destination.stretch (audit 2.12)', () => {
  it('defaults to 0 (= STRETCH) when no stretch is authored', () => {
    const groups = normalizeBeatorajaDestinations([
      { id: 'bg', dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] },
    ]);
    expect(groups[0]!.stretch).toBe(0);
  });

  it('reads stretch from the outer destination record', () => {
    const groups = normalizeBeatorajaDestinations([
      { id: 'jacket', stretch: 1, dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] },
    ]);
    expect(groups[0]!.stretch).toBe(1);
  });

  it('reads stretch from a per-keyframe entry (Lua-driven skins author it that way)', () => {
    const groups = normalizeBeatorajaDestinations([
      {
        id: 'banner',
        dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100, stretch: 2 }],
      },
    ]);
    expect(groups[0]!.stretch).toBe(2);
  });

  it('LAST authored keyframe wins (matches beatoraja JSONSkinLoader.setStretch ordering)', () => {
    // beatoraja's loader calls `obj.setStretch(...)` for each keyframe with a non-default
    // value; subsequent calls overwrite. Our parser must match: the last keyframe's stretch
    // is the one that takes effect.
    const groups = normalizeBeatorajaDestinations([
      {
        id: 'jacket',
        dst: [
          { time: 0, x: 0, y: 0, w: 100, h: 100, stretch: 1 },
          { time: 500, x: 0, y: 0, w: 100, h: 100, stretch: 2 },
        ],
      },
    ]);
    expect(groups[0]!.stretch).toBe(2);
  });

  it('ignores negative stretch values (= "not set" sentinel in beatoraja)', () => {
    const groups = normalizeBeatorajaDestinations([
      { id: 'bg', stretch: -1, dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] },
    ]);
    expect(groups[0]!.stretch).toBe(0);
  });
});
