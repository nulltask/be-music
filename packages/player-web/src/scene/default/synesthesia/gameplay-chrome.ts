import { Graphics, type Container } from 'pixi.js';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../../gameplay-constants.ts';
import type { SkinlessGameplayChromeRenderContext, SkinlessGameplayChromeRuntime } from '../../gameplay-chrome.ts';
import { resolveFallbackLaneLayout, shouldPreserveFallbackSideWidth } from '../../gameplay-lanes.ts';
import type { ChildPool } from '../../pixi-utils.ts';
import { addHudNumber, addHudText, type HudTextOptions } from '../hud-text.ts';
import { hsvToHex, icosahedron, projectPoint, rotateX, rotateY, starfieldPoint } from './space.ts';
import {
  SYN_AMBER,
  SYN_CYAN,
  SYN_DEEP,
  SYN_DIM,
  SYN_DISPLAY_FONT,
  SYN_GLASS,
  SYN_GREEN,
  SYN_MAGENTA,
  SYN_MIST,
  SYN_RED,
  SYN_TEXT_FONT,
  SYN_VIOLET,
  SYN_VOID,
  SYN_WHITE,
  sceneHue,
} from './style.ts';

type Runtime = SkinlessGameplayChromeRuntime;

const SCORE_PANEL = { x: 384, y: 352, w: 234, h: 108 } as const;
const SONG_PLATE = { x: 16, y: 420, w: 344, h: 46 } as const;
const PLAYFIELD_FRAME_BOTTOM = 344;
/** Floor grid: horizon y, camera height above the floor, focal length. */
const FLOOR = { horizon: 326, height: 154, focal: 200 } as const;
const ICOSAHEDRON = icosahedron();

/**
 * Synesthesia gameplay HUD: a 3D starfield streaming out of a vanishing point, a Rez-style perspective floor grid
 * scrolling toward the player, glass panels with glowing rims, and light, wide type. Colour drifts with the song and
 * swells on every beat.
 */
export function renderSynesthesiaChrome({
  layer,
  overlayLayer,
  layerPool,
  overlayLayerPool,
  runtime,
}: SkinlessGameplayChromeRenderContext): void {
  const seconds = (runtime.nowMs ?? 0) / 1000;
  const beatPhase = runtime.beatPhase ?? 0;
  const pulse = (1 - beatPhase) ** 2;
  const hue = sceneHue(seconds, beatPhase);
  const accent = hsvToHex(hue, 0.62, 1);
  const hasBga = runtime.hasBga === true;
  const playfieldRight = resolvePlayfieldRight(runtime);

  const space = layerPool.acquireGraphics();
  space.label = 'synesthesia-gameplay/space';
  drawSpace(space, seconds, pulse, hue, hasBga);
  drawFloorGrid(space, seconds, pulse, hue);

  const panels = layerPool.acquireGraphics();
  panels.label = 'synesthesia-gameplay/panels';
  drawPlayfieldWell(panels, playfieldRight, runtime.progressRatio, accent);
  drawBgaFrame(panels, layer, hasBga, seconds, pulse, hue, layerPool);
  drawGauge(panels, layer, runtime, accent, layerPool);
  drawSongPlate(panels, layer, runtime, accent, layerPool);
  drawScorePanel(panels, layer, runtime, accent, layerPool);
  const tallyX = BGA.x + BGA.w + 22;
  if (playfieldRight + 14 <= tallyX) {
    drawJudgeTally(panels, layer, runtime, tallyX, layerPool);
  }

  const front = overlayLayerPool.acquireGraphics();
  front.label = 'synesthesia-gameplay/header';
  drawHeader(front, overlayLayer, runtime, accent, pulse, overlayLayerPool);
  drawJudgements(overlayLayer, runtime, playfieldRight, seconds, overlayLayerPool);
}

function resolvePlayfieldRight(runtime: Runtime): number {
  const lanes = resolveFallbackLaneLayout({
    channels: runtime.laneChannels,
    laneCount: runtime.laneCount,
    playVariant: runtime.playVariant,
    x: PLAYFIELD.x,
    w: PLAYFIELD.w,
    preserveSideWidth: shouldPreserveFallbackSideWidth(runtime.laneChannels, runtime.playVariant),
  });
  return Math.max(PLAYFIELD.x + PLAYFIELD.w, ...lanes.map((lane) => lane.x + lane.w));
}

