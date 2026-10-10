import { Graphics, type Container } from 'pixi.js';
import { GROOVE } from './layout.ts';
import { drawSynesthesiaMoments } from './moments.ts';
import { ChargeCloud } from './charge-cloud.ts';
import { KICK_REST, stepKick, type KickState } from './kick.ts';
import { createFlock, stepFlock, type Flock } from './boids.ts';
import { drawFrame, drawPointCloud, drawReticle, drawSchool, sharedShapeBatch } from './draw.ts';
import {
  floorRise,
  followTerrain,
  terrainAmplitude,
  clipSegmentOutsideRect,
  emberColor,
  cameraBasis,
  hsvToHex,
  mixCamera,
  particleRiverPoint,
  pointCloudPyramid,
  projectPoint,
  projectViewInto,
  REST_CAMERA,
  roamingCamera,
  scratchProjected,
  starfieldInto,
  vanishingPoint,
  viewPoint,
  wanderPoint,
  type CameraPose,
} from './space.ts';
import {
  SYN_AMBER,
  SYN_CYAN,
  SYN_GREEN,
  SYN_DIM,
  SYN_DISPLAY_FONT,
  SYN_EMBER,
  SYN_FLARE,
  SYN_MAGENTA,
  SYN_MIST,
  SYN_RED,
  SYN_TEXT_FONT,
  SYN_VOID,
  SYN_WHITE,
  sceneHue,
} from './style.ts';
import {
  audioDrive,
  type AudioDrive,
  type BeMusicRect,
  comboTier,
  effectProfile,
  flashingGreatColor,
  hash01,
  impulse,
  isFlashingGreat,
  judgeDisplayWord,
  LOADING_WORD,
  loadingDots,
  type BeMusicGameplayLayout,
  type BeMusicGameplayRuntime,
  STAGE_HEIGHT as DESIGN_HEIGHT,
  STAGE_SIDE_COLUMN,
  STAGE_WIDTH as DESIGN_WIDTH,
  punchScale,
} from '@be-music/skin-sdk';
import {
  addHudNumber,
  addHudText,
  type ChildPool,
  type HudTextOptions,
  type PixiChromeContext,
} from '../pixi-kit/index.ts';

type Runtime = BeMusicGameplayRuntime;

/**
 * HUD grid (design px): a 16 px page margin and a 12 px gutter. The left column (16..272) stacks the gauge frame and
 * the song plate; the score panel fills the right column (284..624) from the gauge frame's top to the plate's bottom.
 */
const HUD_MARGIN = 16;
const GAUGE_FRAME = { x: HUD_MARGIN, y: GROOVE.y - 26, w: 256, h: 48 } as const;
const SONG_PLATE = { x: HUD_MARGIN, y: 420, w: DESIGN_WIDTH - HUD_MARGIN * 2 - 340 - 12, h: 46 } as const;
/** The score panel sits on the right margin; the track card runs from the left margin up to a gutter before it. */
const SCORE_PANEL = { x: DESIGN_WIDTH - HUD_MARGIN - 340, y: GAUGE_FRAME.y, w: 340, h: 466 - GAUGE_FRAME.y } as const;
/** Score panel's column divider, from its left edge. */
const SCORE_DIVIDER = 200;
const PLAYFIELD_FRAME_BOTTOM = 344;
/** Floor grid: horizon y, camera height above the floor, focal length. */
const FLOOR = { horizon: 326, height: 154, focal: 200 } as const;
/** How far the gameplay camera roams: eye offset (floor frame, floor 154 below) and turn / tilt. */
const CAMERA_RANGE = { x: 230, y: 110, yaw: 0.34, pitch: 0.18 } as const;
const CAMERA_CYCLE_S = 7;
const SCHOOL_SIZE = 70;
/**
 * Three schools, each with its own swimming box (floor frame, floor at y 154), light, and seed — their leaders wander
 * independently, so the flocks cross, part, and pass in front of one another.
 */
const SCHOOL_SPECS = [
  {
    seed: 17,
    palette: 'ember',
    band: 'bass',
    bounds: { minX: -650, maxX: 450, minY: -200, maxY: 110, minZ: 160, maxZ: 900 },
  },
  {
    seed: 41,
    palette: 'blue',
    band: 'mid',
    bounds: { minX: -300, maxX: 800, minY: -260, maxY: 40, minZ: 300, maxZ: 1200 },
  },
  {
    seed: 73,
    palette: 'magenta',
    band: 'high',
    bounds: { minX: -800, maxX: 800, minY: -240, maxY: 80, minZ: 700, maxZ: 1700 },
  },
] as const;
const SCHOOLS = new WeakMap<object, { flocks: Flock[]; lastMs: number; kick: KickState }>();

/** The dust field's shape; it moves by accumulated travel (see advanceTravel), so its own speed is one unit per unit. */
const DUST_FIELD = { spread: 640, near: 20, far: 900, speed: 1 } as const;

interface Travel {
  seconds: number;
  dust: number;
  floor: number;
  river: number;
  /** The floor terrain's swell (0..1), following the music's level (see followTerrain). */
  terrain: number;
}

const TRAVEL = new WeakMap<object, Travel>();

/**
 * Accumulates how far the dust, floor and rivers have travelled at their current `speeds` (world units per second).
 * Positions computed as `seconds × speed` jump whenever the speed changes, so the music or the zone changing pace would
 * teleport every particle; integrating keeps the motion continuous. Restarts when the clock runs backwards.
 */
function advanceTravel(
  key: object,
  seconds: number,
  speeds: Omit<Travel, 'seconds' | 'terrain'>,
  level: number,
): Travel {
  let state = TRAVEL.get(key);
  if (!state || seconds < state.seconds) {
    state = { seconds, dust: 0, floor: 0, river: 0, terrain: 0 };
    TRAVEL.set(key, state);
  }
  const dt = Math.min(0.1, seconds - state.seconds);
  state.dust += speeds.dust * dt;
  state.floor += speeds.floor * dt;
  state.river += speeds.river * dt;
  state.terrain = followTerrain(state.terrain, level, dt);
  state.seconds = seconds;
  return state;
}

/**
 * The chrome layer's schools, created on first use (or when their size changes) and stepped to `nowMs`, with the kick
 * envelope (from the spectrum `bands` and `onset`) that flicks the fish up.
 */
