import {
  Container,
  Geometry,
  GlProgram,
  Mesh,
  RenderTexture,
  Shader,
  UniformGroup,
  type TextureSource,
  type WebGLRenderer,
} from 'pixi.js';
import { type AudioDrive, bandLevel } from '@be-music/skin-sdk';
import { queueGpuPass } from '../pixi-kit/index.ts';

/**
 * Charge cloud — a classic music-visualizer idea: a handful of small, dark, charged orbs hang in a dense fluid
 * of particles. Each orb listens to its own slice of the spectrum and is a light: it flares the instant its range
 * hits, flashes for a tenth of a second, then glows down over about a second, throwing light shafts while it flares.
 * The particles are square dots like the rest of the skin's particle world, lit by the orbs (pink to white close to a
 * bright orb, deep indigo elsewhere), and moved by charge: drawn to the orbs of opposite sign, driven off by
 * those of their own, spun round each orb's axis, and flocking so the cloud folds in sheets rather than scattering. Each particle is tuned to one
 * spectrum band, which scales how hard the charges pull it.
 *
 * The particles live in float textures and step on the GPU each frame; the orbs are analytic spheres drawn by a
 * fragment shader, so they need no depth sorting against the particles (particles behind an orb are hidden in the
 * particle shader instead).
 */

export const CHARGE_ORB_COUNT = 5;

export interface ChargeOrb {
  /** Centre in the cloud's local units (y down, z away from the camera). */
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Unit spin axis. */
  axis: readonly [number, number, number];
  /** 0..1: how hard its spectrum range is hitting right now. */
  energy: number;
}

/** Each orb listens to one slice of the 16 spectrum bands, lows to highs. */
const ORB_BANDS: readonly (readonly [number, number])[] = [
  [0, 2],
  [3, 5],
  [6, 8],
  [9, 11],
  [12, 15],
];
const ORB_BASE_RADIUS = [0.13, 0.11, 0.1, 0.09, 0.08] as const;
const ORB_ORBIT = [
  { reach: 0.3, speed: 0.17, phase: 0, tilt: 0.5 },
  { reach: 0.52, speed: -0.23, phase: 1.3, tilt: -0.7 },
  { reach: 0.64, speed: 0.29, phase: 2.6, tilt: 1.1 },
  { reach: 0.45, speed: -0.33, phase: 3.9, tilt: -1.3 },
  { reach: 0.7, speed: 0.21, phase: 5.1, tilt: 0.2 },
] as const;
/** Each orb spins about its own, slowly wandering axis, so the coats they wind cross instead of stacking into a disc. */
const ORB_AXES: readonly (readonly [number, number, number])[] = [
  [0.25, -1, 0.15],
  [1, -0.35, 0.4],
  [-0.4, 0.3, 1],
  [0.6, 0.8, -0.3],
  [-1, -0.2, -0.5],
];

/**
 * Where the orbs are at `seconds` and how hard their bands hit: they circle the cloud's centre on tilted orbits and
 * swell a little with their band range. Pure, so the choreography is testable.
 */
export function chargeOrbs(seconds: number, drive: Pick<AudioDrive, 'bands' | 'onset'>): ChargeOrb[] {
  return ORB_ORBIT.map((orbit, index) => {
    const [from, to] = ORB_BANDS[index]!;
    let sum = 0;
    for (let band = from; band <= to; band += 1) sum += bandLevel(drive.bands, band, 16);
    const energy = Math.min(1, sum / (to - from + 1));
    const angle = orbit.phase + seconds * orbit.speed;
    const flatX = Math.cos(angle) * orbit.reach;
    const flatZ = Math.sin(angle) * orbit.reach;
    const precess = seconds * 0.11 + index * 2.1;
    const [ax, ay, az] = ORB_AXES[index]!;
    const axis = normalize3([ax + Math.sin(precess) * 0.35, ay + Math.cos(precess * 0.7) * 0.25, az]);
    return {
      x: flatX,
      y: flatZ * Math.sin(orbit.tilt) * 0.7,
      z: flatZ * Math.cos(orbit.tilt),
      radius: ORB_BASE_RADIUS[index]! * (1 + 0.2 * energy),
      axis,
      energy,
    };
  });
}