function insideBga(x: number, y: number, margin = 0): boolean {
  return x > BGA.x - margin && x < BGA.x + BGA.w + margin && y > BGA.y - margin && y < BGA.y + BGA.h + margin;
}

/**
 * Deep-space ground (indigo at the top falling into void), a pair of soft nebulae, and 3D stars flying out of the
 * vanishing point. With a live BGA the ground leaves the BGA rect open and stars skip it.
 */
function drawSpace(graphics: Graphics, seconds: number, pulse: number, hue: number, hasBga: boolean): void {
  const bands: ReadonlyArray<readonly [number, number]> = [
    [SYN_DEEP, 120],
    [0x080620, 220],
    [0x05051a, 320],
    [0x030410, 400],
    [SYN_VOID, DESIGN_HEIGHT],
  ];
  let top = 0;
  for (const [color, bottom] of bands) {
    fillAroundBga(graphics, 0, top, DESIGN_WIDTH, bottom - top, color, hasBga);
    top = bottom;
  }
  // Nebulae: stacked translucent discs, placed clear of the BGA rect.
  for (const [x, y, radius, color] of [
    [150, 470, 150, SYN_MAGENTA],
    [600, 420, 120, hsvToHex(hue, 0.7, 1)],
  ] as const) {
    for (let ring = 3; ring >= 1; ring -= 1) {
      graphics.circle(x, y, (radius * ring) / 3).fill({ color, alpha: 0.025 + 0.012 * pulse });
    }
  }
  // Starfield streaming toward the camera from the horizon.
  const cx = 320;
  const cy = FLOOR.horizon - 90;
  for (let index = 0; index < 120; index += 1) {
    const point = starfieldPoint(index, seconds, { spread: 520, near: 20, far: 900, speed: 110 + 40 * pulse });
    const projected = projectPoint(point, cx, cy, 180);
    if (!projected.visible) continue;
    if (projected.x < 0 || projected.x > DESIGN_WIDTH || projected.y < 0 || projected.y > DESIGN_HEIGHT) continue;
    if (hasBga && insideBga(projected.x, projected.y, 4)) continue;
    const nearness = Math.min(1, projected.scale);
    const radius = 0.4 + 1.8 * nearness;
    const color = hsvToHex(hue + (index % 5) * 0.06, 0.35 + 0.3 * (index % 2), 1);
    graphics.circle(projected.x, projected.y, radius * 3).fill({ color, alpha: 0.06 * nearness });
    graphics.circle(projected.x, projected.y, radius).fill({ color: SYN_WHITE, alpha: 0.25 + 0.6 * nearness });
  }
}

/** Rez-style floor: radial lines into the horizon and cross lines scrolling toward the player on the beat. */
function drawFloorGrid(graphics: Graphics, seconds: number, pulse: number, hue: number): void {
  const { horizon, height, focal } = FLOOR;
  const color = hsvToHex(hue + 0.08, 0.7, 1);
  const project = (x: number, z: number) => projectPoint({ x, y: height, z }, 320, horizon, focal);
  for (let x = -1200; x <= 1200; x += 80) {
    const near = project(x, 0);
    const far = project(x, 2400);
    graphics.moveTo(near.x, near.y).lineTo(far.x, far.y).stroke({ color, width: 1, alpha: 0.16 });
  }
  const spacing = 90;
  const offset = (seconds * 150) % spacing;
  for (let z = spacing - offset; z < 2400; z += spacing) {
    const left = project(-1200, z);
    const right = project(1200, z);
    const nearness = 1 - z / 2400;
    graphics
      .moveTo(left.x, left.y)
      .lineTo(right.x, right.y)
      .stroke({ color, width: 1, alpha: (0.08 + 0.22 * nearness) * (0.7 + 0.3 * pulse) });
  }
  // Horizon glow.
  graphics.rect(0, horizon - 1, DESIGN_WIDTH, 2).fill({ color, alpha: 0.18 + 0.2 * pulse });
}

