import { Color, FillGradient, type Graphics } from 'pixi.js';
import type {
  BeMusicBomb,
  BeMusicBombsContext,
  BeMusicLaneKind,
  BeMusicLanesContext,
  BeMusicLongNoteContext,
  BeMusicNoteContext,
} from '../../../skin/be-music/types.ts';
import type { ChildPool } from '../../pixi-utils.ts';
import {
  burstParticlePosition,
  burstParticles,
  hsvToHex,
  projectPoint,
  rotateY,
  type BurstParticle,
  type Vec3,
} from './space.ts';
import { SYN_GLOW_SIZE, synGlowTexture } from './style.ts';

/** Per-lane-class light: note body, glow hue (0..1), and the colour the lane beam / key cap light up in. */
interface LaneLight {
  body: number;
  glow: number;
  hue: number;
}

// Readable first: white keys are icy white, black keys blue-violet, scratch magenta — each with a soft same-hue halo.
const LIGHTS: Record<BeMusicLaneKind, LaneLight> = {
  white: { body: 0xe9fbff, glow: 0x5ff4ff, hue: 0.52 },
  black: { body: 0x8aa2ff, glow: 0x8f74ff, hue: 0.7 },
  scratch: { body: 0xff7ae3, glow: 0xff4fd8, hue: 0.88 },
};

const NOTE_HEIGHT = 8;
export const SYNESTHESIA_BOMB_DURATION_MS = 620;

export function renderSynesthesiaLanes({ graphics, lanes, beatPhase }: BeMusicLanesContext): void {
  const pulse = (1 - beatPhase) ** 2;
  let gridTop = Number.POSITIVE_INFINITY;
  let gridBottom = 0;
  let gridLeft = Number.POSITIVE_INFINITY;
  let gridRight = 0;
  for (const lane of lanes) {
    const { x, w, top, bottom } = lane;
    const light = LIGHTS[lane.kind];
    const laneHeight = Math.max(1, bottom - top);
    gridTop = Math.min(gridTop, top);
    gridBottom = Math.max(gridBottom, bottom);
    gridLeft = Math.min(gridLeft, x);
    gridRight = Math.max(gridRight, x + w);

    // Dark glass bed, so the starfield behind the playfield reads only as a faint depth cue.
    graphics.rect(x, top, w, laneHeight).fill({ color: 0x03040f, alpha: 0.78 });
    graphics.rect(x, top, 1, laneHeight).fill({ fill: resolveColumnGradient(light.glow), alpha: 0.5 });

    if (lane.beam > 0) {
      const beamHeight = Math.min(laneHeight, 220);
      const beamAlpha = lane.beam * lane.beam * (3 - 2 * lane.beam);
      graphics
        .rect(x + 1, bottom - beamHeight, w - 2, beamHeight)
        .fill({ fill: resolveColumnGradient(light.glow), alpha: beamAlpha * 0.45 });
      graphics
        .rect(x + 1, bottom - 26, w - 2, 26)
        .fill({ fill: resolveColumnGradient(0xffffff), alpha: beamAlpha * 0.25 });
    }

    // Key caps: a glass sliver that lights up in the lane's colour on press.
    const pressed = lane.beam > 0.6;
    graphics
      .rect(x + 1, bottom + 4, Math.max(2, w - 2), 10)
      .fill({ color: pressed ? light.glow : 0x0c1030, alpha: 0.9 });
    graphics.rect(x + 1, bottom + 13, Math.max(2, w - 2), 1).fill({ color: light.glow, alpha: pressed ? 1 : 0.45 });
  }
  if (lanes.length === 0) return;
  graphics.rect(gridRight - 1, gridTop, 1, Math.max(1, gridBottom - gridTop)).fill({ color: 0x5ff4ff, alpha: 0.25 });

  // Judgement line: a white filament wrapped in stacked cyan bloom that swells on each beat.
  const lineW = gridRight - gridLeft;
  const y = gridBottom;
  graphics.rect(gridLeft, y - 14, lineW, 22).fill({ color: 0x5ff4ff, alpha: 0.05 + 0.08 * pulse });
  graphics.rect(gridLeft, y - 6, lineW, 8).fill({ color: 0x5ff4ff, alpha: 0.16 + 0.14 * pulse });
  graphics.rect(gridLeft, y - 3, lineW, 3).fill({ color: 0x9ff8ff, alpha: 0.85 });
  graphics.rect(gridLeft, y - 2, lineW, 1).fill(0xffffff);
}

export function renderSynesthesiaNote({ graphics, kind, x, w, y }: BeMusicNoteContext): void {
  drawNote(graphics, x + 2, y, Math.max(4, w - 4), LIGHTS[kind]);
}

