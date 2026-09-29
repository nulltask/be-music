import { Container, Graphics } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../gameplay-constants.ts';
import {
  resolveFallbackLaneLayout,
  shouldPreserveFallbackSideWidth,
  type FallbackLaneLayoutRect,
} from '../gameplay-lanes.ts';
import type { SkinlessGameplayChromeRuntime } from '../gameplay-chrome.ts';
import { DEFAULT_DISPLAY_FONT, DEFAULT_HEADLINE_FONT } from './fonts.ts';
import {
  PHANTOM_ASH,
  PHANTOM_BLACK,
  PHANTOM_CHARCOAL,
  PHANTOM_CYAN,
  PHANTOM_GOLD,
  PHANTOM_INK,
  PHANTOM_ORANGE,
  PHANTOM_PAPER,
  PHANTOM_RED,
  PHANTOM_RED_DEEP,
  PHANTOM_RED_HOT,
  PHANTOM_SLATE,
  PHANTOM_WHITE,
  drawNoteEmblem,
  drawStaves,
  halftoneField,
  parallelogramPoints,
  starburstPoints,
} from './phantom-style.ts';
import type { ChildPool } from '../pixi-utils.ts';
import { audioDrive, bandLevel, type AudioDrive } from './audio-drive.ts';
import { drawPhantomMoments } from './phantom/moments.ts';
import { effectProfile, impulse, punchScale } from './moments.ts';
import { addHudNumber as addNumber, addHudText as addText, type HudTextOptions as TextOptions } from './hud-text.ts';

const DISPLAY_FONT = DEFAULT_DISPLAY_FONT;
/** Italic lean applied to every display-face text node — the whole HUD reads as moving forward. */
const TYPE_SKEW = -0.18;
const SCORE_PANEL = { x: 384, y: 352, w: 232, h: 108 } as const;
const SONG_PLATE = { x: 16, y: 420, w: 340, h: 44 } as const;
/** Red floor wedge behind the score panel. Its top edge stays below the BGA rect so a live video is never covered. */
const FLOOR_WEDGE: readonly number[] = [236, DESIGN_HEIGHT, DESIGN_WIDTH, 326, DESIGN_WIDTH, DESIGN_HEIGHT];

type PlaySide = '1P' | '2P';

/**
 * Live runtime values painted into the built-in gameplay chrome.
 */
export type FallbackGameplayRuntime = SkinlessGameplayChromeRuntime;

export interface FallbackGameplayRenderOptions {
  /**
   * Optional front layer for judgement/combo text. The no-skin gameplay scene passes its overlay layer so those texts
   * stay above the live lane-background layer.
   */
  overlayLayer?: Container;
  layerPool?: ChildPool;
  overlayLayerPool?: ChildPool;
}

interface FallbackPlayfieldLayout {
  lanes: FallbackLaneLayoutRect[];
  x: number;
  w: number;
  centerX: number;
  right: number;
  sideCenters: Partial<Record<PlaySide, number>>;
  sideGap?: { x: number; w: number };
}

/**
 * Built-in gameplay chrome for the default skin family, drawn in the "Phantom" poster style (see `phantom-style.ts`):
 * ink-black ground, blood-red slabs and a halftone floor wedge, slanted paper plates, and condensed italic type. It is
 * intentionally not an LR2 atlas facsimile: this path is the skinless experience, so it keeps only the information a
 * player can act on while playing.
 */
export function renderDefaultGameplayFrame(
  layer: Container,
  runtime: FallbackGameplayRuntime = {},
  options: FallbackGameplayRenderOptions = {},
): void {
  const layerPool = options.layerPool;
  const frame = layerPool?.acquireGraphics() ?? new Graphics();
  const hasBga = runtime.hasBga === true;
  const playfield = resolveFallbackPlayfieldLayout(runtime.laneChannels, runtime.laneCount, runtime.playVariant);
  frame.label = 'default-gameplay/chrome';
  // The poster moves with the music: halftone swells on the bass, the idle burst kicks on onsets, a spectrum strip.
  const drive = audioDrive(runtime.audio, runtime.effects);
  drawBackground(frame, hasBga, drive);

  const effects = effectProfile(runtime.effects);
  drawPlayfield(
    frame,
    playfield,
    runtime.progressRatio,
    impulse(runtime.impulseAtMs, runtime.nowMs ?? 0, 140) * effects.amount,
  );
  // A double-play field reaches into the monitor's column; the frame and its idle screen would sit on the 2P lanes.
  if (playfield.right + 24 <= BGA.x) {
    drawBgaFrame(frame, layer, hasBga, runtime.nowMs, drive, layerPool);
    drawSpectrumStrip(frame, drive);
  }
  drawGauge(frame, layer, runtime, layerPool);
  drawSongPlate(frame, layer, runtime, layerPool);
  drawScorePlate(frame, layer, runtime, drive, layerPool);
  const tallyX = resolveJudgeTallyX(playfield);
  if (tallyX !== undefined) {
    drawJudgeTally(frame, layer, runtime, tallyX, layerPool);
  }
  if (!layerPool) {
    layer.addChildAt(frame, 0);
  }

  const frontLayer = options.overlayLayer && options.overlayLayerPool ? options.overlayLayer : layer;
  const frontPool = frontLayer === layer ? layerPool : options.overlayLayerPool;
  const front = frontPool?.acquireGraphics() ?? new Graphics();
  front.label = 'default-gameplay/status';
  if (!frontPool) {
    frontLayer.addChild(front);
  }
  drawStatusBar(front, frontLayer, runtime, frontPool);
  // Showpieces (count-in, combo milestones, clear line, full combo) sit above the HUD. They draw before the judgements
  // because a screen-wide full combo covers the page and the judgement type would print through its strip.
  const covered = drawPhantomMoments(layer, frontLayer, runtime, frontPool);
  if (!covered) drawJudgements(frontLayer, runtime, playfield, frontPool, effects.amount);
}