function normalize3([x, y, z]: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/** An orb's light: the short flash it fires when its band hits and the glow that lingers after. */
export interface OrbLight {
  flash: number;
  glow: number;
  /** Slow running average of the band's energy: what this orb has got used to. */
  mean: number;
  /** How far the band stood above that average last step, 0..1, to detect hits. */
  excess: number;
  /** Seconds left before the orb may flash again. */
  cooldown: number;
}

export const DARK_ORB: OrbLight = Object.freeze({ flash: 0, glow: 0, mean: 0, excess: 0, cooldown: 0 });

/** Time constants (s) of the flash and the glow after it. */
const FLASH_DECAY_S = 0.08;
const GLOW_DECAY_S = 0.9;
/** How long (s) the orb takes to get used to a new loudness. */
const ADAPT_S = 2.5;
/** After a flash the orb stays quiet this long (s), so a dense passage does not fuse into one long blaze. */
const FLASH_COOLDOWN_S = 0.18;
/** A rise in excess this big within one step counts as a hit; so does an onset while the excess is above ONSET_EXCESS. */
const HIT_RISE = 0.15;
const ONSET_EXCESS = 0.35;

/**
 * How far `energy` stands above what the orb is used to (`mean`), as 0..1: the band at its average reads 0, and the
 * remaining headroom up to full scale maps onto 0..1, so a quiet passage's peaks and a loud passage's peaks both
 * register. Pure.
 */
export function bandExcess(energy: number, mean: number): number {
  const floor = mean * 0.97;
  return Math.max(0, Math.min(1, (energy - floor) / Math.max(0.15, 1 - floor)));
}

/**
 * Advances one orb's light by `dt` seconds given its band `energy` (0..1) and the global `onset` (0..1). The orb
 * reacts to how far its band stands above its own running average rather than to raw loudness, so a sustained loud
 * passage settles back down and only real jumps light it up. A hit — the excess leaping up, or an onset while the
 * excess is high — fires the flash (attack within one frame) unless the orb flashed within the last
 * FLASH_COOLDOWN_S; the flash then falls away in about a tenth of a second while the glow, which follows the excess
 * and rises with every hit, decays over about a second. Pure.
 */
export function stepOrbLight(previous: OrbLight, energy: number, onset: number, dt: number): OrbLight {
  const mean = previous.mean + (energy - previous.mean) * (1 - Math.exp(-dt / ADAPT_S));
  const excess = bandExcess(energy, previous.mean);
  const rise = excess - previous.excess;
  const ready = previous.cooldown <= 0;
  const hit = ready && (rise > HIT_RISE || (onset > 0.6 && excess > ONSET_EXCESS)) ? Math.min(1, 0.3 + excess) : 0;
  const cooldown = hit > 0 ? FLASH_COOLDOWN_S : Math.max(0, previous.cooldown - dt);
  const flash = Math.max(hit, previous.flash * Math.exp(-dt / FLASH_DECAY_S));
  const glow = Math.max(excess * 0.5, hit * 0.8, previous.glow * Math.exp(-dt / GLOW_DECAY_S));
  return { flash, glow, mean, excess, cooldown };
}

/** How bright an orb's light is overall (what lights the particles). */
export function orbBrightness(light: OrbLight): number {
  return 0.05 + 0.8 * light.glow + 1.4 * light.flash;
}

export interface ChargeCloudFrame {
  /** Screen centre of the cloud and how many pixels one local unit spans. */
  x: number;
  y: number;
  scale: number;
  seconds: number;
  /** Seconds since the previous frame (clamped inside). */
  dt: number;
  drive: AudioDrive;
  alpha: number;
  /** Screen rect the cloud must stay inside (e.g. the idle monitor). */
  clip?: { x: number; y: number; w: number; h: number };
}

const ORBS = CHARGE_ORB_COUNT;

const COMMON_GLSL = /* glsl */ `
const int ORBS = ${ORBS};
// xyz centre, w radius
uniform vec4 uOrbs[ORBS];
// xyz spin axis, w band energy
uniform vec4 uAxes[ORBS];
// brightness, flash, glow, unused
uniform vec4 uLights[ORBS];
// dt, seconds, onset, bass
uniform vec4 uSim;
// mid, high, level, initialised (0 on the first step)
uniform vec4 uSim2;
// px per unit, camera yaw, camera pitch, alpha
uniform vec4 uView;
// Screen rect (in pixels relative to the cloud's centre) everything must stay inside: minX, minY, maxX, maxY.
uniform vec4 uClip;
// The 16 spectrum bands, four per vec4.
uniform vec4 uBands0;
uniform vec4 uBands1;
uniform vec4 uBands2;
uniform vec4 uBands3;

const float CAMERA = 4.0;

// The flocking grid: a 32³ lattice over [-GRID_EXTENT, GRID_EXTENT]³, stored as 32 slices of 32 × 32 laid out 8 × 4 in
// a 256 × 128 texture. Each texel holds the summed velocity (xyz) and count (w) of the particles in its cell, scaled by
// GRID_SCALE so half-float blending never overflows.
const int GRID = 32;
const float GRID_EXTENT = 1.1;
const float GRID_SCALE = 1.0 / 64.0;
// target density (particles per cell), alignment, cohesion, unused
uniform vec4 uFlock;

ivec3 gridCell(vec3 p) {
  vec3 g = (p / GRID_EXTENT * 0.5 + 0.5) * float(GRID);
  return clamp(ivec3(floor(g)), ivec3(0), ivec3(GRID - 1));
}

ivec2 gridTexel(ivec3 c) {
  return ivec2((c.z - (c.z / 8) * 8) * GRID + c.x, (c.z / 8) * GRID + c.y);
}

bool clipped(vec2 local) {
  return local.x < uClip.x || local.y < uClip.y || local.x > uClip.z || local.y > uClip.w;
}

/** Unlike charges attract, like charges repel; the orbs alternate in sign. */
float orbCharge(int index) {
  return index - (index / 2) * 2 == 0 ? 1.0 : -1.0;
}

/** The spectrum band (0..15) a particle listens to, and its own charge sign, both fixed by its seed. */
int particleBand(float seed) {
  return int(floor(fract(seed * 7.13) * 16.0));
}

float particleCharge(float seed) {
  return fract(seed * 3.71) < 0.5 ? 1.0 : -1.0;
}

float bandLevel(int band) {
  vec4 bands[4] = vec4[4](uBands0, uBands1, uBands2, uBands3);
  return bands[band / 4][band - (band / 4) * 4];
}

vec3 toCamera(vec3 p) {
  float cy = cos(uView.y);
  float sy = sin(uView.y);
  float cx = cos(uView.z);
  float sx = sin(uView.z);
  vec3 q = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  return vec3(q.x, cx * q.y - sx * q.z, sx * q.y + cx * q.z);
}

float perspective(float z) {
  return CAMERA / max(0.5, CAMERA + z);
}

// Integer (PCG) hashing: the usual fract(sin(x) * k) trick loses precision on GPUs for large x and collapses
// thousands of particles onto the same seed.
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float hash11(float n) {
  return float(pcg(floatBitsToUint(n))) / 4294967295.0;
}

vec3 randomUnit(float a, float b) {
  float z = a * 2.0 - 1.0;
  float theta = b * 6.2831853;
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(theta), z, r * sin(theta));
}
`;

const QUAD_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Velocity step. Particles and orbs carry charges: a particle is pulled toward orbs of the opposite sign and pushed
 * away from orbs of its own (inverse-square; repulsion at half strength), while a hard core keeps it off an orb's
 * surface and each orb spins nearby particles round its axis. The particle's spectrum band scales its charge and spin,
 * so when a frequency sounds, exactly the particles tuned to it surge in or blow out; a flaring orb also blasts its
 * neighbours outward. On top of that the particles flock (see flockForce), a slow large-scale swirl keeps them moving,
 * and a pull at the cloud's edge holds it together.
 */
const VELOCITY_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform highp sampler2D uPositions;
uniform highp sampler2D uVelocities;
uniform highp sampler2D uGrid;
${COMMON_GLSL}
out vec4 finalColor;

vec4 gridAt(ivec3 c) {
  if (any(lessThan(c, ivec3(0))) || any(greaterThan(c, ivec3(GRID - 1)))) return vec4(0.0);
  return texelFetch(uGrid, gridTexel(c), 0);
}

/**
 * Flocking from the grid instead of a neighbour search: steer toward the average velocity of the surrounding cells
 * (alignment), and along the density gradient toward company while the cell is emptier than the target density,
 * away from it once it is fuller (cohesion and separation). Particles that move together and keep a steady spacing
 * gather into the folded sheets and ribbons the fluid is made of.
 */
vec4 gridSample(vec3 p) {
  // Trilinear over the eight surrounding cell centres, so the forces vary smoothly instead of in cell-sized steps.
  vec3 g = (p / GRID_EXTENT * 0.5 + 0.5) * float(GRID) - 0.5;
  ivec3 base = ivec3(floor(g));
  vec3 f = g - floor(g);
  vec4 c000 = gridAt(base);
  vec4 c100 = gridAt(base + ivec3(1, 0, 0));
  vec4 c010 = gridAt(base + ivec3(0, 1, 0));
  vec4 c110 = gridAt(base + ivec3(1, 1, 0));
  vec4 c001 = gridAt(base + ivec3(0, 0, 1));
  vec4 c101 = gridAt(base + ivec3(1, 0, 1));
  vec4 c011 = gridAt(base + ivec3(0, 1, 1));
  vec4 c111 = gridAt(base + ivec3(1, 1, 1));
  return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y), mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}

