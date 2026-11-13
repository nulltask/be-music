import { formatSelectBreadcrumb } from './layout.ts';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { bindGlassSurface, drawGlassSurface, frostedGlassEnabled } from './glass.ts';
import { createFlock, stepFlock } from './boids.ts';
import { ChargeCloud } from './charge-cloud.ts';
import { KICK_REST, stepKick, type KickState } from './kick.ts';
import { drawPointCloud, drawReticle, drawSchool, sharedShapeBatch } from './draw.ts';
import {
  floorRise,
  flyPast,
  cameraBasis,
  emberColor,
  hsvToHex,
  mixCamera,
  particleRiverPointInto,
  pointCloudPyramid,
  projectPoint,
  projectViewInto,
  REST_CAMERA,
  roamingCamera,
  scratchProjected,
  viewPoint,
  wanderPoint,
  type RiverOptions,
} from './space.ts';
import {
  SPECTRUM_RIDGE_HEIGHT,
  SpectrumHistory,
  floorRowStep,
  spectrumLevels,
  spectrumRise,
} from './spectrum-floor.ts';

import {
  SYN_AMBER,
  SYN_DIM,
  SYN_DISPLAY_FONT,
  SYN_FLARE,
  SYN_MIST,
  SYN_TEXT_FONT,
  SYN_VOID,
  SYN_WHITE,
  sceneHue,
  synGlowTexture,
} from './style.ts';
import {
  AUDIO_BAND_COUNT,
  easeOutCubic,
  audioDrive,
  type BeMusicAudioFrame,
  type BeMusicSelectLayout,
  type LibraryEntry,
  type LibraryChart,
  describeBestRecord,
  describeCourseCard,
  formatPlayVariantLabel,
  resolveChartStats,
  resolveDifficultyName,
  hash01,
  resolveChartRowFacts,
  stageProgress,
  selectListRows,
  browseEntryBadge,
  browseEntryCount,
  browseEntryTitle,
  type BeMusicChartBestRecord,
  type BestRecordSummary,
} from '@be-music/player-skin-sdk';
import {
  addHitArea,
  type PixiSelectFrame,
  type PixiSelectRenderer,
  type PixiSelectSkin,
  type SkinTextOptions,
  fadeChildrenFrom,
} from '../pixi-kit/index.ts';
import { addSynesthesiaText } from './figures.ts';
import { drawBarLamp, drawBestRecordPanel, LampLights } from './select-record.ts';
import {
  recordLaunchHandoff,
  resolveDecideLayout,
  resolveLaunchWarp,
  resolveWarpStarSpeed,
  SELECT_LAUNCH_OUTRO_MS,
} from './launch-warp.ts';
import {
  createWarpStarScratch,
  drawLaunchTitle,
  paintSpace,
  poseWarpStar,
  resolveStarTrail,
  STAR_COUNT,
  WARP_STAR_COUNT,
} from './warp-field.ts';

const LAYOUT: BeMusicSelectLayout = { listX: 322, listTop: 92, listBottomInset: 28, rowHeight: 28 };
/**
 * The portrait list: full width under the focused-song card and the search bar, with taller rows (two lines each, and
 * a thumb's height to tap).
 */
const PORTRAIT_LAYOUT: BeMusicSelectLayout = { listX: 16, listTop: 456, listBottomInset: 34, rowHeight: 36 };
/** The focused-song card on the portrait stage. */
const PORTRAIT_CARD = { x: 12, y: 52, w: 456, h: 348 } as const;
/** The tallest a banner is drawn on the landscape card, which holds the best record above it. */
const BANNER_MAX_H = 64;
/** Fixed widths of a song row's fact columns (right to left: tempo, length, note count), so they align down the list. */
const ROW_BPM_W = 76;
const ROW_LENGTH_W = 30;
const ROW_NOTES_W = 84;
/** The DJ Rank column of a song row, left of the note count. */
const ROW_RANK_W = 24;
/**
 * The widest a folder or course row's count may run (`12 charts`, `4 stages · 1 missing`): such a row has no fact
 * columns, so its count takes what it needs up to this and the title gets the rest.
 */
const ROW_COUNT_MAX_W = 150;
const SLIDE_MS = 320;
const INTRO_STAGGER_MS = 45;
const RIVER_PARTICLES = 340;
/** How far the select camera roams around the pyramid field. */
const CAMERA_RANGE = { x: 240, y: 110, yaw: 0.38, pitch: 0.16 } as const;
const CAMERA_CYCLE_S = 6;
const SCHOOL_SIZE = 80;
/** Screen gap (px) the floor rows' points aim for, so near rows read as waveforms. */
const FLOOR_SCREEN_GAP = 6;
/**
 * Three schools in the floor frame (floor at y 150), each with its own box, light, and seed, and each glowing with its
 * own range of the music: the ember school with the bass, the blue with the mids, the magenta with the highs.
 */
const SCHOOL_SPECS = [
  {
    seed: 29,
    palette: 'ember',
    band: 'bass',
    bounds: { minX: -700, maxX: 500, minY: -240, maxY: 90, minZ: 140, maxZ: 900 },
  },
  {
    seed: 57,
    palette: 'blue',
    band: 'mid',
    bounds: { minX: -300, maxX: 900, minY: -300, maxY: 40, minZ: 300, maxZ: 1300 },
  },
  {
    seed: 91,
    palette: 'magenta',
    band: 'high',
    bounds: { minX: -900, maxX: 900, minY: -280, maxY: 60, minZ: 800, maxZ: 1900 },
  },
] as const;
/** Depth the world shots pivot around — the pyramid field. */
const WORLD_ORBIT = 900;
const PYRAMIDS = [pointCloudPyramid(12, 900), pointCloudPyramid(4, 560), pointCloudPyramid(9, 520)];

export const synesthesiaSelectSkin: PixiSelectSkin = {
  outroMs: SELECT_LAUNCH_OUTRO_MS,
  searchTextSize: 10,
  portraitSearchTextSize: 11,
  layout: LAYOUT,
  portraitLayout: PORTRAIT_LAYOUT,
  createRenderer: () => new SynesthesiaSelectRenderer(),
};

function labelStyle(fill: number = SYN_DIM): SkinTextOptions {
  return { size: 9, fill, fontFamily: SYN_DISPLAY_FONT, letterSpacing: 2 };
}

/**
 * `JUDGE <rank>` (the chart's #RANK / #DEFEXRANK), starting at `left` and centred on `centerY`. Label and value share one
 * size, so their capitals line up top and bottom; colour and tracking tell them apart.
 */
function drawJudgeRank(
  addText: (text: string, x: number, y: number, options?: SkinTextOptions) => Container,
  chartEntry: LibraryChart | undefined,
  left: number,
  centerY: number,
): void {
  const label = addText('JUDGE', left, centerY, { ...labelStyle(), anchorY: 0.5 });
  addText(chartEntry ? resolveChartStats(chartEntry).judgeRank : '-', left + label.width + 8, centerY, {
    size: 9,
    fill: SYN_WHITE,
    fontFamily: SYN_DISPLAY_FONT,
    anchorY: 0.5,
    dropShadow: { color: SYN_WHITE, distance: 0, blur: 6, alpha: 0.4 },
  });
}

function drawDifficulty(
  graphics: Graphics,
  addText: (text: string, x: number, y: number, options?: SkinTextOptions) => Container,
  chart: LibraryChart | undefined,
  x: number,
  y: number,
): void {
  const label = addText('DIFFICULTY', x, y, { ...labelStyle(), anchorY: 0.5 });
  const badgeX = x + label.width + 10;
  graphics.rect(badgeX, y - 8, 108, 16).stroke({ color: SYN_AMBER, width: 1, alpha: 0.7 });
  addText(resolveDifficultyName(chart) ?? '-', badgeX + 54, y, {
    ...labelStyle(),
    fill: SYN_AMBER,
    anchorY: 0.5,
    maxWidth: 98,
    anchorX: 0.5,
  });
}