function fillAroundBga(
  graphics: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  hasBga: boolean,
): void {
  const right = x + w;
  const bottom = y + h;
  const holeRight = BGA.x + BGA.w;
  const holeBottom = BGA.y + BGA.h;
  if (!hasBga || right <= BGA.x || x >= holeRight || bottom <= BGA.y || y >= holeBottom) {
    graphics.rect(x, y, w, h).fill(color);
    return;
  }
  if (y < BGA.y) graphics.rect(x, y, w, BGA.y - y).fill(color);
  const bandTop = Math.max(y, BGA.y);
  const bandBottom = Math.min(bottom, holeBottom);
  if (x < BGA.x) graphics.rect(x, bandTop, BGA.x - x, bandBottom - bandTop).fill(color);
  if (right > holeRight) graphics.rect(holeRight, bandTop, right - holeRight, bandBottom - bandTop).fill(color);
  if (bottom > holeBottom) graphics.rect(x, holeBottom, w, bottom - holeBottom).fill(color);
}

function glassPanel(graphics: Graphics, x: number, y: number, w: number, h: number, rim: number): void {
  graphics.roundRect(x, y, w, h, 6).fill({ color: SYN_GLASS, alpha: 0.62 });
  graphics.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, 7).stroke({ color: rim, width: 3, alpha: 0.08 });
  graphics.roundRect(x, y, w, h, 6).stroke({ color: rim, width: 1, alpha: 0.45 });
  graphics.rect(x + 10, y, w - 20, 1).fill({ color: SYN_WHITE, alpha: 0.35 });
}