/**
 * Compatibility alias for older callers. New code should use {@link renderDefaultGameplayFrame}.
 *
 * The explicit `typeof` annotation keeps `--isolatedDeclarations` happy — without it the d.ts generator
 * (`rolldown-plugin-dts`) can't infer the exported binding's type from the right-hand expression, which fails
 * the build with `TS9010: Variable must have an explicit type annotation`.
 */
export const renderFallbackLr2Frame: typeof renderDefaultGameplayFrame = renderDefaultGameplayFrame;

/**
 * Ink ground and the halftone floor wedge. The playfield itself stays undecorated so notes read cleanly. With a live BGA the ground leaves a
 * hole over the BGA rect — the BGA layer renders BEHIND this chrome layer, so anything painted there would cover the
 * video. Every decoration is placed so it never crosses that rect.
 */
function drawBackground(frame: Graphics, hasBga: boolean, drive: AudioDrive): void {
  fillRectAroundHole(frame, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, PHANTOM_BLACK, hasBga);
  // Faint diagonal pinstripes over the lower-left quadrant — gives the ink ground a printed texture.
  for (let stripe = 0; stripe < 9; stripe += 1) {
    const x0 = -120 + stripe * 44;
    frame.poly([x0, DESIGN_HEIGHT, x0 + 14, DESIGN_HEIGHT, x0 + 134, 352, x0 + 120, 352]).fill({
      color: PHANTOM_CHARCOAL,
      alpha: 0.7,
    });
  }

  // Floor wedge: deep red base, hot red face, ink halftone swelling toward the lower-right corner.
  frame
    .poly([FLOOR_WEDGE[0]! - 18, DESIGN_HEIGHT, DESIGN_WIDTH, 316, DESIGN_WIDTH, DESIGN_HEIGHT])
    .fill(PHANTOM_RED_DEEP);
  frame.poly([...FLOOR_WEDGE]).fill(PHANTOM_RED);
  for (const dot of halftoneField({
    x: 300,
    y: 340,
    w: DESIGN_WIDTH - 300,
    h: DESIGN_HEIGHT - 340,
    pitch: 9,
    maxRadius: 4.2 * (1 + 0.45 * drive.bass),
    direction: { x: 1, y: 1 },
  })) {
    if (isInsideFloorWedge(dot.x, dot.y)) {
      frame.circle(dot.x, dot.y, dot.r).fill({ color: PHANTOM_INK, alpha: 0.55 });
    }
  }
  // Sheet music on the floor: two ink staves ruled across the wedge, following its slanted top edge.
  const wedgeLeftAt = (lineY: number): number =>
    FLOOR_WEDGE[0]! +
    ((DESIGN_HEIGHT - lineY) * (DESIGN_WIDTH - FLOOR_WEDGE[0]!)) / (DESIGN_HEIGHT - FLOOR_WEDGE[3]!) +
    6;
  drawStaves(frame, 0, DESIGN_WIDTH, 404, 5, PHANTOM_INK, 0.55, wedgeLeftAt);
  drawStaves(frame, 0, DESIGN_WIDTH, 446, 5, PHANTOM_INK, 0.55, wedgeLeftAt);
  // Paper-white cut line tracing the wedge's leading edge.
  frame
    .poly([FLOOR_WEDGE[0]! + 26, DESIGN_HEIGHT, DESIGN_WIDTH, 334, DESIGN_WIDTH, 337, FLOOR_WEDGE[0]! + 32, 480])
    .fill({ color: PHANTOM_WHITE, alpha: 0.9 });
}

function isInsideFloorWedge(x: number, y: number): boolean {
  const [ax, ay, bx, by] = FLOOR_WEDGE as readonly [number, number, number, number, number, number];
  // Above-line test against the wedge's top edge (A → B); the other two edges are the canvas borders.
  return (bx - ax) * (y - ay) - (by - ay) * (x - ax) > 0 && x <= DESIGN_WIDTH && y <= DESIGN_HEIGHT;
}

/** Fills `rect` minus the BGA rect (when `hasBga`) as up to four axis-aligned pieces. */
function fillRectAroundHole(
  frame: Graphics,
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
    frame.rect(x, y, w, h).fill(color);
    return;
  }
  if (y < BGA.y) frame.rect(x, y, w, BGA.y - y).fill(color);
  const bandTop = Math.max(y, BGA.y);
  const bandBottom = Math.min(bottom, holeBottom);
  if (x < BGA.x) frame.rect(x, bandTop, BGA.x - x, bandBottom - bandTop).fill(color);
  if (right > holeRight) frame.rect(holeRight, bandTop, right - holeRight, bandBottom - bandTop).fill(color);
  if (bottom > holeBottom) frame.rect(x, holeBottom, w, bottom - holeBottom).fill(color);
}