/**
 * A secondary button (AUTO, README): an outline with corner reticles and its label centred in the display face. A
 * disabled one (a chart with no README) is drawn faint.
 */
function drawSecondaryButton(
  chrome: Graphics,
  addText: (text: string, x: number, y: number, options?: SkinTextOptions) => Container,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  enabled: boolean,
  letterSpacing = 3,
): void {
  chrome.rect(x, y, w, h).stroke({ color: SYN_MIST, width: 1, alpha: enabled ? 0.45 : 0.15 });
  drawReticle(chrome, x, y, w, h, SYN_MIST, enabled ? 0.8 : 0.25, { arm: 5, width: 1 });
  addText(label, x + w / 2, y + h / 2, {
    size,
    fill: SYN_MIST,
    fontFamily: SYN_DISPLAY_FONT,
    letterSpacing,
    anchorX: 0.5,
    anchorY: 0.5,
    alpha: enabled ? 1 : 0.3,
  });
}

/** The README chip's size: a small outline on the info card's genre line. */
const README_CHIP_W = 56;
const README_CHIP_H = 18;

/**
 * README at (`x`, `y`): a small outlined chip that opens the chart's README, drawn faint and without a hit area on a
 * chart that has none.
 */
function drawReadmeChip(
  chrome: Graphics,
  addText: (text: string, x: number, y: number, options?: SkinTextOptions) => Container,
  frame: PixiSelectFrame,
  x: number,
  y: number,
): void {
  const enabled = frame.hasReadme === true;
  drawSecondaryButton(chrome, addText, 'README', x, y, README_CHIP_W, README_CHIP_H, 8, enabled, 2);
  if (enabled) addHitArea(x - 2, y - 4, README_CHIP_W + 4, README_CHIP_H + 8, 'pointer', frame.actions.toggleReadme);
}

function framePanel(graphics: Graphics, x: number, y: number, w: number, h: number, rim: number): void {
  drawGlassSurface(graphics, x, y, w, h, 0.94);
  graphics.rect(x, y, w, h).stroke({ color: rim, width: 1, alpha: 0.28 });
  drawReticle(graphics, x - 1, y - 1, w + 2, h + 2, SYN_WHITE, 0.85, { arm: 10, width: 1.25 });
}

/**
 * Synesthesia song select, set in a cosmic particle world. The persistent back layer is a particle world — data dust
 * pouring out of the vanishing point at the focused chart's tempo, point-cloud pyramids, a floor of light points, a
 * golden river of particles, and a roaming visualizer-style audio orb — redrawn cheaply in `tick`. The front layer snaps a lock-on reticle onto the focused card.
 */
class SynesthesiaSelectRenderer implements PixiSelectRenderer {
  private banner: { image: ImageBitmap; texture: Texture } | undefined;
  private drawBanner(frame: PixiSelectFrame, x: number, y: number, maxWidth: number, maxHeight: number): void {
    const image = frame.focusedChart ? frame.chartImage(frame.focusedChart, 'banner') : undefined;
    if (this.banner?.image !== image) {
      this.banner?.texture.destroy(true);
      this.banner = image ? { image, texture: Texture.from(image) } : undefined;
    }
    if (!this.banner) return;
    const scale = Math.min(maxWidth / image!.width, maxHeight / image!.height);
    const sprite = new Sprite(this.banner.texture);
    sprite.position.set(x, y);
    sprite.width = image!.width * scale;
    sprite.height = image!.height * scale;
    frame.layer.addChild(sprite);
  }
  public readonly backLayer = new Container();
  public readonly frontLayer = new Container();
  private readonly glass = new Graphics();
  private readonly ground = new Graphics();
  /** Additive particle world: floor, pyramids, river, and the orb's tails. */
  private readonly world = new Graphics();
  private readonly stars: Sprite[] = [];
  /** Holds {@link stars}; the one layer that stays lit through the launch warp. */
  private readonly starLayer = new Container();
  /** Scratch objects for the allocation-free projection in `tick`'s per-particle loops. */
  private readonly scratchBasis = cameraBasis(REST_CAMERA);
  private readonly scratchPoint = { x: 0, y: 0, z: 0 };
  private readonly scratchHead = scratchProjected();
  private readonly scratchTail = scratchProjected();
  private readonly starScratch = createWarpStarScratch();
  private readonly riverOptions: RiverOptions = { length: 1800, speed: 120, amplitude: 36, width: 20, seed: 2 };
  /** Each star's trail during the launch warp, drawn behind the stars. */
  private readonly trails = new Graphics();
  private readonly lock = new Graphics();
  private readonly cursorGlow = new Sprite();
  private cursorChangedAt = Number.NEGATIVE_INFINITY;
  /** The foreground orb: a charge cloud, and the clock of its last simulation step. */
  private readonly chargeCloud = new ChargeCloud();
  /** Whether this rebuild's panels are frosted (the skin's frosted glass setting). */
  private frosted = true;
  private lastOrbSeconds: number | undefined;
  /** The low end's kick envelope, which puffs up the fish. */
  private kick: KickState = KICK_REST;
  private readonly flocks = SCHOOL_SPECS.map((spec) => createFlock(spec.seed, SCHOOL_SIZE, spec.bounds));
  private built = false;
  private designWidth = 640;
  private designHeight = 480;
  /** Accumulated star / grid travel (speed-weighted seconds), so a speed change never makes the field jump. */
  private travel = 0;
  /** The recent spectrum the floor is shaped from (see spectrum-floor.ts). */
  private readonly spectrum = new SpectrumHistory();
  private readonly spectrumScratch = new Float32Array(AUDIO_BAND_COUNT);
  private lastTickMs: number | undefined;
  private effects: PixiSelectFrame['effects'] = 'full';
  private activeCard: { x: number; y: number; w: number; h: number } | undefined;
  /** This rebuild's clear lamps, blinking and cycling in `tick`. */
  private readonly lampLights = new LampLights();

  public constructor() {
    this.backLayer.label = 'synesthesia-select/space';
    this.frontLayer.label = 'synesthesia-select/front';
  }

  public render(input: PixiSelectFrame): boolean {
    this.effects = input.effects;
    this.frosted = frostedGlassEnabled(input.settings);
    const frame =
      input.effects === 'off'
        ? { ...input, sceneStartedAt: Number.NEGATIVE_INFINITY, cursorChangedAt: Number.NEGATIVE_INFINITY }
        : input;
    this.ensureBuilt(frame.designWidth, frame.designHeight);
    this.activeCard = undefined;
    this.lampLights.reset();
    this.glass.clear();
    const portrait = frame.designHeight > frame.designWidth;
    let needsFrame = portrait ? this.renderPortraitChrome(frame) : this.renderChrome(frame);
    const layout = portrait ? PORTRAIT_LAYOUT : LAYOUT;
    const listWidth = frame.designWidth - layout.listX - (portrait ? 12 : 14);
    // Rows follow the list's pull (`frame.listScroll`): fractional slots, faded where they slide past the window's edge.
    for (const { entryIndex, slot, alpha } of selectListRows(frame, layout.rowHeight)) {
      const entry = frame.entries[entryIndex]!;
      const from = frame.layer.children.length;
      needsFrame =
        (portrait
          ? this.renderPortraitRow(frame, entry, entryIndex, slot, listWidth)
          : this.renderRow(frame, entry, entryIndex, slot, listWidth)) || needsFrame;
      fadeChildrenFrom(frame.layer, from, alpha);
    }
    const visible = this.activeCard !== undefined;
    this.cursorGlow.visible = visible;
    this.lock.visible = visible;
    this.cursorChangedAt = frame.cursorChangedAt;
    if (frame.launchAt !== undefined) {
      this.renderOutro(frame);
      this.lampLights.settle();
      return true;
    }
    this.lampLights.settle();
    return needsFrame;
  }