function drawPlayfieldWell(graphics: Graphics, right: number, progressRatio: number | undefined, accent: number): void {
  const left = PLAYFIELD.x - 4;
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
 * Monitor frame: a thin glowing rim with corner ticks. With no BGA the screen idles on a slowly tumbling wireframe
 * icosahedron wrapped in an orbiting ring of light — the "nothing is playing, but the space is alive" state.
 */
function drawBgaFrame(
  graphics: Graphics,
  layer: Container,
  hasBga: boolean,
  seconds: number,
  pulse: number,
  hue: number,
  pool: ChildPool,
): void {
  const color = hsvToHex(hue, 0.55, 1);
  const margin = 6;
  graphics
    .rect(BGA.x - margin, BGA.y - margin, BGA.w + margin * 2, BGA.h + margin * 2)
    .stroke({ color, width: 4, alpha: 0.07 });
  graphics
    .rect(BGA.x - margin, BGA.y - margin, BGA.w + margin * 2, BGA.h + margin * 2)
    .stroke({ color, width: 1, alpha: 0.5 });
  const tick = 16;
  for (const [x, y, dx, dy] of [
    [BGA.x - margin, BGA.y - margin, 1, 1],
    [BGA.x + BGA.w + margin, BGA.y - margin, -1, 1],
    [BGA.x - margin, BGA.y + BGA.h + margin, 1, -1],
    [BGA.x + BGA.w + margin, BGA.y + BGA.h + margin, -1, -1],
  ] as const) {
    graphics.rect(dx > 0 ? x : x - tick, y - (dy < 0 ? 2 : 0), tick, 2).fill({ color: SYN_WHITE, alpha: 0.9 });
    graphics.rect(x - (dx < 0 ? 2 : 0), dy > 0 ? y : y - tick, 2, tick).fill({ color: SYN_WHITE, alpha: 0.9 });
  }
  if (hasBga) return;

  graphics.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill({ color: SYN_VOID, alpha: 0.85 });
  const cx = BGA.x + BGA.w / 2;
  const cy = BGA.y + BGA.h / 2 - 8;
  const radius = 64 * (1 + 0.05 * pulse);
  const projected = ICOSAHEDRON.vertices.map((vertex) =>
    projectPoint(
      rotateX(
        rotateY({ x: vertex.x * radius, y: vertex.y * radius, z: vertex.z * radius }, seconds * 0.5),
        0.4 + seconds * 0.23,
      ),
      cx,
      cy,
      260,
    ),
  );
  for (const [a, b] of ICOSAHEDRON.edges) {
    const pa = projected[a]!;
    const pb = projected[b]!;
    const depth = (pa.scale + pb.scale) / 2;
    graphics
      .moveTo(pa.x, pa.y)
      .lineTo(pb.x, pb.y)
      .stroke({ color, width: 3, alpha: 0.08 * depth });
    graphics
      .moveTo(pa.x, pa.y)
      .lineTo(pb.x, pb.y)
      .stroke({ color: SYN_WHITE, width: 1, alpha: 0.35 + 0.4 * (depth - 0.8) });
  }
  for (const point of projected) {
    graphics.circle(point.x, point.y, 1.6 * point.scale).fill({ color: SYN_WHITE, alpha: 0.9 });
  }
  // Orbiting ring of light points, tilted so it reads in 3D.
  for (let index = 0; index < 48; index += 1) {
    const angle = (Math.PI * 2 * index) / 48 + seconds * 0.8;
    const point = projectPoint(
      rotateX({ x: Math.cos(angle) * 108, y: 0, z: Math.sin(angle) * 108 }, 0.42),
      cx,
      cy,
      260,
    );
    graphics.circle(point.x, point.y, 1.2 * point.scale).fill({
      color: hsvToHex(hue + index / 48 / 3, 0.6, 1),
      alpha: 0.35 + 0.5 * (point.scale - 0.7),
    });
  }
  addHudText(
    layer,
    'STANDBY',
    cx,
    BGA.y + BGA.h - 26,
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
  graphics.rect(0, 0, DESIGN_WIDTH, 34).fill({ color: SYN_VOID, alpha: 0.55 });
  graphics.rect(0, 34, DESIGN_WIDTH, 1).fill({ color: accent, alpha: 0.35 + 0.35 * pulse });
  graphics.circle(20, 17, 3).fill({ color: autoplay ? SYN_AMBER : accent, alpha: 1 });
  graphics.circle(20, 17, 8).fill({ color: autoplay ? SYN_AMBER : accent, alpha: 0.18 + 0.2 * pulse });
  addHudText(
    layer,
    autoplay ? 'AUTO PLAY' : 'PLAY',
    34,
    12,
    { ...displayStyle(10, SYN_WHITE), letterSpacing: 3 },
    pool,
  );
  addHudText(layer, 'BPM', 150, 14, labelStyle(), pool);
  addHudNumber(layer, formatBpm(runtime.bpm), 186, 9, displayStyle(14, SYN_WHITE), pool);
  addHudText(layer, 'SPEED', 236, 14, labelStyle(), pool);
  addHudNumber(layer, `x${formatHiSpeed(runtime.hiSpeed)}`, 296, 9, displayStyle(14, SYN_WHITE), pool);
  addHudText(
    layer,
    formatRuleset(runtime.rulesetLabel),
    506,
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
  glassPanel(graphics, GROOVE.x - 14, GROOVE.y - 26, GROOVE.w + 28, 48, accent);
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
    GROOVE.x + GROOVE.w + 4,
    GROOVE.y - 22,
    { ...displayStyle(12, cleared ? SYN_MAGENTA : SYN_WHITE), anchorX: 1 },
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
      .fill({ color: cleared ? SYN_MAGENTA : SYN_CYAN, alpha: 0.12 });
  }
  for (let cell = 0; cell < cells; cell += 1) {
    const x = GROOVE.x + cell * stride;
    if (cell >= lit) {
      graphics.rect(x, barY, stride - 1, barH).fill({ color: SYN_DIM, alpha: 0.18 });
      continue;
    }
    const hot = survival || cell >= clearCell;
    const color = hot ? hsvToHex(0.9 - (cell / cells) * 0.05, 0.65, 1) : hsvToHex(0.5 + (cell / cells) * 0.12, 0.6, 1);
    graphics
      .rect(x, barY, stride - 1, barH)
      .fill({ color: cell === lit - 1 ? SYN_WHITE : color, alpha: cell === lit - 1 ? flicker : 0.95 });
  }
  if (!survival) {
    const x = GROOVE.x + clearCell * stride - 1;
    graphics.rect(x, barY - 5, 1.5, barH + 10).fill({ color: SYN_AMBER, alpha: 1 });
  }
}

function drawSongPlate(graphics: Graphics, layer: Container, runtime: Runtime, accent: number, pool: ChildPool): void {
  const { x, y, w, h } = SONG_PLATE;
  glassPanel(graphics, x, y, w, h, accent);
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
  glassPanel(graphics, x, y, w, h, accent);
  graphics.rect(x + 146, y + 14, 1, h - 28).fill({ color: accent, alpha: 0.3 });
  addHudText(layer, 'SCORE', x + 14, y + 12, labelStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.score),
    x + 136,
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
    x + 136,
    y + 52,
    { ...displayStyle(8, SYN_MIST), anchorX: 1, maxWidth: 56 },
    pool,
  );
  addHudText(layer, 'EX RATE', x + 14, y + 76, labelStyle(), pool);
  addHudNumber(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    x + 136,
    y + 74,
    { ...displayStyle(8, SYN_MIST), anchorX: 1, maxWidth: 56 },
    pool,
  );
  // Rate meter as a light filament with the IIDX ninth ticks.
  const rate =
    runtime.exScore !== undefined && runtime.exScoreMax !== undefined && runtime.exScoreMax > 0
      ? Math.max(0, Math.min(1, runtime.exScore / runtime.exScoreMax))
      : 0;
  const meterX = x + 14;
  const meterW = 122;
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
  addHudText(layer, 'COMBO', x + 158, y + 12, labelStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.combo),
    x + w - 12,
    y + 24,
    { ...displayStyle(14, SYN_WHITE), anchorX: 1, maxWidth: 62 },
    pool,
  );
  addHudText(layer, 'MAX', x + 158, y + 54, labelStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.maxCombo),
    x + w - 12,
    y + 52,
    { ...displayStyle(9, SYN_MIST), anchorX: 1, maxWidth: 48 },
    pool,
  );
  const rank = runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F';
  addHudText(layer, 'RANK', x + 158, y + 76, labelStyle(), pool);
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
  const w = DESIGN_WIDTH - x - 6;
  glassPanel(graphics, x, y, w, 186, SYN_VIOLET);
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
      { ...displayStyle(10, SYN_WHITE), anchorX: 1, maxWidth: w - 36 },
      pool,
    );
  }
  const footerY = y + 14 + TALLY.length * 26 + 4;
  graphics.rect(x + 8, footerY - 6, w - 16, 1).fill({ color: SYN_VIOLET, alpha: 0.4 });
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
      { ...displayStyle(9, SYN_WHITE), anchorX: 1, maxWidth: w - 40 },
      pool,
    );
  }
}

