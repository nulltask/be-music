import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { describe, expect, test, vi } from 'vitest';
import { destroyUniqueTextures, disposeChildren, staggerDestroyTextures } from './pixi-utils.ts';

/**
 * The hot render loops in `pixi-gameplay.ts` / `pixi-result.ts` / `pixi-select.ts` originally cleared their dynamic
 * layers with a bare `container.removeChildren()`, which only detaches children from the display tree — Pixi v8's
 * renderer-side state for each orphaned `Graphics` (its owned `GraphicsContext`) and `Text` (its glyph atlas slot)
 * survives the detach. After a few minutes of play that accumulated state freezes the page on the first scene
 * transition. `disposeChildren` is the destroy-on-remove helper that fixes that. The tests below pin the contract:
 *
 * 1. The container ends up empty.
 * 2. Each removed child reports `destroyed === true` (Pixi sets this flag inside `destroy()`, so a missed teardown
 *    would leave it `false`).
 * 3. `Graphics` children specifically have their owned context nulled — the only renderer-side handle the GC needs to
 *    release.
 * 4. Sprite-bound textures that are SHARED with other live sprites are NOT destroyed. Without this guarantee a per-
 *    frame disposeChildren would tear down the note atlas and blank subsequent renders.
 */
describe('disposeChildren', () => {
  test('detaches every child and marks each one destroyed', () => {
    const container = new Container();
    const a = new Container();
    const b = new Container();
    container.addChild(a, b);
    expect(container.children.length).toBe(2);
    disposeChildren(container);
    expect(container.children.length).toBe(0);
    expect(a.destroyed).toBe(true);
    expect(b.destroyed).toBe(true);
  });

  test('frees the owned GraphicsContext on Graphics children', () => {
    const container = new Container();
    const graphics = new Graphics();
    graphics.rect(0, 0, 10, 10).fill(0xff0000);
    container.addChild(graphics);
    // `_context` is the live owned-or-shared GraphicsContext; a successful `destroy({ context: true })` sets it to
    // null. Pre-condition: the freshly authored Graphics has a context.
    expect((graphics as unknown as { _context: unknown })._context).not.toBeNull();
    disposeChildren(container);
    expect(graphics.destroyed).toBe(true);
    expect((graphics as unknown as { _context: unknown })._context).toBeNull();
  });

  test('destroys Text children without throwing on the dynamic glyph atlas', () => {
    const container = new Container();
    const text = new Text({ text: 'hello', style: { fontSize: 12 } });
    container.addChild(text);
    expect(() => disposeChildren(container)).not.toThrow();
    expect(text.destroyed).toBe(true);
  });

  test('does not destroy textures shared by sprites that are still live', () => {
    // Use the always-available WHITE texture so the test doesn't depend on a real atlas decode. We register a second
    // sprite pointing at the same texture but NOT inside the container, simulating "atlas tile shared across the
    // scene". After disposing the container the live sprite must still be able to read the texture.
    const sharedTexture = Texture.WHITE;
    const container = new Container();
    const removed = new Sprite(sharedTexture);
    const stillAlive = new Sprite(sharedTexture);
    container.addChild(removed);
    disposeChildren(container);
    expect(removed.destroyed).toBe(true);
    expect(stillAlive.destroyed).toBe(false);
    // The shared texture must still be usable. `Texture.destroy()` sets `destroyed = true`; if `disposeChildren` had
    // blasted through with `texture: true`, this read would fail.
    expect((sharedTexture as unknown as { destroyed?: boolean }).destroyed).not.toBe(true);
  });

  test('leaves the host container itself alive (only its children are gone)', () => {
    // Important contract: hosts re-add fresh children every frame. Disposing them as well would force every render-loop
    // caller to re-create the layer on the next tick.
    const container = new Container();
    container.addChild(new Container(), new Container());
    disposeChildren(container);
    expect(container.destroyed).toBe(false);
    expect(container.children.length).toBe(0);
    // Re-add to verify the container is still functional.
    const newChild = new Container();
    container.addChild(newChild);
    expect(container.children.length).toBe(1);
  });

  test('is a no-op on an already-empty container', () => {
    const container = new Container();
    expect(() => disposeChildren(container)).not.toThrow();
    expect(container.children.length).toBe(0);
  });
});

describe('destroyUniqueTextures', () => {
  test('destroys each texture at most once and skips undefined slots', () => {
    const textureA = { destroy: vi.fn() } as unknown as Texture;
    const textureB = { destroy: vi.fn() } as unknown as Texture;
    expect(destroyUniqueTextures([textureA, undefined, textureA, textureB])).toBe(2);
    expect(textureA.destroy).toHaveBeenCalledTimes(1);
    expect(textureB.destroy).toHaveBeenCalledTimes(1);
    expect(textureA.destroy).toHaveBeenCalledWith(true);
  });
});

/**
 * `staggerDestroyTextures` is the dispose-time staggered variant of `destroyUniqueTextures`. The contract:
 *
 * 1. Returns the unique texture count immediately (synchronously), regardless of how the scheduler queues work.
 * 2. Runs at most `perFrame` destroy calls per scheduler tick.
 * 3. Stops the scheduler once the queue drains (no leaked tick callbacks).
 * 4. Skips duplicate / undefined entries, matching `destroyUniqueTextures`.
 */
describe('staggerDestroyTextures', () => {
  test('spreads destroys across ticks at perFrame cadence and stops when drained', () => {
    const textures = Array.from({ length: 7 }, () => ({ destroy: vi.fn() }) as unknown as Texture);
    const ticks: Array<() => void> = [];
    const stop = vi.fn();
    const scheduler = vi.fn((callback: () => void) => {
      ticks.push(callback);
      return stop;
    });
    const total = staggerDestroyTextures(textures, scheduler, { perFrame: 3 });
    expect(total).toBe(7);
    expect(scheduler).toHaveBeenCalledTimes(1);
    // Synchronous return — no destroys yet.
    for (const t of textures) expect(t.destroy).toHaveBeenCalledTimes(0);
    // Tick 1: first 3 textures.
    ticks[0]!();
    expect(textures.slice(0, 3).every((t) => (t.destroy as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(
      true,
    );
    expect(textures.slice(3).every((t) => (t.destroy as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
    expect(stop).not.toHaveBeenCalled();
    // Tick 2: next 3 textures (still 1 remaining).
    ticks[0]!();
    expect(textures.slice(0, 6).every((t) => (t.destroy as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(
      true,
    );
    expect(stop).not.toHaveBeenCalled();
    // Tick 3: drains the last texture and calls stop().
    ticks[0]!();
    for (const t of textures) expect(t.destroy).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test('deduplicates textures and skips undefined entries before scheduling', () => {
    const textureA = { destroy: vi.fn() } as unknown as Texture;
    const textureB = { destroy: vi.fn() } as unknown as Texture;
    const ticks: Array<() => void> = [];
    const scheduler = vi.fn((callback: () => void) => {
      ticks.push(callback);
      return () => undefined;
    });
    expect(staggerDestroyTextures([textureA, undefined, textureA, textureB], scheduler, { perFrame: 8 })).toBe(2);
    ticks[0]!();
    expect(textureA.destroy).toHaveBeenCalledTimes(1);
    expect(textureB.destroy).toHaveBeenCalledTimes(1);
  });

  test('returns 0 and never schedules a tick when the input is empty', () => {
    const scheduler = vi.fn();
    expect(staggerDestroyTextures([], scheduler)).toBe(0);
    expect(staggerDestroyTextures([undefined], scheduler)).toBe(0);
    expect(scheduler).not.toHaveBeenCalled();
  });
});