  /**
   * Launch outro — the start of the warp: the panels and list fade away while the camera settles onto a straight dash
   * through the particle field (in `tick`), and the chosen title starts to condense at the centre out of wide-tracked
   * light, a lock-on reticle closing around it. The decide screen carries the warp on from here (see launch-warp.ts).
   */
  private renderOutro(frame: PixiSelectFrame): void {
    const pose = resolveLaunchWarp(frame.nowMs - (frame.launchAt ?? frame.nowMs), frame.effects);
    const { designWidth, designHeight, layer } = frame;
    // Fade the list and panels out of the way, leaving black space and the particles rushing past.
    const away = pose.away;
    for (const child of layer.children) {
      child.alpha *= away;
      if (child.label === 'synesthesia-select/header') child.y -= 38 * (1 - away);
      if (child.label === 'synesthesia-select/footer') child.y += 32 * (1 - away);
    }
    drawLaunchTitle(layer, frame.focusedChart, resolveDecideLayout(designWidth, designHeight), designWidth, pose, 1);
  }

  public tick(
    nowMs: number,
    focusedChart: LibraryChart | undefined,
    launchAt?: number,
    audio?: BeMusicAudioFrame,
  ): void {
    this.lampLights.tick(nowMs, this.effects === 'off');
    // Ambient motion: frozen with effects off, half speed when reduced.
    const rate = this.effects === 'off' ? 0 : this.effects === 'reduced' ? 0.5 : 1;
    // The BGM / chart preview drives the space: dust speeds with loudness, the floor swells on the bass,
    // the schools pulse, and the orb's orbits breathe with the spectrum.
    const drive = audioDrive(audio, this.effects);
    const seconds = (nowMs / 1000) * rate;
    const dt = this.lastTickMs === undefined ? 0 : Math.min(0.1, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;
    // Kicks puff up the fish.
    this.kick = stepKick(this.kick, drive.bands, drive.onset, dt);
    const launch = launchAt !== undefined ? resolveLaunchWarp(nowMs - launchAt, this.effects) : undefined;
    const warp = launch?.warp ?? 0;
    const bpm = focusedChart?.bpm;
    const beatsPerSecond = (bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? Math.min(bpm, 300) : 120) / 60;
    const beatPhase = (seconds * beatsPerSecond) % 1;
    const pulse = (1 - beatPhase) ** 3;
    const hue = sceneHue(seconds, beatPhase);
    const accent = hsvToHex(hue, 0.6, 1);

    // Camera: the backdrop roams between random shots (flying, sometimes hard-cutting) with a handheld drift.
    // Reduced effects halve the moves; off keeps it at rest.
    // On launch the camera settles and flies dead straight, so the warp reads as a dash through the particles.
    const settle = launch?.settle ?? 0;
    const camera = mixCamera(
      REST_CAMERA,
      roamingCamera(seconds, 13, CAMERA_RANGE, CAMERA_CYCLE_S),
      (this.effects === 'off' ? 0 : this.effects === 'reduced' ? 0.5 : 1) * (1 - settle),
    );
    // Data dust pouring out of the vanishing point — speed follows the focused chart's tempo. Launching steers the
    // vanishing point to the centre of the screen, where the chosen title appears, and opens the throttle — kept to a
    // speed the eye can follow, with each particle trailing its own path so the dash reads as forward motion.
    const cx = this.designWidth * (0.58 - 0.08 * settle);
    const cy = this.designHeight * (0.44 + 0.06 * settle);
    const speed = resolveWarpStarSpeed(bpm, warp, this.effects, drive.level);
    const trail = resolveStarTrail(speed, warp, settle);
    const trails = this.trails;
    trails.clear();
    this.travel += dt * speed * (warp > 0 ? 1 : rate);
    const basis = cameraBasis(camera, this.scratchBasis);
    const shownStars = Math.round(STAR_COUNT + (WARP_STAR_COUNT - STAR_COUNT) * settle);
    for (let index = 0; index < this.stars.length; index += 1) {
      const star = this.stars[index]!;
      if (index >= shownStars) {
        star.visible = false;
        continue;
      }
      poseWarpStar(star, trails, index, this.travel, basis, cx, cy, warp, trail, this.starScratch);
    }
    sharedShapeBatch.flush();
    // The decide screen carries the warp on from this frame.
    if (launchAt !== undefined && focusedChart !== undefined) {
      recordLaunchHandoff({
        chartId: focusedChart.id,
        launchAtMs: launchAt,
        lastFrameMs: nowMs,
        travel: this.travel,
        level: drive.level,
      });
    }

    // The cursor's lock-on lets go as the warp starts, and everything but the rushing particles falls away, so the
    // decide screen takes over a sky of stars alone.
    this.frontLayer.alpha = 1 - settle;
    const behind = 1 - settle;
    for (const node of this.backLayer.children) {
      if (node !== this.starLayer && node !== this.trails && node !== this.ground) node.alpha = behind;
    }
    const world = this.world;
    world.clear();
    const floorY = this.designHeight * 0.7;
    // Point-cloud pyramids, far to near.
    const view = { cx, cy: floorY, focal: 200, camera, orbit: WORLD_ORBIT };
    for (const [pyramid, x, z, scale, yaw] of [
      [PYRAMIDS[0]!, -120, 1700, 700, 0.3],
      [PYRAMIDS[1]!, -760, 1100, 420, 0.7],
      [PYRAMIDS[2]!, 620, 1250, 440, -0.4],
    ] as const) {
      drawPointCloud(world, pyramid, { scale, x, y: 150, z, yaw: yaw + seconds * 0.03 }, view, {
        colorOf: (point) => emberColor(0.3 + 0.6 * point.weight),
        alpha: 0.7 * (1 - warp),
        size: 0.9,
        seconds,
        shimmer: 0.3,
        referenceScale: 200 / (200 + z),
      });
    }
    // Floor of light points scrolling toward the viewer, written with the music's spectrum: bass on the left to highs on
    // the right, rising as ridges that leave the viewer and roll out into the distance, over low Perlin-noise ground.
    this.spectrum.push(spectrumLevels(drive.bands, this.spectrumScratch), dt);
    const spacing = 100;
    const offset = this.travel % spacing;
    // Floor points and the river go out as a few batched instructions.
    const batch = sharedShapeBatch;
    for (let z = spacing - offset; z < 2600; z += spacing) {
      const nearness = 1 - z / 2600;
      const size = 0.6 + 1.5 * nearness * nearness;
      const color = emberColor(0.3 + 0.65 * nearness);
      const alpha = Math.min(1, (0.12 + 0.7 * nearness * nearness) * (0.7 + 0.3 * pulse) * (1 + drive.bass));
      // Near rows get more points, so they read as continuous waveforms.
      const step = floorRowStep(z, 200, FLOOR_SCREEN_GAP);
      for (let x = -1800; x <= 1800; x += step) {
        // The band follows where the point sits on screen: bass at the left edge, highs at the right.
        const ground = projectViewInto(this.scratchHead, x, 150, z, basis, cx, floorY, 200, WORLD_ORBIT);
        if (!ground.visible || ground.x < -4 || ground.x > this.designWidth + 4) continue;
        const ridge = spectrumRise(this.spectrum, ground.x / this.designWidth, z);
        const rise = ridge + floorRise(x, z + this.travel, seconds, 10);
        const point = projectViewInto(this.scratchHead, x, 150 - rise, z, basis, cx, floorY, 200, WORLD_ORBIT);
        if (!point.visible || point.x < -4 || point.x > this.designWidth + 4 || point.y > this.designHeight + 4) {
          continue;
        }
        // Crests catch more light than the valleys.
        const lit = Math.min(1, alpha * (1 + (1.4 * ridge) / SPECTRUM_RIDGE_HEIGHT));
        batch.rect(world, color, lit, point.x - size / 2, point.y - size / 2, size, size);
      }
    }
    // A golden river of particles sweeping across the floor.
    const riverOptions = this.riverOptions;
    riverOptions.speed = 120 + beatsPerSecond * 60;
    riverOptions.amplitude = 36 * (1 + 1.3 * drive.mid);
    const local = this.scratchPoint;
    for (let index = 0; index < RIVER_PARTICLES; index += 1) {
      particleRiverPointInto(local, index, this.travel / 90, riverOptions);
      const y = 110 + local.y;
      const z = 620 + local.z;
      const head = projectViewInto(
        this.scratchHead,
        local.x,
        y,
        z + local.x * 0.5,
        basis,
        cx,
        floorY,
        200,
        WORLD_ORBIT,
      );
      const tailX = local.x - 30;
      const tail = projectViewInto(this.scratchTail, tailX, y, z + tailX * 0.5, basis, cx, floorY, 200, WORLD_ORBIT);
      if (!head.visible || !tail.visible) continue;
      const heat = hash01(index * 3 + 7);
      batch.line(
        world,
        heat > 0.85 ? SYN_WHITE : emberColor(0.5 + 0.5 * heat),
        (0.25 + 0.55 * heat) * (1 - warp),
        0.4 + 1 * Math.min(1, head.scale) * (0.5 + heat),
        tail.x,
        tail.y,
        head.x,
        head.y,
      );
    }
    batch.flush();
    // Schools of light fish sweeping through the pyramids: tight on the beat, scattering when the cursor moves.
    if (rate > 0) {
      const scatter = Math.max(Math.max(0, 1 - (nowMs - this.cursorChangedAt) / 600) ** 2, 0.8 * drive.onset) + warp;
      const shown = this.effects === 'reduced' ? 1 : this.flocks.length;
      for (let school = 0; school < shown; school += 1) {
        stepFlock(this.flocks[school]!, dt * rate, {
          seconds: seconds + school * 41.7,
          gather: Math.max(pulse * 0.6, drive.bass),
          scatter,
        });
        drawSchool(
          world,
          this.flocks[school]!,
          (out, point) => projectViewInto(out, point.x, point.y, point.z, basis, cx, floorY, 200, WORLD_ORBIT),
          {
            alpha: 0.95 * (1 - warp),
            palette: SCHOOL_SPECS[school]!.palette,
            swell: this.kick.swell,
            glowLevel: drive[SCHOOL_SPECS[school]!.band],
            seconds,
          },
        );
      }
    }
    // The audio orb roams the space right up by the camera; on launch the camera flies past it, so it streams out of
    // the vanishing point with the stars, swelling until it leaves the screen.
    const big = wanderPoint(seconds * 0.6, 5, { minX: -210, maxX: 230, minY: -140, maxY: -20, minZ: -70, maxZ: 150 });
    // The foreground orb is a charge cloud: dark magnet orbs in a fluid of particles, stepped on the GPU.
    const bigAt = projectPoint(viewPoint(big, camera, WORLD_ORBIT), cx, floorY, 200);
    const passing = flyPast(bigAt.x, bigAt.y, 135 * bigAt.scale * (1 + 0.03 * pulse), cx, cy, warp);
    this.chargeCloud.update({
      x: passing.x,
      y: passing.y,
      scale: bigAt.visible ? passing.scale : 0,
      seconds,
      dt: this.lastOrbSeconds === undefined ? 0 : seconds - this.lastOrbSeconds,
      drive,
      alpha: bigAt.visible ? passing.alpha : 0,
    });
    this.lastOrbSeconds = seconds;

    // Lock-on reticle snapping onto the focused card, plus a breathing glow under it.
    const card = this.activeCard;
    this.lock.clear();
    if (card) {
      const snap = easeOutCubic(stageProgress(nowMs - this.cursorChangedAt, 0, 220));
      const grow = 18 * (1 - snap);
      drawReticle(
        this.lock,
        card.x - 5 - grow,
        card.y - 4 - grow * 0.5,
        card.w + 10 + grow * 2,
        card.h + 8 + grow,
        SYN_FLARE,
        0.5 + 0.5 * snap,
        { arm: 9, width: 1.75 },
      );
      this.cursorGlow.position.set(card.x + card.w / 2, card.y + card.h / 2);
      this.cursorGlow.width = card.w * 1.15;
      this.cursorGlow.height = card.h * 3.2;
      this.cursorGlow.tint = accent;
      this.cursorGlow.alpha = 0.16 + 0.18 * pulse;
    }
  }

  public dispose(): void {
    this.banner?.texture.destroy(true);
    this.banner = undefined;
    this.chargeCloud.destroy();
    this.backLayer.destroy({ children: true });
    this.frontLayer.destroy({ children: true });
  }

  private ensureBuilt(designWidth: number, designHeight: number): void {
    // The stage can change between draws (a rotation): the ground is repainted for the new size.
    if (designWidth !== this.designWidth || designHeight !== this.designHeight || !this.built) {
      this.designWidth = designWidth;
      this.designHeight = designHeight;
      paintSpace(this.ground, designWidth, designHeight);
    }
    if (this.built) return;
    this.built = true;
    const glow = synGlowTexture();
    const starLayer = this.starLayer;
    starLayer.blendMode = 'add';
    for (let index = 0; index < WARP_STAR_COUNT; index += 1) {
      const star = new Sprite(glow);
      star.anchor.set(0.5);
      star.blendMode = 'add';
      starLayer.addChild(star);
      this.stars.push(star);
    }
    this.world.blendMode = 'add';
    this.trails.blendMode = 'add';
    this.backLayer.addChild(this.ground, this.world, this.trails, starLayer, this.chargeCloud.view, this.glass);

    this.cursorGlow.texture = glow;
    this.cursorGlow.anchor.set(0.5);
    this.cursorGlow.blendMode = 'add';
    this.frontLayer.addChild(this.cursorGlow, this.lock);
  }

  private renderChrome(frame: PixiSelectFrame): boolean {
    const { layer, designWidth, designHeight, entries, focusedChart: chartEntry } = frame;
    const chrome = new Graphics();
    if (this.frosted) bindGlassSurface(chrome, this.glass);
    chrome.label = 'synesthesia-select/chrome';
    const hue = sceneHue(frame.nowMs / 1000);
    const accent = hsvToHex(hue, 0.6, 1);
    const addText = (text: string, x: number, y: number, options: SkinTextOptions = {}) => {
      const node = addSynesthesiaText(layer, text, x, y, options);
      if (y < 38) node.label = 'synesthesia-select/header';
      else if (y >= designHeight - 36) node.label = 'synesthesia-select/footer';
      return node;
    };

    // A focused course takes the song's place: its name, then its kind and stage count.
    const course =
      chartEntry === undefined && frame.focusedCourse !== undefined
        ? describeCourseCard(frame.focusedCourse, frame.courseBestRecord?.(frame.focusedCourse))
        : undefined;
    const chartTitle = chartEntry?.title ?? course?.title ?? 'No chart selected';
    const chartArtist = chartEntry?.artist || chartEntry?.subtitle || course?.detail || '';
    const playLevel = chartEntry?.playLevel !== undefined ? String(chartEntry.playLevel) : '-';
    const chartBPM = chartEntry?.bpm !== undefined ? String(Math.round(chartEntry.bpm)) : '-';
    const modeLabel = chartEntry ? formatPlayVariantLabel(chartEntry) : '- KEYS';
    const categoryName = formatSelectBreadcrumb(frame.folderPath, frame.folderLabel, frame.searchQuery);
    const position =
      entries.length > 0 ? `${Math.min(frame.selectedIndex + 1, entries.length)} / ${entries.length}` : '0 / 0';

    // Header: title as light, a hairline, and the folder on the right.
    const header = new Graphics();
    header.label = 'synesthesia-select/header';
    layer.addChild(header);
    header.rect(0, 0, designWidth, 38).fill({ color: SYN_VOID, alpha: 0.5 });
    header.rect(0, 38, designWidth, 1).fill({ color: accent, alpha: 0.5 });
    const intro = easeOutCubic(stageProgress(frame.nowMs - frame.sceneStartedAt, 0, 900));
    addText('MUSIC SELECT', 18, 13, {
      size: 12,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 4 + 8 * (1 - intro) + 2,
      alpha: intro,
      dropShadow: { color: accent, distance: 0, blur: 8, alpha: 0.9 },
    });
    addText(categoryName, designWidth - 18, 14, {
      size: 10,
      weight: '500',
      fill: SYN_MIST,
      fontFamily: SYN_TEXT_FONT,
      anchorX: 1,
      maxWidth: designWidth - 300,
    });

    // Info panel.
    const banner = chartEntry ? frame.chartImage(chartEntry, 'banner') : undefined;
    const bannerHeight = banner ? Math.min(BANNER_MAX_H, (258 * banner.height) / banner.width) : 0;
    // Match the 14 px gap above the banner, including short or unusually tall source images.
    framePanel(chrome, 14, 56, 290, banner ? 322 + bannerHeight : 316, accent);
    // The genre heads the card, in the accent light, where a fixed caption used to sit.
    const genre = chartEntry?.genre?.trim() || (chartEntry ? '----' : undefined);
    const slide = 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS));
    addText(chartTitle, 30 + slide * 24, 86, {
      size: 18,
      weight: '500',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      maxWidth: 258,
      alpha: 1 - slide,
      dropShadow: { color: accent, distance: 0, blur: 10, alpha: 0.8 },
    });
    if (genre) {
      addText(genre.toUpperCase(), 30 + slide * 16, 70, {
        size: 9,
        weight: '500',
        fill: accent,
        fontFamily: SYN_TEXT_FONT,
        letterSpacing: 2,
        // Clear of the README chip at the row's end.
        maxWidth: chartEntry ? 258 - README_CHIP_W - 8 : 258,
        alpha: 1 - slide,
      });
    }
    // README at the card's top right, on the genre line; the title starts under it.
    if (chartEntry) drawReadmeChip(chrome, addText, frame, 288 - README_CHIP_W, 66);
    if (chartArtist) {
      addText(chartArtist, 30 + slide * 40, 114, {
        size: 10,
        weight: '300',
        fill: SYN_MIST,
        fontFamily: SYN_TEXT_FONT,
        maxWidth: 258,
        alpha: 1 - slide,
      });
    }
    chrome.rect(30, 136, 258, 1).fill({ color: accent, alpha: 0.35 });