function resolveFallbackPlayfieldLayout(
  laneChannels: readonly string[] | undefined,
  laneCount: number | undefined,
  playVariant: ChartPlayVariant | undefined,
): FallbackPlayfieldLayout {
  const lanes = resolveFallbackLaneLayout({
    channels: laneChannels,
    laneCount,
    playVariant,
    x: PLAYFIELD.x,
    w: PLAYFIELD.w,
    preserveSideWidth: shouldPreserveFallbackSideWidth(laneChannels, playVariant),
  });
  const right = Math.max(PLAYFIELD.x + PLAYFIELD.w, ...lanes.map((lane) => lane.x + lane.w));
  const w = Math.max(1, right - PLAYFIELD.x);
  const sideBounds = resolveSideBounds(lanes);
  const sideCenters: Partial<Record<PlaySide, number>> = {};
  if (sideBounds['1P']) {
    sideCenters['1P'] = (sideBounds['1P'].left + sideBounds['1P'].right) / 2;
  }
  if (sideBounds['2P']) {
    sideCenters['2P'] = (sideBounds['2P'].left + sideBounds['2P'].right) / 2;
  }
  return {
    lanes,
    x: PLAYFIELD.x,
    w,
    centerX: PLAYFIELD.x + w / 2,
    right,
    sideCenters,
    sideGap:
      sideBounds['1P'] && sideBounds['2P'] && sideBounds['2P'].left > sideBounds['1P'].right
        ? { x: sideBounds['1P'].right, w: sideBounds['2P'].left - sideBounds['1P'].right }
        : undefined,
  };
}

function resolveSideBounds(
  lanes: readonly FallbackLaneLayoutRect[],
): Partial<Record<PlaySide, { left: number; right: number }>> {
  const bounds: Partial<Record<PlaySide, { left: number; right: number }>> = {};
  for (const lane of lanes) {
    const side = lane.side;
    const current = bounds[side];
    const right = lane.x + lane.w;
    bounds[side] = current
      ? { left: Math.min(current.left, lane.x), right: Math.max(current.right, right) }
      : { left: lane.x, right };
  }
  return bounds;
}

/** Bottom edge of the playfield frame — leaves room for the key-cap strip renderLanes paints below the judge line. */
const PLAYFIELD_FRAME_BOTTOM = 344;

function drawPlayfield(
  frame: Graphics,
  playfield: FallbackPlayfieldLayout,
  progressRatio: number | undefined,
  hit: number,
): void {
  const wellTop = PLAYFIELD.y;
  const wellBottom = PLAYFIELD_FRAME_BOTTOM;
  const wellHeight = wellBottom - wellTop;
  const railW = 8;
  const leftRailX = playfield.x - railW - 2;
  const rightRailX = playfield.right + 2;

  // Lane well — pure ink with a soft top fade where notes emerge.
  frame.rect(playfield.x - 2, wellTop, playfield.w + 4, wellHeight).fill(0x050506);
  frame.rect(playfield.x - 2, wellTop, playfield.w + 4, 70).fill({ color: PHANTOM_INK, alpha: 0.6 });

  // DP side gap — a dead column between the 1P / 2P halves.
  if (playfield.sideGap) {
    frame.rect(playfield.sideGap.x, wellTop, playfield.sideGap.w, wellHeight).fill(PHANTOM_BLACK);
  }

  // Rails: red body, paper-white piping on both faces, ink seat against the well.
  for (const railX of [leftRailX, rightRailX]) {
    frame.rect(railX, wellTop, railW, wellHeight).fill(PHANTOM_RED);
    frame.rect(railX, wellTop, 1, wellHeight).fill(PHANTOM_WHITE);
    frame.rect(railX + railW - 1, wellTop, 1, wellHeight).fill(PHANTOM_WHITE);
    // Every press flashes the rails white, bottom-heavy, so the cabinet answers the player's hands.
    if (hit > 0) {
      frame.rect(railX, wellHeight * 0.45, railW, wellHeight * 0.55).fill({ color: PHANTOM_WHITE, alpha: 0.75 * hit });
    }
  }

  // Song-progress track inside the left rail, filling bottom-up in paper white.
  const trackX = leftRailX + 2;
  const trackTop = wellTop + 6;
  const trackHeight = wellBottom - 12 - trackTop;
  frame.rect(trackX, trackTop, railW - 4, trackHeight).fill({ color: PHANTOM_INK, alpha: 0.7 });
  const ratio =
    progressRatio !== undefined && Number.isFinite(progressRatio) ? Math.max(0, Math.min(1, progressRatio)) : 0;
  if (ratio > 0) {
    const fillHeight = Math.max(2, Math.round(trackHeight * ratio));
    frame.rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, fillHeight).fill(PHANTOM_PAPER);
  }

  // Footer — a slanted paper strip closing the well under the key caps, with a red kicker below.
  const footerW = rightRailX + railW - leftRailX;
  frame.poly(parallelogramPoints(leftRailX, wellBottom, footerW, 5, 0)).fill(PHANTOM_WHITE);
  frame.poly(parallelogramPoints(leftRailX + 6, wellBottom + 5, footerW - 12, 4, -6)).fill(PHANTOM_RED);
}

