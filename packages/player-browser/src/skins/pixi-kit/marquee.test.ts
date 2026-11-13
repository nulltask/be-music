import { CanvasTextMetrics, Container, Text } from 'pixi.js';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  DEFAULT_MARQUEE_TIMING,
  fitTextToWidth,
  MIN_TEXT_SQUEEZE,
  marqueeCycleMs,
  resolveMarqueeAlpha,
  resolveMarqueeOffset,
  resolveTextSqueeze,
  type MarqueeTiming,
} from './marquee.ts';

const timing: MarqueeTiming = { startHoldMs: 1000, speedPxPerSecond: 50, endHoldMs: 500, fadeMs: 200 };

describe('resolveTextSqueeze', () => {
  it('leaves text that fits at full width', () => {
    expect(resolveTextSqueeze(80, 100)).toBe(1);
    expect(resolveTextSqueeze(100, 100)).toBe(1);
  });

  it('squeezes text that fits within the minimum squeeze', () => {
    expect(resolveTextSqueeze(110, 100)).toBeCloseTo(100 / 110);
    expect(resolveTextSqueeze(100 / MIN_TEXT_SQUEEZE, 100)).toBeCloseTo(MIN_TEXT_SQUEEZE);
  });

  it('stops at the minimum squeeze for text that still overflows', () => {
    expect(resolveTextSqueeze(400, 100)).toBe(MIN_TEXT_SQUEEZE);
    expect(resolveTextSqueeze(400, 100, 0.5)).toBe(0.5);
  });

  it('treats empty or degenerate widths as fitting', () => {
    expect(resolveTextSqueeze(0, 100)).toBe(1);
    expect(resolveTextSqueeze(Number.NaN, 100)).toBe(1);
    expect(resolveTextSqueeze(50, 0)).toBe(MIN_TEXT_SQUEEZE);
  });
});

describe('fitTextToWidth', () => {
  it.each([
    { maxWidth: 68, scroll: true, squeezeShortOverflow: true, fits: true },
    { maxWidth: 67, scroll: true, squeezeShortOverflow: true, fits: false },
    { maxWidth: 68, scroll: false, squeezeShortOverflow: true, fits: false },
    { maxWidth: 68, scroll: true, squeezeShortOverflow: false, fits: false },
  ])('fits short overflow only for enabled scrolling text (%j)', ({ fits, ...options }) => {
    const layer = new Container();
    const node = layer.addChild(new Text({ text: 'Titleが👩‍🎤' }));
    node.position.set(50, 10);
    node.anchor.set(0.5);
    vi.spyOn(node, 'width', 'get').mockReturnValue(100);
    vi.spyOn(node, 'height', 'get').mockReturnValue(20);
    const measure = vi
      .spyOn(CanvasTextMetrics, 'measureText')
      .mockReturnValue({ maxLineWidth: 20 } as CanvasTextMetrics);

    try {
      fitTextToWidth(node, layer, { ...options, anchorX: 0.5, anchorY: 0.5, scale: 2 });
      expect(node.scale.x).toBeCloseTo(2 * (fits ? options.maxWidth / 100 : MIN_TEXT_SQUEEZE));
      expect(node.scale.y).toBe(2);
      expect(Boolean(node.mask)).toBe(!fits);
      expect(node.anchor.x).toBe(fits ? 0.5 : 0);
      expect(node.x).toBe(fits ? 50 : 50 - options.maxWidth);
      if (options.scroll && options.squeezeShortOverflow) {
        expect(measure).toHaveBeenCalledWith('が👩‍🎤', node.style);
      } else {
        expect(measure).not.toHaveBeenCalled();
      }
    } finally {
      measure.mockRestore();
      layer.destroy({ children: true });
    }
  });
});

describe('marqueeCycleMs', () => {
  it('adds the holds to the scroll time', () => {
    // 100 px at 50 px/s scrolls for 2 s.
    expect(marqueeCycleMs(100, timing)).toBe(1000 + 2000 + 500);
  });

  it('is zero without overflow', () => {
    expect(marqueeCycleMs(0, timing)).toBe(0);
    expect(marqueeCycleMs(-5, timing)).toBe(0);
  });
});

describe('resolveMarqueeOffset', () => {
  it('holds at the start, scrolls at a constant speed, then holds at the end', () => {
    expect(resolveMarqueeOffset(0, 100, timing)).toBe(0);
    expect(resolveMarqueeOffset(999, 100, timing)).toBe(0);
    expect(resolveMarqueeOffset(1500, 100, timing)).toBeCloseTo(25);
    expect(resolveMarqueeOffset(2000, 100, timing)).toBeCloseTo(50);
    expect(resolveMarqueeOffset(3000, 100, timing)).toBeCloseTo(100);
    expect(resolveMarqueeOffset(3400, 100, timing)).toBe(100);
  });

  it('starts over after each cycle', () => {
    expect(resolveMarqueeOffset(3500 + 500, 100, timing)).toBe(0);
    expect(resolveMarqueeOffset(3500 * 2 + 1500, 100, timing)).toBeCloseTo(25);
  });

  it('never scrolls text that fits or before it appears', () => {
    expect(resolveMarqueeOffset(2000, 0, timing)).toBe(0);
    expect(resolveMarqueeOffset(-100, 100, timing)).toBe(0);
  });

  it('uses the default timing when none is given', () => {
    const { startHoldMs, speedPxPerSecond } = DEFAULT_MARQUEE_TIMING;
    expect(resolveMarqueeOffset(startHoldMs + 1000, 500)).toBeCloseTo(speedPxPerSecond);
  });
});

describe('resolveMarqueeAlpha', () => {
  it('shows the first appearance without a fade in', () => {
    expect(resolveMarqueeAlpha(0, 100, timing)).toBe(1);
    expect(resolveMarqueeAlpha(50, 100, timing)).toBe(1);
  });

  it('fades out at the end of the end hold and back in on the next cycle', () => {
    expect(resolveMarqueeAlpha(3200, 100, timing)).toBe(1);
    expect(resolveMarqueeAlpha(3400, 100, timing)).toBeCloseTo(0.5);
    expect(resolveMarqueeAlpha(3500 + 100, 100, timing)).toBeCloseTo(0.5);
    expect(resolveMarqueeAlpha(3500 + 200, 100, timing)).toBe(1);
  });

  it('stays opaque for text that fits or without a fade', () => {
    expect(resolveMarqueeAlpha(3400, 0, timing)).toBe(1);
    expect(resolveMarqueeAlpha(3400, 100, { ...timing, fadeMs: 0 })).toBe(1);
  });
});