function advanceSchools(
  key: object,
  nowMs: number,
  size: number,
  forces: { gather: number; scatter: number },
  bands: readonly number[],
  onset: number,
): { flocks: Flock[]; swell: number } {
  let state = SCHOOLS.get(key);
  if (!state || state.flocks[0]!.count !== size || nowMs < state.lastMs) {
    state = {
      flocks: SCHOOL_SPECS.map((spec) => createFlock(spec.seed, size, spec.bounds)),
      lastMs: nowMs,
      kick: KICK_REST,
    };
    SCHOOLS.set(key, state);
  }
  const dt = (nowMs - state.lastMs) / 1000;
  state.flocks.forEach((flock, index) => {
    // Offset each leader's clock so the schools never shadow one another.
    stepFlock(flock, dt, { seconds: nowMs / 1000 + index * 41.7, ...forces });
  });
  state.kick = stepKick(state.kick, bands, onset, Math.min(0.1, dt));
  state.lastMs = nowMs;
  return { flocks: state.flocks, swell: state.kick.swell };
}
/**
 * The idle monitor's charge cloud, one per chrome layer (it outlives the per-frame pools), with the clock of its last
 * simulation step. A smaller cloud than the select screen's: the monitor is small.
 */
const MONITOR_CLOUDS = new WeakMap<Container, { cloud: ChargeCloud; lastSeconds: number | undefined }>();

function monitorCloudFor(layer: Container): { cloud: ChargeCloud; lastSeconds: number | undefined } {
  let state = MONITOR_CLOUDS.get(layer);
  if (state === undefined) {
    state = { cloud: new ChargeCloud(192), lastSeconds: undefined };
    MONITOR_CLOUDS.set(layer, state);
  }
  return state;
}
const PYRAMIDS = [pointCloudPyramid(3, 520), pointCloudPyramid(8, 420), pointCloudPyramid(5, 700)];

/**
 * Synesthesia gameplay HUD after a cosmic particle world: a black void lit by an ember horizon, data dust and speed
 * dust pouring out of the vanishing point, a floor of light points scrolling toward the player, rivers of particles
 * once the run is in the zone, and hairline frames with lock-on corners. With no BGA the monitor idles on a floating
 * audio orb roaming in front of particle pyramids. Colour drifts through the ember band and swells on every beat.
 */
export function renderSynesthesiaChrome({
  layer,
  overlayLayer,
  layerPool,
  overlayLayerPool,
  runtime,
  layout,
}: PixiChromeContext): void {
  const seconds = (runtime.nowMs ?? 0) / 1000;
  // The idle monitor shows its cloud only while there is no BGA; it redraws (and re-shows) it below if so. Its clock
  // carries on across hidden frames: the cloud clamps each step, so a gap just resumes it.
  const monitorCloud = MONITOR_CLOUDS.get(layer);
  if (monitorCloud) monitorCloud.cloud.view.visible = false;
  const beatPhase = runtime.beatPhase ?? 0;
  const pulse = (1 - beatPhase) ** 2;
  const hue = sceneHue(seconds, beatPhase);
  const accent = hsvToHex(hue, 0.62, 1);
  const { left: playfieldLeft, right: playfieldRight } = layout.playfield;
  Object.assign(BGA, layout.bga ?? NO_MONITOR);
  const hasBga = runtime.hasBga === true && BGA.w > 0;

  const space = layerPool.acquireGraphics();
  space.label = 'synesthesia-gameplay/space';
  space.blendMode = 'normal';
  // Zone: the space intensifies with the combo (faster, denser dust, a hotter floor, particle rivers).
  // Reduced effects cap the escalation; effects off keep the calm tier-0 space.
  const effects = effectProfile(runtime.effects);
  const tier = effects.enabled ? Math.min(comboTier(runtime.combo ?? 0), effects.screenWide ? 4 : 2) : 0;
  // Input reaction: every press surges the dust and tints the sky with the pressed lane's light.
  const hit = impulse(runtime.impulseAtMs, runtime.nowMs ?? 0, 280) * effects.amount;
  const hitColor = IMPULSE_COLORS[runtime.impulseKind ?? 'white'];
  // Camera: the background roams between random shots (flying, sometimes hard-cutting) with a handheld drift,
  // reframing floor, rivers, and schools. Reduced effects halve the moves; effects off keep the camera at rest.
  const camera = mixCamera(REST_CAMERA, roamingCamera(seconds, 7, CAMERA_RANGE, CAMERA_CYCLE_S), effects.amount);
  const horizon = vanishingPoint(camera, CENTER_X, FLOOR.horizon, FLOOR.focal).y;
  // The space listens to the mix: the ember haze and floor swell on the bass, dust speeds with loudness, rivers weave with the mids, the schools tighten on bass hits and scatter on transients.
  const drive = audioDrive(runtime.audio, runtime.effects);
  drawGround(space, hasBga, hit, hitColor, horizon);

  const light = layerPool.acquireGraphics();
  light.label = 'synesthesia-gameplay/light';
  light.blendMode = 'add';
  // Dust, floor and rivers move by accumulated travel, so the music and the zone can change their speed smoothly.
  const travel = advanceTravel(
    layer,
    seconds,
    {
      dust: (120 + 40 * pulse) * (1 + 0.45 * tier) * (1 + 2.2 * hit) * (1 + 1.2 * drive.level),
      floor: 150 * (1 + 0.3 * tier),
      river: 260 + 60 * tier,
    },
    drive.level,
  );
  drawDust(light, hasBga, tier, hit, camera, travel.dust);
  drawFloor(light, travel.floor, terrainAmplitude(travel.terrain), seconds, pulse, hasBga, tier, hit, camera, drive);
  const rivers = tier >= 4 ? 3 : tier >= 2 ? 2 : 1;
  for (let river = 0; river < rivers; river += 1) {
    drawRiver(light, seconds, travel.river, river, hasBga, tier, camera, drive);
  }
  if (effects.enabled) {
    // Schools of light fish swimming through the space: tighter on the beat, scattering on every key press.
    const { flocks: schools, swell } = advanceSchools(
      layer,
      runtime.nowMs ?? 0,
      effects.screenWide ? SCHOOL_SIZE : SCHOOL_SIZE / 2,
      {
        gather: Math.max(pulse * 0.6, drive.bass),
        scatter: Math.max(impulse(runtime.impulseAtMs, runtime.nowMs ?? 0, 520) * effects.amount, 0.8 * drive.onset),
      },
      drive.bands,
      drive.onset,
    );
    const shown = effects.screenWide ? schools.length : 1;
    for (let school = 0; school < shown; school += 1) {
      drawSchool(
        light,
        schools[school]!,
        (point) => projectPoint(viewPoint(point, camera), CENTER_X, FLOOR.horizon, FLOOR.focal),
        {
          alpha: 0.95,
          palette: SCHOOL_SPECS[school]!.palette,
          swell,
          glowLevel: drive[SCHOOL_SPECS[school]!.band],
          skip: (x, y) =>
            x < -10 || x > DESIGN_WIDTH + 10 || y < 0 || y > DESIGN_HEIGHT || (hasBga && insideBga(x, y, 4)),
        },
      );
    }
  }

  const panels = layerPool.acquireGraphics();
  panels.label = 'synesthesia-gameplay/panels';
  panels.blendMode = 'normal';
  drawPlayfieldWell(panels, playfieldLeft, playfieldRight, runtime.progressRatio, accent);
  // The monitor shrinks to fit beside a double-play field; only a page-wide keyboard field leaves no room for it.
  if (BGA.w > 0) {
    const standby = layerPool.acquireGraphics();
    standby.label = 'synesthesia-gameplay/standby';
    standby.blendMode = 'add';
    drawBgaFrame(panels, standby, layer, hasBga, seconds, pulse, hue, camera, drive, layerPool);
  }
  drawGauge(panels, layer, runtime, accent, layerPool);
  drawSongPlate(panels, layer, runtime, accent, layerPool);
  drawScorePanel(panels, layer, runtime, accent, layerPool);
  // The judge tally owns the side column on the right edge.
  drawJudgeTally(panels, layer, runtime, STAGE_SIDE_COLUMN.x, layerPool);

  const front = overlayLayerPool.acquireGraphics();
  front.label = 'synesthesia-gameplay/header';
  drawHeader(front, overlayLayer, runtime, accent, pulse, overlayLayerPool);
  if (runtime.loading) {
    drawLoading(overlayLayer, runtime.nowMs ?? 0, (playfieldLeft + playfieldRight) / 2, accent, overlayLayerPool);
  } else {
    drawJudgements(overlayLayer, runtime, layout, seconds, overlayLayerPool);
  }
  drawSynesthesiaMoments(
    layer,
    overlayLayer,
    runtime,
    (playfieldLeft + playfieldRight) / 2,
    hue,
    overlayLayerPool,
    layout,
  );
}