vec3 flockForce(vec3 p, vec3 v) {
  // Two cells either way: a wider reach draws neighbouring clumps into one body instead of a spray of droplets.
  float cell = 4.0 * GRID_EXTENT / float(GRID);
  vec4 here = gridSample(p);
  if (here.w < GRID_SCALE * 0.5) return vec3(0.0);
  vec3 average = here.xyz / here.w;
  vec3 force = (average - v) * uFlock.y;
  vec3 gradient = vec3(
    gridSample(p + vec3(cell, 0.0, 0.0)).w - gridSample(p - vec3(cell, 0.0, 0.0)).w,
    gridSample(p + vec3(0.0, cell, 0.0)).w - gridSample(p - vec3(0.0, cell, 0.0)).w,
    gridSample(p + vec3(0.0, 0.0, cell)).w - gridSample(p - vec3(0.0, 0.0, cell)).w) / GRID_SCALE;
  float density = here.w / GRID_SCALE;
  float spread = length(gradient);
  if (spread > 1e-3) {
    force += gradient / spread * clamp(1.0 - density / uFlock.x, -1.5, 1.0) * uFlock.z;
  }
  return force;
}

vec3 orbForce(int index, vec3 p, float charge, float level, float seed) {
  vec4 orb = uOrbs[index];
  vec4 axis = uAxes[index];
  vec3 d = p - orb.xyz;
  float r = max(length(d), 1e-3);
  vec3 n = d / r;
  float energy = axis.w;
  float sign = charge * orbCharge(index);
  float strength = (0.2 + 1.3 * level) * (0.7 + 0.8 * energy);
  vec3 force = n * sign * (sign > 0.0 ? 0.5 : 1.0) * strength / (r * r + 0.1);
  // A loose coat: each particle drifts back toward its own height round the orb, so the cloud keeps its shape.
  float shell = orb.w * 1.3 + 0.06 + 0.65 * fract(seed * 13.7);
  force += -n * (r - shell) * 0.7 / (1.0 + 2.0 * r * r);
  force += n * max(0.0, orb.w * 1.15 - r) * 160.0;
  force += cross(axis.xyz, d) * (0.3 + 0.8 * level + 0.4 * energy) / (r * r + 0.15);
  force += n * uLights[index].y * 4.0 * exp(-r * 4.0);
  return force;
}

