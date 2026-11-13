import { Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader, Texture, UniformGroup } from 'pixi.js';
import type { Container, Graphics } from 'pixi.js';

/**
 * Floats a point takes in a {@link PointLayer}'s instance buffer: `x, y, half size`, then the packed colour's bits (read
 * as `unorm8x4`, the way Pixi's particles read theirs).
 */
export const POINT_STRIDE = 4;

/** Points a layer has room for before its first growth. */
const INITIAL_POINTS = 256;

/** One ±1 quad every layer draws once per point, with the per-point data stepping by instance. */
const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/** Narrowest a point is drawn, in device pixels; a smaller one grows to it and fades by the area it gained. */
const MIN_POINT_PIXELS = '1.0';

const POINT_VERTEX_GLSL = /* glsl */ `#version 300 es
const float MIN_POINT_PIXELS = ${MIN_POINT_PIXELS};
in vec2 aPosition;
in vec3 aPoint;
in vec4 aColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec4 uFrame;
out vec2 vUV;
out vec4 vColor;

void main() {
  mat3 matrix = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  // A point under a device pixel across grows to one pixel and fades by the area it gained, so it gives off the same
  // light without dropping out between pixel centres (the player's skin texture is not multisampled).
  float side = aPoint.z * length(matrix[0].xy) * uResolution.x;
  float grown = max(side, MIN_POINT_PIXELS);
  float coverage = side * side / (grown * grown);
  vec2 world = aPoint.xy + aPosition * aPoint.z * (grown / max(side, 1e-6));
  gl_Position = vec4((matrix * vec3(world, 1.0)).xy, 0.0, 1.0);
  vUV = mix(uFrame.xy, uFrame.zw, aPosition * 0.5 + 0.5);
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha * coverage;
}
`;

const POINT_FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vColor;
uniform sampler2D uTexture;
out vec4 finalColor;

void main() {
  finalColor = texture(uTexture, vUV) * vColor;
}
`;

const POINT_WGSL = /* wgsl */ `
const MIN_POINT_PIXELS: f32 = ${MIN_POINT_PIXELS};
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
}

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
}