/** X where the judge tally column can sit, or undefined when the (DP-wide) playfield covers it. */
function resolveJudgeTallyX(playfield: FallbackPlayfieldLayout): number | undefined {
  const x = BGA.x + BGA.w + 22;
  return playfield.right + 14 <= x && x + 60 <= DESIGN_WIDTH ? x : undefined;
}

/**
 * Monitor frame: a red offset parallelogram and a paper-white one, both wide enough to enclose the BGA rect so their
 * strokes never cross the video. With no BGA the screen idles on a red halftone field with a "STAND BY" slug.
 */
function drawBgaFrame(
  frame: Graphics,
  layer: Container,
  hasBga: boolean,
  nowMs: number | undefined,
  drive: AudioDrive,
  pool: ChildPool | undefined,
): void {
  const slant = 6;
  const margin = 6;
  const frameX = BGA.x - margin - slant;
  const frameW = BGA.w + margin * 2 + slant;
  frame.poly(parallelogramPoints(frameX + 4, BGA.y - margin + 4, frameW, BGA.h + margin * 2, slant)).stroke({
    color: PHANTOM_RED,
    width: 4,
    join: 'miter',
  });
  frame.poly(parallelogramPoints(frameX, BGA.y - margin, frameW, BGA.h + margin * 2, slant)).stroke({
    color: PHANTOM_WHITE,
    width: 3,
    join: 'miter',
  });
  if (hasBga) return;

  frame.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill(PHANTOM_INK);
  for (const dot of halftoneField({
    x: BGA.x + 4,
    y: BGA.y + 4,
    w: BGA.w - 8,
    h: BGA.h - 8,
    pitch: 12,
    maxRadius: 5 * (1 + 0.5 * drive.level),
    direction: { x: -0.6, y: 1 },
  })) {
    frame.circle(dot.x, dot.y, dot.r).fill({ color: PHANTOM_RED, alpha: 0.75 });
  }
  // Slow-turning starburst behind the slug — the idle screen is alive, not a hole in the cabinet.
  // It pumps on the bass and jolts a notch round on every onset.
  const spin = (nowMs !== undefined ? nowMs / 6000 : 0) + 0.1 * drive.onset;
  const pump = 1 + 0.2 * drive.bass + 0.1 * drive.onset;
  const cx = BGA.x + BGA.w / 2;
  const cy = BGA.y + BGA.h / 2;
  frame
    .poly(starburstPoints(cx, cy, 92 * pump, 58 * pump, 14, spin, 0.18, 3))
    .fill({ color: PHANTOM_RED, alpha: 0.95 });
  frame.poly(starburstPoints(cx, cy, 70 * pump, 46 * pump, 14, spin + 0.12, 0.2, 5)).fill(PHANTOM_INK);
  frame.poly(parallelogramPoints(cx - 70, cy - 15, 132, 30, 8)).fill(PHANTOM_WHITE);
  addText(
    layer,
    'STAND BY',
    cx + 4,
    cy,
    { size: 22, fill: PHANTOM_INK, fontFamily: DISPLAY_FONT, anchorX: 0.5, anchorY: 0.5, skewX: TYPE_SKEW },
    pool,
  );
}

/**
 * Spectrum strip under the monitor: 16 slanted red bars rising off an ink rule, white-capped, hot bands turning gold —
 * the poster's equalizer. Silent (or effects off) leaves just the rule.
 */
function drawSpectrumStrip(frame: Graphics, drive: AudioDrive): void {
  const baseY = 348;
  const maxH = 22;
  const count = 16;
  const pitch = BGA.w / count;
  frame.rect(BGA.x - 6, baseY, BGA.w + 12, 2).fill(PHANTOM_WHITE);
  for (let bar = 0; bar < count; bar += 1) {
    const value = bandLevel(drive.bands, bar, count);
    const h = Math.round(maxH * value);
    if (h < 2) continue;
    const x = BGA.x + bar * pitch + 1;
    const w = pitch - 5;
    frame.poly(parallelogramPoints(x, baseY - h, w, h, 4)).fill(value > 0.82 ? PHANTOM_GOLD : PHANTOM_RED);
    // A 3 px paper cap riding the bar's slanted top.
    frame.poly(parallelogramPoints(x + 4 * (1 - 3 / h), baseY - h, w, 3, (4 * 3) / h)).fill(PHANTOM_WHITE);
  }
}

/**
 * Header strip: ink bar, a red jagged kicker that swells on every beat, the paper mode tag, BPM / HI-SPEED readouts,
 * and the red ruleset tag.
 */