export function renderSynesthesiaLongNote({ graphics, kind, x, w, top, bottom }: BeMusicLongNoteContext): void {
  const light = LIGHTS[kind];
  const bodyX = x + 2;
  const bodyW = Math.max(4, w - 4);
  const bodyTop = top - NOTE_HEIGHT;
  const bodyH = Math.max(1, bottom - top);
  // A beam of light between head and tail: soft outer glow, translucent core, bright centre filament.
  graphics.rect(bodyX - 2, bodyTop, bodyW + 4, bodyH).fill({ color: light.glow, alpha: 0.08 });
  graphics.rect(bodyX + 1, bodyTop, bodyW - 2, bodyH).fill({ color: light.body, alpha: 0.22 });
  graphics.rect(bodyX + bodyW / 2 - 1, bodyTop, 2, bodyH).fill({ color: 0xffffff, alpha: 0.55 });
  drawNote(graphics, bodyX, bottom, bodyW, light);
  drawNote(graphics, bodyX, top, bodyW, light);
}

/** A flat bar with a white filament on top and a same-hue halo — glowing, but still a plain rectangle to read. */
function drawNote(graphics: Graphics, x: number, y: number, w: number, light: LaneLight): void {
  graphics.rect(x - 3, y - NOTE_HEIGHT - 3, w + 6, NOTE_HEIGHT + 6).fill({ color: light.glow, alpha: 0.14 });
  graphics.rect(x, y - NOTE_HEIGHT, w, NOTE_HEIGHT).fill(light.body);
  graphics.rect(x, y - NOTE_HEIGHT, w, 2).fill({ color: 0xffffff, alpha: 0.95 });
}

const BURST_PARTICLES = 52;
const BURST_FOCAL = 260;
const PARTICLE_CACHE = new Map<number, BurstParticle[]>();

function cachedBurst(seed: number): BurstParticle[] {
  let particles = PARTICLE_CACHE.get(seed);
  if (!particles) {
    particles = burstParticles(seed, BURST_PARTICLES);
    PARTICLE_CACHE.set(seed, particles);
    // Live bombs never exceed a few dozen; keep the cache bounded.
    if (PARTICLE_CACHE.size > 64) {
      const oldest = PARTICLE_CACHE.keys().next().value;
      if (oldest !== undefined) PARTICLE_CACHE.delete(oldest);
    }
  }
  return particles;
}

/**
 * The Synesthesia hit: a 3D particle burst in perspective. Layered back to front —
 *
 * 1. a light pillar rising up the lane,
 * 2. two shockwave rings lying in the XZ plane (so they read as tilted ellipses) expanding out of the line,
 * 3. motion trails for every spark,
 * 4. depth-sorted glow sparks that launch white-hot and cool into the lane's hue,
 * 5. a core flash and an anamorphic streak across the line.
 *
 * Everything is additive, so overlapping hits bloom into each other like light instead of stacking opaque shapes.
 */
export function renderSynesthesiaBombs({ pool, bombs }: BeMusicBombsContext): void {
  for (const bomb of bombs) {
    renderBomb(pool, bomb);
  }
}