    const stats: ReadonlyArray<readonly [x: number, w: number, label: string, value: string, fill: number]> = [
      [30, 80, 'MODE', modeLabel, SYN_WHITE],
      [118, 76, 'BPM', chartBPM, SYN_WHITE],
      [202, 86, 'LEVEL', playLevel, SYN_AMBER],
    ];
    for (const [x, w, label, value, fill] of stats) {
      chrome.rect(x, 146, w, 44).fill({ color: SYN_VOID, alpha: 0.5 });
      chrome.rect(x, 146, w, 44).stroke({ color: accent, width: 1, alpha: 0.25 });
      drawReticle(chrome, x, 146, w, 44, SYN_MIST, 0.6, { arm: 5, width: 1 });
      addText(label, x + 10, 154, labelStyle());
      addText(value, x + 10, 168, {
        size: 14,
        fill,
        fontFamily: SYN_DISPLAY_FONT,
        maxWidth: w - 18,
        dropShadow: { color: fill, distance: 0, blur: 6, alpha: 0.6 },
      });
    }

    // The judge rank (#RANK / #DEFEXRANK) under the stat chips.
    drawDifficulty(chrome, addText, chartEntry, 30, 206);
    drawJudgeRank(addText, chartEntry, 30, 226);

    // The file name and the list position share the row under the judge rank.
    if (chartEntry?.fileLabel) {
      addText(chartEntry.fileLabel, 30, 246, {
        size: 9,
        weight: '300',
        fill: SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        anchorY: 0.5,
        // Clear of the list position at the row's end.
        maxWidth: 200,
      });
    }
    addText(position, 288, 246, { size: 9, fill: SYN_MIST, fontFamily: SYN_DISPLAY_FONT, anchorX: 1, anchorY: 0.5 });

