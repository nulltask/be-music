import { extractStructAndGroups, generateGpuLayoutGroups, GpuProgram } from 'pixi.js';

/**
 * The charge cloud's shaders in WGSL, for a player rendering with WebGPU: line for line the GLSL programs in
 * `charge-cloud.ts` (see the comments there for what each step does). Two things differ:
 * - WebGPU draws points one pixel wide, so the particles are drawn as one instanced quad each, sized as the GL point
 *   would be.
 * - WebGPU's framebuffer y runs down where GL's runs up, so the grid splat flips y to land each particle on the texel
 *   `textureLoad` reads back.
 */

const COMMON_WGSL = /* wgsl */ `
const ORBS: i32 = 5;
const CAMERA: f32 = 4.0;
const GRID: i32 = 32;
const GRID_EXTENT: f32 = 1.1;
const GRID_SCALE: f32 = 1.0 / 64.0;

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

struct CloudUniforms {
  uOrbs: array<vec4<f32>, 5>,
  uAxes: array<vec4<f32>, 5>,
  uLights: array<vec4<f32>, 5>,
  uSim: vec4<f32>,
  uSim2: vec4<f32>,
  uView: vec4<f32>,
  uClip: vec4<f32>,
  uBands0: vec4<f32>,
  uBands1: vec4<f32>,
  uBands2: vec4<f32>,
  uBands3: vec4<f32>,
  uFlock: vec4<f32>,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> cloud: CloudUniforms;

fn gridCell(p: vec3<f32>) -> vec3<i32> {
  let g = (p / GRID_EXTENT * 0.5 + 0.5) * f32(GRID);
  return clamp(vec3<i32>(floor(g)), vec3<i32>(0), vec3<i32>(GRID - 1));
}

fn gridTexel(c: vec3<i32>) -> vec2<i32> {
  return vec2<i32>((c.z % 8) * GRID + c.x, (c.z / 8) * GRID + c.y);
}

fn clipped(local: vec2<f32>) -> bool {
  let clip = cloud.uClip;
  return local.x < clip.x || local.y < clip.y || local.x > clip.z || local.y > clip.w;
}

fn orbCharge(index: i32) -> f32 {
  return select(-1.0, 1.0, index % 2 == 0);
}

fn particleBand(seed: f32) -> i32 {
  return i32(floor(fract(seed * 7.13) * 16.0));
}

fn particleCharge(seed: f32) -> f32 {
  return select(-1.0, 1.0, fract(seed * 3.71) < 0.5);
}

fn bandLevel(band: i32) -> f32 {
  var bands = array<vec4<f32>, 4>(cloud.uBands0, cloud.uBands1, cloud.uBands2, cloud.uBands3);
  return bands[band / 4][band % 4];
}

fn toCamera(p: vec3<f32>) -> vec3<f32> {
  let cy = cos(cloud.uView.y);
  let sy = sin(cloud.uView.y);
  let cx = cos(cloud.uView.z);
  let sx = sin(cloud.uView.z);
  let q = vec3<f32>(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  return vec3<f32>(q.x, cx * q.y - sx * q.z, sx * q.y + cx * q.z);
}

fn perspective(z: f32) -> f32 {
  return CAMERA / max(0.5, CAMERA + z);
}

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn hash11(n: f32) -> f32 {
  return f32(pcg(bitcast<u32>(n))) / 4294967295.0;
}

fn randomUnit(a: f32, b: f32) -> vec3<f32> {
  let z = a * 2.0 - 1.0;
  let theta = b * 6.2831853;
  let r = sqrt(max(0.0, 1.0 - z * z));
  return vec3<f32>(r * cos(theta), z, r * sin(theta));
}
`;

const STATE_TEXTURES_WGSL = /* wgsl */ `
@group(2) @binding(1) var uPositions: texture_2d<f32>;
@group(2) @binding(2) var uVelocities: texture_2d<f32>;
`;

const QUAD_VERTEX_WGSL = /* wgsl */ `
@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> @builtin(position) vec4<f32> {
  return vec4<f32>(aPosition, 0.0, 1.0);
}
`;