const TALLY_NAMES = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', bad: 'BAD', poor: 'POOR' } as const;
const JUDGE_COLORS: Record<string, number> = {
  PERFECT: 0xc8fbff,
  GREAT: SYN_AMBER,
  GOOD: SYN_GREEN,
  BAD: SYN_VIOLET,
  POOR: SYN_RED,
};

/**
 * Judgement word and combo as light: wide tracked type with a same-colour bloom. PERFECT cycles through the hue wheel
 * like a prism so a clean run literally shimmers.
 */
function drawJudgements(
  layer: Container,
  runtime: Runtime,
  playfieldRight: number,
  seconds: number,
  pool: ChildPool,
): void {
  const displays = resolveJudgeDisplays(runtime, playfieldRight);
  for (const display of displays) {
    const color =
      display.judge === 'PERFECT'
        ? hsvToHex(seconds * 1.4 + display.x / 400, 0.35, 1)
        : (JUDGE_COLORS[display.judge] ?? SYN_WHITE);
    addHudText(
      layer,
      display.judge,
      display.x,
      236,
      {
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
          ...displayStyle(22, combo >= 200 ? SYN_AMBER : SYN_WHITE),
          anchorX: 0.5,
          anchorY: 0.5,
          maxWidth: Math.max(60, display.maxWidth - 40),
          dropShadow: { color: combo >= 200 ? SYN_AMBER : SYN_CYAN, alpha: 0.85, blur: 10, distance: 0 },
        },
        pool,
      );
    }
  }
}

function resolveJudgeDisplays(
  runtime: Runtime,
  playfieldRight: number,
): Array<{ judge: string; combo: number | undefined; x: number; maxWidth: number }> {
  const lanes = resolveFallbackLaneLayout({
    channels: runtime.laneChannels,
    laneCount: runtime.laneCount,
    playVariant: runtime.playVariant,
    x: PLAYFIELD.x,
    w: PLAYFIELD.w,
    preserveSideWidth: shouldPreserveFallbackSideWidth(runtime.laneChannels, runtime.playVariant),
  });
  const centerOf = (side: '1P' | '2P'): number | undefined => {
    const own = lanes.filter((lane) => lane.side === side);
    if (own.length === 0) return undefined;
    return (Math.min(...own.map((lane) => lane.x)) + Math.max(...own.map((lane) => lane.x + lane.w))) / 2;
  };
  const doublePlay = centerOf('2P') !== undefined;
  const maxWidth = doublePlay ? 122 : 180;
  const fallbackX = (PLAYFIELD.x + playfieldRight) / 2;
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
  return { size: 7, fill: SYN_DIM, fontFamily: SYN_DISPLAY_FONT, letterSpacing: 2 };
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