    // The player's best on the focused chart or course: lamp, score, DJ Rank. Nothing on a folder.
    if (chartEntry !== undefined || frame.focusedCourse !== undefined) {
      drawBestRecordPanel(chrome, layer, addText, this.lampLights, focusedBestRecord(frame), {
        x: 30,
        y: 258,
        w: 258,
        accent,
        nowMs: frame.nowMs,
        still: frame.effects === 'off',
      });
    }

    // PLAY (primary glowing pill) / AUTO PLAY (secondary outline).
    chrome.rect(26, 310, 170, 40).fill({ color: accent, alpha: 0.16 });
    chrome.rect(30, 314, 162, 32).fill({ color: accent, alpha: 0.88 });
    drawReticle(chrome, 26, 310, 170, 40, SYN_WHITE, 0.95, { arm: 8, width: 1.5 });
    addText('PLAY', 111, 330, {
      size: 14,
      fill: SYN_VOID,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 6,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    // AUTO's right edge sits on the content column's (288), like the LEVEL chip above it.
    drawSecondaryButton(chrome, addText, 'AUTO', 202, 317, 86, 26, 9, true);
    addHitArea(26, 310, 172, 40, 'pointer', frame.actions.play);
    addHitArea(200, 314, 90, 32, 'pointer', frame.actions.autoPlay);
    this.drawBanner(frame, 30, 364, 258, BANNER_MAX_H);

    // Search and library.
    framePanel(chrome, 322, 54, designWidth - 336, 30, accent);
    addText('SEARCH', 334, 69, { ...labelStyle(accent), anchorY: 0.5 });
    // While the player types in the host's field laid over the box, the field shows the text.
    if (!frame.searchEditing) {
      addText(frame.searchQuery || 'Title / artist / genre', 418, 69, {
        size: 10,
        anchorY: 0.5,
        weight: '300',
        fill: frame.searchQuery ? SYN_WHITE : SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        maxWidth: designWidth - 436,
      });
    }
    // The label and the text strip both start typing; the strip comes last, so the host lays its field over the text.
    addHitArea(322, 54, 92, 30, 'text', frame.actions.activateSearch);
    addHitArea(414, 54, designWidth - 428, 30, 'text', frame.actions.activateSearch);
    const footY = designHeight - 17;
    addText('LIBRARY', 30, footY, { ...labelStyle(), anchorY: 0.5 });
    // The count in the display face, like the LIBRARY label above it and the list position.
    addText(`${entries.length} shown / ${frame.totalCharts} charts`, 110, footY, {
      size: 11,
      fill: SYN_MIST,
      fontFamily: SYN_DISPLAY_FONT,
      anchorY: 0.5,
      maxWidth: designWidth - 270,
    });
    addText(frame.searchQuery ? 'SEARCH RESULTS' : frame.folderLabel ? 'CHARTS' : 'FOLDERS', designWidth - 14, footY, {
      ...labelStyle(),
      anchorX: 1,
      anchorY: 0.5,
    });

    layer.addChildAt(chrome, 0);
    return slide > 0 || intro < 1;
  }

  /**
   * Portrait select: the header, the focused song as a card across the top (genre, title, artist, the mode / tempo /
   * level chips, PLAY and AUTO), the search bar, and the library line at the foot; the list runs
   * full width between them. Nothing is set smaller than 10 design px.
   */
  private renderPortraitChrome(frame: PixiSelectFrame): boolean {
    const { layer, designWidth, designHeight, entries, focusedChart: chartEntry } = frame;
    const chrome = new Graphics();
    if (this.frosted) bindGlassSurface(chrome, this.glass);
    chrome.label = 'synesthesia-select/chrome';
    const accent = hsvToHex(sceneHue(frame.nowMs / 1000), 0.6, 1);
    const addText = (text: string, x: number, y: number, options: SkinTextOptions = {}) => {
      const node = addSynesthesiaText(layer, text, x, y, options);
      if (y < 38) node.label = 'synesthesia-select/header';
      else if (y >= designHeight - 36) node.label = 'synesthesia-select/footer';
      return node;
    };
    const label = (fill: number = SYN_DIM): SkinTextOptions => ({ ...labelStyle(fill), size: 10 });

    const course =
      chartEntry === undefined && frame.focusedCourse !== undefined
        ? describeCourseCard(frame.focusedCourse, frame.courseBestRecord?.(frame.focusedCourse))
        : undefined;
    const chartArtist = chartEntry?.artist || chartEntry?.subtitle || course?.detail || '';
    const playLevel = chartEntry?.playLevel !== undefined ? String(chartEntry.playLevel) : '-';
    const categoryName = formatSelectBreadcrumb(frame.folderPath, frame.folderLabel, frame.searchQuery);
    const position =
      entries.length > 0 ? `${Math.min(frame.selectedIndex + 1, entries.length)} / ${entries.length}` : '0 / 0';

    // Header: title as light, a hairline, and the folder on the right.
    const header = new Graphics();
    header.label = 'synesthesia-select/header';
    layer.addChild(header);
    header.rect(0, 0, designWidth, 40).fill({ color: SYN_VOID, alpha: 0.5 });
    header.rect(0, 40, designWidth, 1).fill({ color: accent, alpha: 0.5 });
    const intro = easeOutCubic(stageProgress(frame.nowMs - frame.sceneStartedAt, 0, 900));
    addText('MUSIC SELECT', 16, 14, {
      size: 12,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 4 + 8 * (1 - intro) + 2,
      alpha: intro,
      dropShadow: { color: accent, distance: 0, blur: 8, alpha: 0.9 },
    });
    addText(categoryName, designWidth - 16, 15, {
      size: 11,
      weight: '500',
      fill: SYN_MIST,
      fontFamily: SYN_TEXT_FONT,
      anchorX: 1,
      maxWidth: 200,
    });

    // The focused-song card.
    const card = PORTRAIT_CARD;
    framePanel(chrome, card.x, card.y, card.w, card.h, accent);
    const left = card.x + 16;
    const innerW = card.w - 32;
    const slide = 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS));
    const genre = chartEntry?.genre?.trim() || (chartEntry ? '----' : undefined);
    if (genre) {
      addText(genre.toUpperCase(), left + slide * 16, card.y + 14, {
        size: 10,
        weight: '500',
        fill: accent,
        fontFamily: SYN_TEXT_FONT,
        letterSpacing: 2,
        // Clear of the README chip at the row's end.
        maxWidth: chartEntry ? innerW - README_CHIP_W - 8 : innerW,
        alpha: 1 - slide,
      });
    }
    // README at the card's top right, on the genre line; the title starts under it.
    if (chartEntry) drawReadmeChip(chrome, addText, frame, left + innerW - README_CHIP_W, card.y + 10);
    addText(chartEntry?.title ?? course?.title ?? 'No chart selected', left + slide * 24, card.y + 30, {
      size: 18,
      weight: '500',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      maxWidth: innerW,
      alpha: 1 - slide,
      dropShadow: { color: accent, distance: 0, blur: 10, alpha: 0.8 },
    });
    if (chartArtist) {
      addText(chartArtist, left + slide * 40, card.y + 56, {
        size: 11,
        weight: '300',
        fill: SYN_MIST,
        fontFamily: SYN_TEXT_FONT,
        maxWidth: innerW,
        alpha: 1 - slide,
      });
    }
    chrome.rect(left, card.y + 78, innerW, 1).fill({ color: accent, alpha: 0.35 });

