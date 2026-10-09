import { Container, Graphics, Sprite } from 'pixi.js';
import { createFlock, stepFlock } from './boids.ts';
import { drawMagnetoOrb, drawPointCloud, drawReticle, drawSchool, sharedShapeBatch } from './draw.ts';
import {
  emberColor,
  hsvToHex,
  mixCamera,
  particleRiverPoint,
  fibonacciSphere,
  orbitParticles,
  pointCloudPyramid,
  projectPoint,
  REST_CAMERA,
  roamingCamera,
  starfieldPoint,
  vanishingPoint,
  viewPoint,
  wanderPoint,
} from './space.ts';
import {
  SYN_AMBER,
  SYN_CYAN,
  SYN_DEEP,
  SYN_DIM,
  SYN_DISPLAY_FONT,
  SYN_EMBER,
  SYN_FLARE,
  SYN_GLASS,
  SYN_MAGENTA,
  SYN_MIST,
  SYN_TEXT_FONT,
  SYN_VOID,
  SYN_WHITE,
  sceneHue,
  synGlowTexture,
} from './style.ts';
import {
  easeOutCubic,
  audioDrive,
  type BeMusicAudioFrame,
  type BeMusicSelectLayout,
  type BrowserBrowseEntry,
  type BrowserSongEntry,
  formatPlayVariantLabel,
  hash01,
  resolveSongRowFacts,
  stageProgress,
} from '../../skin-sdk/index.ts';
import {
  addHitArea,
  addSkinText,
  type PixiSelectFrame,
  type PixiSelectRenderer,
  type PixiSelectSkin,
  ChildPool,
  type SkinTextOptions,
} from '../pixi-kit/index.ts';

const LAYOUT: BeMusicSelectLayout = { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 };
/** Fixed widths of a song row's fact columns (right to left: tempo, length, note count), so they align down the list. */
const ROW_BPM_W = 76;
const ROW_LENGTH_W = 30;
const ROW_NOTES_W = 50;
const SLIDE_MS = 320;
const OUTRO_MS = 700;
const INTRO_STAGGER_MS = 45;
const STAR_COUNT = 320;
const RIVER_PARTICLES = 340;
const ORB_SHELL = fibonacciSphere(900, 23);
const ORB = orbitParticles(23, 30);
const SMALL_SHELL = fibonacciSphere(400, 31);
const SMALL_ORB = orbitParticles(31, 12);
/** How far the select camera roams around the pyramid field. */
const CAMERA_RANGE = { x: 240, y: 110, yaw: 0.38, pitch: 0.16 } as const;
const CAMERA_CYCLE_S = 6;
const SCHOOL_SIZE = 80;
/** Three schools in the floor frame (floor at y 150), each with its own box, light, and seed. */
const SCHOOL_SPECS = [
  { seed: 29, palette: 'ember', bounds: { minX: -700, maxX: 500, minY: -240, maxY: 90, minZ: 140, maxZ: 900 } },
  { seed: 57, palette: 'blue', bounds: { minX: -300, maxX: 900, minY: -300, maxY: 40, minZ: 300, maxZ: 1300 } },
  { seed: 91, palette: 'magenta', bounds: { minX: -900, maxX: 900, minY: -280, maxY: 60, minZ: 800, maxZ: 1900 } },
] as const;
/** Depth the world shots pivot around — the pyramid field. */
const WORLD_ORBIT = 900;
const PYRAMIDS = [pointCloudPyramid(12, 900), pointCloudPyramid(4, 560), pointCloudPyramid(9, 520)];

export const synesthesiaSelectSkin: PixiSelectSkin = {
  outroMs: OUTRO_MS,
  layout: LAYOUT,
  createRenderer: () => new SynesthesiaSelectRenderer(),
};

function labelStyle(fill: number = SYN_DIM): SkinTextOptions {
  return { size: 9, fill, fontFamily: SYN_DISPLAY_FONT, letterSpacing: 2 };
}

function framePanel(graphics: Graphics, x: number, y: number, w: number, h: number, rim: number): void {
  graphics.rect(x, y, w, h).fill({ color: SYN_GLASS, alpha: 0.5 });
  graphics.rect(x, y, w, h).stroke({ color: rim, width: 1, alpha: 0.28 });
  drawReticle(graphics, x - 1, y - 1, w + 2, h + 2, SYN_WHITE, 0.85, { arm: 10, width: 1.25 });
}