/** NOW LOADING on the lanes: wide-tracked light breathing in the accent glow, dots ticking beneath. */
function drawLoading(layer: Container, nowMs: number, cx: number, accent: number, pool: ChildPool): void {
  const breath = 0.55 + 0.45 * Math.sin(nowMs / 420) ** 2;
  addHudText(
    layer,
    LOADING_WORD,
    cx,
    186,
    {
      size: 13,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 4,
      anchorX: 0.5,
      anchorY: 0.5,
      maxWidth: 180,
      dropShadow: { color: accent, alpha: breath, blur: 10, distance: 0 },
    },
    pool,
  );
  addHudText(
    layer,
    loadingDots(nowMs).padEnd(3, ' '),
    cx,
    208,
    { size: 13, fill: accent, fontFamily: SYN_DISPLAY_FONT, letterSpacing: 6, anchorX: 0.5, anchorY: 0.5 },
    pool,
  );
}

function insideBga(x: number, y: number, margin = 0): boolean {
  return x > BGA.x - margin && x < BGA.x + BGA.w + margin && y > BGA.y - margin && y < BGA.y + BGA.h + margin;
}

/**
 * The monitor rect of the frame being drawn: the stage's BGA square for the current playfield (it shrinks beside a
 * double-play field). Updated at the top of {@link renderSynesthesiaChrome} and read by the drawing helpers below.
 */
const BGA: BeMusicRect = { x: 0, y: 0, w: 0, h: 0 };
/** Stand-in for a layout without a BGA (a page-wide keyboard field): an empty rect, so no monitor is drawn. */
const NO_MONITOR: BeMusicRect = { x: 0, y: 0, w: 0, h: 0 };

/** Horizontal centre of the stage — the space's vanishing point. */
const CENTER_X = DESIGN_WIDTH / 2;

const IMPULSE_COLORS: Record<'white' | 'black' | 'scratch', number> = {
  white: SYN_EMBER,
  black: SYN_CYAN,
  scratch: SYN_MAGENTA,
};

/** Vanishing point the dust pours out of (behind the monitor). */
const VANISH = { x: CENTER_X, y: FLOOR.horizon - 90 } as const;

/**
 * Warm-black ground (a stack of bands, so a live BGA stays untouched), plus a brief tint of the pressed lane's light on
 * each key press above `horizon`, which follows the camera's pitch.
 */
function drawGround(graphics: Graphics, hasBga: boolean, hit: number, hitColor: number, horizon: number): void {
  const bands: ReadonlyArray<readonly [number, number]> = [
    [0x090302, 140],
    [0x060201, 260],
    [0x040100, 380],
    [SYN_VOID, DESIGN_HEIGHT],
  ];
  let top = 0;
  for (const [color, bottom] of bands) {
    fillAroundBga(graphics, 0, top, DESIGN_WIDTH, bottom - top, color, hasBga);
    top = bottom;
  }
  if (hit > 0) {
    fillAroundBga(graphics, 0, 0, DESIGN_WIDTH, horizon, hitColor, hasBga, 0.06 * hit);
  }
}

/**
 * Data dust (tiny warm squares, the odd blue / magenta mote) flying out of the vanishing point, faster with the combo
 * tier and on key presses.
 */
