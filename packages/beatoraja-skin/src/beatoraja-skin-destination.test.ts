import { describe, expect, it } from 'vitest';
import {
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
});