    const chipGap = 8;
    const chipW = (innerW - 2 * chipGap) / 3;
    const stats: ReadonlyArray<readonly [label: string, value: string, fill: number]> = [
      ['MODE', chartEntry ? formatPlayVariantLabel(chartEntry) : '- KEYS', SYN_WHITE],
      ['BPM', chartEntry?.bpm !== undefined ? String(Math.round(chartEntry.bpm)) : '-', SYN_WHITE],
      ['LEVEL', playLevel, SYN_AMBER],
    ];
    stats.forEach(([name, value, fill], index) => {
      const x = left + index * (chipW + chipGap);
      const y = card.y + 90;
      chrome.rect(x, y, chipW, 46).fill({ color: SYN_VOID, alpha: 0.5 });
      chrome.rect(x, y, chipW, 46).stroke({ color: accent, width: 1, alpha: 0.25 });
      drawReticle(chrome, x, y, chipW, 46, SYN_MIST, 0.6, { arm: 5, width: 1 });
      addText(name, x + 10, y + 8, label());
      addText(value, x + 10, y + 23, {
        size: 14,
        fill,
        fontFamily: SYN_DISPLAY_FONT,
        maxWidth: chipW - 18,
        dropShadow: { color: fill, distance: 0, blur: 6, alpha: 0.6 },
      });
    });

    // The judge rank (#RANK / #DEFEXRANK) under the stat chips.
    drawDifficulty(chrome, addText, chartEntry, left, card.y + 154);
    drawJudgeRank(addText, chartEntry, left + 238, card.y + 154);

    // The file name and the list position share the row under the judge rank.
    const fileRowY = card.y + 180;
    addText(position, left + innerW, fileRowY, { ...label(SYN_MIST), anchorX: 1, anchorY: 0.5 });
    if (chartEntry?.fileLabel) {
      addText(chartEntry.fileLabel, left, fileRowY, {
        size: 10,
        weight: '300',
        fill: SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        anchorY: 0.5,
        // Clear of the list position at the row's end.
        maxWidth: innerW - 64,
      });
    }

    // The player's best on the focused chart or course: lamp, score, DJ Rank. Nothing on a folder.
    if (chartEntry !== undefined || frame.focusedCourse !== undefined) {
      drawBestRecordPanel(chrome, frame.layer, addText, this.lampLights, focusedBestRecord(frame), {
        x: left,
        y: card.y + 194,
        w: innerW,
        accent,
        nowMs: frame.nowMs,
        still: frame.effects === 'off',
        size: 10,
      });
    }

