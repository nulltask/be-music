import { Container, GlProgram, Graphics, Mesh, Particle, Texture } from 'pixi.js';
import { describe, expect, test, vi } from 'vite-plus/test';
import { packParticleColor, pointLayerFor } from './particle-layer.ts';

// Compiling the GLSL program probes a WebGL context for its precision, which Node has none of.
vi.spyOn(GlProgram, 'from').mockReturnValue({} as GlProgram);

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
  const above = new Graphics();
  host.addChild(anchor, above);
  const layer = pointLayerFor(anchor);
  layer.point(10, 20, 2, 0xff0000, 0.5);
  const mesh = host.getChildByLabel('point-layer') as Mesh;
  const commit = () => mesh.onRender?.(undefined as never);
  return { host, anchor, above, layer, mesh, commit };
}

test('sits right after its anchor and copies its blend mode', () => {
  const { host, anchor, above, mesh, commit } = setupLayer();
  expect(host.children).toEqual([anchor, mesh, above]);
  commit();
  anchor.blendMode = 'add';
  pointLayerFor(anchor).point(0, 0, 1, 0xffffff, 1);
  expect(mesh.blendMode).toBe('add');
  host.destroy({ children: true });
});

test('draws one instance per point written since the last render', () => {
  const { host, layer, mesh, commit } = setupLayer();
  layer.point(3, 4, 6, 0x00ff00, 1);
  expect(layer.count).toBe(2);
  expect(layer.pointAt(0)).toEqual([10, 20, 1, packParticleColor(0xff0000, 0.5) >>> 0]);
  expect(layer.pointAt(1)).toEqual([3, 4, 3, packParticleColor(0x00ff00, 1) >>> 0]);
  commit();
  expect(mesh.geometry.instanceCount).toBe(2);
  expect(layer.count).toBe(0);
  layer.point(1, 1, 1, 0, 1);
  commit();
  expect(mesh.geometry.instanceCount).toBe(1);
  commit();
  expect(mesh.geometry.instanceCount).toBe(0);
  host.destroy({ children: true });
});

test('grows past its first room and keeps the points written before', () => {
  const { host, layer, mesh, commit } = setupLayer();
  for (let index = 1; index < 1000; index += 1) layer.point(index, -index, 1, 0xffffff, 1);
  expect(layer.pointAt(0)[0]).toBe(10);
  expect(layer.pointAt(999)).toEqual([999, -999, 0.5, 0xffffffff]);
  commit();
  expect(mesh.geometry.instanceCount).toBe(1000);
  host.destroy({ children: true });
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