const VELOCITY_WGSL = /* wgsl */ `
${COMMON_WGSL}
${STATE_TEXTURES_WGSL}
@group(2) @binding(3) var uGrid: texture_2d<f32>;
${QUAD_VERTEX_WGSL}

fn gridAt(c: vec3<i32>) -> vec4<f32> {
  if (any(c < vec3<i32>(0)) || any(c > vec3<i32>(GRID - 1))) {
    return vec4<f32>(0.0);
  }
  return textureLoad(uGrid, gridTexel(c), 0);
}

fn gridSample(p: vec3<f32>) -> vec4<f32> {
  let g = (p / GRID_EXTENT * 0.5 + 0.5) * f32(GRID) - 0.5;
  let base = vec3<i32>(floor(g));
  let f = g - floor(g);
  let c000 = gridAt(base);
  let c100 = gridAt(base + vec3<i32>(1, 0, 0));
  let c010 = gridAt(base + vec3<i32>(0, 1, 0));
  let c110 = gridAt(base + vec3<i32>(1, 1, 0));
  let c001 = gridAt(base + vec3<i32>(0, 0, 1));
  let c101 = gridAt(base + vec3<i32>(1, 0, 1));
  let c011 = gridAt(base + vec3<i32>(0, 1, 1));
  let c111 = gridAt(base + vec3<i32>(1, 1, 1));
  return mix(
    mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
    mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y),
    f.z,
  );
}

fn flockForce(p: vec3<f32>, v: vec3<f32>) -> vec3<f32> {
  let cell = 4.0 * GRID_EXTENT / f32(GRID);
  let here = gridSample(p);
  if (here.w < GRID_SCALE * 0.5) {
    return vec3<f32>(0.0);
  }
  let average = here.xyz / here.w;
  var force = (average - v) * cloud.uFlock.y;
  let gradient = vec3<f32>(
    gridSample(p + vec3<f32>(cell, 0.0, 0.0)).w - gridSample(p - vec3<f32>(cell, 0.0, 0.0)).w,
    gridSample(p + vec3<f32>(0.0, cell, 0.0)).w - gridSample(p - vec3<f32>(0.0, cell, 0.0)).w,
    gridSample(p + vec3<f32>(0.0, 0.0, cell)).w - gridSample(p - vec3<f32>(0.0, 0.0, cell)).w,
  ) / GRID_SCALE;
  let density = here.w / GRID_SCALE;
  let spread = length(gradient);
  if (spread > 1e-3) {
    force += gradient / spread * clamp(1.0 - density / cloud.uFlock.x, -1.5, 1.0) * cloud.uFlock.z;
  }
  return force;
}

fn orbForce(index: i32, p: vec3<f32>, charge: f32, level: f32, seed: f32) -> vec3<f32> {
  let orb = cloud.uOrbs[index];
  let axis = cloud.uAxes[index];
  let d = p - orb.xyz;
  let r = max(length(d), 1e-3);
  let n = d / r;
  let energy = axis.w;
  let pull = charge * orbCharge(index);
  let strength = (0.2 + 1.3 * level) * (0.7 + 0.8 * energy);
  var force = n * pull * select(1.0, 0.5, pull > 0.0) * strength / (r * r + 0.1);
  let shell = orb.w * 1.3 + 0.06 + 0.65 * fract(seed * 13.7);
  force += -n * (r - shell) * 0.7 / (1.0 + 2.0 * r * r);
  force += n * max(0.0, orb.w * 1.15 - r) * 160.0;
  force += cross(axis.xyz, d) * (0.3 + 0.8 * level + 0.4 * energy) / (r * r + 0.15);
  force += n * cloud.uLights[index].y * 4.0 * exp(-r * 4.0);
  return force;
}

fn flow(p: vec3<f32>, t: f32) -> vec3<f32> {
  return vec3<f32>(
    sin(p.y * 1.1 + t * 0.6) + 0.6 * sin(p.z * 1.7 - t * 0.4),
    sin(p.z * 1.2 + t * 0.5) + 0.6 * sin(p.x * 1.6 + t * 0.55),
    sin(p.x * 1.0 - t * 0.55) + 0.6 * sin(p.y * 1.8 + t * 0.35),
  );
}

@fragment
fn mainFragment(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let cell = vec2<i32>(fragCoord.xy);
  let position = textureLoad(uPositions, cell, 0);
  let velocity = textureLoad(uVelocities, cell, 0);
  var seed = velocity.w;
  if (cloud.uSim2.w < 0.5) {
    seed = f32(pcg(u32(cell.x) + u32(cell.y) * 4096u)) / 4294967295.0;
    return vec4<f32>(0.0, 0.0, 0.0, seed);
  }
  let dt = cloud.uSim.x;
  let life = 3.0 + 6.0 * seed;
  if (position.w + dt > life || length(position.xyz) > 3.0) {
    return vec4<f32>(0.0, 0.0, 0.0, seed);
  }
  let p = position.xyz;
  let charge = particleCharge(seed);
  let level = bandLevel(particleBand(seed));
  var force = vec3<f32>(0.0);
  for (var index = 0; index < ORBS; index += 1) {
    force += orbForce(index, p, charge, level, seed);
  }
  force -= p * 1.2 * smoothstep(0.7, 1.4, length(p));
  force += flockForce(p, velocity.xyz);
  var v = velocity.xyz * exp(-dt * 2.2) + force * dt;
  let stream = (flow(p * 1.3, cloud.uSim.y * 0.3) - flow(vec3<f32>(0.0), cloud.uSim.y * 0.3))
    * (0.18 + 0.25 * cloud.uSim2.z);
  v = mix(v, stream, 1.0 - exp(-dt * 0.5));
  let speed = length(v);
  if (speed > 1.4) {
    v *= 1.4 / speed;
  }
  return vec4<f32>(v, seed);
}
`;