vec3 flow(vec3 p, float t) {
  // Every component depends only on the other two coordinates, so the field has no divergence: it swirls, never
  // bunches up. Low frequencies keep neighbouring particles on the same path.
  return vec3(
    sin(p.y * 1.1 + t * 0.6) + 0.6 * sin(p.z * 1.7 - t * 0.4),
    sin(p.z * 1.2 + t * 0.5) + 0.6 * sin(p.x * 1.6 + t * 0.55),
    sin(p.x * 1.0 - t * 0.55) + 0.6 * sin(p.y * 1.8 + t * 0.35));
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 position = texelFetch(uPositions, cell, 0);
  vec4 velocity = texelFetch(uVelocities, cell, 0);
  float seed = velocity.w;
  if (uSim2.w < 0.5) {
    seed = float(pcg(uint(cell.x) + uint(cell.y) * 4096u)) / 4294967295.0;
    finalColor = vec4(0.0, 0.0, 0.0, seed);
    return;
  }
  float dt = uSim.x;
  float life = 3.0 + 6.0 * seed;
  if (position.w + dt > life || length(position.xyz) > 3.0) {
    finalColor = vec4(0.0, 0.0, 0.0, seed);
    return;
  }
  vec3 p = position.xyz;
  float charge = particleCharge(seed);
  float level = bandLevel(particleBand(seed));
  vec3 force = vec3(0.0);
  for (int index = 0; index < ORBS; index += 1) {
    force += orbForce(index, p, charge, level, seed);
  }
  // Hold the cloud together only out at its edge, so the pull never drags the coats onto the orbs' inner sides.
  force -= p * 1.2 * smoothstep(0.7, 1.4, length(p));
  force += flockForce(p, velocity.xyz);
  vec3 v = velocity.xyz * exp(-dt * 2.2) + force * dt;
  // A gentle large-scale swirl on top keeps the flock from settling. Minus the flow at the centre: what is left only
  // swirls the cloud about, it never carries it off as a whole.
  vec3 stream = (flow(p * 1.3, uSim.y * 0.3) - flow(vec3(0.0), uSim.y * 0.3)) * (0.18 + 0.25 * uSim2.z);
  v = mix(v, stream, 1.0 - exp(-dt * 0.5));
  float speed = length(v);
  if (speed > 1.4) v *= 1.4 / speed;
  finalColor = vec4(v, seed);
}
`;

/** Position step: move, age, and respawn expired or stray particles on the coat of a random orb. */
const POSITION_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform highp sampler2D uPositions;
uniform highp sampler2D uVelocities;
${COMMON_GLSL}
out vec4 finalColor;

vec3 spawn(float seed, float salt) {
  int pick = int(floor(hash11(seed * 91.7 + salt) * float(ORBS)));
  vec4 orb = uOrbs[min(pick, ORBS - 1)];
  vec3 dir = randomUnit(hash11(seed * 13.1 + salt * 1.7), hash11(seed * 7.7 + salt * 3.1));
  return orb.xyz + dir * (orb.w * 1.3 + 0.06 + 0.65 * hash11(seed * 3.3 + salt));
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 position = texelFetch(uPositions, cell, 0);
  vec4 velocity = texelFetch(uVelocities, cell, 0);
  float seed = velocity.w;
  float dt = uSim.x;
  if (uSim2.w < 0.5) {
    finalColor = vec4(spawn(seed, 0.0), seed * 9.0);
    return;
  }
  float life = 3.0 + 6.0 * seed;
  if (position.w + dt > life || length(position.xyz) > 3.0) {
    finalColor = vec4(spawn(seed, floor(uSim.y * 7.0)), 0.0);
    return;
  }
  finalColor = vec4(position.xyz + velocity.xyz * dt, position.w + dt);
}
`;