function drawStatusBar(
  status: Graphics,
  layer: Container,
  runtime: FallbackGameplayRuntime,
  pool: ChildPool | undefined,
): void {
  const autoplay = runtime.autoplay === true;
  status.rect(0, 0, DESIGN_WIDTH, 38).fill(PHANTOM_INK);
  // Beat-driven kicker: a sawtooth red edge whose teeth lengthen on the downbeat and decay into the bar.
  const pulse = runtime.beatPhase !== undefined ? 1 - runtime.beatPhase : 0.5;
  const teeth: number[] = [0, 38];
  for (let x = 0; x <= DESIGN_WIDTH; x += 20) {
    teeth.push(x, 38, x + 10, 41 + 5 * pulse);
  }
  teeth.push(DESIGN_WIDTH, 38);
  status.poly(teeth).fill(PHANTOM_RED);
  status.rect(0, 37, DESIGN_WIDTH, 1).fill(PHANTOM_WHITE);

  // Mode tag — paper plate with a red shadow; AUTO PLAY flips it to a red plate so a demo run is unmistakable.
  status.poly(parallelogramPoints(15, 11, 96, 22, 9)).fill(autoplay ? PHANTOM_WHITE : PHANTOM_RED);
  status.poly(parallelogramPoints(11, 7, 96, 22, 9)).fill(autoplay ? PHANTOM_RED : PHANTOM_WHITE);
  addText(
    layer,
    autoplay ? 'AUTO PLAY' : 'PLAY',
    63,
    18,
    {
      size: 15,
      fill: autoplay ? PHANTOM_WHITE : PHANTOM_INK,
      fontFamily: DISPLAY_FONT,
      letterSpacing: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      skewX: TYPE_SKEW,
    },
    pool,
  );

  addText(layer, 'BPM', 132, 14, tagLabelStyle(PHANTOM_RED), pool);
  addNumber(layer, formatBpmValue(runtime.bpm), 156, 5, displayStyle(22, PHANTOM_WHITE), pool);
  addText(layer, 'HI-SPEED', 214, 14, tagLabelStyle(PHANTOM_RED), pool);
  addNumber(layer, `x${formatHiSpeed(runtime.hiSpeed)}`, 262, 5, displayStyle(22, PHANTOM_WHITE), pool);

  // The skin's mark, between the tempo readouts and the ruleset tag.
  drawNoteEmblem(status, 350, 25, 22, PHANTOM_WHITE, PHANTOM_RED);
  status.poly(parallelogramPoints(392, 8, 118, 22, -8)).fill(PHANTOM_RED);
  status.rect(397, 13, 3, 12).fill(PHANTOM_WHITE);
  addText(layer, 'RULESET', 410, 15, tagLabelStyle(PHANTOM_INK), pool);
  addText(
    layer,
    formatRulesetLabel(runtime.rulesetLabel),
    500,
    19,
    { ...displayStyle(16, PHANTOM_WHITE), anchorX: 1, anchorY: 0.5, maxWidth: 56 },
    pool,
  );
}

/**
 * Segmented gauge housed in a slanted ink plate. 50 slanted cells of 2 % each: paper white below the clear line, red
 * at/above it, with a flickering tip. Survival gauges (clear threshold 0) run all-red and drop the clear notch.
 */
function drawGauge(
  frame: Graphics,
  layer: Container,
  runtime: FallbackGameplayRuntime,
  pool: ChildPool | undefined,
): void {
  const gauge = clampPercent(runtime.gauge ?? 0);
  const clear = clampPercent(runtime.clearThreshold ?? 80);
  const survival = runtime.gaugeSurvival === true || clear <= 0;
  const cleared = survival ? gauge > 0 : gauge >= clear;
  const cellCount = 50;
  const cellStride = GROOVE.w / cellCount;
  const cellW = cellStride - 1;
  const litCells = Math.round((gauge / 100) * cellCount);
  const clearCell = Math.round((clear / 100) * cellCount);

  frame
    .poly(parallelogramPoints(GROOVE.x - 16, GROOVE.y - 22, GROOVE.w + 30, 46, 8))
    .fill(PHANTOM_INK)
    .stroke({
      color: PHANTOM_WHITE,
      width: 2,
      join: 'miter',
    });
  // Gauge-type tag knifed into the housing's top-left corner.
  frame
    .poly(parallelogramPoints(GROOVE.x - 20, GROOVE.y - 30, 106, 16, 6))
    .fill(survival ? PHANTOM_WHITE : PHANTOM_RED);
  addText(
    layer,
    `${(runtime.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`,
    GROOVE.x - 10,
    GROOVE.y - 22,
    { ...tagLabelStyle(survival ? PHANTOM_RED : PHANTOM_WHITE), anchorY: 0.5, maxWidth: 92 },
    pool,
  );
  addNumber(
    layer,
    `${Math.round(gauge)}%`,
    GROOVE.x + GROOVE.w + 8,
    GROOVE.y - 16,
    { ...displayStyle(18, cleared ? PHANTOM_RED_HOT : PHANTOM_PAPER), anchorX: 1 },
    pool,
  );

  const flicker = runtime.nowMs !== undefined ? 0.6 + 0.4 * Math.abs(Math.sin(runtime.nowMs / 70)) : 1;
  for (let cell = 0; cell < cellCount; cell += 1) {
    const cellX = GROOVE.x + cell * cellStride;
    const points = parallelogramPoints(cellX, GROOVE.y, cellW, GROOVE.h, 3);
    if (cell >= litCells) {
      frame.poly(points).fill(PHANTOM_SLATE);
      continue;
    }
    const hot = survival || cell >= clearCell;
    const isTip = cell === litCells - 1;
    frame
      .poly(points)
      .fill({ color: isTip ? PHANTOM_GOLD : hot ? PHANTOM_RED_HOT : PHANTOM_PAPER, alpha: isTip ? flicker : 1 });
  }
  if (!survival) {
    const clearX = GROOVE.x + Math.round(clearCell * cellStride) - 1;
    frame.rect(clearX, GROOVE.y - 4, 2, GROOVE.h + 8).fill(PHANTOM_GOLD);
    frame.poly([clearX - 4, GROOVE.y - 8, clearX + 6, GROOVE.y - 8, clearX + 1, GROOVE.y - 3]).fill(PHANTOM_GOLD);
  }
}