const POSITION_WGSL = /* wgsl */ `
${COMMON_WGSL}
${STATE_TEXTURES_WGSL}
// Bound (the step quads share their resources) but unread.
@group(2) @binding(3) var uGrid: texture_2d<f32>;
${QUAD_VERTEX_WGSL}

fn spawn(seed: f32, salt: f32) -> vec3<f32> {
  let pick = i32(floor(hash11(seed * 91.7 + salt) * f32(ORBS)));
  let orb = cloud.uOrbs[min(pick, ORBS - 1)];
  let dir = randomUnit(hash11(seed * 13.1 + salt * 1.7), hash11(seed * 7.7 + salt * 3.1));
  return orb.xyz + dir * (orb.w * 1.3 + 0.06 + 0.65 * hash11(seed * 3.3 + salt));
}

@fragment
fn mainFragment(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let cell = vec2<i32>(fragCoord.xy);
  let position = textureLoad(uPositions, cell, 0);
  let velocity = textureLoad(uVelocities, cell, 0);
  let seed = velocity.w;
  let dt = cloud.uSim.x;
  if (cloud.uSim2.w < 0.5) {
    return vec4<f32>(spawn(seed, 0.0), seed * 9.0);
  }
  let life = 3.0 + 6.0 * seed;
  if (position.w + dt > life || length(position.xyz) > 3.0) {
    return vec4<f32>(spawn(seed, floor(cloud.uSim.y * 7.0)), 0.0);
  }
  return vec4<f32>(position.xyz + velocity.xyz * dt, position.w + dt);
}
`;

const SPLAT_WGSL = /* wgsl */ `
${COMMON_WGSL}
${STATE_TEXTURES_WGSL}

struct SplatUniforms {
  uSide: f32,
}

@group(2) @binding(3) var<uniform> splatUniforms: SplatUniforms;

struct SplatOut {
  @builtin(position) position: vec4<f32>,
  @location(0) value: vec4<f32>,
}

@vertex
fn mainVertex(@location(0) aSlot: f32, @builtin(vertex_index) vertexIndex: u32) -> SplatOut {
  let id = i32(vertexIndex);
  let side = i32(splatUniforms.uSide);
  let cell = vec2<i32>(id % side, id / side);
  let position = textureLoad(uPositions, cell, 0);
  let velocity = textureLoad(uVelocities, cell, 0);
  let texel = gridTexel(gridCell(position.xyz));
  let size = vec2<f32>(f32(GRID * 8), f32(GRID * 4));
  let ndc = (vec2<f32>(texel) + 0.5) / size * 2.0 - 1.0;
  let inside = all(abs(position.xyz) < vec3<f32>(GRID_EXTENT));
  var out: SplatOut;
  out.position = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  out.value = select(vec4<f32>(0.0), vec4<f32>(velocity.xyz, 1.0) * GRID_SCALE + aSlot * 0.0, inside);
  return out;
}

@fragment
fn mainFragment(@location(0) value: vec4<f32>) -> @location(0) vec4<f32> {
  return value;
}
`;