/** Grid splat: every particle drops one point into its cell, adding its velocity and a count (additive blending). */
const SPLAT_VERTEX = /* glsl */ `#version 300 es
in float aSlot;
uniform highp sampler2D uPositions;
uniform highp sampler2D uVelocities;
uniform float uSide;
${COMMON_GLSL}
out vec4 vValue;

void main() {
  int id = gl_VertexID;
  int side = int(uSide);
  ivec2 cell = ivec2(id - (id / side) * side, id / side);
  vec4 position = texelFetch(uPositions, cell, 0);
  vec4 velocity = texelFetch(uVelocities, cell, 0);
  ivec2 texel = gridTexel(gridCell(position.xyz));
  vec2 size = vec2(float(GRID * 8), float(GRID * 4));
  gl_Position = vec4((vec2(texel) + 0.5) / size * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  bool inside = all(lessThan(abs(position.xyz), vec3(GRID_EXTENT)));
  vValue = inside ? vec4(velocity.xyz, 1.0) * GRID_SCALE + aSlot * 0.0 : vec4(0.0);
}
`;

const SPLAT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec4 vValue;
out vec4 finalColor;
void main() {
  finalColor = vValue;
}
`;

/**
 * Particle draw, in the same hand as the rest of Synesthesia's particle world: every particle is a crisp square dot
 * (0.6–2 px, by weight and depth, like the floor and pyramid point clouds) that shimmers with the highs. Particles carry
 * almost no light of their own: they are lit by the orbs, deep indigo far from any bright orb, warming through violet
 * and pink to white as an orb close by flares.
 */
const PARTICLE_VERTEX = /* glsl */ `#version 300 es
in float aSlot;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uResolution;
uniform highp sampler2D uPositions;
uniform highp sampler2D uVelocities;
uniform float uSide;
// Per-dot opacity, scaled down as the particle count goes up so the cloud's overall brightness stays put.
uniform float uStroke;
${COMMON_GLSL}
out vec3 vColor;
out float vAlpha;

