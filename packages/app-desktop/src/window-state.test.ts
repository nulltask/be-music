import { describe, expect, it } from 'vite-plus/test';
import { MINIMUM_WINDOW_SIZE, parseWindowState, restorableBounds } from './window-state.ts';

const MAIN = { x: 0, y: 25, width: 1440, height: 875 };
const RIGHT = { x: 1440, y: 0, width: 1920, height: 1080 };

describe('parseWindowState', () => {
  it('reads a saved state', () => {
    const text = JSON.stringify({ bounds: { x: 10, y: 40, width: 1280, height: 800 }, maximized: true });
    expect(parseWindowState(text)).toEqual({
      bounds: { x: 10, y: 40, width: 1280, height: 800 },
      maximized: true,
      fullScreen: false,
    });
  });

  it('rounds fractional bounds', () => {
    expect(parseWindowState('{"bounds":{"x":1.4,"y":2.6,"width":800.5,"height":600}}')?.bounds).toEqual({
      x: 1,
      y: 3,
      width: 801,
      height: 600,
    });
  });

  it('returns null for anything malformed', () => {
    expect(parseWindowState('')).toBeNull();
    expect(parseWindowState('null')).toBeNull();
    expect(parseWindowState('{"bounds":{"x":0,"y":0,"width":"wide","height":600}}')).toBeNull();
    expect(parseWindowState('{"maximized":true}')).toBeNull();
  });
});

describe('restorableBounds', () => {
  it('restores bounds on a display', () => {
    const bounds = { x: 100, y: 100, width: 1280, height: 720 };
    expect(restorableBounds(bounds, [MAIN])).toEqual(bounds);
  });

  it('restores bounds on a second display', () => {
    const bounds = { x: 1600, y: 100, width: 1280, height: 720 };
    expect(restorableBounds(bounds, [MAIN, RIGHT])).toEqual(bounds);
  });

  it('drops bounds left on an unplugged display', () => {
    expect(restorableBounds({ x: 1600, y: 100, width: 1280, height: 720 }, [MAIN])).toBeUndefined();
  });

  it('drops bounds whose title bar is off screen', () => {
    expect(restorableBounds({ x: 100, y: 0, width: 1280, height: 720 }, [MAIN])).toBeUndefined();
    expect(restorableBounds({ x: 1380, y: 100, width: 1280, height: 720 }, [MAIN])).toBeUndefined();
    expect(restorableBounds({ x: 100, y: 880, width: 1280, height: 720 }, [MAIN])).toBeUndefined();
  });

  it('grows bounds to the minimum size', () => {
    expect(restorableBounds({ x: 100, y: 100, width: 200, height: 100 }, [MAIN])).toEqual({
      x: 100,
      y: 100,
      ...MINIMUM_WINDOW_SIZE,
    });
  });

  it('opens at the default size with nothing saved', () => {
    expect(restorableBounds(undefined, [MAIN])).toBeUndefined();
  });
});
