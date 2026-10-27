import { Container, Graphics, Particle, ParticleContainer, Texture } from 'pixi.js';
import { describe, expect, test, vi } from 'vite-plus/test';
import { packParticleColor, pointLayerFor } from './particle-layer.ts';

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

test('writes the packed color Pixi would compute, without the tint and alpha setters', () => {
  const { host, container, point, commit } = setupLayer();
  commit();
  const particle = container.particleChildren[0]! as Particle;
  const tint = vi.spyOn(Particle.prototype, 'tint', 'set');
  const alpha = vi.spyOn(Particle.prototype, 'alpha', 'set');
  const reference = (color: number, opacity: number) =>
    new Particle({ texture: Texture.WHITE, tint: color, alpha: opacity }).color;
  tint.mockClear();
  alpha.mockClear();
  point();
  commit();
  expect(particle.color).toBe(reference(0xff0000, 0.5));
  point(0x00ff00, 2);
  commit();
  expect(particle.color).toBe(reference(0x00ff00, 1));
  point(0x123456, -1);
  commit();
  expect(particle.color).toBe(reference(0x123456, 0));
  // The references above use the setters; the layer itself never did.
  expect(tint).toHaveBeenCalledTimes(3);
  expect(alpha).toHaveBeenCalledTimes(3);
  tint.mockRestore();
  alpha.mockRestore();
  host.destroy({ children: true, context: true });
});

test('packs a tint and an alpha as Pixi does', () => {
  for (const [color, opacity] of [
    [0xffffff, 1],
    [0x000000, 0],
    [0xff8000, 0.5],
    [0x0080ff, 0.999],
    [0x123456, 1.5],
    [0xabcdef, -0.25],
  ] as const) {
    expect(packParticleColor(color, opacity)).toBe(
      new Particle({ texture: Texture.WHITE, tint: color, alpha: opacity }).color,
    );
  }
});