/** The track card: a paper plate on a red shadow, black title, red artist line. */
function drawSongPlate(
  frame: Graphics,
  layer: Container,
  runtime: FallbackGameplayRuntime,
  pool: ChildPool | undefined,
): void {
  const { x, y, w, h } = SONG_PLATE;
  frame.poly(parallelogramPoints(x + 7, y + 5, w, h, 12)).fill(PHANTOM_RED);
  frame
    .poly(parallelogramPoints(x, y, w, h, 12))
    .fill(PHANTOM_PAPER)
    .stroke({ color: PHANTOM_INK, width: 2 });
  frame.poly(parallelogramPoints(x + 6, y + 6, 5, h - 12, 5)).fill(PHANTOM_RED);
  addText(
    layer,
    runtime.songTitle?.trim() || 'Untitled chart',
    x + 22,
    y + 5,
    { size: 16, fill: PHANTOM_INK, fontFamily: DEFAULT_HEADLINE_FONT, maxWidth: w - 30 },
    pool,
  );
  const artist = runtime.songArtist?.trim();
  if (artist) {
    addText(layer, artist, x + 20, y + 27, { size: 10, weight: '800', fill: PHANTOM_RED, maxWidth: w - 30 }, pool);
  }
}

function drawScorePlate(
  frame: Graphics,
  layer: Container,
  runtime: FallbackGameplayRuntime,
  drive: AudioDrive,
  pool: ChildPool | undefined,
): void {
  const { x, y, w, h } = SCORE_PANEL;
  frame.poly(parallelogramPoints(x + 6, y + 6, w, h, -10)).fill(PHANTOM_INK);
  frame
    .poly(parallelogramPoints(x, y, w, h, -10))
    .fill(PHANTOM_BLACK)
    .stroke({ color: PHANTOM_WHITE, width: 2 });
  frame.rect(x + 14, y + 40, 116, 1).fill({ color: PHANTOM_SLATE });
  frame.rect(x + 14, y + 70, 116, 1).fill({ color: PHANTOM_SLATE });
  frame.poly([x + 146, y + 10, x + 148, y + 10, x + 150, y + h - 10, x + 148, y + h - 10]).fill(PHANTOM_RED);

  addText(layer, 'SCORE', x + 14, y + 12, tagLabelStyle(PHANTOM_RED), pool);
  addNumber(
    layer,
    formatCount(runtime.score),
    x + 134,
    y + 2,
    { ...displayStyle(26, PHANTOM_WHITE), anchorX: 1, maxWidth: 80 },
    pool,
  );
  addText(layer, 'EX SCORE', x + 14, y + 49, tagLabelStyle(PHANTOM_ASH), pool);
  addNumber(
    layer,
    `${formatCount(runtime.exScore)} / ${formatCount(runtime.exScoreMax)}`,
    x + 134,
    y + 44,
    { ...displayStyle(14, PHANTOM_PAPER), anchorX: 1, maxWidth: 66 },
    pool,
  );
  addText(layer, 'EX RATE', x + 14, y + 78, tagLabelStyle(PHANTOM_ASH), pool);
  addNumber(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    x + 134,
    y + 73,
    { ...displayStyle(14, PHANTOM_PAPER), anchorX: 1, maxWidth: 74 },
    pool,
  );

  // DJ-level meter under EX RATE: slanted segments, one per IIDX ninth, so the distance to the next letter is legible.
  const rate =
    runtime.exScore !== undefined && runtime.exScoreMax !== undefined && runtime.exScoreMax > 0
      ? Math.max(0, Math.min(1, runtime.exScore / runtime.exScoreMax))
      : 0;
  const segments = 9;
  const segmentW = 116 / segments;
  for (let segment = 0; segment < segments; segment += 1) {
    const fill = Math.max(0, Math.min(1, rate * segments - segment));
    const sx = x + 14 + segment * segmentW;
    frame.poly(parallelogramPoints(sx, y + 96, segmentW - 2, 5, 2)).fill(PHANTOM_SLATE);
    if (fill > 0) {
      frame
        .poly(parallelogramPoints(sx, y + 96, (segmentW - 2) * fill, 5, 2))
        .fill(segment >= 7 ? PHANTOM_GOLD : PHANTOM_RED_HOT);
    }
  }

  // Right column: COMBO headline on its own row, MAX inline beneath, rank badge in the lower corner.
  addText(layer, 'COMBO', x + 160, y + 10, tagLabelStyle(PHANTOM_RED), pool);
  addNumber(
    layer,
    formatCount(runtime.combo),
    x + w - 12,
    y + 20,
    { ...displayStyle(22, PHANTOM_WHITE), anchorX: 1, maxWidth: 60 },
    pool,
  );
  addText(layer, 'MAX', x + 160, y + 55, tagLabelStyle(PHANTOM_ASH), pool);
  addNumber(
    layer,
    formatCount(runtime.maxCombo),
    x + w - 10,
    y + 51,
    { ...displayStyle(13, PHANTOM_PAPER), anchorX: 1, maxWidth: 40 },
    pool,
  );

  // Rank badge: the letter sits on a jagged red burst — the calling card of the run.
  const rank = runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F';
  const topRank = rank === 'AAA' || rank === 'AA';
  // Anchored on the plate's lower-right corner and allowed to break out of the frame, so it never crowds COMBO / MAX.
  const badgeX = x + w - 10;
  const badgeY = y + h - 14;
  // The badge pumps with the bass.
  const pump = 1 + 0.16 * drive.bass;
  const badge = starburstPoints(badgeX, badgeY, 27 * pump, 17 * pump, 12, -0.2, 0.22, rank.length);
  frame
    .poly(badge)
    .fill(topRank ? PHANTOM_GOLD : PHANTOM_RED)
    .stroke({ color: PHANTOM_WHITE, width: 1.5 });
  addText(layer, 'RANK', x + 160, y + 84, tagLabelStyle(PHANTOM_ASH), pool);
  addText(
    layer,
    rank,
    badgeX + 1,
    badgeY + 1,
    {
      ...displayStyle(rank.length >= 3 ? 18 : 28, topRank ? PHANTOM_INK : PHANTOM_WHITE),
      anchorX: 0.5,
      anchorY: 0.5,
      maxWidth: 42,
    },
    pool,
  );
}

