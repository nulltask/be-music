import { Container } from 'pixi.js';
import { expect, test, vi } from 'vite-plus/test';
import { renderBuiltInChrome, type BuiltInChromeContext, type SkinlessGameplayChromeRuntime } from './play-chrome.ts';

test('forwards a draw-local runtime without resolving or mutating it again', () => {
  const pool = () => ({ begin: vi.fn(), end: vi.fn() });
  const ctx = {
    skinLayer: new Container(),
    overlayLayer: new Container(),
    bgaLayer: new Container(),
    skinLayerPool: pool(),
    overlayLayerPool: pool(),
    get play() {
      throw new Error('must use the supplied snapshot');
    },
  } as unknown as BuiltInChromeContext;
  const first = Object.freeze({ score: 10, judgeSides: Object.freeze([]) }) as unknown as SkinlessGameplayChromeRuntime;
  const next = Object.freeze({ score: 20, judgeSides: Object.freeze([]) }) as unknown as SkinlessGameplayChromeRuntime;
  const retained: SkinlessGameplayChromeRuntime[] = [];
  renderBuiltInChrome(ctx, ({ runtime }) => retained.push(runtime), first);
  renderBuiltInChrome(ctx, ({ runtime }) => retained.push(runtime), next);
  expect(retained).toEqual([first, next]);
  expect(retained[0]).toBe(first);
  expect(retained[0]!.score).toBe(10);
  expect(ctx.skinLayerPool.begin).toHaveBeenCalledTimes(2);
  expect(ctx.skinLayerPool.end).toHaveBeenCalledTimes(2);
  expect(ctx.overlayLayerPool.end).toHaveBeenCalledTimes(2);
  ctx.skinLayer.destroy();
  ctx.overlayLayer.destroy();
  ctx.bgaLayer.destroy();
});