const PARTICLE_WGSL = /* wgsl */ `
${COMMON_WGSL}
${STATE_TEXTURES_WGSL}

struct ParticleUniforms {
  uSide: f32,
  uStroke: f32,
}

@group(2) @binding(3) var<uniform> particleUniforms: ParticleUniforms;

struct ParticleOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) alpha: f32,
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @builtin(instance_index) instance: u32) -> ParticleOut {
  let id = i32(instance);
  let side = i32(particleUniforms.uSide);
  let cell = vec2<i32>(id % side, id / side);
  let position = textureLoad(uPositions, cell, 0);
  let velocity = textureLoad(uVelocities, cell, 0);
  let seed = velocity.w;
  let c = toCamera(position.xyz);
  let k = perspective(c.z);
  let screen = c.xy * k * cloud.uView.x;

  var light = 0.0;
  var covered = false;
  for (var index = 0; index < ORBS; index += 1) {
    let orb = cloud.uOrbs[index];
    let gap = max(0.0, distance(position.xyz, orb.xyz) - orb.w);
    light += cloud.uLights[index].x * 0.03 / (gap * gap + 0.03);
    let oc = toCamera(orb.xyz);
    let ok = perspective(oc.z);
    covered = covered
      || (c.z > oc.z && distance(screen, oc.xy * ok * cloud.uView.x) < orb.w * ok * cloud.uView.x * 0.98);
  }
  light = 1.0 - exp(-light);

  let weight = 0.3 + 0.7 * fract(seed * 5.31);
  let indigo = vec3<f32>(0.2, 0.18, 0.8);
  let violet = vec3<f32>(0.55, 0.34, 1.0);
  let pink = vec3<f32>(1.0, 0.45, 0.85);
  let white = vec3<f32>(1.0, 0.95, 1.0);
  let lit = select(mix(pink, white, light * 2.0 - 1.0), mix(violet, pink, light * 2.0), light < 0.5);

  let life = 3.0 + 6.0 * seed;
  let fade = smoothstep(0.0, 0.5, position.w) * (1.0 - smoothstep(life - 0.8, life, position.w));
  let hidden = select(1.0, 0.0, covered || clipped(screen));
  let depth = clamp(1.25 - 0.35 * c.z, 0.4, 1.6);
  let shimmer = 1.0 - (0.2 + 0.5 * cloud.uSim2.y) * (0.5 + 0.5 * sin(cloud.uSim.y * 7.0 + f32(id) * 2.39));
  let spread = clamp(pow(cloud.uView.x / 170.0, 1.6), 0.5, 3.0);

  let matrix = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let centre = (matrix * vec3<f32>(screen, 1.0)).xy;
  let pixels = abs(matrix[0][0]) * globalUniforms.uResolution.x * 0.5;
  let size = select(0.0, max(1.0, max(0.6, 0.9 * (0.5 + weight) * depth) * pixels), hidden > 0.0);

  var out: ParticleOut;
  // The quad covers what a GL point of \`size\` pixels would.
  out.position = vec4<f32>(centre + aPosition * size / globalUniforms.uResolution, 0.0, 1.0);
  out.color = indigo * (0.8 + 0.5 * cloud.uSim2.z) + lit * light;
  out.alpha = cloud.uView.w * hidden * fade * weight * shimmer * min(1.4, depth) * (0.55 + 0.9 * light)
    * particleUniforms.uStroke * spread;
  return out;
}

@fragment
fn mainFragment(@location(0) color: vec3<f32>, @location(1) alpha: f32) -> @location(0) vec4<f32> {
  return vec4<f32>(color * alpha, 0.0) * localUniforms.uColor.a;
}
`;