function drawDust(
  graphics: Graphics,
  hasBga: boolean,
  tier: number,
  hit: number,
  camera: CameraPose,
  distance: number,
): void {
  const batch = sharedShapeBatch;
  const count = 220 + 50 * tier;
  const basis = cameraBasis(camera, SCRATCH_BASIS);
  for (let index = 0; index < count; index += 1) {
    // `distance` is the field's accumulated travel, so a change of speed accelerates the motes instead of jumping them.
    const point = starfieldInto(SCRATCH_POINT, index, distance, DUST_FIELD);
    const projected = projectViewInto(SCRATCH_A, point.x, point.y, point.z, basis, VANISH.x, VANISH.y, 180);
    if (!projected.visible) continue;
    if (projected.x < 0 || projected.x > DESIGN_WIDTH || projected.y < 0 || projected.y > DESIGN_HEIGHT) continue;
    if (hasBga && insideBga(projected.x, projected.y, 4)) continue;
    const nearness = Math.min(1, projected.scale);
    const size = 0.5 + 1.3 * nearness;
    const color = index % 9 === 0 ? SYN_CYAN : index % 13 === 0 ? SYN_MAGENTA : emberColor(0.35 + 0.65 * nearness);
    if (nearness > 0.45) {
      // Near motes get a soft bokeh square around them.
      const bokeh = size * 3.2;
      batch.rect(graphics, color, 0.05 * nearness, projected.x - bokeh / 2, projected.y - bokeh / 2, bokeh, bokeh);
    }
    batch.rect(graphics, color, 0.3 + 0.6 * nearness, projected.x - size / 2, projected.y - size / 2, size, size);
  }
  batch.flush();
}

/**
 * Particle-world floor: a lattice of light points scrolling toward the player on the beat, over faint radial guide lines.
 * The lattice rolls into Perlin-noise hills (see floorRise) up to `amplitude` tall, so it heaves with the music.
 */
function drawFloor(
  graphics: Graphics,
  distance: number,
  amplitude: number,
  seconds: number,
  pulse: number,
  hasBga: boolean,
  tier: number,
  hit: number,
  camera: CameraPose,
  drive: AudioDrive,
): void {
  const { horizon, height, focal } = FLOOR;
  const glow = 1 + 0.3 * tier + 0.8 * hit + 1.2 * drive.bass;
  const basis = cameraBasis(camera, SCRATCH_BASIS);
  // The floor runs up to a live BGA but never over it: lines are clipped around the monitor, points inside it skipped.
  const pieces = FLOOR_PIECES;
  pieces.length = 0;
  for (let x = -1500; x <= 1500; x += 100) {
    const near = projectViewInto(SCRATCH_A, x, height, 0, basis, CENTER_X, horizon, focal);
    const far = projectViewInto(SCRATCH_B, x, height, 2400, basis, CENTER_X, horizon, focal);
    if (!near.visible || !far.visible) continue;
    if (hasBga) clipSegmentOutsideRect(near.x, near.y, far.x, far.y, BGA, pieces);
    else pieces.push(near.x, near.y, far.x, far.y);
  }
  for (let index = 0; index < pieces.length; index += 4) {
    graphics.moveTo(pieces[index]!, pieces[index + 1]!).lineTo(pieces[index + 2]!, pieces[index + 3]!);
  }
  graphics.stroke({ color: SYN_EMBER, width: 1, alpha: Math.min(0.4, 0.05 * glow) });
  const spacing = 90;
  const offset = distance % spacing;
  for (let z = spacing - offset; z < 2400; z += spacing) {
    const nearness = 1 - z / 2400;
    const alpha = Math.min(1, (0.12 + 0.7 * nearness * nearness) * (0.7 + 0.3 * pulse) * glow);
    const size = 0.6 + 1.4 * nearness * nearness;
    const color = emberColor(0.3 + 0.65 * nearness);
    for (let x = -1500; x <= 1500; x += 50) {
      const rise = floorRise(x, z + distance, seconds, amplitude);
      const point = projectViewInto(SCRATCH_A, x, height - rise, z, basis, CENTER_X, horizon, focal);
      if (!point.visible || point.x < -4 || point.x > DESIGN_WIDTH + 4 || point.y > DESIGN_HEIGHT + 4) continue;
      if (hasBga && insideBga(point.x, point.y, 2)) continue;
      // Crests catch more light than the valleys.
      const lit = Math.min(1, alpha * (1 + (0.9 * rise) / amplitude));
      sharedShapeBatch.rect(graphics, color, lit, point.x - size / 2, point.y - size / 2, size, size);
    }
  }
  sharedShapeBatch.flush();
}

/** Scratch buffer for clipped floor lines (`x0, y0, x1, y1` quads), reused every frame. */
const FLOOR_PIECES: number[] = [];
/** Scratch objects for the allocation-free projection in the hot loops above. */
const SCRATCH_BASIS = cameraBasis(REST_CAMERA);
const SCRATCH_A = scratchProjected();
const SCRATCH_B = scratchProjected();
const SCRATCH_POINT = { x: 0, y: 0, z: 0 };

const RIVER_PARTICLES = 280;

/**
 * A river of light particles streaming low over the floor, receding diagonally into the distance — golden
 * flows. Each particle is a short streak along the flow; river 1 runs blue-white, the others ember.
 */
function drawRiver(
  graphics: Graphics,
  seconds: number,
  distance: number,
  river: number,
  hasBga: boolean,
  tier: number,
  camera: CameraPose,
  drive: AudioDrive,
): void {
  const options = {
    length: 1500,
    speed: 260 + 60 * tier,
    amplitude: 28 * (1 + 1.4 * drive.mid),
    width: 16,
    seed: river + 1,
  };
  const baseY = [118, 70, 134][river] ?? 118;
  const baseZ = [520, 900, 300][river] ?? 520;
  const slope = [0.55, -0.4, 0.3][river] ?? 0.5;
  const toWorld = (local: { x: number; y: number; z: number }) =>
    viewPoint({ x: local.x, y: baseY + local.y, z: baseZ + local.z + local.x * slope }, camera);
  for (let index = 0; index < RIVER_PARTICLES; index += 1) {
    const local = particleRiverPoint(index, seconds, options, distance);
    const head = projectPoint(toWorld(local), CENTER_X, FLOOR.horizon, FLOOR.focal);
    const tail = projectPoint(toWorld({ ...local, x: local.x - 26 }), CENTER_X, FLOOR.horizon, FLOOR.focal);
    if (!head.visible || !tail.visible) continue;
    if (head.x < -20 || head.x > DESIGN_WIDTH + 20 || head.y < 0 || head.y > DESIGN_HEIGHT) continue;
    if (hasBga && (insideBga(head.x, head.y, 4) || insideBga(tail.x, tail.y, 4))) continue;
    const heat = hash01(index * 3 + river * 101);
    const color = river === 1 ? (heat > 0.7 ? SYN_WHITE : SYN_CYAN) : emberColor(0.5 + 0.5 * heat);
    const nearness = Math.min(1, head.scale);
    sharedShapeBatch.line(
      graphics,
      color,
      0.25 + 0.55 * heat,
      0.4 + 0.9 * nearness * (0.5 + heat),
      tail.x,
      tail.y,
      head.x,
      head.y,
    );
  }
  sharedShapeBatch.flush();
}