const JUDGE_TALLY_ROWS: ReadonlyArray<readonly [label: string, key: 'perfect' | 'great' | 'good' | 'bad' | 'poor']> = [
  ['PG', 'perfect'],
  ['GR', 'great'],
  ['GD', 'good'],
  ['BD', 'bad'],
  ['PR', 'poor'],
];

/**
 * Live judge tally beside the BGA monitor. Labels are ransom-note chips — alternating paper-on-ink and ink-on-paper,
 * each knocked to a slightly different angle — with the counts in the condensed display face.
 */
function drawJudgeTally(
  frame: Graphics,
  layer: Container,
  runtime: FallbackGameplayRuntime,
  x: number,
  pool?: ChildPool,
): void {
  const y = BGA.y - 12;
  const w = DESIGN_WIDTH - x - 6;
  const rowH = 24;
  const h = 22 + JUDGE_TALLY_ROWS.length * rowH + 46;
  frame.rect(x, y, w, h).fill(PHANTOM_INK).stroke({ color: PHANTOM_WHITE, width: 1 });
  frame.poly(parallelogramPoints(x - 4, y - 6, 52, 17, 6)).fill(PHANTOM_RED);
  addText(layer, 'JUDGE', x + 22, y + 2, { ...displayStyle(12, PHANTOM_WHITE), anchorX: 0.5, anchorY: 0.5 }, pool);
  for (let row = 0; row < JUDGE_TALLY_ROWS.length; row += 1) {
    const [label, key] = JUDGE_TALLY_ROWS[row]!;
    const rowY = y + 20 + row * rowH;
    const inverted = row % 2 === 1;
    const chipSlant = inverted ? -4 : 4;
    frame.poly(parallelogramPoints(x + 5, rowY + 3, 20, 14, chipSlant)).fill(inverted ? PHANTOM_WHITE : PHANTOM_RED);
    addText(
      layer,
      label,
      x + 17,
      rowY + 10,
      {
        size: 10,
        fill: inverted ? PHANTOM_INK : PHANTOM_WHITE,
        fontFamily: DISPLAY_FONT,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: inverted ? 0.06 : -0.06,
      },
      pool,
    );
    addNumber(
      layer,
      formatCount(runtime[key]),
      x + w - 6,
      rowY + 1,
      { ...displayStyle(15, judgeStyle(TALLY_JUDGE_NAMES[key]).tally), anchorX: 1, maxWidth: w - 34 },
      pool,
    );
  }
  // FAST / SLOW footer — early presses read cyan, late ones orange (the one place the HUD leaves the three inks).
  const footerY = y + 20 + JUDGE_TALLY_ROWS.length * rowH + 4;
  frame.rect(x + 5, footerY - 4, w - 10, 1).fill(PHANTOM_RED);
  const footerRows: ReadonlyArray<readonly [label: string, color: number, count: number | undefined]> = [
    ['FAST', PHANTOM_CYAN, runtime.fast],
    ['SLOW', PHANTOM_ORANGE, runtime.slow],
  ];
  for (let row = 0; row < footerRows.length; row += 1) {
    const [label, color, count] = footerRows[row]!;
    const rowY = footerY + 2 + row * 20;
    addText(layer, label, x + 7, rowY + 3, tagLabelStyle(color), pool);
    addNumber(
      layer,
      formatCount(count),
      x + w - 6,
      rowY,
      { ...displayStyle(13, PHANTOM_PAPER), anchorX: 1, maxWidth: w - 40 },
      pool,
    );
  }
}

const TALLY_JUDGE_NAMES = {
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  bad: 'BAD',
  poor: 'POOR',
} as const;

interface ResolvedJudgeDisplay {
  judge: string;
  combo: number | undefined;
  x: number;
  maxWidth: number;
}

/**
 * Judgement word + combo over the lanes. Kept to type only — a leaning headline with a hard offset shadow and plain
 * numerals (gold once the run passes 200) — so nothing opaque sits on top of incoming notes.
 */