const ORB_WGSL = /* wgsl */ `
${COMMON_WGSL}

struct OrbUniforms {
  uIndex: f32,
}

@group(2) @binding(1) var<uniform> orbUniforms: OrbUniforms;

struct OrbOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) screen: vec2<f32>,
  @location(2) lightDir: vec2<f32>,
  @location(3) radius: f32,
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> OrbOut {
  let index = i32(orbUniforms.uIndex);
  let orb = cloud.uOrbs[index];
  let oc = toCamera(orb.xyz);
  let k = perspective(oc.z);
  let centre = oc.xy * k * cloud.uView.x;
  let radius = orb.w * k * cloud.uView.x;
  let extent = 3.0 + 9.0 * cloud.uLights[index].y;
  var out: OrbOut;
  out.local = aPosition * extent;
  out.screen = centre + aPosition * extent * radius;
  out.lightDir = normalize(-centre + vec2<f32>(0.0, -0.4 * radius) + vec2<f32>(1e-3));
  out.radius = radius;
  let matrix = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  out.position = vec4<f32>((matrix * vec3<f32>(out.screen, 1.0)).xy, 0.0, 1.0);
  return out;
}

@fragment
fn mainFragment(orbIn: OrbOut) -> @location(0) vec4<f32> {
  if (clipped(orbIn.screen)) {
    discard;
  }
  let index = i32(orbUniforms.uIndex);
  let light = cloud.uLights[index];
  let brightness = light.x;
  let flash = light.y;
  let d = length(orbIn.local);
  let dir = orbIn.local / max(d, 1e-4);
  let facing = 0.3 + 0.7 * max(0.0, dot(dir, orbIn.lightDir));
  let pink = vec3<f32>(1.0, 0.5, 0.88);
  let violet = vec3<f32>(0.6, 0.42, 1.0);
  let white = vec3<f32>(1.0, 0.96, 1.0);
  let tint = mix(violet, pink, clamp(light.z, 0.0, 1.0));
  let alpha = cloud.uView.w;
  if (d < 1.0) {
    let nz = sqrt(1.0 - d * d);
    let body = vec3<f32>(0.01, 0.005, 0.025) * (0.6 + 0.8 * nz);
    let edge = tint * pow(1.0 - nz, 4.0) * facing * (0.3 + 0.8 * brightness);
    let aa = clamp((1.0 - d) * orbIn.radius, 0.0, 1.0);
    return vec4<f32>((body + edge) * aa, aa) * alpha * localUniforms.uColor.a;
  }
  let ringOffset = (d - 1.25) * 9.0;
  let ring = exp(-ringOffset * ringOffset) * facing * (0.06 + 0.8 * brightness);
  let glow = exp(-(d - 1.0) * 3.0) * (0.06 + 0.35 * brightness) * facing;
  let angle = atan2(dir.y, dir.x);
  let t = cloud.uSim.y;
  let shafts = pow(0.5 + 0.5 * sin(angle * 21.0 + orbUniforms.uIndex * 5.0 + t * 0.5), 10.0)
    * pow(0.5 + 0.5 * sin(angle * 8.0 - t * 0.8 + orbUniforms.uIndex), 3.0);
  let rays = (shafts * 1.6 + 0.5) * exp(-(d - 1.0) * 0.5) * flash;
  let color = tint * (ring + glow) + mix(tint, white, 0.6) * rays + white * flash * 0.8 * exp(-(d - 1.0) * 1.5);
  let extent = 3.0 + 9.0 * flash;
  let fadeOut = 1.0 - smoothstep(extent * 0.75, extent, d);
  return vec4<f32>(color * fadeOut, 0.0) * alpha * localUniforms.uColor.a;
}
`;

/**
 * A WGSL program from one module with `mainVertex` / `mainFragment`. Its textures are bound as unfilterable floats: the
 * particle state is 32-bit float, which WebGPU filters only with an optional feature, and the shaders only ever
 * `textureLoad` it.
 */
function program(source: string, name: string): GpuProgram {
  const gpuLayout = generateGpuLayoutGroups(extractStructAndGroups(source));
  for (const group of gpuLayout) {
    for (const entry of group) {
      if (entry.texture) entry.texture = { ...entry.texture, sampleType: 'unfilterable-float' };
    }
  }
  return GpuProgram.from({
    name,
    vertex: { source, entryPoint: 'mainVertex' },
    fragment: { source, entryPoint: 'mainFragment' },
    gpuLayout,
  });
}

export interface ChargeCloudGpuPrograms {
  velocity: GpuProgram;
  position: GpuProgram;
  particles: GpuProgram;
  orb: GpuProgram;
  splat: GpuProgram;
}

let programs: ChargeCloudGpuPrograms | undefined;

/** The charge cloud's WGSL programs, built once. */
export function chargeCloudGpuPrograms(): ChargeCloudGpuPrograms {
  programs ??= {
    velocity: program(VELOCITY_WGSL, 'charge-cloud-velocity'),
    position: program(POSITION_WGSL, 'charge-cloud-position'),
    particles: program(PARTICLE_WGSL, 'charge-cloud-particles'),
    orb: program(ORB_WGSL, 'charge-cloud-orb'),
    splat: program(SPLAT_WGSL, 'charge-cloud-splat'),
  };
  return programs;
}