function fillAroundBga(
  graphics: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  hasBga: boolean,
  alpha = 1,
): void {
  const fill = { color, alpha };
  const right = x + w;
  const bottom = y + h;
  const holeRight = BGA.x + BGA.w;
  const holeBottom = BGA.y + BGA.h;
  if (!hasBga || right <= BGA.x || x >= holeRight || bottom <= BGA.y || y >= holeBottom) {
    graphics.rect(x, y, w, h).fill(fill);
    return;
  }
  if (y < BGA.y) graphics.rect(x, y, w, BGA.y - y).fill(fill);
  const bandTop = Math.max(y, BGA.y);
  const bandBottom = Math.min(bottom, holeBottom);
  if (x < BGA.x) graphics.rect(x, bandTop, BGA.x - x, bandBottom - bandTop).fill(fill);
  if (right > holeRight) graphics.rect(holeRight, bandTop, right - holeRight, bandBottom - bandTop).fill(fill);
  if (bottom > holeBottom) graphics.rect(x, holeBottom, w, bottom - holeBottom).fill(fill);
}

function drawPlayfieldWell(
  graphics: Graphics,
  playfieldLeft: number,
  right: number,
  progressRatio: number | undefined,
  accent: number,
): void {
  const left = playfieldLeft - 4;
  const w = right - left + 4;
  graphics.rect(left, 0, w, PLAYFIELD_FRAME_BOTTOM).fill({ color: SYN_VOID, alpha: 0.72 });
  // Glowing side rails.
  for (const x of [left - 1, right + 2]) {
    graphics.rect(x - 2, 0, 5, PLAYFIELD_FRAME_BOTTOM).fill({ color: accent, alpha: 0.06 });
    graphics.rect(x, 0, 1, PLAYFIELD_FRAME_BOTTOM).fill({ color: accent, alpha: 0.6 });
  }
  // Song progress as a light rising along the left rail.
  const ratio =
    progressRatio !== undefined && Number.isFinite(progressRatio) ? Math.max(0, Math.min(1, progressRatio)) : 0;
  const trackH = PLAYFIELD_FRAME_BOTTOM - 12;
  if (ratio > 0) {
    const y = 6 + trackH * (1 - ratio);
    graphics.rect(left - 3, y, 5, trackH * ratio).fill({ color: SYN_WHITE, alpha: 0.12 });
    graphics.circle(left - 1, y, 3).fill({ color: SYN_WHITE, alpha: 0.95 });
    graphics.circle(left - 1, y, 7).fill({ color: accent, alpha: 0.25 });
  }
  graphics.rect(left - 1, PLAYFIELD_FRAME_BOTTOM, w + 4, 1).fill({ color: accent, alpha: 0.7 });
}

/**
 * Monitor frame: a warm hairline with lock-on corners. With no BGA the screen idles on a miniature particle world — a floating
 * visualizer-style orb roaming in front of particle pyramids on an ember horizon — the
 * "nothing is playing, but the space is alive" state. The idle scene draws into `light` (additive).
 */
function drawBgaFrame(
  graphics: Graphics,
  light: Graphics,
  layer: Container,
  hasBga: boolean,
  seconds: number,
  pulse: number,
  hue: number,
  camera: CameraPose,
  drive: AudioDrive,
  pool: ChildPool,
): void {
  const color = hsvToHex(hue, 0.6, 1);
  const margin = 6;
  const frameX = BGA.x - margin;
  const frameY = BGA.y - margin;
  const frameW = BGA.w + margin * 2;
  const frameH = BGA.h + margin * 2;
  graphics.rect(frameX, frameY, frameW, frameH).stroke({ color, width: 4, alpha: 0.06 });
  graphics.rect(frameX, frameY, frameW, frameH).stroke({ color, width: 1, alpha: 0.4 });
  drawReticle(graphics, frameX, frameY, frameW, frameH, SYN_WHITE, 0.9, { arm: 18, width: 2 });
  if (hasBga) return;

  graphics.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill({ color: SYN_VOID, alpha: 0.92 });
  const inside = (x: number, y: number) => !insideBga(x, y, -2);
  // The monitor's camera circles the scene: the shot's turn is exaggerated into an orbit, its travel damped.
  const orbit = 60;
  const orbitCamera: CameraPose = {
    x: camera.x * 0.2,
    y: camera.y * 0.3,
    z: 0,
    yaw: camera.yaw * 2.2,
    pitch: camera.pitch * 0.8,
  };
  const cx = BGA.x + BGA.w / 2;
  const baseHorizon = BGA.y + BGA.h * 0.66;
  const view = { cx, cy: baseHorizon, focal: 220, camera: orbitCamera, orbit };
  // Particle pyramids on the horizon.
  for (const [pyramid, x, z, scale, yaw] of [
    [PYRAMIDS[2]!, 40, 1500, 520, 0.2],
    [PYRAMIDS[0]!, -330, 700, 250, 0.5],
    [PYRAMIDS[1]!, 330, 820, 230, -0.3],
  ] as const) {
    drawPointCloud(light, pyramid, { scale, x, y: 0, z, yaw: yaw + seconds * 0.04 }, view, {
      colorOf: (point) => emberColor(0.35 + 0.55 * point.weight),
      alpha: 0.8,
      size: 1,
      seconds,
      shimmer: 0.3,
      referenceScale: 220 / (220 + z),
      skip: (px, py) => inside(px, py),
    });
  }
  // Floor points scrolling in.
  // A coarser lattice than the main floor: the monitor is small, so this keeps the point count down.
  const offset = (seconds * 90) % 80;
  for (let z = 80 - offset; z < 1400; z += 80) {
    const nearness = 1 - z / 1400;
    for (let x = -600; x <= 600; x += 40) {
      const point = projectPoint(viewPoint({ x, y: 70, z }, orbitCamera, orbit), cx, baseHorizon, 220);
      if (!point.visible || inside(point.x, point.y)) continue;
      const size = 0.5 + 1.1 * nearness * nearness;
      sharedShapeBatch.rect(
        light,
        emberColor(0.3 + 0.6 * nearness),
        0.2 + 0.6 * nearness * nearness,
        point.x - size / 2,
        point.y - size / 2,
        size,
        size,
      );
    }
  }
  sharedShapeBatch.flush();
  // The audio orb roams the monitor's little world close to the camera: a small charge cloud, its dark magnet orbs
  // wrapped in a fluid of particles, kept inside the monitor.
  const roam = wanderPoint(seconds * 0.8, 2, { minX: -55, maxX: 55, minY: -125, maxY: -70, minZ: -120, maxZ: 0 });
  const at = projectPoint(viewPoint(roam, view.camera, view.orbit), view.cx, view.cy, view.focal);
  const state = monitorCloudFor(layer);
  const host = light.parent!;
  if (state.cloud.view.parent === host) host.removeChild(state.cloud.view);
  host.addChildAt(state.cloud.view, host.getChildIndex(light) + 1);
  const scale = at.visible ? 60 * at.scale * (1 + 0.03 * pulse) : 0;
  state.cloud.update({
    x: at.x,
    y: at.y,
    scale,
    seconds,
    dt: state.lastSeconds === undefined ? 0 : seconds - state.lastSeconds,
    drive,
    alpha: at.visible ? 1 : 0,
    clip: { x: BGA.x, y: BGA.y, w: BGA.w, h: BGA.h - 22 },
  });
  state.lastSeconds = seconds;
  if (at.visible) {
    // Lock-on reticle tracking it.
    const lock = scale * 0.55 + 5 * pulse;
    drawReticle(light, at.x - lock, at.y - lock, lock * 2, lock * 2, SYN_FLARE, 0.5, { arm: 8, cross: true });
  }
  // A dark slip under the label, so the monitor's floor horizon never runs through the type.
  const slip = pool.acquireGraphics();
  slip.label = 'synesthesia-gameplay/standby-slip';
  slip.blendMode = 'normal';
  slip.rect(cx - 76, BGA.y + BGA.h - 26, 152, 17).fill({ color: SYN_VOID, alpha: 0.9 });
  addHudText(
    layer,
    'SOUND ONLY',
    cx,
    BGA.y + BGA.h - 22,
    { ...displayStyle(9, SYN_MIST), letterSpacing: 6, anchorX: 0.5 },
    pool,
  );
}