/**
 * Synesthesia song select, set in a cosmic particle world. The persistent back layer is a particle world — data dust
 * pouring out of the vanishing point at the focused chart's tempo, point-cloud pyramids on an ember
 * horizon, a floor of light points, a golden river of particles, and a roaming visualizer-style audio orb — redrawn cheaply
 * in `tick`. The front layer snaps a lock-on reticle onto the focused card.
 */
class SynesthesiaSelectRenderer implements PixiSelectRenderer {
  public readonly backLayer = new Container();
  public readonly frontLayer = new Container();
  private readonly ground = new Graphics();
  /** Additive particle world: floor, pyramids, river, and the orb's tails. */
  private readonly world = new Graphics();
  private readonly stars: Sprite[] = [];
  private readonly lock = new Graphics();
  private readonly cursorGlow = new Sprite();
  private cursorChangedAt = Number.NEGATIVE_INFINITY;
  /** Glow sprites for the audio orb, drawn over the world graphics. */
  private readonly orbHost = new Container();
  /** Normal-blend layer for the orb's black moon, and the additive layer for the camera-facing half of its shell. */
  private readonly orbMoon = new Graphics();
  private readonly orbFront = new Graphics();
  private readonly orbSprites = new ChildPool(this.orbHost);
  private readonly flocks = SCHOOL_SPECS.map((spec) => createFlock(spec.seed, SCHOOL_SIZE, spec.bounds));
  private built = false;
  private designWidth = 640;
  private designHeight = 480;
  /** Accumulated star / grid travel (speed-weighted seconds), so a speed change never makes the field jump. */
  private travel = 0;
  private lastTickMs: number | undefined;
  private effects: PixiSelectFrame['effects'] = 'full';
  private activeCard: { x: number; y: number; w: number; h: number } | undefined;

  public constructor() {
    this.backLayer.label = 'synesthesia-select/space';
    this.frontLayer.label = 'synesthesia-select/front';
  }

  public render(input: PixiSelectFrame): boolean {
    this.effects = input.effects;
    const frame =
      input.effects === 'off'
        ? { ...input, sceneStartedAt: Number.NEGATIVE_INFINITY, cursorChangedAt: Number.NEGATIVE_INFINITY }
        : input;
    this.ensureBuilt(frame.designWidth, frame.designHeight);
    this.activeCard = undefined;
    let needsFrame = this.renderChrome(frame);
    const listWidth = frame.designWidth - LAYOUT.listX - 14;
    for (let visibleIndex = 0; visibleIndex < frame.visibleRows; visibleIndex += 1) {
      const entryIndex = frame.firstVisibleIndex + visibleIndex;
      const entry = frame.entries[entryIndex];
      if (!entry) break;
      needsFrame = this.renderRow(frame, entry, entryIndex, visibleIndex, listWidth) || needsFrame;
    }
    const visible = this.activeCard !== undefined;
    this.cursorGlow.visible = visible;
    this.lock.visible = visible;
    this.cursorChangedAt = frame.cursorChangedAt;
    if (frame.launchAt !== undefined) {
      this.renderOutro(frame);
      return true;
    }
    return needsFrame;
  }

  /**
   * Launch outro — the warp: the star field rushes forward (in `tick`), a white bloom opens from the
   * vanishing point with the chosen title in it, and the screen falls to black for the gameplay count-in.
   */
  private renderOutro(frame: PixiSelectFrame): void {
    const t = Math.min(1, (frame.nowMs - (frame.launchAt ?? frame.nowMs)) / OUTRO_MS);
    const { designWidth, designHeight, layer } = frame;
    const g = new Graphics();
    g.label = 'synesthesia-select/outro';
    const cx = designWidth * 0.58;
    const cy = designHeight * 0.44;
    const bloom = easeOutCubic(Math.min(1, t / 0.7));
    for (let ring = 5; ring >= 1; ring -= 1) {
      g.circle(cx, cy, (40 + 520 * bloom) * (ring / 5)).fill({ color: SYN_FLARE, alpha: 0.1 * bloom });
    }
    const dark = Math.max(0, (t - 0.72) / 0.28);
    if (dark > 0) g.rect(0, 0, designWidth, designHeight).fill({ color: SYN_VOID, alpha: dark });
    layer.addChild(g);
    addSkinText(layer, frame.focusedSong?.title ?? '', cx, cy, {
      size: 22,
      weight: '500',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      letterSpacing: 2 + 10 * bloom,
      anchorX: 0.5,
      anchorY: 0.5,
      maxWidth: designWidth - 80,
      alpha: Math.min(1, t * 3) * (1 - dark),
      dropShadow: { color: SYN_EMBER, distance: 0, blur: 16, alpha: 1 },
    });
  }

