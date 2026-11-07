/**
 * The launch warp's star field and title, drawn alike by the select screen (its outro) and the decide screen, so the
 * hand-over between the two keeps every particle and letter where it was.
 */

import { Container, Graphics, Sprite, type ColorSource } from 'pixi.js';
import type { BeMusicEffectLevel, LibraryChart } from '@be-music/player-skin-sdk';
import { drawReticle, sharedShapeBatch } from './draw.ts';
import { addSynesthesiaText } from './figures.ts';
import { resolveTitleLockBox, resolveWarpStarSpeed, type DecideLayout, type LaunchWarpPose } from './launch-warp.ts';
import {
  cameraBasis,
  emberColor,
  projectViewInto,
  REST_CAMERA,
  scratchProjected,
  starfieldInto,
  type CameraBasis,
  type Projected,
  type Vec3,
} from './space.ts';
import {
  SYN_CYAN,
  SYN_DEEP,
  SYN_EMBER,
  SYN_MAGENTA,
  SYN_MIST,
  SYN_TEXT_FONT,
  SYN_VOID,
  SYN_WHITE,
  synGlowTexture,
} from './style.ts';

/** Stars drifting past while browsing, and the denser field the launch warp dashes through. */
export const STAR_COUNT = 320;
export const WARP_STAR_COUNT = 900;
/** The star field's volume: particles stream from `far` to `near` along z. */
export const STARFIELD = { spread: 560, near: 10, far: 1000, speed: 1 } as const;
/** How long a trail each particle draws during the warp (seconds of travel), and its longest. */
const STAR_TRAIL_SECONDS = 0.07;
const STAR_TRAIL_MAX = 220;
/** The focal length the star field is projected with. */
const STAR_FOCAL = 200;

/** World units a particle's trail reaches back along its path at `speed`: about the last few frames of travel. */
export function resolveStarTrail(speed: number, warp: number, settle: number): number {
  return warp > 0 ? Math.min(STAR_TRAIL_MAX, speed * STAR_TRAIL_SECONDS) * settle : 0;
}

/** Scratch objects for {@link poseWarpStar}'s allocation-free projection. */
export interface WarpStarScratch {
  readonly point: Vec3;
  readonly head: Projected;
  readonly tail: Projected;
}

export function createWarpStarScratch(): WarpStarScratch {
  return { point: { x: 0, y: 0, z: 0 }, head: scratchProjected(), tail: scratchProjected() };
}

/**
 * Poses star `index` of the field at `travel`, seen through `basis` towards (`cx`, `cy`): near particles swell and
 * brighten, the more so as the `warp` opens up, and with a `trail` each draws a solid streak back towards the vanishing
 * point into `trails` (queued on the shared shape batch; flush it once every star is posed).
 */
export function poseWarpStar(
  star: Sprite,
  trails: Graphics,
  index: number,
  travel: number,
  basis: CameraBasis,
  cx: number,
  cy: number,
  warp: number,
  trail: number,
  scratch: WarpStarScratch,
): void {
  const point = starfieldInto(scratch.point, index, travel, STARFIELD);
  const projected = projectViewInto(scratch.head, point.x, point.y, point.z, basis, cx, cy, STAR_FOCAL);
  star.visible = projected.visible;
  if (!projected.visible) return;
  const nearness = Math.min(1, projected.scale);
  // Rushing past, the near particles swell and brighten.
  const size = (1 + 3 * nearness * nearness) * (1 + 2.5 * warp * nearness);
  star.position.set(projected.x, projected.y);
  star.rotation = 0;
  star.width = size;
  star.height = size;
  star.alpha = Math.min(1, (0.2 + 0.8 * nearness) * (1 + warp));
  star.tint = index % 9 === 0 ? SYN_CYAN : index % 13 === 0 ? SYN_MAGENTA : emberColor(0.4 + 0.6 * nearness);
  if (trail <= 0) return;
  // The tail sits further down the same path, so every trail points back at the vanishing point.
  const tailZ = Math.min(STARFIELD.far, point.z + trail);
  const tail = projectViewInto(scratch.tail, point.x, point.y, tailZ, basis, cx, cy, STAR_FOCAL);
  if (!tail.visible) return;
  // Solid streaks, not grains: the warp's speed lines read as continuous light.
  sharedShapeBatch.streak(
    trails,
    star.tint,
    star.alpha * 0.7,
    Math.max(0.6, size * 0.45),
    tail.x,
    tail.y,
    projected.x,
    projected.y,
  );
}

/** The warm black the space is painted in, top to bottom: each band's colour and where it ends (fraction of height). */
export const SPACE_BANDS: ReadonlyArray<readonly [color: number, until: number]> = [
  [SYN_DEEP, 0.3],
  [0x070201, 0.55],
  [0x040100, 0.8],
  [SYN_VOID, 1],
];

/** Paints the space's warm-black bands over a `width` x `height` stage. */
export function paintSpace(graphics: Graphics, width: number, height: number): void {
  graphics.clear();
  let top = 0;
  for (const [color, until] of SPACE_BANDS) {
    const bottom = height * until;
    graphics.rect(0, top, width, bottom - top).fill(color);
    top = bottom;
  }
}