function drawHeader(
  graphics: Graphics,
  layer: Container,
  runtime: Runtime,
  accent: number,
  pulse: number,
  pool: ChildPool,
): void {
  const autoplay = runtime.autoplay === true;
  // Near-opaque, so the playfield rails and lanes stop under the header instead of running through its type.
  graphics.rect(0, 0, DESIGN_WIDTH, 34).fill({ color: SYN_VOID, alpha: 0.92 });
  graphics.rect(0, 34, DESIGN_WIDTH, 1).fill({ color: accent, alpha: 0.35 + 0.35 * pulse });
  graphics.circle(HUD_MARGIN + 8, 17, 3).fill({ color: autoplay ? SYN_AMBER : accent, alpha: 1 });
  graphics.circle(HUD_MARGIN + 8, 17, 8).fill({ color: autoplay ? SYN_AMBER : accent, alpha: 0.18 + 0.2 * pulse });
  addHudText(
    layer,
    autoplay ? 'AUTO PLAY' : 'PLAY',
    HUD_MARGIN + 22,
    12,
    { ...displayStyle(10, SYN_WHITE), letterSpacing: 3 },
    pool,
  );
  // Readouts on a fixed rhythm after the mode: label, then its value 40 px on; groups 96 px apart.
  addHudText(layer, 'BPM', 172, 14, labelStyle(), pool);
  addHudNumber(layer, formatBpm(runtime.bpm), 212, 9, displayStyle(14, SYN_WHITE), pool);
  addHudText(layer, 'SPEED', 268, 14, labelStyle(), pool);
  addHudNumber(layer, `x${formatHiSpeed(runtime.hiSpeed)}`, 328, 9, displayStyle(14, SYN_WHITE), pool);
  addHudText(
    layer,
    formatRuleset(runtime.rulesetLabel),
    DESIGN_WIDTH - HUD_MARGIN,
    12,
    { ...displayStyle(9, accent), letterSpacing: 3, anchorX: 1, maxWidth: 110 },
    pool,
  );
}

function drawGauge(graphics: Graphics, layer: Container, runtime: Runtime, accent: number, pool: ChildPool): void {
  const gauge = clampPercent(runtime.gauge ?? 0);
  const clear = clampPercent(runtime.clearThreshold ?? 80);
  const survival = runtime.gaugeSurvival === true || clear <= 0;
  const cleared = survival ? gauge > 0 : gauge >= clear;
  drawFrame(graphics, GAUGE_FRAME.x, GAUGE_FRAME.y, GAUGE_FRAME.w, GAUGE_FRAME.h, accent);
  addHudText(
    layer,
    `${(runtime.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`,
    GROOVE.x - 2,
    GROOVE.y - 19,
    { ...labelStyle(), maxWidth: 130 },
    pool,
  );
  addHudNumber(
    layer,
    `${Math.round(gauge)}%`,
    GAUGE_FRAME.x + GAUGE_FRAME.w - 14,
    GROOVE.y - 22,
    { ...displayStyle(12, cleared ? SYN_AMBER : SYN_WHITE), anchorX: 1 },
    pool,
  );
  const cells = 50;
  const stride = GROOVE.w / cells;
  const lit = Math.round((gauge / 100) * cells);
  const clearCell = Math.round((clear / 100) * cells);
  const flicker = runtime.nowMs !== undefined ? 0.65 + 0.35 * Math.abs(Math.sin(runtime.nowMs / 60)) : 1;
  const barY = GROOVE.y + 2;
  const barH = GROOVE.h - 4;
  if (lit > 0) {
    graphics
      .rect(GROOVE.x, barY - 3, lit * stride, barH + 6)
      .fill({ color: cleared ? SYN_EMBER : SYN_CYAN, alpha: 0.14 });
  }
  for (let cell = 0; cell < cells; cell += 1) {
    const x = GROOVE.x + cell * stride;
    if (cell >= lit) {
      graphics.rect(x, barY, stride - 1, barH).fill({ color: SYN_DIM, alpha: 0.18 });
      continue;
    }
    const hot = survival || cell >= clearCell;
    // Below the clear line the cells run electric blue; past it they catch fire, ember → gold.
    const color = hot
      ? emberColor(0.4 + (0.55 * (cell - clearCell)) / Math.max(1, cells - clearCell))
      : hsvToHex(0.58 - (cell / cells) * 0.04, 0.72, 1);
    graphics
      .rect(x, barY, stride - 1, barH)
      .fill({ color: cell === lit - 1 ? SYN_WHITE : color, alpha: cell === lit - 1 ? flicker : 0.95 });
  }
  if (!survival) {
    const x = GROOVE.x + clearCell * stride - 1;
    graphics.rect(x, barY - 5, 1.5, barH + 10).fill({ color: SYN_WHITE, alpha: 1 });
  }
}