    // PLAY (primary glowing pill) / AUTO PLAY (secondary outline), thumb-sized.
    const buttonY = card.y + 246;
    const playW = Math.round(innerW * 0.62);
    chrome.rect(left - 4, buttonY - 4, playW + 8, 44).fill({ color: accent, alpha: 0.16 });
    chrome.rect(left, buttonY, playW, 36).fill({ color: accent, alpha: 0.88 });
    drawReticle(chrome, left - 4, buttonY - 4, playW + 8, 44, SYN_WHITE, 0.95, { arm: 8, width: 1.5 });
    addText('PLAY', left + playW / 2, buttonY + 18, {
      size: 14,
      fill: SYN_VOID,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 6,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    const autoX = left + playW + 16;
    const autoW = left + innerW - autoX;
    drawSecondaryButton(chrome, addText, 'AUTO', autoX, buttonY + 2, autoW, 32, 10, true);
    addHitArea(left - 4, buttonY - 4, playW + 8, 44, 'pointer', frame.actions.play);
    addHitArea(autoX - 2, buttonY - 2, autoW + 4, 40, 'pointer', frame.actions.autoPlay);

    const banner = chartEntry ? frame.chartImage(chartEntry, 'banner') : undefined;
    const bannerHeight = banner ? Math.min(48, (innerW * banner.height) / banner.width) : 0;
    this.drawBanner(frame, left, card.y + 286 + (card.h - 286 - bannerHeight) / 2, innerW, 48);

    // Search.
    const searchY = card.y + card.h + 10;
    framePanel(chrome, card.x, searchY, card.w, 32, accent);
    addText('SEARCH', left, searchY + 16, { ...label(accent), anchorY: 0.5 });
    // While the player types in the host's field laid over the box, the field shows the text.
    if (!frame.searchEditing) {
      addText(frame.searchQuery || 'Title / artist / genre', left + 84, searchY + 16, {
        size: 11,
        anchorY: 0.5,
        weight: '300',
        fill: frame.searchQuery ? SYN_WHITE : SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        maxWidth: innerW - 84,
      });
    }
    // The label and the text strip both start typing; the strip comes last, so the host lays its field over the text.
    addHitArea(card.x, searchY, left + 80 - card.x, 32, 'text', frame.actions.activateSearch);
    addHitArea(left + 80, searchY, card.x + card.w - (left + 80), 32, 'text', frame.actions.activateSearch);

    // Library line at the foot.
    const footY = designHeight - 17;
    const footer = new Graphics();
    footer.label = 'synesthesia-select/footer';
    layer.addChild(footer);
    footer.rect(0, designHeight - 32, designWidth, 1).fill({ color: accent, alpha: 0.3 });
    addText(`${entries.length} shown / ${frame.totalCharts} charts`, 16, footY, {
      size: 11,
      fill: SYN_MIST,
      fontFamily: SYN_DISPLAY_FONT,
      anchorY: 0.5,
    });
    addText(frame.searchQuery ? 'SEARCH RESULTS' : frame.folderLabel ? 'CHARTS' : 'FOLDERS', designWidth - 16, footY, {
      ...label(),
      anchorX: 1,
      anchorY: 0.5,
    });

    layer.addChildAt(chrome, 0);
    return slide > 0 || intro < 1;
  }

  /**
   * One portrait list row: the level orb, the title over the artist, and the tempo over the note count on the right —
   * two lines in a row a thumb tall.
   */
  private renderPortraitRow(
    frame: PixiSelectFrame,
    entry: LibraryEntry,
    entryIndex: number,
    visibleIndex: number,
    listWidth: number,
  ): boolean {
    const { listX, listTop, rowHeight } = PORTRAIT_LAYOUT;
    const y = listTop + visibleIndex * rowHeight;
    const rowH = rowHeight - 4;
    const active = entryIndex === frame.selectedIndex;
    const chartEntry = entry.kind === 'chart' ? entry.chart : undefined;
    const accent = hsvToHex(sceneHue(frame.nowMs / 1000), 0.6, 1);
    const slide = active ? 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS)) : 0;
    const intro =
      1 -
      easeOutCubic(
        stageProgress(frame.nowMs - frame.sceneStartedAt, 120 + Math.max(0, visibleIndex) * INTRO_STAGGER_MS, 420),
      );
    // The focused row steps out a little to the left; the list is full width, so it does not grow.
    const rowX = (active ? listX - 4 : listX) + slide * 18 + intro * 80;
    const rowW = listWidth + (active ? 4 : 0);
    const alpha = 1 - intro;
    const row = new Graphics();
    if (this.frosted) bindGlassSurface(row, this.glass);
    row.alpha = alpha;
    row.label = `fallback-row[idx=${entryIndex},kind=${entry.kind}${active ? ',active' : ''}]`;
    drawGlassSurface(row, rowX, y, rowW, rowH, 0.96 * alpha);
    if (active) {
      row.rect(rowX, y, rowW, rowH).fill({ color: accent, alpha: 0.24 });
      row.rect(rowX, y, rowW, rowH).stroke({ color: SYN_FLARE, width: 1, alpha: 0.6 });
      this.activeCard = { x: rowX, y, w: rowW, h: rowH };
    } else {
      row.rect(rowX, y, rowW, rowH).stroke({ color: accent, width: 1, alpha: 0.16 });
    }
    const midY = y + rowH / 2;
    const level = browseEntryBadge(entry);
    const orbColor = chartEntry ? levelColor(Math.min(1, Number.parseFloat(level) / 12 || 0)) : SYN_MIST;
    row.circle(rowX + 18, midY, 12).fill({ color: orbColor, alpha: active ? 0.35 : 0.18 });
    frame.layer.addChild(row);
    // The best clear lamp lights the bar's leading edge, rippling down the list.
    drawBarLamp(
      frame.layer,
      this.lampLights,
      entryBestRecord(frame, entry)?.lamp,
      rowX + 1,
      y + 2,
      rowH - 4,
      entryIndex * 0.07,
      frame.nowMs,
      frame.effects === 'off',
    );
    addSynesthesiaText(frame.layer, level, rowX + 18, midY, {
      size: 10,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      alpha,
      maxWidth: 22,
    });
    const facts = chartEntry ? resolveChartRowFacts(chartEntry) : undefined;
    let factsW = 84;
    const factsRight = rowX + rowW - 10;
    const factStyle = (fill: number, maxWidth: number = factsW): SkinTextOptions => ({
      size: 10,
      fill,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 0.5,
      anchorX: 1,
      anchorY: 0.5,
      alpha,
      maxWidth,
      marquee: active,
    });
    if (facts) {
      addSynesthesiaText(
        frame.layer,
        `${facts.bpm} BPM`,
        factsRight,
        midY - 7,
        factStyle(active ? SYN_WHITE : SYN_MIST),
      );
      addSynesthesiaText(frame.layer, `${facts.notes} NOTES`, factsRight, midY + 8, factStyle(SYN_DIM));
    } else {
      // A folder or course count takes what it needs (`4 stages · 1 missing`), up to ROW_COUNT_MAX_W.
      const count = browseEntryCount(entry) ?? '';
      const countNode = addSynesthesiaText(frame.layer, count, factsRight, midY, factStyle(SYN_MIST, ROW_COUNT_MAX_W));
      factsW = count ? Math.max(factsW, Math.min(ROW_COUNT_MAX_W, countNode.width)) : factsW;
    }
    const textX = rowX + 38;
    const textW = Math.max(24, factsRight - factsW - 10 - textX);
    const artist = chartEntry?.artist?.trim();
    const title = addSynesthesiaText(frame.layer, browseEntryTitle(entry), textX, artist ? midY - 7 : midY, {
      size: 12,
      weight: active ? '500' : '300',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      anchorY: 0.5,
      alpha,
      maxWidth: textW,
      marquee: active,
      ...(active ? { dropShadow: { color: accent, distance: 0, blur: 8, alpha: 0.9 } } : {}),
    });
    title.label = `fallback-title[idx=${entryIndex}]`;
    if (artist) {
      addSynesthesiaText(frame.layer, artist, textX, midY + 8, {
        size: 10,
        weight: '300',
        fill: active ? SYN_MIST : SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        anchorY: 0.5,
        alpha,
        maxWidth: textW,
        marquee: active,
      });
    }
    return slide > 0 || intro > 0;
  }

  private renderRow(
    frame: PixiSelectFrame,
    entry: LibraryEntry,
    entryIndex: number,
    visibleIndex: number,
    listWidth: number,
  ): boolean {
    const { listX, listTop, rowHeight } = LAYOUT;
    const y = listTop + visibleIndex * rowHeight;
    const active = entryIndex === frame.selectedIndex;
    const chartEntry = entry.kind === 'chart' ? entry.chart : undefined;
    const hue = sceneHue(frame.nowMs / 1000);
    const accent = hsvToHex(hue, 0.6, 1);
    const slide = active ? 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS)) : 0;
    const intro =
      1 -
      easeOutCubic(
        stageProgress(frame.nowMs - frame.sceneStartedAt, 120 + Math.max(0, visibleIndex) * INTRO_STAGGER_MS, 420),
      );
    const rowX = (active ? listX - 8 : listX) + slide * 26 + intro * 120;
    const rowW = active ? listWidth + 8 : listWidth;
    const alpha = 1 - intro;
    const row = new Graphics();
    if (this.frosted) bindGlassSurface(row, this.glass);
    row.alpha = alpha;
    row.label = `fallback-row[idx=${entryIndex},kind=${entry.kind}${active ? ',active' : ''}]`;
    drawGlassSurface(row, rowX, y, rowW, rowHeight - 4, 0.96 * alpha);
    if (active) {
      row.rect(rowX, y, rowW, rowHeight - 4).fill({ color: accent, alpha: 0.24 });
      row.rect(rowX, y, rowW, rowHeight - 4).stroke({ color: SYN_FLARE, width: 1, alpha: 0.6 });
      this.activeCard = { x: rowX, y, w: rowW, h: rowHeight - 4 };
    } else {
      row.rect(rowX, y, rowW, rowHeight - 4).stroke({ color: accent, width: 1, alpha: 0.16 });
    }
    const record = entryBestRecord(frame, entry);
    // Level as a glowing orb on the leading edge.
    const level = browseEntryBadge(entry);
    const orbColor = chartEntry ? levelColor(Math.min(1, Number.parseFloat(level) / 12 || 0)) : SYN_MIST;
    row.circle(rowX + 16, y + (rowHeight - 4) / 2, 9).fill({ color: orbColor, alpha: active ? 0.35 : 0.18 });
    frame.layer.addChild(row);
    // The best clear lamp lights the bar's leading edge, rippling down the list.
    drawBarLamp(
      frame.layer,
      this.lampLights,
      record?.lamp,
      rowX + 1,
      y + 2,
      rowHeight - 8,
      entryIndex * 0.07,
      frame.nowMs,
      frame.effects === 'off',
    );
    const midY = y + (rowHeight - 4) / 2;
    addSynesthesiaText(frame.layer, level, rowX + 16, midY, {
      size: level.length > 2 ? 7 : 9,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      alpha,
      maxWidth: 16,
    });
    // On the right, the facts a player checks before picking — gimmick tags, note count, length and tempo range — in
    // fixed columns so they line up down the list. Folders show their size instead.
    const facts = chartEntry ? resolveChartRowFacts(chartEntry) : undefined;
    const meta = facts ? `${facts.bpm} BPM` : (browseEntryCount(entry) ?? '');
    const metaNode = addSynesthesiaText(frame.layer, meta, rowX + rowW - 14, midY, {
      size: 9,
      fill: active ? SYN_WHITE : SYN_DIM,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 1,
      anchorX: 1,
      anchorY: 0.5,
      alpha,
      maxWidth: facts ? ROW_BPM_W : ROW_COUNT_MAX_W,
      marquee: active,
    });
    metaNode.label = `fallback-meta[idx=${entryIndex}]`;
    let factsLeft = rowX + rowW - 14 - (facts ? ROW_BPM_W : meta ? Math.min(ROW_COUNT_MAX_W, metaNode.width) : 0) - 12;
    if (facts) {
      const factStyle = (fill: number) => ({
        size: 9,
        fill,
        fontFamily: SYN_DISPLAY_FONT,
        letterSpacing: 1,
        anchorX: 1,
        anchorY: 0.5,
        alpha,
      });
      const ink = active ? SYN_WHITE : SYN_MIST;
      addSynesthesiaText(frame.layer, facts.length, factsLeft, midY, { ...factStyle(ink), maxWidth: ROW_LENGTH_W });
      factsLeft -= ROW_LENGTH_W + 12;
      addSynesthesiaText(frame.layer, 'NOTES', factsLeft, midY, { ...factStyle(SYN_DIM), size: 7 });
      addSynesthesiaText(frame.layer, facts.notes, factsLeft - 46, midY, {
        ...factStyle(ink),
        maxWidth: ROW_NOTES_W - 48,
      });
      factsLeft -= ROW_NOTES_W + 8;
      // The DJ Rank of the best EX score, in its own column so the ranks line up down the list.
      const rank = chartEntry ? describeBestRecord(record, chartEntry.totalNotes)?.rank : undefined;
      if (rank !== undefined) {
        addSynesthesiaText(frame.layer, rank, factsLeft, midY, {
          ...factStyle(rank === 'AAA' ? SYN_AMBER : ink),
          maxWidth: ROW_RANK_W,
        });
      }
      factsLeft -= ROW_RANK_W + 8;
      // Gimmick tags glow as small outlined capsules in the accent light.
      for (let index = facts.tags.length - 1; index >= 0; index -= 1) {
        const tag = facts.tags[index]!;
        const chipW = 10 + tag.length * 6.5;
        factsLeft -= chipW;
        row
          .roundRect(factsLeft, midY - 6, chipW, 12, 6)
          .stroke({ color: active ? SYN_FLARE : accent, width: 1, alpha: 0.7 });
        addSynesthesiaText(frame.layer, tag, factsLeft + chipW / 2, midY, {
          size: 7,
          fill: active ? SYN_WHITE : SYN_MIST,
          fontFamily: SYN_DISPLAY_FONT,
          letterSpacing: 0.5,
          anchorX: 0.5,
          anchorY: 0.5,
          alpha,
          maxWidth: chipW - 4,
        });
        factsLeft -= 5;
      }
      factsLeft -= 6;
    }
    const title = addSynesthesiaText(frame.layer, browseEntryTitle(entry), rowX + 34, midY, {
      size: 11,
      weight: active ? '500' : '300',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      anchorY: 0.5,
      alpha,
      maxWidth: Math.max(24, factsLeft - rowX - 34),
      // Only the focused row scrolls a long title; the others clip it at its start.
      marquee: active,
      ...(active ? { dropShadow: { color: accent, distance: 0, blur: 8, alpha: 0.9 } } : {}),
    });
    title.label = `fallback-title[idx=${entryIndex}]`;
    // The artist trails the title in a dimmer light while there is room for it.
    const artist = chartEntry?.artist?.trim();
    const artistX = rowX + 34 + title.width + 10;
    if (artist && factsLeft - artistX >= 40) {
      addSynesthesiaText(frame.layer, artist, artistX, midY, {
        size: 9,
        weight: '300',
        fill: active ? SYN_MIST : SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        anchorY: 0.5,
        alpha,
        maxWidth: factsLeft - artistX,
        marquee: active,
      });
    }
    return slide > 0 || intro > 0;
  }
}

/** The player's best record on a bar's chart or course, when the host keeps one. */
function entryBestRecord(frame: PixiSelectFrame, entry: LibraryEntry): BeMusicChartBestRecord | undefined {
  if (entry.kind === 'chart') return frame.chartBestRecord(entry.chart);
  if (entry.kind === 'course') return frame.courseBestRecord?.(entry.course);
  return undefined;
}

/** The best record on the focused chart (with its rate and DJ Rank) or course, as the info card shows it. */
function focusedBestRecord(frame: PixiSelectFrame): BestRecordSummary | undefined {
  if (frame.focusedChart !== undefined) {
    return describeBestRecord(frame.chartBestRecord(frame.focusedChart), frame.focusedChart.totalNotes);
  }
  return frame.focusedCourse !== undefined
    ? describeBestRecord(frame.courseBestRecord?.(frame.focusedCourse))
    : undefined;
}

/** Level light for `ratio` (0..1): electric blue for easy charts through magenta to ember for the hardest. */
function levelColor(ratio: number): number {
  return hsvToHex(0.58 + Math.max(0, Math.min(1, ratio)) * 0.5, 0.72, 1);
}
