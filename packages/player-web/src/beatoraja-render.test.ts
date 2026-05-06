import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaDestinations } from '@be-music/beatoraja-skin';
import { blendCodeToPixi, destinationToSpriteProps } from './beatoraja-render.ts';

const ctx = (overrides: Partial<Parameters<typeof destinationToSpriteProps>[1]> = {}) => ({
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
  it('returns the head keyframe at scene start', () => {
    const props = destinationToSpriteProps(groupOf(), ctx({ nowMs: 0 }));
    expect(props.visible).toBe(true);
    expect(props.x).toBe(0);
    expect(props.y).toBe(0);
    expect(props.width).toBe(100);
    expect(props.height).toBe(50);
    expect(props.alpha).toBe(1);
  });

  it('linearly interpolates between adjacent keyframes', () => {
    const props = destinationToSpriteProps(groupOf(), ctx({ nowMs: 500 }));
    expect(props.x).toBe(50);
    expect(props.alpha).toBeCloseTo(0.5, 5);
  });

  it('hides past the last keyframe when loop=-1 (default)', () => {
    const props = destinationToSpriteProps(groupOf(), ctx({ nowMs: 1500 }));
    expect(props.visible).toBe(false);
    expect(props.alpha).toBe(0);
  });

  it('hides when alpha hits zero exactly', () => {
    const props = destinationToSpriteProps(groupOf(), ctx({ nowMs: 1000 }));
    expect(props.visible).toBe(false);
  });

  it('hides when ifCodes are unsatisfied', () => {
    const props = destinationToSpriteProps(
      groupOf({ if: [920], values: [{ id: 'demo', timer: 0, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] }] }),
      ctx({ activeOps: new Set([900]) }),
    );
    expect(props.visible).toBe(false);
  });

  it('hides when group op codes are unsatisfied', () => {
    const g = groupOf({ op: [901] });
    const props = destinationToSpriteProps(g, ctx({ activeOps: new Set() }));
    expect(props.visible).toBe(false);
  });

  it('hides when the referenced timer has not fired yet', () => {
    const g = groupOf({ timer: 51, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] });
    const props = destinationToSpriteProps(g, ctx({ getTimerStart: () => undefined, nowMs: 5000 }));
    expect(props.visible).toBe(false);
  });

  it('respects negated op codes', () => {
    const g = groupOf({ op: [-905] });
    expect(destinationToSpriteProps(g, ctx({ activeOps: new Set() })).visible).toBe(true);
    expect(destinationToSpriteProps(g, ctx({ activeOps: new Set([905]) })).visible).toBe(false);
  });

  it('packs RGB tint as 0xRRGGBB', () => {
    const props = destinationToSpriteProps(
      groupOf({
        dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1, r: 64, g: 192, b: 192 }, { time: 1000 }],
      }),
      ctx({ nowMs: 0 }),
    );
    expect(props.tint).toBe((64 << 16) | (192 << 8) | 192);
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
