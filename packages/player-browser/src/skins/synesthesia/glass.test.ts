import type { Graphics } from 'pixi.js';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  bindGlassSurface,
  drawGlassSurface,
  FROSTED_GLASS_SETTING,
  frostedGlassEnabled,
  isMacOS,
  unbindGlassSurface,
} from './glass.ts';

vi.mock('pixi.js', async (original) => ({
  ...(await original<typeof import('pixi.js')>()),
  BlendModeFilter: class {
    destroy = vi.fn();
  },
}));

function recorder() {
  const fills: { color: number; alpha: number }[] = [];
  const rectangles: number[][] = [];
  const once = vi.fn();
  const graphics = {
    filters: null,
    once,
    rect(...rect: number[]) {
      rectangles.push(rect);
      return this;
    },
    fill(style: { color: number; alpha: number }) {
      fills.push(style);
      return this;
    },
  } as unknown as Graphics;
  return { graphics, fills, rectangles, once };
}

describe('frosted panel surfaces', () => {
  it('retains a readable flat fill when no backdrop layer is bound', () => {
    const front = recorder();
    drawGlassSurface(front.graphics, 10, 20, 100, 40);
    expect(front.rectangles).toEqual([[10, 20, 100, 40]]);
    expect(front.fills[0]!.alpha).toBe(0.96);
  });

  it('draws translucent panel fills into the backdrop layer without blurring foreground details', () => {
    const front = recorder();
    const surface = recorder();
    bindGlassSurface(front.graphics, surface.graphics);
    drawGlassSurface(front.graphics, 10, 20, 100, 40);
    expect(front.rectangles).toEqual([]);
    expect(surface.rectangles).toEqual([[10, 20, 100, 40]]);
    expect(surface.fills[0]!.alpha).toBeCloseTo(0.96 * 0.42);
  });

  it('shares one filter across the frame and releases it with its surface', () => {
    const surface = recorder();
    bindGlassSurface(recorder().graphics, surface.graphics);
    const filter = surface.graphics.filters![0]!;
    bindGlassSurface(recorder().graphics, surface.graphics);
    expect(surface.graphics.filters![0]).toBe(filter);
    expect(filter.resolution).toBe('inherit');
    expect(surface.once).toHaveBeenCalledOnce();
    expect(surface.once.mock.calls[0]![0]).toBe('destroyed');
    surface.once.mock.calls[0]![1]();
    expect(filter.destroy).toHaveBeenCalledOnce();
  });

  it('draws plain fills again once unbound', () => {
    const front = recorder();
    const surface = recorder();
    bindGlassSurface(front.graphics, surface.graphics);
    unbindGlassSurface(front.graphics);
    drawGlassSurface(front.graphics, 10, 20, 100, 40);
    expect(surface.rectangles).toEqual([]);
    expect(front.rectangles).toEqual([[10, 20, 100, 40]]);
    expect(front.fills[0]!.alpha).toBe(0.96);
  });
});

describe('frostedGlassEnabled', () => {
  it('follows the player, else the setting default', () => {
    expect(frostedGlassEnabled({ frostedGlass: true })).toBe(true);
    expect(frostedGlassEnabled({ frostedGlass: false })).toBe(false);
    expect(frostedGlassEnabled(undefined)).toBe(FROSTED_GLASS_SETTING.default);
    expect(frostedGlassEnabled({})).toBe(FROSTED_GLASS_SETTING.default);
  });
});

describe('isMacOS', () => {
  it('recognises a Mac from its platform hints', () => {
    expect(isMacOS({ userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isMacOS({ platform: 'MacIntel', maxTouchPoints: 0 })).toBe(true);
    expect(isMacOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
  });

  it('turns down Windows, Linux, phones, an iPad posing as a Mac, and no navigator', () => {
    expect(isMacOS({ userAgentData: { platform: 'Windows' }, platform: 'Win32' })).toBe(false);
    expect(isMacOS({ platform: 'Linux x86_64' })).toBe(false);
    expect(isMacOS({ platform: 'iPhone', maxTouchPoints: 5 })).toBe(false);
    expect(isMacOS({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe(false);
    expect(isMacOS(undefined)).toBe(false);
  });
});