  public tick(
    nowMs: number,
    focusedSong: BrowserSongEntry | undefined,
    launchAt?: number,
    audio?: BeMusicAudioFrame,
  ): void {
    // Ambient motion: frozen with effects off, half speed when reduced.
    const rate = this.effects === 'off' ? 0 : this.effects === 'reduced' ? 0.5 : 1;
    // The BGM / chart preview drives the space: dust speeds with loudness, the horizon and floor swell on the bass,
    // the schools pulse, and the orb's orbits breathe with the spectrum.
    const drive = audioDrive(audio, this.effects);
    const seconds = (nowMs / 1000) * rate;
    const dt = this.lastTickMs === undefined ? 0 : Math.min(0.1, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;
    const warp = launchAt !== undefined ? Math.min(1, (nowMs - launchAt) / OUTRO_MS) : 0;
    const bpm = focusedSong?.bpm;
    const beatsPerSecond = (bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? Math.min(bpm, 300) : 120) / 60;
    const beatPhase = (seconds * beatsPerSecond) % 1;
    const pulse = (1 - beatPhase) ** 3;
    const hue = sceneHue(seconds, beatPhase);
    const accent = hsvToHex(hue, 0.6, 1);

    // Camera: the backdrop roams between random shots (flying, sometimes hard-cutting) with a handheld drift.
    // Reduced effects halve the moves; off keeps it at rest.
    const camera = mixCamera(
      REST_CAMERA,
      roamingCamera(seconds, 13, CAMERA_RANGE, CAMERA_CYCLE_S),
      this.effects === 'off' ? 0 : this.effects === 'reduced' ? 0.5 : 1,
    );
    // Data dust pouring out of the vanishing point — speed follows the focused chart's tempo.
    const cx = this.designWidth * 0.58;
    const cy = this.designHeight * 0.44;
    const speed = (80 + beatsPerSecond * 55) * (1 + 16 * warp * warp) * (1 + 1.2 * drive.level);
    this.travel += dt * speed * (warp > 0 ? 1 : rate);
    for (let index = 0; index < this.stars.length; index += 1) {
      const star = this.stars[index]!;
      const point = starfieldPoint(index, this.travel, { spread: 560, near: 10, far: 1000, speed: 1 });
      const projected = projectPoint(viewPoint(point, camera), cx, cy, 200);
      star.visible = projected.visible;
      if (!projected.visible) continue;
      const nearness = Math.min(1, projected.scale);
      const size = 1 + 3 * nearness * nearness;
      star.position.set(projected.x, projected.y);
      star.rotation = 0;
      star.width = size;
      star.height = size;
      star.alpha = 0.2 + 0.8 * nearness;
      star.tint = index % 9 === 0 ? SYN_CYAN : index % 13 === 0 ? SYN_MAGENTA : emberColor(0.4 + 0.6 * nearness);
    }

    const world = this.world;
    world.clear();
    const floorY = this.designHeight * 0.7;
    const horizon = vanishingPoint(camera, cx, floorY, 200).y;
    // Point-cloud pyramids on the horizon, far to near.
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
    // Ember haze along the horizon.
    for (let band = 0; band < 14; band += 1) {
      const falloff = (1 - band / 14) ** 2;
      const alpha = (0.05 + 0.04 * pulse) * falloff * (1 + 1.4 * drive.bass);
      world.rect(0, horizon - (band + 1) * 7, this.designWidth, 7).fill({ color: SYN_EMBER, alpha });
      world.rect(0, horizon + band * 4, this.designWidth, 4).fill({ color: SYN_EMBER, alpha: alpha * 0.8 });
    }
    world.rect(0, horizon - 1, this.designWidth, 2).fill({ color: SYN_AMBER, alpha: 0.35 + 0.25 * pulse });
    // Floor of light points scrolling toward the viewer.
    const project = (x: number, z: number) =>
      projectPoint(viewPoint({ x, y: 150, z }, camera, WORLD_ORBIT), cx, floorY, 200);
    const spacing = 100;
    const offset = this.travel % spacing;
    // Floor points and the river go out as a few batched instructions.
    const batch = sharedShapeBatch;
    for (let z = spacing - offset; z < 2600; z += spacing) {
      const nearness = 1 - z / 2600;
      const size = 0.6 + 1.5 * nearness * nearness;
      const color = emberColor(0.3 + 0.65 * nearness);
      const alpha = Math.min(1, (0.12 + 0.7 * nearness * nearness) * (0.7 + 0.3 * pulse) * (1 + drive.bass));
      for (let x = -1800; x <= 1800; x += 50) {
        const point = project(x, z);
        if (!point.visible || point.x < -4 || point.x > this.designWidth + 4 || point.y > this.designHeight + 4) {
          continue;
        }
        batch.rect(world, color, alpha, point.x - size / 2, point.y - size / 2, size, size);
      }
    }
    // A golden river of particles sweeping across the floor.
    const riverOptions = {
      length: 1800,
      speed: 120 + beatsPerSecond * 60,
      amplitude: 36 * (1 + 1.3 * drive.mid),
      width: 20,
      seed: 2,
    };
    const riverWorld = (local: { x: number; y: number; z: number }) =>
      viewPoint({ x: local.x, y: 110 + local.y, z: 620 + local.z + local.x * 0.5 }, camera, WORLD_ORBIT);
    for (let index = 0; index < RIVER_PARTICLES; index += 1) {
      const local = particleRiverPoint(index, this.travel / 90, riverOptions);
      const head = projectPoint(riverWorld(local), cx, floorY, 200);
      const tail = projectPoint(riverWorld({ ...local, x: local.x - 30 }), cx, floorY, 200);
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
          (point) => projectPoint(viewPoint(point, camera, WORLD_ORBIT), cx, floorY, 200),
          { alpha: 0.95 * (1 - warp), palette: SCHOOL_SPECS[school]!.palette },
        );
      }
    }
    // Two audio orbs roam the space — the big one and its black moon right up by the camera — visualizer-style shells of sparks and fibres, the big one
    // with a black moon circling it. On launch they swell into the warp.
    this.orbSprites.begin();
    this.orbMoon.clear();
    this.orbFront.clear();
    const layers = { back: world, moon: this.orbMoon, front: this.orbFront };
    const orbView = { cx, cy: floorY, focal: 200, camera, orbit: WORLD_ORBIT };
    const big = wanderPoint(seconds * 0.6, 5, { minX: -210, maxX: 230, minY: -140, maxY: -20, minZ: -70, maxZ: 150 });
    const small = wanderPoint(seconds * 0.75 + 40, 9, {
      minX: -360,
      maxX: 360,
      minY: -190,
      maxY: 30,
      minZ: 80,
      maxZ: 700,
    });
    // Draw the farther orb first so the nearer one's shell lands over it.
    const orbs = [
      { at: big, shell: ORB_SHELL, particles: ORB, radius: 58, moon: true },
      { at: small, shell: SMALL_SHELL, particles: SMALL_ORB, radius: 34, moon: false },
    ].sort((left, right) => right.at.z - left.at.z);
    for (const orb of orbs) {
      drawMagnetoOrb(layers, () => this.orbSprites.acquireSprite(), orb.shell, orb.particles, {
        ...orb.at,
        radius: orb.radius * (1 + 0.03 * pulse) * (1 + 0.8 * warp),
        view: orbView,
        drive,
        seconds,
        alpha: 1 - warp * 0.5,
        tilt: orb.moon ? 0.35 : -0.5,
        spin: orb.moon ? 0.22 : -0.35,
        ...(orb.moon ? { moon: { size: 0.42, distance: 2.1, speed: 0.55, phase: 0.4, tilt: 0.3 } } : {}),
      });
    }
    this.orbSprites.end();

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
    this.backLayer.destroy({ children: true });
    this.frontLayer.destroy({ children: true });
  }

  private ensureBuilt(designWidth: number, designHeight: number): void {
    if (this.built) return;
    this.built = true;
    this.designWidth = designWidth;
    this.designHeight = designHeight;
    const bands: ReadonlyArray<readonly [number, number]> = [
      [SYN_DEEP, 0.3],
      [0x070201, 0.55],
      [0x040100, 0.8],
      [SYN_VOID, 1],
    ];
    let top = 0;
    for (const [color, until] of bands) {
      const bottom = designHeight * until;
      this.ground.rect(0, top, designWidth, bottom - top).fill(color);
      top = bottom;
    }
    const glow = synGlowTexture();
    const starLayer = new Container();
    starLayer.blendMode = 'add';
    for (let index = 0; index < STAR_COUNT; index += 1) {
      const star = new Sprite(glow);
      star.anchor.set(0.5);
      star.blendMode = 'add';
      starLayer.addChild(star);
      this.stars.push(star);
    }
    this.world.blendMode = 'add';
    this.orbHost.blendMode = 'add';
    this.orbFront.blendMode = 'add';
    this.backLayer.addChild(this.ground, this.world, starLayer, this.orbMoon, this.orbFront, this.orbHost);

    this.cursorGlow.texture = glow;
    this.cursorGlow.anchor.set(0.5);
    this.cursorGlow.blendMode = 'add';
    this.frontLayer.addChild(this.cursorGlow, this.lock);
  }

  private renderChrome(frame: PixiSelectFrame): boolean {
    const { layer, designWidth, designHeight, entries, focusedSong: song } = frame;
    const chrome = new Graphics();
    chrome.label = 'synesthesia-select/chrome';
    const hue = sceneHue(frame.nowMs / 1000);
    const accent = hsvToHex(hue, 0.6, 1);
    const addText = (text: string, x: number, y: number, options: SkinTextOptions = {}) =>
      addSkinText(layer, text, x, y, options);

    const songTitle = song?.title ?? 'No chart selected';
    const songArtist = song?.artist || song?.subtitle || '';
    const playLevel = song?.playLevel !== undefined ? String(song.playLevel) : '-';
    const playLevelNumber =
      song?.playLevel !== undefined ? Number.parseFloat(String(song.playLevel).replace(/^[^\d.]+/u, '')) : NaN;
    const songBpm = song?.bpm !== undefined ? String(Math.round(song.bpm)) : '-';
    const modeLabel = song ? formatPlayVariantLabel(song) : '- KEYS';
    const categoryName = frame.searchQuery ? `Search: ${frame.searchQuery}` : (frame.folderLabel ?? 'Library');
    const position =
      entries.length > 0 ? `${Math.min(frame.selectedIndex + 1, entries.length)} / ${entries.length}` : '0 / 0';

    // Header: title as light, a hairline, and the folder on the right.
    chrome.rect(0, 0, designWidth, 38).fill({ color: SYN_VOID, alpha: 0.5 });
    chrome.rect(0, 38, designWidth, 1).fill({ color: accent, alpha: 0.5 });
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
      maxWidth: 220,
    });

    // Info panel.
    framePanel(chrome, 14, 56, 290, 302, accent);
    addText('NOW SELECTING', 30, 70, labelStyle(accent));
    const slide = 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS));
    addText(songTitle, 30 + slide * 24, 86, {
      size: 18,
      weight: '500',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      maxWidth: 258,
      alpha: 1 - slide,
      dropShadow: { color: accent, distance: 0, blur: 10, alpha: 0.8 },
    });
    if (songArtist) {
      addText(songArtist, 30 + slide * 40, 114, {
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
      [118, 76, 'BPM', songBpm, SYN_WHITE],
      [202, 86, 'LEVEL', playLevel, SYN_AMBER],
    ];
    for (const [x, w, label, value, fill] of stats) {
      chrome.rect(x, 150, w, 50).fill({ color: SYN_VOID, alpha: 0.5 });
      chrome.rect(x, 150, w, 50).stroke({ color: accent, width: 1, alpha: 0.25 });
      drawReticle(chrome, x, 150, w, 50, SYN_MIST, 0.6, { arm: 5, width: 1 });
      addText(label, x + 10, 158, labelStyle());
      addText(value, x + 10, 174, {
        size: 14,
        fill,
        fontFamily: SYN_DISPLAY_FONT,
        maxWidth: w - 18,
        dropShadow: { color: fill, distance: 0, blur: 6, alpha: 0.6 },
      });
    }

    // Level as a row of lights, from cool electric blue through magenta to hot ember.
    const levelRatio = Number.isFinite(playLevelNumber) ? Math.max(0.04, Math.min(1, playLevelNumber / 12)) : 0;
    const dots = 12;
    for (let dot = 0; dot < dots; dot += 1) {
      const lit = dot < Math.round(levelRatio * dots);
      const x = 38 + dot * 22;
      const color = levelColor(dot / dots);
      if (lit) {
        chrome.circle(x, 226, 7).fill({ color, alpha: 0.18 });
        chrome.circle(x, 226, 3).fill({ color: SYN_WHITE, alpha: 0.95 });
      } else {
        chrome.circle(x, 226, 2).fill({ color: SYN_DIM, alpha: 0.5 });
      }
    }
    if (song?.fileLabel) {
      addText(song.fileLabel, 30, 245, {
        size: 9,
        weight: '300',
        fill: SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        maxWidth: 258,
      });
    }
    addText(position, 288, 268, { size: 9, fill: SYN_MIST, fontFamily: SYN_DISPLAY_FONT, anchorX: 1 });

    // PLAY (primary glowing pill) / AUTO PLAY (secondary outline).
    chrome.rect(26, 296, 170, 40).fill({ color: accent, alpha: 0.16 });
    chrome.rect(30, 300, 162, 32).fill({ color: accent, alpha: 0.88 });
    drawReticle(chrome, 26, 296, 170, 40, SYN_WHITE, 0.95, { arm: 8, width: 1.5 });
    addText('PLAY', 111, 316, {
      size: 14,
      fill: SYN_VOID,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 6,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    // AUTO's right edge sits on the content column's (288), like the LEVEL chip above it.
    chrome.rect(202, 303, 86, 26).stroke({ color: SYN_MIST, width: 1, alpha: 0.45 });
    drawReticle(chrome, 202, 303, 86, 26, SYN_MIST, 0.8, { arm: 5, width: 1 });
    addText('AUTO', 245, 316, {
      size: 9,
      fill: SYN_MIST,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 3,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    addHitArea(26, 296, 172, 40, 'pointer', frame.actions.play);
    addHitArea(200, 300, 90, 32, 'pointer', frame.actions.autoPlay);

    // Search and library.
    framePanel(chrome, 14, 372, 290, 30, accent);
    addText('SEARCH', 30, 387, { ...labelStyle(accent), anchorY: 0.5 });
    addText(frame.searchQuery || 'Title / artist / genre', 116, 387, {
      size: 10,
      anchorY: 0.5,
      weight: '300',
      fill: frame.searchQuery ? SYN_WHITE : SYN_DIM,
      fontFamily: SYN_TEXT_FONT,
      maxWidth: 180,
    });
    addHitArea(14, 372, 290, 30, 'text', frame.actions.activateSearch);
    addText('LIBRARY', 30, 422, labelStyle());
    addText(`${entries.length} shown / ${frame.totalCharts} charts`, 30, 436, {
      size: 11,
      weight: '500',
      fill: SYN_MIST,
      fontFamily: SYN_TEXT_FONT,
    });
    addText(
      frame.searchQuery ? 'SEARCH RESULTS' : frame.folderLabel ? 'CHARTS' : 'FOLDERS',
      designWidth - 14,
      designHeight - 20,
      { ...labelStyle(), anchorX: 1 },
    );

    layer.addChildAt(chrome, 0);
    return slide > 0 || intro < 1;
  }

  private renderRow(
    frame: PixiSelectFrame,
    entry: BrowserBrowseEntry,
    entryIndex: number,
    visibleIndex: number,
    listWidth: number,
  ): boolean {
    const { listX, listTop, rowHeight } = LAYOUT;
    const y = listTop + visibleIndex * rowHeight;
    const active = entryIndex === frame.selectedIndex;
    const song = entry.kind === 'song' ? entry.song : undefined;
    const folder = entry.kind === 'folder' ? entry.folder : undefined;
    const hue = sceneHue(frame.nowMs / 1000);
    const accent = hsvToHex(hue, 0.6, 1);
    const slide = active ? 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS)) : 0;
    const intro =
      1 - easeOutCubic(stageProgress(frame.nowMs - frame.sceneStartedAt, 120 + visibleIndex * INTRO_STAGGER_MS, 420));
    const rowX = (active ? listX - 8 : listX) + slide * 26 + intro * 120;
    const rowW = active ? listWidth + 8 : listWidth;
    const alpha = 1 - intro;
    const row = new Graphics();
    row.alpha = alpha;
    row.label = `fallback-row[idx=${entryIndex},kind=${entry.kind}${active ? ',active' : ''}]`;
    if (active) {
      row.rect(rowX, y, rowW, rowHeight - 4).fill({ color: accent, alpha: 0.24 });
      row.rect(rowX, y, rowW, rowHeight - 4).stroke({ color: SYN_FLARE, width: 1, alpha: 0.6 });
      this.activeCard = { x: rowX, y, w: rowW, h: rowHeight - 4 };
    } else {
      row.rect(rowX, y, rowW, rowHeight - 4).fill({ color: SYN_GLASS, alpha: 0.55 });
      row.rect(rowX, y, rowW, rowHeight - 4).stroke({ color: accent, width: 1, alpha: 0.16 });
    }
    // Level as a glowing orb on the leading edge.
    const level = song?.playLevel !== undefined ? String(song.playLevel) : folder ? 'DIR' : '-';
    const orbColor = song ? levelColor(Math.min(1, Number.parseFloat(level) / 12 || 0)) : SYN_MIST;
    row.circle(rowX + 16, y + (rowHeight - 4) / 2, 9).fill({ color: orbColor, alpha: active ? 0.35 : 0.18 });
    frame.layer.addChild(row);
    const midY = y + (rowHeight - 4) / 2;
    addSkinText(frame.layer, level, rowX + 16, midY, {
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
    const facts = song ? resolveSongRowFacts(song) : undefined;
    const meta = facts
      ? `${facts.bpm} BPM`
      : `${folder?.songs.length ?? 0} chart${folder?.songs.length === 1 ? '' : 's'}`;
    const metaNode = addSkinText(frame.layer, meta, rowX + rowW - 14, midY, {
      size: 9,
      fill: active ? SYN_WHITE : SYN_DIM,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 1,
      anchorX: 1,
      anchorY: 0.5,
      alpha,
      maxWidth: facts ? ROW_BPM_W : 70,
    });
    metaNode.label = `fallback-meta[idx=${entryIndex}]`;
    let factsLeft = rowX + rowW - 14 - (facts ? ROW_BPM_W : meta ? Math.min(70, metaNode.width) : 0) - 12;
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
      addSkinText(frame.layer, facts.length, factsLeft, midY, { ...factStyle(ink), maxWidth: ROW_LENGTH_W });
      factsLeft -= ROW_LENGTH_W + 12;
      addSkinText(frame.layer, 'N', factsLeft, midY, { ...factStyle(SYN_DIM), size: 7 });
      addSkinText(frame.layer, facts.notes, factsLeft - 12, midY, { ...factStyle(ink), maxWidth: ROW_NOTES_W - 14 });
      factsLeft -= ROW_NOTES_W + 8;
      // Gimmick tags glow as small outlined capsules in the accent light.
      for (let index = facts.tags.length - 1; index >= 0; index -= 1) {
        const tag = facts.tags[index]!;
        const chipW = 10 + tag.length * 6.5;
        factsLeft -= chipW;
        row
          .roundRect(factsLeft, midY - 6, chipW, 12, 6)
          .stroke({ color: active ? SYN_FLARE : accent, width: 1, alpha: 0.7 });
        addSkinText(frame.layer, tag, factsLeft + chipW / 2, midY, {
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
    const title = addSkinText(frame.layer, song?.title ?? folder?.label ?? '', rowX + 34, midY, {
      size: 11,
      weight: active ? '500' : '300',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      anchorY: 0.5,
      alpha,
      maxWidth: Math.max(24, factsLeft - rowX - 34),
      ...(active ? { dropShadow: { color: accent, distance: 0, blur: 8, alpha: 0.9 } } : {}),
    });
    title.label = `fallback-title[idx=${entryIndex}]`;
    // The artist trails the title in a dimmer light while there is room for it.
    const artist = song?.artist?.trim();
    const artistX = rowX + 34 + title.width + 10;
    if (artist && factsLeft - artistX >= 40) {
      addSkinText(frame.layer, artist, artistX, midY, {
        size: 9,
        weight: '300',
        fill: active ? SYN_MIST : SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        anchorY: 0.5,
        alpha,
        maxWidth: factsLeft - artistX,
      });
    }
    return slide > 0 || intro > 0;
  }
}

/** Level light for `ratio` (0..1): electric blue for easy charts through magenta to ember for the hardest. */
function levelColor(ratio: number): number {
  return hsvToHex(0.58 + Math.max(0, Math.min(1, ratio)) * 0.5, 0.72, 1);
}