function renderBomb(pool: ChildPool, bomb: BeMusicBomb): void {
  const t = Math.max(0, Math.min(1, bomb.elapsedMs / SYNESTHESIA_BOMB_DURATION_MS));
  if (t >= 1) return;
  const light = LIGHTS[bomb.kind];
  const cx = bomb.x + bomb.w / 2;
  const cy = bomb.y - 3;
  const unit = Math.max(10, bomb.w);
  const fade = 1 - t;
  // Slow spin around the vertical axis gives the burst parallax as it expands.
  const spin = (bomb.seed % 2 === 0 ? 1 : -1) * t * 0.9;
  const project = (point: Vec3) => projectPoint(rotateY(point, spin), cx, cy, BURST_FOCAL);

  const effects = pool.acquireGraphics();
  effects.label = `synesthesia-bomb[ch=${bomb.channel}]`;
  effects.blendMode = 'add';

  // 1. Light pillar.
  const pillarH = unit * 5.5 * (0.6 + 0.4 * fade);
  effects
    .rect(bomb.x + 1, cy - pillarH, bomb.w - 2, pillarH)
    .fill({ fill: resolveColumnGradient(light.glow), alpha: 0.55 * fade * fade });

  // 2. Shockwave rings in the XZ plane — the second one trails slightly and tilts the other way.
  for (const [delay, tilt, strength] of [
    [0, 0.35, 1],
    [0.12, -0.25, 0.6],
  ] as const) {
    const ringT = Math.max(0, (t - delay) / (1 - delay));
    if (ringT <= 0 || ringT >= 1) continue;
    const radius = unit * (0.5 + 2.6 * (1 - (1 - ringT) ** 2));
    const ring: number[] = [];
    for (let step = 0; step <= 36; step += 1) {
      const angle = (Math.PI * 2 * step) / 36;
      const point = project({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * tilt,
        z: Math.sin(angle) * radius,
      });
      ring.push(point.x, point.y);
    }
    effects.poly(ring, false).stroke({
      color: hsvToHex(light.hue + 0.04 * delay, 0.55, 1),
      width: 0.6 + 2.2 * (1 - ringT),
      alpha: 0.75 * strength * (1 - ringT),
    });
  }

  // 3 + 4. Sparks: compute every projected position once, draw trails, then depth-sorted glow sprites.
  const particles = cachedBurst(bomb.seed);
  const radius = unit * 4.6;
  const gravity = unit * 3.2;
  const sparks: Array<{ x: number; y: number; z: number; scale: number; life: number; particle: BurstParticle }> = [];
  // Fountain shaping: narrow the lateral spread so neighbouring lanes don't merge into one white band, and add an
  // upward launch so sparks visibly leap off the line before gravity bends them back.
  const fountain = (particle: BurstParticle, life: number): Vec3 => {
    const position = burstParticlePosition(particle, life, radius, gravity);
    return {
      x: position.x * 0.55,
      y: position.y * 1.1 - unit * 2.8 * particle.speed * (1 - (1 - life) ** 2),
      z: position.z * 0.8,
    };
  };
  for (const particle of particles) {
    const life = t / particle.life;
    if (life >= 1) continue;
    const position = fountain(particle, life);
    const head = project(position);
    if (!head.visible) continue;
    const tail = project(fountain(particle, Math.max(0, life - 0.14)));
    const trailAlpha = (1 - life) * 0.6;
    if (trailAlpha > 0.02) {
      effects
        .moveTo(tail.x, tail.y)
        .lineTo(head.x, head.y)
        .stroke({
          color: hsvToHex(light.hue + particle.hueShift, Math.min(0.9, 0.35 + life * 2), 1),
          width: Math.max(0.8, 2.2 * head.scale * particle.size),
          alpha: trailAlpha,
        });
    }
    sparks.push({ x: head.x, y: head.y, z: position.z, scale: head.scale, life, particle });
  }
  sparks.sort((left, right) => right.z - left.z);
  const glow = synGlowTexture();
  for (const spark of sparks) {
    const sprite = pool.acquireSprite();
    sprite.texture = glow;
    sprite.anchor.set(0.5);
    sprite.blendMode = 'add';
    const size = (6 + 12 * spark.particle.size) * spark.scale * Math.sqrt(1 - spark.life);
    sprite.width = size;
    sprite.height = size;
    sprite.position.set(spark.x, spark.y);
    // White-hot at launch, cooling into the lane's hue.
    sprite.tint = hsvToHex(light.hue + spark.particle.hueShift, Math.min(0.9, 0.45 + spark.life * 1.8), 1);
    sprite.alpha = (1 - spark.life) ** 0.8;
  }

  // 5. Core flash + anamorphic streak.
  const flash = Math.max(0, 1 - t * 5);
  if (flash > 0) {
    const core = pool.acquireSprite();
    core.texture = glow;
    core.anchor.set(0.5);
    core.blendMode = 'add';
    const coreSize = (unit * 1.3 + unit * 2 * t) * (SYN_GLOW_SIZE / 64);
    core.width = coreSize;
    core.height = coreSize;
    core.position.set(cx, cy);
    core.tint = hsvToHex(light.hue, t * 2, 1);
    core.alpha = flash * 0.7;
  }
  const streakAlpha = fade ** 2.5;
  if (streakAlpha > 0.02) {
    const streak = pool.acquireSprite();
    streak.texture = glow;
    streak.anchor.set(0.5);
    streak.blendMode = 'add';
    streak.width = unit * (6 + 5 * t);
    streak.height = Math.max(2, unit * 0.32 * fade);
    streak.position.set(cx, cy);
    streak.tint = hsvToHex(light.hue, 0.35, 1);
    streak.alpha = streakAlpha * 0.6;
  }
}

const COLUMN_GRADIENTS = new Map<number, FillGradient>();

/** Vertical light column for `color`: transparent at the top, brightening toward the base. Local texture space. */
function resolveColumnGradient(color: number): FillGradient {
  let gradient = COLUMN_GRADIENTS.get(color);
  if (!gradient) {
    const rgb = new Color(color);
    gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: rgb.setAlpha(0).toRgbaString() },
        { offset: 0.5, color: rgb.setAlpha(0.1).toRgbaString() },
        { offset: 0.85, color: rgb.setAlpha(0.32).toRgbaString() },
        { offset: 1, color: rgb.setAlpha(0.6).toRgbaString() },
      ],
    });
    COLUMN_GRADIENTS.set(color, gradient);
  }
  return gradient;
}