struct PointUniforms {
  uFrame: vec4<f32>,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uSampler: sampler;
@group(2) @binding(2) var<uniform> pointUniforms: PointUniforms;

struct PointOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
}

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aPoint: vec3<f32>,
  @location(2) aColor: vec4<f32>,
) -> PointOut {
  let matrix = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let side = aPoint.z * length(matrix[0].xy) * globalUniforms.uResolution.x;
  let grown = max(side, MIN_POINT_PIXELS);
  let coverage = side * side / (grown * grown);
  let world = aPoint.xy + aPosition * aPoint.z * (grown / max(side, 1e-6));
  var out: PointOut;
  out.position = vec4<f32>((matrix * vec3<f32>(world, 1.0)).xy, 0.0, 1.0);
  out.uv = mix(pointUniforms.uFrame.xy, pointUniforms.uFrame.zw, aPosition * 0.5 + 0.5);
  out.color = vec4<f32>(aColor.rgb * aColor.a, aColor.a) * localUniforms.uColor * globalUniforms.uWorldColorAlpha * coverage;
  return out;
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @location(1) color: vec4<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv) * color;
}
`;

let programs: { gl: GlProgram; gpu: GpuProgram } | undefined;
let corners: Buffer | undefined;
let quadIndices: Buffer | undefined;

function pointPrograms(): { gl: GlProgram; gpu: GpuProgram } {
  programs ??= {
    gl: GlProgram.from({ vertex: POINT_VERTEX_GLSL, fragment: POINT_FRAGMENT_GLSL, name: 'point-layer' }),
    gpu: GpuProgram.from({
      name: 'point-layer',
      vertex: { source: POINT_WGSL, entryPoint: 'mainVertex' },
      fragment: { source: POINT_WGSL, entryPoint: 'mainFragment' },
    }),
  };
  return programs;
}

/**
 * Points drawn as instanced quads instead of `Graphics` geometry.
 *
 * The built-in skins scatter thousands of tiny marks every frame (Synesthesia's floor lattice, dust, and powder — some
 * sixteen thousand a frame). As `Graphics` shapes each one is re-triangulated and re-uploaded per frame; even as Pixi
 * particles each one is four vertices rebuilt by a per-particle upload loop. Here each mark is four floats written
 * straight into the layer's instance buffer — `x, y, half size, colour` — and the buffer goes to the GPU as it is, 16
 * bytes a point, with no per-point object or upload loop. One draw per layer instances a quad over them.
 *
 * A layer rides along with an anchor `Graphics` (a pooled graphics the skin acquires in the same order every frame):
 * it sits right after the anchor in the anchor's parent and copies the anchor's blend mode, so its points paint exactly
 * where the anchor's rects would have. Each frame the points written since the last render are shown and the rest are
 * dropped, so a layer whose anchor stops receiving points simply goes empty.
 */
export class PointLayer {
  private readonly mesh: Mesh<Geometry, Shader>;
  private readonly geometry: Geometry;
  private readonly buffer: Buffer;
  private data = new Float32Array(INITIAL_POINTS * POINT_STRIDE);
  private words = new Uint32Array(this.data.buffer);
  private cursor = 0;
  private touched = false;

  private readonly anchor: Graphics;
  /** Position among the anchor's layers; layer `slot` sits `slot + 1` children after the anchor. */
  private readonly slot: number;

  public constructor(anchor: Graphics, texture: Texture = Texture.WHITE, slot = 0) {
    this.anchor = anchor;
    this.slot = slot;
    corners ??= new Buffer({ data: CORNERS, usage: BufferUsage.VERTEX });
    quadIndices ??= new Buffer({ data: QUAD_INDICES, usage: BufferUsage.INDEX });
    this.buffer = new Buffer({ data: this.data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const stride = POINT_STRIDE * 4;
    this.geometry = new Geometry({
      attributes: {
        aPosition: { buffer: corners, format: 'float32x2' },
        aPoint: { buffer: this.buffer, format: 'float32x3', stride, offset: 0, instance: true },
        aColor: { buffer: this.buffer, format: 'unorm8x4', stride, offset: 12, instance: true },
      },
      indexBuffer: quadIndices,
    });
    this.geometry.instanceCount = 0;
    const { uvs } = texture;
    const { gl, gpu } = pointPrograms();
    const shader = new Shader({
      glProgram: gl,
      gpuProgram: gpu,
      resources: {
        uTexture: texture.source,
        uSampler: texture.source.style,
        pointUniforms: new UniformGroup({
          uFrame: { value: new Float32Array([uvs.x0, uvs.y0, uvs.x2, uvs.y2]), type: 'vec4<f32>' },
        }),
      },
    });
    this.mesh = new Mesh({ geometry: this.geometry, shader, texture });
    this.mesh.label = 'point-layer';
    this.mesh.onRender = () => this.commit();
  }

  /** Points written since the last render. */
  public get count(): number {
    return this.touched ? this.cursor : 0;
  }

  /** The point `index` written since the last render, as `[x, y, half size, packed colour]`. */
  public pointAt(index: number): [number, number, number, number] {
    const at = index * POINT_STRIDE;
    return [this.data[at]!, this.data[at + 1]!, this.data[at + 2]!, this.words[at + 3]!];
  }

  /** Writes one square point (or one copy of the layer's texture) `size` px wide, centred on `(cx, cy)`. */
  public point(cx: number, cy: number, size: number, color: number, alpha: number): void {
    if (!this.touched) {
      // Once per frame, on its first point: the anchor does not move among its siblings between two points.
      this.attach();
      this.touched = true;
      this.cursor = 0;
    }
    const at = this.cursor * POINT_STRIDE;
    if (at >= this.data.length) this.grow();
    const data = this.data;
    data[at] = cx;
    data[at + 1] = cy;
    data[at + 2] = size * 0.5;
    this.words[at + 3] = packParticleColor(color, alpha);
    this.cursor += 1;
  }

  private grow(): void {
    const data = new Float32Array(this.data.length * 2);
    data.set(this.data);
    this.data = data;
    this.words = new Uint32Array(data.buffer);
  }

  /**
   * Keeps the layer right after its anchor (after the anchor's earlier layers), so the anchor's later siblings (HUD
   * panels, text) stay on top.
   */
  private attach(): void {
    const parent: Container | null = this.anchor.parent;
    if (!parent) return;
    if (this.mesh.parent !== parent) parent.addChild(this.mesh);
    const target = parent.getChildIndex(this.anchor) + 1 + this.slot;
    if (parent.getChildIndex(this.mesh) !== target) {
      parent.setChildIndex(this.mesh, Math.min(target, parent.children.length - 1));
    }
    this.mesh.blendMode = this.anchor.blendMode;
    this.mesh.visible = this.anchor.visible;
  }

  /** Runs just before the mesh renders: uploads this frame's points and drops the rest. */
  private commit(): void {
    const count = this.count;
    this.geometry.instanceCount = count;
    // Only the points shown go up; a grown array replaces the GPU buffer.
    if (count > 0) this.buffer.setDataWithSize(this.data, count * POINT_STRIDE, true);
    this.touched = false;
    this.cursor = 0;
  }
}

/**
 * A particle's packed `color` for an `0xRRGGBB` tint and an alpha, as Pixi's `Particle` computes it from `tint` and
 * `alpha` (BGR in the low 24 bits, the alpha byte above, added as Pixi adds them).
 */
export function packParticleColor(rgb: number, alpha: number): number {
  const bgr = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
  return bgr + (((Math.min(Math.max(alpha, 0), 1) * 255) | 0) << 24);
}

const LAYERS = new WeakMap<Graphics, Map<Texture, PointLayer>>();

/**
 * The point layer riding along with `anchor` that draws `texture` (Pixi's 1x1 white by default), created on first use.
 * A layer draws a single texture, so each texture gets its own layer; an anchor's layers stack in the order they were
 * first asked for.
 */
export function pointLayerFor(anchor: Graphics, texture: Texture = Texture.WHITE): PointLayer {
  let layers = LAYERS.get(anchor);
  if (!layers) {
    layers = new Map();
    LAYERS.set(anchor, layers);
  }
  let layer = layers.get(texture);
  if (!layer) {
    layer = new PointLayer(anchor, texture, layers.size);
    layers.set(texture, layer);
  }
  return layer;
}
