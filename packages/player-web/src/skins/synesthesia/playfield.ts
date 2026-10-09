import { Color, FillGradient, type Graphics } from 'pixi.js';
import {
  burstParticlePosition,
  burstParticles,
  emberColor,
  hsvToHex,
  projectPoint,
  rotateY,
  type BurstParticle,
  type Vec3,
} from './space.ts';
import { burstGrainCount } from './burst-budget.ts';
import { drawReticle, sharedShapeBatch } from './draw.ts';
import { SYN_GLOW_SIZE, synGlowTexture } from './style.ts';
import {
  audioDrive,
  type BeMusicBomb,
  type BeMusicBombsContext,
  type BeMusicLaneKind,
  type BeMusicLanesContext,
  type BeMusicLongNoteContext,
  type BeMusicNoteContext,
  type ChildPool,
  comboTier,
  effectProfile,
  keyBeamGradient,
  resolveLaneRuns,
} from '../../skin-sdk/index.ts';

/** Per-lane-class light: note body, glow hue (0..1), and the colour the lane beam / key cap light up in. */
interface LaneLight {
  body: number;
  glow: number;
  hue: number;
}

// Readable first, in the skin's ember palette: white keys burn warm white-gold with an ember halo, black keys run
// electric blue, scratch hot magenta.
const LIGHTS: Record<BeMusicLaneKind, LaneLight> = {
  white: { body: 0xfff1dc, glow: 0xff7a1e, hue: 0.07 },
  black: { body: 0xa6dcff, glow: 0x3fb4ff, hue: 0.57 },
  scratch: { body: 0xff9fd0, glow: 0xff3d9e, hue: 0.92 },
};

const NOTE_HEIGHT = 8;
export const SYNESTHESIA_BOMB_DURATION_MS = 620;

export function renderSynesthesiaLanes({
  graphics,
  lanes,
  beatPhase,
  nowMs,
  combo,
  effects,
  audio,
}: BeMusicLanesContext): void {
  const pulse = (1 - beatPhase) ** 2;
  const drive = audioDrive(audio, effects);
  // The judgement line burns brighter as the run builds, and cycles the spectrum once it is in the zone.
  const tier = effectProfile(effects).enabled ? comboTier(combo ?? 0) : 0;
  // ...and swells on every bass hit of the mix.
  const heat = 1 + 0.3 * tier + 0.9 * drive.bass;
  const lineColor = tier >= 3 ? emberColor(0.55 + 0.35 * Math.sin(nowMs / 700)) : 0xff8a2a;
  let gridTop = Number.POSITIVE_INFINITY;
  let gridBottom = 0;
  let gridLeft = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    const { x, w, top, bottom } = lane;
    const light = LIGHTS[lane.kind];
    const laneHeight = Math.max(1, bottom - top);
    gridTop = Math.min(gridTop, top);
    gridBottom = Math.max(gridBottom, bottom);
    gridLeft = Math.min(gridLeft, x);

    // Near-black bed, so the particle world behind the playfield reads only as a faint depth cue; white-key lanes take
    // a warmer, lifted bed so they read apart from the black keys and the scratch.
    graphics
      .rect(x, top, w, laneHeight)
      .fill(lane.kind === 'white' ? { color: 0x180c06, alpha: 0.88 } : { color: 0x050201, alpha: 0.8 });
    graphics.rect(x, top, 1, laneHeight).fill({ fill: resolveColumnGradient(light.glow), alpha: 0.5 });

    // Key beam: a column of the lane's light, near solid at the judgement line and easing out up the lane, so a press
    // reads clearly while the notes still on their way down keep their contrast.
    if (lane.beam > 0) {
      const beamHeight = Math.min(laneHeight, 250);
      const beamAlpha = lane.beam * lane.beam * (3 - 2 * lane.beam);
      graphics
        .rect(x + 1, bottom - beamHeight, w - 2, beamHeight)
        .fill({ fill: keyBeamGradient(light.glow), alpha: beamAlpha * 0.9 });
      graphics
        .rect(x + 1, bottom - 26, w - 2, 26)
        .fill({ fill: resolveColumnGradient(0xffffff), alpha: beamAlpha * 0.25 });
    }

    // Key caps: a glass sliver that lights up in the lane's colour on press.
    const pressed = lane.beam > 0.6;
    graphics
      .rect(x + 1, bottom + 4, Math.max(2, w - 2), 10)
      .fill({ color: pressed ? light.glow : 0x140804, alpha: 0.9 });
    graphics.rect(x + 1, bottom + 13, Math.max(2, w - 2), 1).fill({ color: light.glow, alpha: pressed ? 1 : 0.45 });
  }
  if (lanes.length === 0) return;
  // Close each play side's grid on its right edge (each lane only draws its left hairline).
  for (const run of resolveLaneRuns(lanes)) {
    graphics.rect(run.right - 1, gridTop, 1, Math.max(1, gridBottom - gridTop)).fill({ color: 0xff7a1e, alpha: 0.25 });
  }

  // Judgement line: a white filament wrapped in stacked ember bloom that swells on each beat — one per play side, so
  // it never crosses the gap between the double-play banks.
  const y = gridBottom;
  for (const run of resolveLaneRuns(lanes)) {
    const lineW = run.right - run.left;
    graphics.rect(run.left, y - 14, lineW, 22).fill({ color: lineColor, alpha: (0.05 + 0.08 * pulse) * heat });
    graphics
      .rect(run.left, y - 6, lineW, 8)
      .fill({ color: lineColor, alpha: Math.min(0.8, (0.16 + 0.14 * pulse) * heat) });
    graphics.rect(run.left, y - 3, lineW, 3).fill({ color: 0xffd08a, alpha: 0.85 });
    graphics.rect(run.left, y - 2, lineW, 1).fill(0xffffff);
  }
}

