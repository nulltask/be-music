import { Container, Graphics, Particle, ParticleContainer, Texture } from 'pixi.js';
import { describe, expect, test, vi } from 'vite-plus/test';
import { pointLayerFor } from './particle-layer.ts';

describe('pointLayerFor', () => {
  test('keeps one layer per anchor and texture', () => {
    const anchor = new Graphics();
    const glow = Texture.EMPTY;
    const white = pointLayerFor(anchor);
    expect(pointLayerFor(anchor)).toBe(white);
    expect(pointLayerFor(anchor, Texture.WHITE)).toBe(white);
    const textured = pointLayerFor(anchor, glow);
    expect(textured).not.toBe(white);
    expect(pointLayerFor(anchor, glow)).toBe(textured);
    expect(pointLayerFor(new Graphics())).not.toBe(white);
  });
});

function setupLayer() {
  const host = new Container();
  const anchor = new Graphics();
  host.addChild(anchor);
  const layer = pointLayerFor(anchor);
  const point = (color = 0xff0000, alpha = 0.5) => layer.point(10, 20, 2, color, alpha);
  point();
  const container = host.getChildByLabel('particle-layer') as ParticleContainer;
  const commit = () => container.onRender?.(undefined as never);
  return { host, layer, container, point, commit };
}

test('keeps the active pool prefix through shrinking, growing and empty frames', () => {
  const { host, layer, container, point, commit } = setupLayer();
  point();
  commit();
  const children = container.particleChildren;
  const [first, second] = children;
  expect(children).toHaveLength(2);
  point();
  commit();
  expect(children).toHaveLength(1);
  expect(children[0]).toBe(first);
  point();
  point();
  layer.segment(0, 0, 3, 4, 2, 0x00ff00, 1);
  commit();
  expect(container.particleChildren).toBe(children);
  expect(children).toHaveLength(3);
  expect(children[0]).toBe(first);
  expect(children[1]).toBe(second);
  expect(children[2]!.scaleX).toBe(5);
  expect(children[2]!.rotation).toBeCloseTo(Math.atan2(4, 3));
  commit();
  expect(children).toHaveLength(0);
  point();
  commit();
  expect(children[0]).toBe(first);
  host.destroy({ children: true, context: true });
});

test('skips unchanged colors and opacity while preserving public tint, alpha and packed color', () => {
  const { host, container, point, commit } = setupLayer();
  commit();
  const particle = container.particleChildren[0]! as Particle;
  const tint = vi.spyOn(Particle.prototype, 'tint', 'set');
  const alpha = vi.spyOn(Particle.prototype, 'alpha', 'set');
  point();
  commit();
  expect(tint).not.toHaveBeenCalled();
  expect(alpha).not.toHaveBeenCalled();
  point(0x00ff00, 2);
  commit();
  expect(tint).toHaveBeenCalledTimes(1);
  expect(alpha).toHaveBeenCalledTimes(1);
  expect(particle.tint).toBe(0x00ff00);
  expect(particle.alpha).toBe(1);
  const reference = new Particle({ texture: Texture.WHITE, tint: 0x00ff00, alpha: 1 });
  expect(particle.color).toBe(reference.color);
  alpha.mockClear();
  point(0x00ff00, 3);
  commit();
  expect(alpha).not.toHaveBeenCalled();
  point(0x00ff00, -1);
  commit();
  expect(particle.alpha).toBe(0);
  tint.mockRestore();
  alpha.mockRestore();
  host.destroy({ children: true, context: true });
});