function drawSongPlate(graphics: Graphics, layer: Container, runtime: Runtime, accent: number, pool: ChildPool): void {
  const { x, y, w, h } = SONG_PLATE;
  drawFrame(graphics, x, y, w, h, accent);
  addHudText(
    layer,
    runtime.songTitle?.trim() || 'Untitled chart',
    x + 14,
    y + 6,
    {
      size: 15,
      weight: '500',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      maxWidth: w - 28,
      dropShadow: { color: accent, alpha: 0.7, blur: 6, distance: 0 },
    },
    pool,
  );
  const artist = runtime.songArtist?.trim();
  if (artist) {
    addHudText(
      layer,
      artist,
      x + 14,
      y + 28,
      { size: 10, weight: '300', fill: SYN_MIST, fontFamily: SYN_TEXT_FONT, maxWidth: w - 28 },
      pool,
    );
  }
}

function drawScorePanel(graphics: Graphics, layer: Container, runtime: Runtime, accent: number, pool: ChildPool): void {
  const { x, y, w, h } = SCORE_PANEL;
  drawFrame(graphics, x, y, w, h, accent);
  graphics.rect(x + SCORE_DIVIDER, y + 14, 1, h - 28).fill({ color: accent, alpha: 0.3 });
  addHudText(layer, 'SCORE', x + 14, y + 12, labelStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.score),
    x + SCORE_DIVIDER - 14,
    y + 22,
    {
      ...displayStyle(17, SYN_WHITE),
      anchorX: 1,
      maxWidth: 120,
      dropShadow: { color: accent, alpha: 0.8, blur: 6, distance: 0 },
    },
    pool,
  );
  addHudText(layer, 'EX SCORE', x + 14, y + 54, labelStyle(), pool);
  addHudNumber(
    layer,
    `${formatCount(runtime.exScore)}/${formatCount(runtime.exScoreMax)}`,
    x + SCORE_DIVIDER - 14,
    y + 52,
    { ...displayStyle(8, SYN_MIST), anchorX: 1, maxWidth: 46 },
    pool,
  );
  addHudText(layer, 'EX RATE', x + 14, y + 76, labelStyle(), pool);
  addHudNumber(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    x + SCORE_DIVIDER - 14,
    y + 74,
    { ...displayStyle(8, SYN_MIST), anchorX: 1, maxWidth: 46 },
    pool,
  );
  // Rate meter as a light filament with the IIDX ninth ticks.
  const rate =
    runtime.exScore !== undefined && runtime.exScoreMax !== undefined && runtime.exScoreMax > 0
      ? Math.max(0, Math.min(1, runtime.exScore / runtime.exScoreMax))
      : 0;
  const meterX = x + 14;
  const meterW = SCORE_DIVIDER - 28;
  graphics.rect(meterX, y + 94, meterW, 2).fill({ color: SYN_DIM, alpha: 0.3 });
  if (rate > 0) {
    graphics.rect(meterX, y + 92, meterW * rate, 6).fill({ color: accent, alpha: 0.15 });
    graphics.rect(meterX, y + 94, meterW * rate, 2).fill({ color: rate >= 8 / 9 ? SYN_AMBER : SYN_WHITE, alpha: 0.95 });
  }
  for (let ninth = 1; ninth < 9; ninth += 1) {
    graphics
      .rect(meterX + (meterW * ninth) / 9, y + 91, 1, 8)
      .fill({ color: SYN_WHITE, alpha: ninth >= 6 ? 0.45 : 0.18 });
  }
  addHudText(layer, 'COMBO', x + SCORE_DIVIDER + 14, y + 12, labelStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.combo),
    x + w - 12,
    y + 24,
    { ...displayStyle(14, SYN_WHITE), anchorX: 1, maxWidth: 62 },
    pool,
  );
  addHudText(layer, 'MAX', x + SCORE_DIVIDER + 14, y + 54, labelStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.maxCombo),
    x + w - 12,
    y + 52,
    { ...displayStyle(9, SYN_MIST), anchorX: 1, maxWidth: 48 },
    pool,
  );
  const rank = runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F';
  addHudText(layer, 'RANK', x + SCORE_DIVIDER + 14, y + 76, labelStyle(), pool);
  addHudText(
    layer,
    rank,
    x + w - 12,
    y + 84,
    {
      ...displayStyle(rank.length >= 3 ? 12 : 16, SYN_AMBER),
      anchorX: 1,
      maxWidth: 46,
      dropShadow: { color: SYN_AMBER, alpha: 0.8, blur: 8, distance: 0 },
    },
    pool,
  );
}

const TALLY: ReadonlyArray<readonly [label: string, key: 'perfect' | 'great' | 'good' | 'bad' | 'poor']> = [
  ['PG', 'perfect'],
  ['GR', 'great'],
  ['GD', 'good'],
  ['BD', 'bad'],
  ['PR', 'poor'],
];