/**
 * The warp as the decide screen shows it, once the camera flies straight: the space, the star field streaming out of
 * the centre and each star's trail. It carries on from the `travel` the select screen handed over.
 */
export class WarpStarField {
  public readonly view = new Container();
  private readonly ground = new Graphics();
  /** Between the space and the stars: for an image glowing through the space. */
  public readonly imageLayer = new Container();
  private readonly trails = new Graphics();
  private readonly starLayer = new Container();
  private readonly stars: Sprite[] = [];
  private readonly basis = cameraBasis(REST_CAMERA);
  private readonly scratch = createWarpStarScratch();
  private width = -1;
  private height = -1;
  private lastNowMs: number | undefined;
  /** Accumulated travel (speed-weighted seconds), as on the select screen. */
  public travel: number;

  public constructor(travel = 0) {
    this.travel = travel;
    this.view.label = 'synesthesia-decide/space';
    const glow = synGlowTexture();
    this.starLayer.blendMode = 'add';
    for (let index = 0; index < WARP_STAR_COUNT; index += 1) {
      const star = new Sprite(glow);
      star.anchor.set(0.5);
      star.blendMode = 'add';
      this.starLayer.addChild(star);
      this.stars.push(star);
    }
    this.trails.blendMode = 'add';
    this.view.addChild(this.ground, this.imageLayer, this.trails, this.starLayer);
  }

  /**
   * Streams the field on to `nowMs` at the chart's tempo, the warp opened up to `warp` and quickened by the music's
   * `level`. Effects off hold it still and trail-less.
   */
  public update(
    width: number,
    height: number,
    nowMs: number,
    bpm: number | undefined,
    warp: number,
    effects: BeMusicEffectLevel,
    level = 0,
  ): void {
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      paintSpace(this.ground, width, height);
    }
    const dt = this.lastNowMs === undefined ? 0 : Math.max(0, Math.min(0.1, (nowMs - this.lastNowMs) / 1000));
    this.lastNowMs = nowMs;
    const moving = effects !== 'off';
    const speed = resolveWarpStarSpeed(bpm, warp, effects, level);
    if (moving) this.travel += dt * speed;
    const trail = moving ? resolveStarTrail(speed, warp, 1) : 0;
    this.trails.clear();
    const cx = width / 2;
    const cy = height / 2;
    for (let index = 0; index < this.stars.length; index += 1) {
      poseWarpStar(this.stars[index]!, this.trails, index, this.travel, this.basis, cx, cy, warp, trail, this.scratch);
    }
    sharedShapeBatch.flush();
  }
}

/**
 * The chosen title condensing at the centre out of wide-tracked light, the artist under it, and the lock-on reticle
 * closing around it, posed by `pose` and faded by `alpha`. Returns the title node.
 */
export function drawLaunchTitle(
  layer: Container,
  chart: Pick<LibraryChart, 'title' | 'artist' | 'subtitle'> | undefined,
  layout: Pick<DecideLayout, 'centerX' | 'centerY' | 'titleY' | 'artistY' | 'titleMaxWidth' | 'lineMaxWidth'>,
  designWidth: number,
  pose: LaunchWarpPose,
  alpha: number,
): Container {
  const { centerX: cx, centerY: cy } = layout;
  const titleAlpha = pose.titleAlpha * alpha;
  const title = addSynesthesiaText(layer, chart?.title ?? '', cx, layout.titleY, {
    size: 26,
    weight: '500',
    fill: SYN_WHITE,
    fontFamily: SYN_TEXT_FONT,
    letterSpacing: pose.titleTracking,
    anchorX: 0.5,
    anchorY: 0.5,
    maxWidth: layout.titleMaxWidth,
    alpha: titleAlpha,
    dropShadow: { color: SYN_EMBER, distance: 0, blur: 16, alpha: 1 },
  });
  const artist = chart?.artist || chart?.subtitle;
  if (artist) {
    addSynesthesiaText(layer, artist, cx, layout.artistY, {
      size: 11,
      fill: SYN_MIST,
      fontFamily: SYN_TEXT_FONT,
      letterSpacing: 2,
      anchorX: 0.5,
      anchorY: 0.5,
      maxWidth: layout.lineMaxWidth,
      alpha: titleAlpha * pose.artistAlpha,
    });
  }
  // Lock-on: brackets close from wide to tight around the title.
  const box = resolveTitleLockBox(title.width, designWidth, pose.lock);
  const reticle = new Graphics();
  reticle.label = 'synesthesia/launch-lock';
  drawReticle(
    reticle,
    cx - box.width / 2,
    cy - box.height / 2 + 4,
    box.width,
    box.height,
    SYN_WHITE,
    0.85 * titleAlpha,
    {
      arm: 12,
      width: 1.5,
    },
  );
  layer.addChild(reticle);
  return title;
}

/** A full-stage veil of `color` at `alpha`, for the fall to black. */
export function drawVeil(
  layer: Container,
  width: number,
  height: number,
  alpha: number,
  color: ColorSource = SYN_VOID,
): void {
  if (alpha <= 0) return;
  const veil = new Graphics();
  veil.label = 'synesthesia/veil';
  veil.rect(0, 0, width, height).fill({ color, alpha });
  layer.addChild(veil);
}