export function renderSynesthesiaNote({ graphics, kind, x, w, y }: BeMusicNoteContext): void {
  drawNote(graphics, x, y, Math.max(4, w), LIGHTS[kind]);
}

export function renderSynesthesiaLongNote({ graphics, kind, x, w, top, bottom }: BeMusicLongNoteContext): void {
  const light = LIGHTS[kind];
  const bodyX = x;
  const bodyW = Math.max(4, w);
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

/** Sparks per hit at combo tier 0; each tier adds {@link BURST_PARTICLES_PER_TIER}. */
const BURST_PARTICLES = 170;
const BURST_PARTICLES_PER_TIER = 24;
const BURST_PARTICLES_MAX = BURST_PARTICLES + BURST_PARTICLES_PER_TIER * 4;
const BURST_FOCAL = 260;
/** Grain size (0.4..1) from which a spark leaves a hairline trail / carries a glow sprite; the rest is fine powder. */
const POWDER_TRAIL_SIZE = 0.85;
const POWDER_GLINT_SIZE = 0.94;
const PARTICLE_CACHE = new Map<number, BurstParticle[]>();

function cachedBurst(seed: number): BurstParticle[] {
  let particles = PARTICLE_CACHE.get(seed);
  if (!particles) {
    particles = burstParticles(seed, BURST_PARTICLES_MAX);
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
 * 5. a core flash and an anamorphic streak across the line,
 * 6. a lock-on reticle that snaps shut on the hit and fades.
 *
 * The smaller sparks fly as square voxels rather than round glows, like shattering wireframes.
 * Everything is additive, so overlapping hits bloom into each other like light instead of stacking opaque shapes.
 */
export function renderSynesthesiaBombs({ pool, bombs, combo, effects }: BeMusicBombsContext): void {
  const profile = effectProfile(effects);
  if (!profile.enabled) {
    // Effects off: a small, plain core flash per hit.
    renderPlainFlashes(pool, bombs);
    return;
  }
  const tier = Math.min(comboTier(combo ?? 0), profile.screenWide ? 4 : 2);
  // Keep colour the hero: when many hits overlap, dim the white parts (flash, pillar, streak) so additive stacking
  // doesn't burn the line to white, while sparks keep most of their colour.
  const crowd = 1 / Math.sqrt(Math.max(1, bombs.length / 2));
  for (const bomb of bombs) {
    const grains = burstGrainCount(BURST_PARTICLES, BURST_PARTICLES_PER_TIER, tier, profile.amount, bombs.length);
    renderBomb(pool, bomb, tier, crowd, profile.amount, grains);
  }
}

function renderPlainFlashes(pool: ChildPool, bombs: readonly BeMusicBomb[]): void {
  const glow = synGlowTexture();
  for (const bomb of bombs) {
    const t = Math.min(1, bomb.elapsedMs / 180);
    if (t >= 1) continue;
    const sprite = pool.acquireSprite();
    sprite.texture = glow;
    sprite.anchor.set(0.5);
    sprite.blendMode = 'add';
    const size = Math.max(10, bomb.w) * (1.2 + t);
    sprite.width = size;
    sprite.height = size;
    sprite.position.set(bomb.x + bomb.w / 2, bomb.y - 3);
    sprite.tint = LIGHTS[bomb.kind].glow;
    sprite.alpha = 0.7 * (1 - t);
  }
}

function renderBomb(
  pool: ChildPool,
  bomb: BeMusicBomb,
  tier: number,
  crowd: number,
  amount: number,
  grains: number,
): void {
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
    .fill({ fill: resolveColumnGradient(light.glow), alpha: 0.55 * fade * fade * crowd });

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
      alpha: 0.75 * strength * (1 - ringT) * (0.5 + 0.5 * crowd),
    });
  }

  // 3 + 4. Sparks: hairline trails and powder grains go through the shared batch (one fill per colour bucket instead of
  // one per grain); the few coarse grains get a glow sprite. Everything here is additive, so draw order is free and no
  // depth sort (or per-frame spark list) is needed.
  const particles = cachedBurst(bomb.seed);
  const count = Math.min(particles.length, grains);
  const radius = unit * 4.6 * (1 + 0.1 * tier);
  const gravity = unit * 3.2;
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
  const batch = sharedShapeBatch;
  const glow = synGlowTexture();
  for (let index = 0; index < count; index += 1) {
    const particle = particles[index]!;
    const life = t / particle.life;
    if (life >= 1) continue;
    const head = project(fountain(particle, life));
    if (!head.visible) continue;
    // Only the coarser grains leave a short, hairline trail; the powder itself just drifts.
    const trailAlpha = particle.size >= POWDER_TRAIL_SIZE ? (1 - life) * 0.45 : 0;
    if (trailAlpha > 0.02) {
      const tail = project(fountain(particle, Math.max(0, life - 0.07)));
      batch.line(
        effects,
        hsvToHex(light.hue + particle.hueShift, Math.min(0.9, 0.35 + life * 2), 1),
        trailAlpha,
        Math.max(0.5, 1 * head.scale * particle.size),
        tail.x,
        tail.y,
        head.x,
        head.y,
      );
    }
    const tint = hsvToHex(light.hue + particle.hueShift, Math.min(0.9, 0.45 + life * 1.8), 1);
    const sparkAlpha = (1 - life) ** 0.8 * (0.65 + 0.35 * crowd);
    // Powder: most grains are tiny squares; only the coarsest few carry a soft glint.
    if (particle.size < POWDER_GLINT_SIZE) {
      const side = Math.max(0.7, (0.6 + 1 * particle.size) * head.scale * (1 - life * 0.5));
      batch.rect(effects, tint, sparkAlpha, head.x - side / 2, head.y - side / 2, side, side);
      continue;
    }
    const sprite = pool.acquireSprite();
    sprite.texture = glow;
    sprite.anchor.set(0.5);
    sprite.blendMode = 'add';
    const size = (1.6 + 2.4 * particle.size) * head.scale * Math.sqrt(1 - life);
    sprite.width = size;
    sprite.height = size;
    sprite.position.set(head.x, head.y);
    // White-hot at launch, cooling into the lane's hue.
    sprite.tint = tint;
    sprite.alpha = sparkAlpha;
  }
  batch.flush();

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
    core.alpha = flash * 0.7 * crowd;
  }
  // 6. Lock-on: corner brackets snap in from wide to tight around the hit, then hold and fade.
  if (t < 0.55) {
    const snap = Math.min(1, t / 0.16);
    const size = unit * (1.15 + 1.4 * (1 - snap) ** 3);
    const lockAlpha = (t < 0.16 ? 0.95 : 0.95 * (1 - (t - 0.16) / 0.39)) * (0.6 + 0.4 * crowd);
    drawReticle(effects, cx - size / 2, cy - size / 2, size, size, 0xfff2dc, lockAlpha, {
      arm: size * 0.3,
      width: 1.25,
      cross: t < 0.3,
    });
  }
  const streakAlpha = amount < 1 ? 0 : fade ** 2.5;
  if (streakAlpha > 0.02) {
    const streak = pool.acquireSprite();
    streak.texture = glow;
    streak.anchor.set(0.5);
    streak.blendMode = 'add';
    streak.width = unit * (6 + 5 * t);
    streak.height = Math.max(2, unit * 0.32 * fade);
    streak.position.set(cx, cy);
    streak.tint = hsvToHex(light.hue, 0.35, 1);
    streak.alpha = streakAlpha * 0.6 * crowd;
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