function drawJudgements(
  layer: Container,
  runtime: FallbackGameplayRuntime,
  playfield: FallbackPlayfieldLayout,
  pool: ChildPool | undefined,
  amount: number,
): void {
  const nowMs = runtime.nowMs ?? 0;
  for (const display of resolveJudgeDisplays(runtime, playfield)) {
    const combo = resolveVisibleCombo(display.judge, display.combo);
    const style = judgeStyle(display.judge);
    // Punch: every judgement lands with a quick overshoot; misses also rattle sideways.
    const judgeScale = punchScale(runtime.judgeAtMs, nowMs, 120, 0.24 * amount);
    const miss = display.judge === 'POOR' || display.judge === 'BAD';
    const rattle = miss ? Math.sin(nowMs / 14) * 4 * impulse(runtime.judgeAtMs, nowMs, 220) * amount : 0;
    addText(
      layer,
      display.judge,
      display.x + rattle,
      238,
      {
        scale: judgeScale,
        size: 30,
        fill: style.fill,
        fontFamily: DISPLAY_FONT,
        letterSpacing: 1,
        anchorX: 0.5,
        anchorY: 0.5,
        skewX: TYPE_SKEW,
        stroke: { color: PHANTOM_INK, width: 6, alignment: 0.5, join: 'miter' },
        dropShadow: { color: style.shadow, alpha: 1, blur: 0, distance: 4, angle: Math.PI / 4 },
        maxWidth: display.maxWidth,
      },
      pool,
    );
    if (combo > 0) {
      addNumber(
        layer,
        formatCount(combo),
        display.x,
        270,
        {
          scale: punchScale(runtime.judgeAtMs, nowMs, 150, (combo % 100 === 0 ? 0.5 : 0.16) * amount),
          ...displayStyle(24, combo >= 200 ? PHANTOM_GOLD : PHANTOM_WHITE),
          anchorX: 0.5,
          anchorY: 0.5,
          stroke: { color: PHANTOM_INK, width: 4, alignment: 0.5, join: 'miter' },
          maxWidth: Math.max(72, display.maxWidth - 36),
        },
        pool,
      );
    }
  }
}

function resolveJudgeDisplays(
  runtime: FallbackGameplayRuntime,
  playfield: FallbackPlayfieldLayout,
): ResolvedJudgeDisplay[] {
  const isDoublePlay = playfield.sideCenters['2P'] !== undefined;
  const maxWidth = isDoublePlay ? 122 : 170;
  const sideStates = runtime.judgeSides?.filter((state) => typeof state.judge === 'string' && state.judge.length > 0);
  if (sideStates?.length) {
    return sideStates.map((state) => ({
      judge: state.judge!,
      combo: state.combo,
      x: resolveJudgeDisplayX(playfield, state.side),
      maxWidth,
    }));
  }
  if (!runtime.lastJudge) {
    return [];
  }
  return [{ judge: runtime.lastJudge, combo: runtime.combo, x: resolveJudgeDisplayX(playfield, '1P'), maxWidth }];
}

function resolveJudgeDisplayX(playfield: FallbackPlayfieldLayout, side: PlaySide): number {
  return playfield.sideCenters[side] ?? playfield.centerX;
}

function resolveVisibleCombo(judge: string, combo: number | undefined): number {
  if (judge !== 'PERFECT' && judge !== 'GREAT' && judge !== 'GOOD') {
    return 0;
  }
  return combo !== undefined && Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
}

/** Small all-caps label in the display face. */
function tagLabelStyle(fill: number): TextOptions {
  return { size: 9, fill, fontFamily: DISPLAY_FONT, letterSpacing: 1.2, skewX: TYPE_SKEW };
}

/** Condensed, leaning numeral / headline style. */
function displayStyle(size: number, fill: number): TextOptions {
  return { size, fill, fontFamily: DISPLAY_FONT, weight: '400', skewX: TYPE_SKEW };
}

function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0';
  return String(Math.max(0, Math.floor(value)));
}

function formatRulesetLabel(value: string | undefined): string {
  switch (value) {
    case 'beatoraja':
      return 'BEATORAJA';
    case 'iidx':
      return 'IIDX';
    default:
      return 'LR2';
  }
}

function formatBpmValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '---';
  return String(Math.round(value));
}

function formatHiSpeed(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0.0';
  return value.toFixed(1);
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

/** Fill / hard-shadow pair for each judgement word, plus the tally-count colour. */
function judgeStyle(judge: string): { fill: number; shadow: number; tally: number } {
  switch (judge) {
    case 'PERFECT':
      return { fill: PHANTOM_WHITE, shadow: PHANTOM_RED, tally: PHANTOM_WHITE };
    case 'GREAT':
      return { fill: PHANTOM_GOLD, shadow: PHANTOM_RED, tally: PHANTOM_GOLD };
    case 'GOOD':
      return { fill: PHANTOM_CYAN, shadow: PHANTOM_INK, tally: PHANTOM_CYAN };
    case 'BAD':
      return { fill: PHANTOM_ORANGE, shadow: PHANTOM_INK, tally: PHANTOM_ORANGE };
    case 'POOR':
      return { fill: PHANTOM_RED_HOT, shadow: PHANTOM_WHITE, tally: PHANTOM_RED_HOT };
    default:
      return { fill: PHANTOM_WHITE, shadow: PHANTOM_INK, tally: PHANTOM_WHITE };
  }
}