function drawJudgeTally(graphics: Graphics, layer: Container, runtime: Runtime, x: number, pool: ChildPool): void {
  const y = BGA.y - 6;
  const w = DESIGN_WIDTH - HUD_MARGIN - x;
  drawFrame(graphics, x, y, w, 186, SYN_EMBER);
  for (let row = 0; row < TALLY.length; row += 1) {
    const [label, key] = TALLY[row]!;
    const rowY = y + 14 + row * 26;
    const color = JUDGE_COLORS[TALLY_NAMES[key]] ?? SYN_WHITE;
    graphics.circle(x + 9, rowY + 6, 2).fill({ color, alpha: 1 });
    graphics.circle(x + 9, rowY + 6, 5).fill({ color, alpha: 0.2 });
    addHudText(layer, label, x + 17, rowY + 1, { ...labelStyle(), fill: color }, pool);
    addHudNumber(
      layer,
      formatCount(runtime[key]),
      x + w - 7,
      rowY - 1,
      { ...displayStyle(9, SYN_WHITE), anchorX: 1, maxWidth: w - 46 },
      pool,
    );
  }
  const footerY = y + 14 + TALLY.length * 26 + 4;
  graphics.rect(x + 8, footerY - 6, w - 16, 1).fill({ color: SYN_EMBER, alpha: 0.35 });
  for (const [row, label, color, count] of [
    [0, 'FAST', SYN_CYAN, runtime.fast],
    [1, 'SLOW', SYN_MAGENTA, runtime.slow],
  ] as const) {
    const rowY = footerY + row * 20;
    addHudText(layer, label, x + 8, rowY + 2, { ...labelStyle(), fill: color }, pool);
    addHudNumber(
      layer,
      formatCount(count),
      x + w - 7,
      rowY,
      { ...displayStyle(9, SYN_WHITE), anchorX: 1, maxWidth: w - 52 },
      pool,
    );
  }
}

const TALLY_NAMES = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', bad: 'BAD', poor: 'POOR' } as const;
const JUDGE_COLORS: Record<string, number> = {
  PERFECT: SYN_FLARE,
  GREAT: SYN_AMBER,
  GOOD: SYN_CYAN,
  BAD: SYN_MAGENTA,
  POOR: SYN_RED,
};

/** Colours the PERFECT judgement's flashing GREAT cycles through. */
const FLASHING_GREAT = [SYN_CYAN, SYN_WHITE, SYN_AMBER, SYN_MAGENTA, SYN_GREEN] as const;

/**
 * Judgement word and combo as light: wide tracked type with a same-colour bloom. PERFECT prints as a GREAT that flashes
 * through the prism colours, so a clean run literally shimmers.
 */
function drawJudgements(
  layer: Container,
  runtime: Runtime,
  layout: BeMusicGameplayLayout,
  seconds: number,
  pool: ChildPool,
): void {
  const displays = resolveJudgeDisplays(runtime, layout);
  const nowMs = runtime.nowMs ?? 0;
  const amount = effectProfile(runtime.effects).amount;
  for (const display of displays) {
    const judgeScale = punchScale(runtime.judgeAtMs, nowMs, 120, 0.22 * amount);
    const color = isFlashingGreat(display.judge)
      ? flashingGreatColor(nowMs, FLASHING_GREAT)
      : (JUDGE_COLORS[display.judge] ?? SYN_WHITE);
    addHudText(
      layer,
      judgeDisplayWord(display.judge),
      display.x,
      236,
      {
        scale: judgeScale,
        ...displayStyle(16, color),
        letterSpacing: 4,
        anchorX: 0.5,
        anchorY: 0.5,
        maxWidth: display.maxWidth,
        dropShadow: { color, alpha: 0.95, blur: 10, distance: 0 },
      },
      pool,
    );
    const combo = resolveVisibleCombo(display.judge, display.combo);
    if (combo > 0) {
      addHudNumber(
        layer,
        formatCount(combo),
        display.x,
        264,
        {
          scale: punchScale(runtime.judgeAtMs, nowMs, 150, (combo % 100 === 0 ? 0.45 : 0.14) * amount),
          ...displayStyle(22, combo >= 200 ? SYN_AMBER : SYN_WHITE),
          anchorX: 0.5,
          anchorY: 0.5,
          maxWidth: Math.max(60, display.maxWidth - 40),
          dropShadow: { color: combo >= 200 ? SYN_AMBER : SYN_EMBER, alpha: 0.85, blur: 10, distance: 0 },
        },
        pool,
      );
    }
  }
}

function resolveJudgeDisplays(
  runtime: Runtime,
  layout: BeMusicGameplayLayout,
): Array<{ judge: string; combo: number | undefined; x: number; maxWidth: number }> {
  const centerOf = (side: '1P' | '2P'): number | undefined => {
    const bounds = layout.playfield.sides[side];
    return bounds ? (bounds.left + bounds.right) / 2 : undefined;
  };
  const doublePlay = centerOf('2P') !== undefined;
  const maxWidth = doublePlay ? 122 : 180;
  const fallbackX = layout.playfield.centerX;
  const sides = runtime.judgeSides?.filter((state) => typeof state.judge === 'string' && state.judge.length > 0);
  if (sides?.length) {
    return sides.map((state) => ({
      judge: state.judge!,
      combo: state.combo,
      x: centerOf(state.side) ?? fallbackX,
      maxWidth,
    }));
  }
  if (!runtime.lastJudge) return [];
  return [{ judge: runtime.lastJudge, combo: runtime.combo, x: centerOf('1P') ?? fallbackX, maxWidth }];
}

function resolveVisibleCombo(judge: string, combo: number | undefined): number {
  if (judge !== 'PERFECT' && judge !== 'GREAT' && judge !== 'GOOD') return 0;
  return combo !== undefined && Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
}

function labelStyle(): HudTextOptions {
  return { size: 9, fill: SYN_DIM, fontFamily: SYN_DISPLAY_FONT, letterSpacing: 0.8 };
}

function displayStyle(size: number, fill: number): HudTextOptions {
  return { size, fill, fontFamily: SYN_DISPLAY_FONT, weight: '400' };
}

function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0';
  return String(Math.max(0, Math.floor(value)));
}

function formatBpm(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '---';
  return String(Math.round(value));
}

function formatHiSpeed(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0.0';
  return value.toFixed(1);
}

function formatRuleset(value: string | undefined): string {
  switch (value) {
    case 'beatoraja':
      return 'BEATORAJA';
    case 'iidx':
      return 'IIDX';
    default:
      return 'LR2';
  }
}

function formatExRate(exScore: number | undefined, max: number | undefined): string {
  if (exScore === undefined || max === undefined || !Number.isFinite(exScore) || !Number.isFinite(max) || max <= 0) {
    return '0.0%';
  }
  return `${((exScore / max) * 100).toFixed(1)}%`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