void main() {
  int id = gl_VertexID;
  int side = int(uSide);
  ivec2 cell = ivec2(id - (id / side) * side, id / side);
  vec4 position = texelFetch(uPositions, cell, 0);
  vec4 velocity = texelFetch(uVelocities, cell, 0);
  float seed = velocity.w;
  vec3 c = toCamera(position.xyz);
  float k = perspective(c.z);
  vec2 screen = c.xy * k * uView.x;

  // Light from the orbs, falling off with the gap to each orb's surface; hidden if an orb stands in front of it.
  float light = 0.0;
  bool covered = false;
  for (int index = 0; index < ORBS; index += 1) {
    vec4 orb = uOrbs[index];
    float gap = max(0.0, distance(position.xyz, orb.xyz) - orb.w);
    light += uLights[index].x * 0.03 / (gap * gap + 0.03);
    vec3 oc = toCamera(orb.xyz);
    float ok = perspective(oc.z);
    covered = covered || (c.z > oc.z && distance(screen, oc.xy * ok * uView.x) < orb.w * ok * uView.x * 0.98);
  }
  // Soft ceiling: however many bright orbs pile light on a particle, it saturates gently instead of blowing out.
  light = 1.0 - exp(-light);

  float weight = 0.3 + 0.7 * fract(seed * 5.31);
  vec3 indigo = vec3(0.2, 0.18, 0.8);
  vec3 violet = vec3(0.55, 0.34, 1.0);
  vec3 pink = vec3(1.0, 0.45, 0.85);
  vec3 white = vec3(1.0, 0.95, 1.0);
  vec3 lit = light < 0.5 ? mix(violet, pink, light * 2.0) : mix(pink, white, light * 2.0 - 1.0);
  vColor = indigo * (0.8 + 0.5 * uSim2.z) + lit * light;

  float life = 3.0 + 6.0 * seed;
  float fade = smoothstep(0.0, 0.5, position.w) * (1.0 - smoothstep(life - 0.8, life, position.w));
  float hidden = covered || clipped(screen) ? 0.0 : 1.0;
  float depth = clamp(1.25 - 0.35 * c.z, 0.4, 1.6);
  // The highs make the dots shimmer, as the world's other point clouds do.
  float shimmer = 1.0 - (0.2 + 0.5 * uSim2.y) * (0.5 + 0.5 * sin(uSim.y * 7.0 + float(id) * 2.39));
  // Dots keep their pixel size however large the cloud is drawn, so a bigger cloud spreads them thinner: brighten each
  // with the scale to keep the cloud's look the same at the select screen's size, the monitor's, and anything between.
  float spread = clamp(pow(uView.x / 170.0, 1.6), 0.5, 3.0);
  vAlpha = uView.w * hidden * fade * weight * shimmer * min(1.4, depth) * (0.55 + 0.9 * light) * uStroke * spread
    + aSlot * 0.0;

  mat3 matrix = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((matrix * vec3(screen, 1.0)).xy, 0.0, 1.0);
  float pixels = abs(matrix[0][0]) * uResolution.x * 0.5;
  gl_PointSize = hidden > 0.0 ? max(1.0, max(0.6, 0.9 * (0.5 + weight) * depth) * pixels) : 0.0;
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
uniform vec4 uColor;
out vec4 finalColor;
void main() {
  // Square, like the world's rect dots: no shaping inside the point.
  finalColor = vec4(vColor * vAlpha, 0.0) * uColor.a;
}
`;

/**
 * Orb draw: one camera-facing quad per orb, wide enough for its glow and shafts. Inside the disc it is an opaque,
 * nearly black sphere; just outside, a thin luminous ring sits a little off its surface, brightest on the side facing
 * the cloud's heart; beyond that a glow and — while the orb flares — radiant shafts of light. Written premultiplied:
 * the body has alpha 1 (it hides what is behind it) and the light has alpha 0 (it adds), so both go out in one draw.
 */
const ORB_VERTEX = /* glsl */ `#version 300 es
in vec2 aCorner;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uIndex;
${COMMON_GLSL}
out vec2 vLocal;
out vec2 vScreen;
out vec2 vLightDir;
out float vRadius;

float extentFor(float flash) {
  return 3.0 + 9.0 * flash;
}

void main() {
  int index = int(uIndex);
  vec4 orb = uOrbs[index];
  vec3 oc = toCamera(orb.xyz);
  float k = perspective(oc.z);
  vec2 centre = oc.xy * k * uView.x;
  float radius = orb.w * k * uView.x;
  float extent = extentFor(uLights[index].y);
  vLocal = aCorner * extent;
  vScreen = centre + aCorner * extent * radius;
  // Lit from the cloud's heart (the origin) and a little from above.
  vLightDir = normalize(-centre + vec2(0.0, -0.4 * radius) + vec2(1e-3));
  vRadius = radius;
  mat3 matrix = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((matrix * vec3(vScreen, 1.0)).xy, 0.0, 1.0);
}
`;

const ORB_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vScreen;
in vec2 vLightDir;
in float vRadius;
uniform vec4 uColor;
uniform float uIndex;
${COMMON_GLSL}
out vec4 finalColor;

void main() {
  if (clipped(vScreen)) discard;
  int index = int(uIndex);
  vec4 light = uLights[index];
  float brightness = light.x;
  float flash = light.y;
  float d = length(vLocal);
  vec2 dir = vLocal / max(d, 1e-4);
  float facing = 0.3 + 0.7 * max(0.0, dot(dir, vLightDir));
  vec3 pink = vec3(1.0, 0.5, 0.88);
  vec3 violet = vec3(0.6, 0.42, 1.0);
  vec3 white = vec3(1.0, 0.96, 1.0);
  vec3 tint = mix(violet, pink, clamp(light.z, 0.0, 1.0));
  float alpha = uView.w;
  if (d < 1.0) {
    float nz = sqrt(1.0 - d * d);
    vec3 body = vec3(0.01, 0.005, 0.025) * (0.6 + 0.8 * nz);
    // A faint lit edge on the sphere itself.
    vec3 edge = tint * pow(1.0 - nz, 4.0) * facing * (0.3 + 0.8 * brightness);
    float aa = clamp((1.0 - d) * vRadius, 0.0, 1.0);
    finalColor = vec4((body + edge) * aa, aa) * alpha * uColor.a;
    return;
  }
  // The thin ring a little off the surface.
  float ring = exp(-pow((d - 1.25) * 9.0, 2.0)) * facing * (0.06 + 0.8 * brightness);
  float glow = exp(-(d - 1.0) * 3.0) * (0.06 + 0.35 * brightness) * facing;
  float angle = atan(dir.y, dir.x);
  float t = uSim.y;
  float shafts = pow(0.5 + 0.5 * sin(angle * 21.0 + uIndex * 5.0 + t * 0.5), 10.0)
    * pow(0.5 + 0.5 * sin(angle * 8.0 - t * 0.8 + uIndex), 3.0);
  float rays = (shafts * 1.6 + 0.5) * exp(-(d - 1.0) * 0.5) * flash;
  vec3 color = tint * (ring + glow) + mix(tint, white, 0.6) * rays + white * flash * 0.8 * exp(-(d - 1.0) * 1.5);
  float extent = 3.0 + 9.0 * flash;
  float fadeOut = 1.0 - smoothstep(extent * 0.75, extent, d);
  finalColor = vec4(color * fadeOut, 0.0) * alpha * uColor.a;
}
`;

function program(vertex: string, fragment: string, name: string): GlProgram {
  return GlProgram.from({ vertex, fragment, name, preferredFragmentPrecision: 'highp' });
}

let programs:
  | { velocity: GlProgram; position: GlProgram; particles: GlProgram; orb: GlProgram; splat: GlProgram }
  | undefined;

function cloudPrograms() {
  programs ??= {
    velocity: program(QUAD_VERTEX, VELOCITY_FRAGMENT, 'charge-cloud-velocity'),
    position: program(QUAD_VERTEX, POSITION_FRAGMENT, 'charge-cloud-position'),
    particles: program(PARTICLE_VERTEX, PARTICLE_FRAGMENT, 'charge-cloud-particles'),
    orb: program(ORB_VERTEX, ORB_FRAGMENT, 'charge-cloud-orb'),
    splat: program(SPLAT_VERTEX, SPLAT_FRAGMENT, 'charge-cloud-splat'),
  };
  return programs;
}

function quad(attribute: string): Geometry {
  return new Geometry({
    attributes: { [attribute]: { buffer: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), format: 'float32x2' } },
    indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

function particleDots(count: number): Geometry {
  // One vertex per particle; the shader finds its particle from gl_VertexID, the attribute only sets the count.
  return new Geometry({
    attributes: { aSlot: { buffer: new Float32Array(count), format: 'float32' } },
    topology: 'point-list',
  });
}

function splatPoints(count: number): Geometry {
  // One vertex per particle; the shader finds its particle from gl_VertexID, the attribute only sets the count.
  return new Geometry({
    attributes: { aSlot: { buffer: new Float32Array(count), format: 'float32' } },
    topology: 'point-list',
  });
}

function gridTexture(): RenderTexture {
  return RenderTexture.create({
    width: 32 * 8,
    height: 32 * 4,
    format: 'rgba16float',
    scaleMode: 'nearest',
    resolution: 1,
    antialias: false,
  });
}

function stateTexture(side: number): RenderTexture {
  return RenderTexture.create({
    width: side,
    height: side,
    format: 'rgba32float',
    scaleMode: 'nearest',
    resolution: 1,
    antialias: false,
  });
}

/**
 * One charge cloud. Add {@link view} to the stage and call {@link update} once per frame; the simulation step
 * runs as a GPU pass right before the frame is drawn.
 */
export class ChargeCloud {
  public readonly view = new Container();
  private readonly uniforms: UniformGroup;
  private readonly positions: [RenderTexture, RenderTexture];
  private readonly velocities: [RenderTexture, RenderTexture];
  private current = 0;
  private initialised = false;
  private lights: OrbLight[] = Array.from({ length: ORBS }, () => DARK_ORB);
  private readonly grid = gridTexture();
  private readonly splat: Mesh<Geometry, Shader>;
  private readonly velocityStep: Mesh<Geometry, Shader>;
  private readonly positionStep: Mesh<Geometry, Shader>;
  private readonly stepHost = new Container();
  private readonly particles: Mesh<Geometry, Shader>;
  private readonly orbs: Mesh<Geometry, Shader>[];

  /** `side` × `side` particles. */
  public constructor(side = 384) {
    this.view.label = 'synesthesia/charge-cloud';
    const vec4 = () => ({ value: new Float32Array(4), type: 'vec4<f32>' as const });
    const vec4s = () => ({ value: new Float32Array(4 * ORBS), type: 'vec4<f32>' as const, size: ORBS });
    this.uniforms = new UniformGroup({
      uOrbs: vec4s(),
      uAxes: vec4s(),
      uLights: vec4s(),
      uSim: vec4(),
      uSim2: vec4(),
      uView: vec4(),
      uClip: { value: new Float32Array([-1e6, -1e6, 1e6, 1e6]), type: 'vec4<f32>' as const },
      uBands0: vec4(),
      uBands1: vec4(),
      uBands2: vec4(),
      uBands3: vec4(),
      // About an eighth of the grid's cells end up occupied; aiming each at a few times its even share packs the flock
      // into dense sheets with gaps between them.
      uFlock: {
        value: new Float32Array([((side * side) / (32 * 32 * 32 * 0.12)) * 2.5, 3.0, 2.2, 0]),
        type: 'vec4<f32>' as const,
      },
    });
    this.positions = [stateTexture(side), stateTexture(side)];
    this.velocities = [stateTexture(side), stateTexture(side)];
    const { velocity, position, particles, orb, splat } = cloudPrograms();
    const stepQuad = quad('aPosition');
    const step = (glProgram: GlProgram) => {
      const mesh = new Mesh({
        geometry: stepQuad,
        shader: new Shader({
          glProgram,
          resources: {
            cloud: this.uniforms,
            uPositions: this.positions[0].source,
            uVelocities: this.velocities[0].source,
            uGrid: this.grid.source,
          },
        }),
      });
      // The state textures carry data in alpha too, so the step overwrites them instead of blending.
      mesh.state.blend = false;
      return mesh;
    };
    this.velocityStep = step(velocity);
    this.positionStep = step(position);
    this.splat = new Mesh({
      geometry: splatPoints(side * side),
      shader: new Shader({
        glProgram: splat,
        resources: {
          cloud: this.uniforms,
          splatUniforms: new UniformGroup({ uSide: { value: side, type: 'f32' } }),
          uPositions: this.positions[0].source,
          uVelocities: this.velocities[0].source,
        },
      }),
    });
    this.splat.blendMode = 'add';
    this.particles = new Mesh({
      geometry: particleDots(side * side),
      shader: new Shader({
        glProgram: particles,
        resources: {
          cloud: this.uniforms,
          particleUniforms: new UniformGroup({
            uSide: { value: side, type: 'f32' },
            uStroke: { value: 0.11 * ((384 * 384) / (side * side)) ** 0.7, type: 'f32' },
          }),
          uPositions: this.positions[0].source,
          uVelocities: this.velocities[0].source,
        },
      }),
    });
    this.particles.blendMode = 'add';
    const orbQuad = quad('aCorner');
    this.orbs = Array.from(
      { length: ORBS },
      (_, index) =>
        new Mesh({
          geometry: orbQuad,
          shader: new Shader({
            glProgram: orb,
            resources: {
              cloud: this.uniforms,
              orbUniforms: new UniformGroup({ uIndex: { value: index, type: 'f32' } }),
            },
          }),
        }),
    );
    this.view.addChild(...this.orbs, this.particles);
  }

  public update(frame: ChargeCloudFrame): void {
    this.view.visible = frame.alpha > 0.01;
    if (!this.view.visible) return;
    const { drive } = frame;
    const dt = Math.min(1 / 30, Math.max(0, frame.dt));
    const orbs = chargeOrbs(frame.seconds, drive);
    this.lights = orbs.map((orb, index) => stepOrbLight(this.lights[index]!, orb.energy, drive.onset, dt));
    const u = this.uniforms.uniforms as Record<string, Float32Array>;
    orbs.forEach((orb, index) => {
      const light = this.lights[index]!;
      u.uOrbs!.set([orb.x, orb.y, orb.z, orb.radius], index * 4);
      u.uAxes!.set([orb.axis[0], orb.axis[1], orb.axis[2], orb.energy], index * 4);
      u.uLights!.set([orbBrightness(light), light.flash, light.glow, 0], index * 4);
    });
    for (let band = 0; band < 16; band += 1) {
      u[`uBands${band >> 2}`]![band & 3] = bandLevel(drive.bands, band, 16);
    }
    u.uSim!.set([dt, frame.seconds % 3600, drive.onset, drive.bass]);
    u.uSim2!.set([drive.mid, drive.high, drive.level, this.initialised ? 1 : 0]);
    const yaw = frame.seconds * 0.09;
    const pitch = 0.35 + 0.12 * Math.sin(frame.seconds * 0.13);
    u.uView!.set([frame.scale, yaw, pitch, frame.alpha]);
    const clip = frame.clip;
    u.uClip!.set(
      clip
        ? [clip.x - frame.x, clip.y - frame.y, clip.x + clip.w - frame.x, clip.y + clip.h - frame.y]
        : [-1e6, -1e6, 1e6, 1e6],
    );
    this.uniforms.update();
    this.view.position.set(frame.x, frame.y);

    // Far orbs first so a nearer one's body covers a farther one's.
    const depth = (orb: ChargeOrb) => {
      const z = -Math.sin(yaw) * orb.x + Math.cos(yaw) * orb.z;
      return Math.sin(pitch) * orb.y + Math.cos(pitch) * z;
    };
    const order = orbs.map((orb, index) => ({ index, depth: depth(orb) })).sort((a, b) => b.depth - a.depth);
    order.forEach(({ index }, slot) => this.view.setChildIndex(this.orbs[index]!, slot));

    if (dt > 0 || !this.initialised) {
      queueGpuPass((renderer) => this.step(renderer));
    }
  }

  private step(renderer: WebGLRenderer): void {
    const from = this.current;
    const to = 1 - from;
    this.bind(this.splat, this.positions[from].source, this.velocities[from].source);
    this.stepHost.addChild(this.splat);
    renderer.render({ container: this.stepHost, target: this.grid, clear: true, clearColor: [0, 0, 0, 0] });
    this.stepHost.removeChild(this.splat);
    this.bind(this.velocityStep, this.positions[from].source, this.velocities[from].source);
    this.render(renderer, this.velocityStep, this.velocities[to]);
    this.bind(this.positionStep, this.positions[from].source, this.velocities[to].source);
    this.render(renderer, this.positionStep, this.positions[to]);
    this.current = to;
    this.bind(this.particles, this.positions[to].source, this.velocities[to].source);
    if (!this.initialised) {
      this.initialised = true;
      (this.uniforms.uniforms as Record<string, Float32Array>).uSim2![3] = 1;
      this.uniforms.update();
    }
  }

  private bind(mesh: Mesh<Geometry, Shader>, positions: TextureSource, velocities: TextureSource): void {
    mesh.shader!.resources.uPositions = positions;
    mesh.shader!.resources.uVelocities = velocities;
  }

  private render(renderer: WebGLRenderer, mesh: Mesh<Geometry, Shader>, target: RenderTexture): void {
    this.stepHost.addChild(mesh);
    renderer.render({ container: this.stepHost, target, clear: false });
    this.stepHost.removeChild(mesh);
  }

  public destroy(): void {
    for (const mesh of [this.splat, this.velocityStep, this.positionStep, this.particles, ...this.orbs]) {
      const shader = mesh.shader;
      mesh.destroy();
      shader?.destroy();
    }
    for (const texture of [...this.positions, ...this.velocities, this.grid]) texture.destroy(true);
    this.stepHost.destroy();
    this.view.destroy({ children: true });
  }
}
