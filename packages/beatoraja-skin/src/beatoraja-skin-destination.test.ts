import { describe, expect, it } from 'vitest';
import {
  applyBeatorajaOffsetAlpha,
  centerToAnchor,
  normalizeBeatorajaDestinations,
  sampleBeatorajaDestination,
  type BeatorajaSkinOffsetValue,
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

  it('expands inner if-gated keyframe alternatives — picks first match against activeOps', () => {
    // Beatoraja's BGA / lane-position destinations stash a SINGLE keyframe per slot but vary the
    // rect by skin-config option. Each slot is an array of `{if, value}` alternatives:
    //
    //   {"id":2002, "dst":[
    //     [
    //       {"if":[924], "value":{"x":1000,"y":440,"w":256,"h":256}}, // option 924 = compact BGA
    //       {"if":[],    "value":{"x":700, "y":144,"w":512,"h":512}}, // catch-all (default layout)
    //     ]
    //   ]}
    //
    // With option 924 active the first alt wins; otherwise the empty-if catch-all wins. Without
    // expansion the renderer reads the array as a degenerate object (zero rect) — BGA invisible.
    const withOption = normalizeBeatorajaDestinations(
      [
        { id: 2002, dst: [
          [
            { if: [924], value: { time: 0, x: 1000, y: 440, w: 256, h: 256 } },
            { if: [],    value: { time: 0, x: 700,  y: 144, w: 512, h: 512 } },
          ],
        ] },
      ],
      new Set([924]),
    );
    expect(withOption[0]?.dst[0]).toMatchObject({ x: 1000, y: 440, w: 256, h: 256 });

    const withoutOption = normalizeBeatorajaDestinations([
      { id: 2002, dst: [
        [
          { if: [924], value: { time: 0, x: 1000, y: 440, w: 256, h: 256 } },
          { if: [],    value: { time: 0, x: 700,  y: 144, w: 512, h: 512 } },
        ],
      ] },
    ]);
    expect(withoutOption[0]?.dst[0]).toMatchObject({ x: 700, y: 144, w: 512, h: 512 });
  });

  it('falls back to the last alternative when no `if` matches and no catch-all exists', () => {
    // Authors occasionally omit the catch-all (every alt has a non-empty `if`); rather than drop
    // the keyframe entirely (sprite invisible), beatoraja-style fallback uses the last alt. This
    // is preferable to nothing — the skin is mis-authored, but the renderer still paints.
    const out = normalizeBeatorajaDestinations([
      { id: 'x', dst: [
        [
          { if: [101], value: { time: 0, x: 10, y: 10, w: 10, h: 10 } },
          { if: [102], value: { time: 0, x: 20, y: 20, w: 20, h: 20 } },
        ],
      ] },
    ]);
    expect(out[0]?.dst[0]).toMatchObject({ x: 20, y: 20, w: 20, h: 20 });
  });

  it('parses `relative: true` (boolean or numeric truthy) for offset center-anchoring opt-out', () => {
    // Mirrors `SkinObject.relative` — when true, `prepareDraw` skips the
    // `region.x += off.x - off.w/2` centering shift. Used by `JsonPlaySkinObjectLoader` on
    // per-digit judgement-detail numbers. Default false.
    const out = normalizeBeatorajaDestinations([
      { id: 'a', dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      { id: 'b', relative: true, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      { id: 'c', relative: 1, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      { id: 'd', relative: 0, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
    ]);
    expect(out[0]?.relative).toBe(false);
    expect(out[1]?.relative).toBe(true);
    expect(out[2]?.relative).toBe(true); // numeric 1 truthy
    expect(out[3]?.relative).toBe(false); // numeric 0 falsy
  });

  it('honors negated `if` codes on inner alternatives', () => {
    // `if: [-924]` means "active when option 924 is NOT set". Same convention as element-level
    // ifCodes — a negative code is a negation guard.
    const out = normalizeBeatorajaDestinations(
      [
        { id: 'g', dst: [
          [
            { if: [-924], value: { time: 0, x: 1, y: 2, w: 3, h: 4 } },
            { if: [],     value: { time: 0, x: 5, y: 6, w: 7, h: 8 } },
          ],
        ] },
      ],
      new Set([924]),
    );
    // 924 IS set, so `-924` fails — falls through to the empty-if catch-all.
    expect(out[0]?.dst[0]).toMatchObject({ x: 5, y: 6, w: 7, h: 8 });
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

  it('hides for elapsed < dst[0].time (audit 1.7 — pre-starttime gate)', () => {
    // Beatoraja's `prepareRegion()` runs `if (starttime > time) draw = false; return;` —
    // sampling before the first keyframe's authored time hides the element. The renderer's
    // pipeline already gates on `elapsed < 0` upstream so this only matters when a downstream
    // caller drives the sampler directly with a negative offset, but matching beatoraja
    // exactly keeps the spec faithful.
    expect(sampleBeatorajaDestination(group, -50)).toBeUndefined();
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

  it('single-keyframe destination with loop=-1 winks once at dst[0].time then hides (audit 1.6)', () => {
    // Beatoraja's `prepareRegion()` runs both `starttime > time → hide` AND
    // `dstloop == -1 && time > endtime → hide`. For length-1 dsts those bounds collapse to
    // a single instant — only `t == dst[0].time` paints. The previous TS impl short-circuited
    // length-1 to "always visible", which left default play's `judgef-*` / `judgen-*`
    // single-keyframe judge dsts (and ModernChic's Decide corner-flash group) painted
    // forever after their timer fired.
    const winkOnce = normalizeBeatorajaDestinations([
      { id: 'wink', loop: -1, dst: [{ time: 0, x: 10, y: 20, w: 100, h: 100, a: 255 }] },
    ])[0]!;
    expect(sampleBeatorajaDestination(winkOnce, 0)?.x).toBe(10);
    expect(sampleBeatorajaDestination(winkOnce, 1)).toBeUndefined();
    expect(sampleBeatorajaDestination(winkOnce, 1000)).toBeUndefined();
  });

  it('default loop is 0 (NOT -1) so omitting `loop` keeps a length-1 dst visible (regression)', () => {
    // Beatoraja's `JsonSkin.Destination.loop` is a Java int with no explicit default → `0`.
    // Authors that author a static element as a single-keyframe dst with no `loop` field rely
    // on this default to keep the element visible across the whole scene. Our parser
    // previously defaulted to `-1`, which combined with the audit-1.6 length-1 single-frame
    // gating made every static skin background, BG quad, and anchor sprite hide after t=0
    // (= "render entirely black"). Confirm the default is now `0` and the static element
    // stays visible.
    const groups = normalizeBeatorajaDestinations([
      { id: 'static-bg', dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100, a: 255 }] },
    ]);
    expect(groups[0]?.loop).toBe(0);
    expect(sampleBeatorajaDestination(groups[0]!, 0)?.x).toBe(0);
    expect(sampleBeatorajaDestination(groups[0]!, 1000)?.x).toBe(0);
    expect(sampleBeatorajaDestination(groups[0]!, 9999)?.x).toBe(0);
  });

  it('single-keyframe destination with loop>=0 stays visible (period collapses to "static")', () => {
    // With `loop >= 0`, the wraparound period for a length-1 dst would divide by zero in
    // beatoraja itself; we degrade to "hold the frame static" rather than producing NaN. This
    // matches author intent for any single-frame element they DO want to keep visible — they
    // simply set `loop = 0` instead of `-1`.
    const staticGroup = normalizeBeatorajaDestinations([
      { id: 'static-bg', loop: 0, dst: [{ time: 0, x: 10, y: 20, w: 100, h: 100, a: 255 }] },
    ])[0]!;
    expect(sampleBeatorajaDestination(staticGroup, 0)?.x).toBe(10);
    expect(sampleBeatorajaDestination(staticGroup, 1000)?.x).toBe(10);
    expect(sampleBeatorajaDestination(staticGroup, 9999)?.x).toBe(10);
  });

  it('hides before dst[0].time when authors author a delayed reveal (audit 1.7)', () => {
    // Authors that delay an element's first appearance with `dst[0].time > 0` expect it to
    // stay hidden until the timer reaches that mark. The previous impl returned the head
    // frame for any `t <= dst[0].time` instead, which made delayed elements paint immediately
    // (most visible when the head frame's `a` was non-zero — common in pop-in reveals).
    const delayed = normalizeBeatorajaDestinations([
      {
        id: 'delayed',
        loop: -1,
        dst: [
          { time: 500, x: 10, y: 0, w: 1, h: 1, a: 255 },
          { time: 1000, x: 100 },
        ],
      },
    ])[0]!;
    expect(sampleBeatorajaDestination(delayed, 0)).toBeUndefined();
    expect(sampleBeatorajaDestination(delayed, 499)).toBeUndefined();
    expect(sampleBeatorajaDestination(delayed, 500)?.x).toBe(10);
    expect(sampleBeatorajaDestination(delayed, 750)?.x).toBeCloseTo(55, 6); // halfway
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

    it('every segment uses the SAME acc (element-level lock, audit 1.5)', () => {
      // Beatoraja's `SkinObject.acc` is a class-level field, not a per-keyframe curve:
      // `setDestination` runs `if (this.acc == 0) this.acc = anim.acc` per keyframe, so the
      // first non-zero acc across the whole list wins and locks. Every segment then uses that
      // single curve.
      //
      // Multi-segment dst with acc=2 on the first non-zero keyframe → both segments decelerate.
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
      ])[0]!;
      expect(mixed.acc).toBe(2);
      // First segment (0→1000): u=0.5, decel → 0.75 → x = 75.
      expect(sampleBeatorajaDestination(mixed, 500)?.x).toBeCloseTo(75, 6);
      // Second segment (1000→2000): also uses acc=2 (element-level lock). u=0.5, decel = 0.75
      // → x = 100 - 0.75·100 = 25.
      expect(sampleBeatorajaDestination(mixed, 1500)?.x).toBeCloseTo(25, 6);
    });

    it('first non-zero acc wins regardless of which keyframe authored it (audit 1.5)', () => {
      // Authors that omit acc on the first keyframe and add it on the second still get the
      // curve applied to ALL segments — beatoraja's accumulator picks up the first non-zero
      // value it encounters. Old per-segment behavior would have left the first segment linear,
      // which doesn't match the author's intent for fade-in choreography.
      const lateAcc = normalizeBeatorajaDestinations([
        {
          id: 'late',
          loop: -1,
          dst: [
            { time: 0, x: 0, y: 0, w: 1, h: 1, a: 255 },
            { time: 1000, x: 100, acc: 2 },
            { time: 2000, x: 0 },
          ],
        },
      ])[0]!;
      expect(lateAcc.acc).toBe(2);
      // First segment: now uses acc=2 (was incorrectly linear in the per-segment impl).
      expect(sampleBeatorajaDestination(lateAcc, 500)?.x).toBeCloseTo(75, 6);
    });

    it('subsequent non-zero acc values are ignored (only first wins)', () => {
      // Multi-keyframe with DIFFERENT non-zero acc values: beatoraja locks on the first,
      // ignores the rest. Mirrors the `if (this.acc == 0)` guard.
      const conflicting = normalizeBeatorajaDestinations([
        {
          id: 'conflict',
          loop: -1,
          dst: [
            { time: 0, x: 0, y: 0, w: 1, h: 1, a: 255, acc: 1 },
            { time: 1000, x: 100, acc: 2 },
            { time: 2000, x: 0 },
          ],
        },
      ])[0]!;
      expect(conflicting.acc).toBe(1);
      // First segment uses accel (acc=1): u=0.5 → 0.25 → x = 25
      expect(sampleBeatorajaDestination(conflicting, 500)?.x).toBeCloseTo(25, 6);
      // Second segment ALSO uses acc=1 (locked element-level). 100 → 0 with accel u=0.5
      // → 0.25 → x = 100 - 0.25·100 = 75.
      expect(sampleBeatorajaDestination(conflicting, 1500)?.x).toBeCloseTo(75, 6);
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

describe('applyBeatorajaOffsetAlpha (audit A-10 — per-step clamp matches SkinObject.prepareColor)', () => {
  // Mirrors `SkinObject.java:391-401, 424-430`:
  //
  //   for (SkinOffset off : this.off) {
  //       float a = color.a + (off.a / 255.0f);
  //       a = a > 1 ? 1 : (a < 0 ? 0 : a);
  //       color.a = a;
  //   }
  //
  // Each offset is applied AND clamped before the next runs. The previous impl summed all
  // offsets first then clamped at the end — observable difference only when intermediate
  // accumulation crossed [0, 1].
  function makeResolver(offsets: ReadonlyMap<number, BeatorajaSkinOffsetValue>) {
    return (id: number) => offsets.get(id);
  }

  it('returns base alpha unchanged when no offset ids resolve', () => {
    expect(applyBeatorajaOffsetAlpha(0.5, [], () => undefined)).toBeCloseTo(0.5, 6);
    expect(applyBeatorajaOffsetAlpha(0.5, [99], () => undefined)).toBeCloseTo(0.5, 6);
  });

  it('clamps the base alpha into [0, 1] before applying offsets', () => {
    expect(applyBeatorajaOffsetAlpha(2.0, [], () => undefined)).toBe(1);
    expect(applyBeatorajaOffsetAlpha(-0.5, [], () => undefined)).toBe(0);
  });

  it('applies a single positive offset additively', () => {
    // base 0.5 + (off.a = 64 → +0.251) = 0.751.
    const offsets = new Map([[1, { x: 0, y: 0, w: 0, h: 0, r: 0, a: 64 }]]);
    expect(applyBeatorajaOffsetAlpha(0.5, [1], makeResolver(offsets))).toBeCloseTo(0.751, 3);
  });

  it('clamps each step independently — saturation in step N does not survive to step N+1', () => {
    // Step trace for base 0.5 + offsets `[+200, -100, +50]` (raw a values):
    //   +200/255 → 0.5 + 0.7843 = 1.2843 → clamp 1.0
    //   -100/255 → 1.0 - 0.3922 = 0.6078
    //   +50/255  → 0.6078 + 0.1961 = 0.8039
    // Sum-then-clamp would give 0.5 + (0.7843 - 0.3922 + 0.1961) = 1.0882 → clamp 1.0 (wrong).
    const offsets = new Map<number, BeatorajaSkinOffsetValue>([
      [1, { x: 0, y: 0, w: 0, h: 0, r: 0, a: 200 }],
      [2, { x: 0, y: 0, w: 0, h: 0, r: 0, a: -100 }],
      [3, { x: 0, y: 0, w: 0, h: 0, r: 0, a: 50 }],
    ]);
    const out = applyBeatorajaOffsetAlpha(0.5, [1, 2, 3], makeResolver(offsets));
    // 1.0 - 100/255 + 50/255 = 1.0 - 50/255 ≈ 0.8039.
    expect(out).toBeCloseTo(1 - 50 / 255, 6);
    expect(out).toBeLessThan(1.0); // strictly less than the sum-then-clamp upper bound.
  });

  it('honors authored offset order — swapping ids changes the saturation point', () => {
    // [+200, -100] vs [-100, +200] both sum to +100 but per-step yields different finals.
    const offsets = new Map<number, BeatorajaSkinOffsetValue>([
      [1, { x: 0, y: 0, w: 0, h: 0, r: 0, a: 200 }],
      [2, { x: 0, y: 0, w: 0, h: 0, r: 0, a: -100 }],
    ]);
    // [1, 2]: 0.5 + 200/255 = 1.2843 → clamp 1.0; - 100/255 = 1.0 - 100/255 ≈ 0.6078.
    expect(applyBeatorajaOffsetAlpha(0.5, [1, 2], makeResolver(offsets))).toBeCloseTo(1 - 100 / 255, 6);
    // [2, 1]: 0.5 - 100/255 ≈ 0.1078; + 200/255 ≈ 0.8922.
    expect(applyBeatorajaOffsetAlpha(0.5, [2, 1], makeResolver(offsets))).toBeCloseTo(0.5 + 100 / 255, 6);
  });

  it('clamps to 0 when intermediate steps go negative', () => {
    // base 0.2 + (-200/255 → -0.5843 → clamp 0) + (+50/255 → 0.1961). Final ≈ 0.1961.
    // Sum-then-clamp would give 0.2 - 200/255 + 50/255 = -0.3882 → clamp 0 (different).
    const offsets = new Map<number, BeatorajaSkinOffsetValue>([
      [1, { x: 0, y: 0, w: 0, h: 0, r: 0, a: -200 }],
      [2, { x: 0, y: 0, w: 0, h: 0, r: 0, a: 50 }],
    ]);
    const out = applyBeatorajaOffsetAlpha(0.2, [1, 2], makeResolver(offsets));
    expect(out).toBeCloseTo(50 / 255, 6);
    expect(out).toBeGreaterThan(0);
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
