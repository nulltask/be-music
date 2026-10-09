import { Container, Graphics } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { GROOVE, PLAYFIELD } from '../gameplay-constants.ts';
import type { BeMusicRect } from '../../skin/be-music/types.ts';
import {
  STAGE_BGA_BAND,
  STAGE_HEIGHT as DESIGN_HEIGHT,
  STAGE_SIDE_COLUMN,
  STAGE_WIDTH as DESIGN_WIDTH,
  resolveStageBgaRect,
} from './stage.ts';
import { resolveSkinlessLaneLayout, type FallbackLaneLayoutRect } from '../gameplay-lanes.ts';
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
import { addRansomText, type GlyphFactory } from './phantom/tear.ts';
import { loadingDots } from './loading.ts';
import { effectProfile, impulse } from './moments.ts';
import { flashingGreatColor, isFlashingGreat, judgeDisplayWord } from './judge-word.ts';
import { addHudNumber as addNumber, addHudText as addText, type HudTextOptions as TextOptions } from './hud-text.ts';

const DISPLAY_FONT = DEFAULT_DISPLAY_FONT;
/** Italic lean applied to every display-face text node — the whole HUD reads as moving forward. */
const TYPE_SKEW = -0.18;
/** Page margin of the HUD grid: the left and right blocks line up 16 px in from the canvas edges. */
const HUD_MARGIN = 16;
/** Score panel: right edge (with its shadow) on the margin, top on the gauge housing's line, bottom on the song plate's. */
const SCORE_PANEL = { x: DESIGN_WIDTH - HUD_MARGIN - 6 - 272, y: 365, w: 272, h: 99 } as const;
/** Score panel columns: the left one's values end at {@link SCORE_LEFT_END}, the right one starts after the divider. */
const SCORE_LEFT_END = 148;
const SCORE_DIVIDER = 162;
const SCORE_RIGHT = SCORE_DIVIDER + 14;
/** The track card runs from the left margin to a gutter before the score panel, so long titles keep their room. */
const SONG_PLATE = { x: 16, y: 420, w: SCORE_PANEL.x - 16 - 40, h: 44 } as const;
/** Red floor wedge behind the score panel. Its top edge stays below the BGA rect so a live video is never covered. */
const FLOOR_WEDGE: readonly number[] = [236, DESIGN_HEIGHT, DESIGN_WIDTH, 352, DESIGN_WIDTH, DESIGN_HEIGHT];

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
  // The scene composites the BGA into the same rect (the stage's), sized to the room the playfield leaves.
  const bga = resolveStageBgaRect(playfield.right);
  frame.label = 'default-gameplay/chrome';
  // The poster moves with the music: halftone swells on the bass, the idle burst kicks on onsets, a spectrum strip.
  const drive = audioDrive(runtime.audio, runtime.effects);
  drawBackground(frame, hasBga && bga.w > 0, bga, drive);

  const effects = effectProfile(runtime.effects);
  drawPlayfield(
    frame,
    playfield,
    runtime.progressRatio,
    impulse(runtime.impulseAtMs, runtime.nowMs ?? 0, 140) * effects.amount,
  );
  // The monitor shrinks to fit beside a double-play field; only a page-wide keyboard field leaves no room for it.
  if (bga.w > 0) {
    drawBgaFrame(frame, layer, bga, hasBga, runtime.nowMs, drive, layerPool);
  }
  drawGauge(frame, layer, runtime, layerPool);
  drawSongPlate(frame, layer, runtime, layerPool);
  drawScorePlate(frame, layer, runtime, drive, layerPool);
  // The side column on the right edge: the judge tally on top, the spectrum below it.
  const tallyBottom = drawJudgeTally(frame, layer, runtime, STAGE_SIDE_COLUMN.x, layerPool);
  drawSpectrumColumn(frame, layer, drive, tallyBottom + 18, layerPool);
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
  const covered = drawPhantomMoments(layer, frontLayer, runtime, frontPool, playfield.right);
  if (runtime.loading) drawLoading(frontLayer, runtime.nowMs ?? 0, playfield, frontPool);
  else if (!covered) drawJudgements(frontLayer, runtime, playfield, frontPool, effects.amount);
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
function drawBackground(frame: Graphics, hasBga: boolean, bga: BeMusicRect, drive: AudioDrive): void {
  fillRectAroundHole(frame, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, PHANTOM_BLACK, hasBga ? bga : undefined);
  // Faint diagonal pinstripes over the lower-left quadrant — gives the ink ground a printed texture.
  for (let stripe = 0; stripe < 12; stripe += 1) {
    const x0 = -120 + stripe * 44;
    frame.poly([x0, DESIGN_HEIGHT, x0 + 14, DESIGN_HEIGHT, x0 + 134, 352, x0 + 120, 352]).fill({
      color: PHANTOM_CHARCOAL,
      alpha: 0.7,
    });
  }

  // Floor wedge: deep red base, hot red face, ink halftone swelling toward the lower-right corner.
  frame
    .poly([FLOOR_WEDGE[0]! - 18, DESIGN_HEIGHT, DESIGN_WIDTH, 342, DESIGN_WIDTH, DESIGN_HEIGHT])
    .fill(PHANTOM_RED_DEEP);
  frame.poly([...FLOOR_WEDGE]).fill(PHANTOM_RED);
  for (const dot of halftoneField({
    x: 300,
    y: 352,
    w: DESIGN_WIDTH - 300,
    h: DESIGN_HEIGHT - 352,
    pitch: 9,
    maxRadius: 4.2 * (1 + 0.45 * drive.bass),
    direction: { x: 1, y: 1 },
  })) {
    if (isInsideFloorWedge(dot.x, dot.y)) frame.circle(dot.x, dot.y, dot.r);
  }
  // One fill for the whole field instead of one per dot.
  frame.fill({ color: PHANTOM_INK, alpha: 0.55 });
  // Sheet music on the floor: two ink staves ruled across the wedge, following its slanted top edge.
  const wedgeLeftAt = (lineY: number): number =>
    FLOOR_WEDGE[0]! +
    ((DESIGN_HEIGHT - lineY) * (DESIGN_WIDTH - FLOOR_WEDGE[0]!)) / (DESIGN_HEIGHT - FLOOR_WEDGE[3]!) +
    6;
  drawStaves(frame, 0, DESIGN_WIDTH, 404, 5, PHANTOM_INK, 0.55, wedgeLeftAt);
  drawStaves(frame, 0, DESIGN_WIDTH, 446, 5, PHANTOM_INK, 0.55, wedgeLeftAt);
  // Paper-white cut line tracing the wedge's leading edge.
  frame
    .poly([FLOOR_WEDGE[0]! + 26, DESIGN_HEIGHT, DESIGN_WIDTH, 360, DESIGN_WIDTH, 363, FLOOR_WEDGE[0]! + 32, 480])
    .fill({ color: PHANTOM_WHITE, alpha: 0.9 });
}

function isInsideFloorWedge(x: number, y: number): boolean {
  const [ax, ay, bx, by] = FLOOR_WEDGE as readonly [number, number, number, number, number, number];
  // Above-line test against the wedge's top edge (A → B); the other two edges are the canvas borders.
  return (bx - ax) * (y - ay) - (by - ay) * (x - ax) > 0 && x <= DESIGN_WIDTH && y <= DESIGN_HEIGHT;
}

/** Fills `rect` minus the `hole` rect (the live BGA) as up to four axis-aligned pieces. */
function fillRectAroundHole(
  frame: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  hole: BeMusicRect | undefined,
): void {
  const right = x + w;
  const bottom = y + h;
  if (!hole || right <= hole.x || x >= hole.x + hole.w || bottom <= hole.y || y >= hole.y + hole.h) {
    frame.rect(x, y, w, h).fill(color);
    return;
  }
  const holeRight = hole.x + hole.w;
  const holeBottom = hole.y + hole.h;
  if (y < hole.y) frame.rect(x, y, w, hole.y - y).fill(color);
  const bandTop = Math.max(y, hole.y);
  const bandBottom = Math.min(bottom, holeBottom);
  if (x < hole.x) frame.rect(x, bandTop, hole.x - x, bandBottom - bandTop).fill(color);
  if (right > holeRight) frame.rect(holeRight, bandTop, right - holeRight, bandBottom - bandTop).fill(color);
  if (bottom > holeBottom) frame.rect(x, holeBottom, w, bottom - holeBottom).fill(color);
}

function resolveFallbackPlayfieldLayout(
  laneChannels: readonly string[] | undefined,
  laneCount: number | undefined,
  playVariant: ChartPlayVariant | undefined,
): FallbackPlayfieldLayout {
  const { lanes, left, right } = resolveSkinlessLaneLayout(laneChannels, laneCount, playVariant);
  const w = Math.max(1, right - left);
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
    x: left,
    w,
    centerX: left + w / 2,
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

/**
 * Monitor frame: a red offset parallelogram and a paper-white one, both wide enough to enclose the BGA rect so their
 * strokes never cross the video. With no BGA the screen idles on a red halftone field with a "STAND BY" slug.
 */
function drawBgaFrame(
  frame: Graphics,
  layer: Container,
  bga: BeMusicRect,
  hasBga: boolean,
  nowMs: number | undefined,
  drive: AudioDrive,
  pool: ChildPool | undefined,
): void {
  const slant = 6;
  const margin = 6;
  const frameX = bga.x - margin - slant;
  const frameW = bga.w + margin * 2 + slant;
  frame.poly(parallelogramPoints(frameX + 4, bga.y - margin + 4, frameW, bga.h + margin * 2, slant)).stroke({
    color: PHANTOM_RED,
    width: 4,
    join: 'miter',
  });
  frame.poly(parallelogramPoints(frameX, bga.y - margin, frameW, bga.h + margin * 2, slant)).stroke({
    color: PHANTOM_WHITE,
    width: 3,
    join: 'miter',
  });
  if (hasBga) return;

  frame.rect(bga.x, bga.y, bga.w, bga.h).fill(PHANTOM_INK);
  for (const dot of halftoneField({
    x: bga.x + 4,
    y: bga.y + 4,
    w: bga.w - 8,
    h: bga.h - 8,
    pitch: 12,
    maxRadius: 5 * (1 + 0.5 * drive.level),
    direction: { x: -0.6, y: 1 },
  })) {
    frame.circle(dot.x, dot.y, dot.r);
  }
  frame.fill({ color: PHANTOM_RED, alpha: 0.75 });
  // Slow-turning starburst behind the slug — the idle screen is alive, not a hole in the cabinet.
  // It pumps on the bass and jolts a notch round on every onset. Sized off the monitor, which shrinks in double play.
  const spin = (nowMs !== undefined ? nowMs / 6000 : 0) + 0.1 * drive.onset;
  const pump = (1 + 0.2 * drive.bass + 0.1 * drive.onset) * (bga.w / 256);
  const cx = bga.x + bga.w / 2;
  const cy = bga.y + bga.h / 2;
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
 * Spectrum in the side column under the judge tally: 16 slanted red bars rising off a paper rule, white-capped, hot
 * bands turning gold — the poster's equalizer. Silent (or effects off) leaves just the rule.
 */
function drawSpectrumColumn(
  frame: Graphics,
  layer: Container,
  drive: AudioDrive,
  top: number,
  pool: ChildPool | undefined,
): void {
  const x = STAGE_SIDE_COLUMN.x;
  const w = STAGE_SIDE_COLUMN.w;
  const baseY = SPECTRUM_BASE_Y;
  const maxH = baseY - top - 14;
  if (maxH < 16) return;
  frame.poly(parallelogramPoints(x - 4, top - 6, 52, 17, 6)).fill(PHANTOM_RED);
  addText(layer, 'SOUND', x + 22, top + 2, { ...displayStyle(12, PHANTOM_WHITE), anchorX: 0.5, anchorY: 0.5 }, pool);
  const count = 16;
  const pitch = w / count;
  frame.rect(x, baseY, w, 2).fill(PHANTOM_WHITE);
  for (let bar = 0; bar < count; bar += 1) {
    const value = bandLevel(drive.bands, bar, count);
    const h = Math.round(maxH * value);
    if (h < 2) continue;
    const bx = x + bar * pitch + 1;
    const bw = pitch - 2;
    frame.poly(parallelogramPoints(bx, baseY - h, bw, h, 2)).fill(value > 0.82 ? PHANTOM_GOLD : PHANTOM_RED);
    frame.rect(bx + 2, baseY - h, bw, 2).fill(PHANTOM_WHITE);
  }
}

/** The spectrum's rule sits on the BGA band's floor, level with the monitor's bottom edge. */
const SPECTRUM_BASE_Y = STAGE_BGA_BAND.bottom;

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
  status.poly(parallelogramPoints(HUD_MARGIN + 4, 11, 96, 22, 9)).fill(autoplay ? PHANTOM_WHITE : PHANTOM_RED);
  status.poly(parallelogramPoints(HUD_MARGIN, 7, 96, 22, 9)).fill(autoplay ? PHANTOM_RED : PHANTOM_WHITE);
  addText(
    layer,
    autoplay ? 'AUTO PLAY' : 'PLAY',
    HUD_MARGIN + 52,
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

  addText(layer, 'BPM', 136, 14, tagLabelStyle(PHANTOM_RED), pool);
  addNumber(layer, formatBpmValue(runtime.bpm), 160, 5, displayStyle(22, PHANTOM_WHITE), pool);
  addText(layer, 'HI-SPEED', 218, 14, tagLabelStyle(PHANTOM_RED), pool);
  addNumber(layer, `x${formatHiSpeed(runtime.hiSpeed)}`, 266, 5, displayStyle(22, PHANTOM_WHITE), pool);

  // The ruleset tag sits on the right margin; the skin's mark sits midway between it and the tempo readouts.
  const rulesetX = DESIGN_WIDTH - HUD_MARGIN - 126;
  drawNoteEmblem(status, (310 + rulesetX) / 2, 25, 22, PHANTOM_WHITE, PHANTOM_RED);
  status.poly(parallelogramPoints(rulesetX, 8, 118, 22, -8)).fill(PHANTOM_RED);
  status.rect(rulesetX + 5, 13, 3, 12).fill(PHANTOM_WHITE);
  addText(layer, 'RULESET', rulesetX + 18, 15, tagLabelStyle(PHANTOM_INK), pool);
  addText(
    layer,
    formatRulesetLabel(runtime.rulesetLabel),
    rulesetX + 108,
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
    .poly(parallelogramPoints(GROOVE.x - 24, GROOVE.y - 22, GROOVE.w + 38, 46, 8))
    .fill(PHANTOM_INK)
    .stroke({
      color: PHANTOM_WHITE,
      width: 2,
      join: 'miter',
    });
  // Gauge-type tag knifed into the housing's top-left corner.
  frame.poly(parallelogramPoints(HUD_MARGIN, GROOVE.y - 30, 106, 16, 6)).fill(survival ? PHANTOM_WHITE : PHANTOM_RED);
  addText(
    layer,
    `${(runtime.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`,
    HUD_MARGIN + 10,
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
  // Three rows on a 28 px pitch shared by both columns: label on the left, value on the right of each row.
  frame.rect(x + 14, y + 36, SCORE_LEFT_END - 18, 1).fill({ color: PHANTOM_SLATE });
  frame.rect(x + 14, y + 64, SCORE_LEFT_END - 18, 1).fill({ color: PHANTOM_SLATE });
  const d = x + SCORE_DIVIDER;
  frame.poly([d - 2, y + 10, d, y + 10, d + 2, y + h - 10, d, y + h - 10]).fill(PHANTOM_RED);

  addText(layer, 'SCORE', x + 14, y + 12, tagLabelStyle(PHANTOM_RED), pool);
  addNumber(
    layer,
    formatCount(runtime.score),
    x + SCORE_LEFT_END,
    y + 2,
    { ...displayStyle(26, PHANTOM_WHITE), anchorX: 1, maxWidth: 94 },
    pool,
  );
  addText(layer, 'EX SCORE', x + 14, y + 44, tagLabelStyle(PHANTOM_ASH), pool);
  addNumber(
    layer,
    `${formatCount(runtime.exScore)} / ${formatCount(runtime.exScoreMax)}`,
    x + SCORE_LEFT_END,
    y + 39,
    { ...displayStyle(14, PHANTOM_PAPER), anchorX: 1, maxWidth: 76 },
    pool,
  );
  addText(layer, 'EX RATE', x + 14, y + 72, tagLabelStyle(PHANTOM_ASH), pool);
  addNumber(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    x + SCORE_LEFT_END,
    y + 67,
    { ...displayStyle(14, PHANTOM_PAPER), anchorX: 1, maxWidth: 84 },
    pool,
  );

  // DJ-level meter under EX RATE: slanted segments, one per IIDX ninth, so the distance to the next letter is legible.
  const rate =
    runtime.exScore !== undefined && runtime.exScoreMax !== undefined && runtime.exScoreMax > 0
      ? Math.max(0, Math.min(1, runtime.exScore / runtime.exScoreMax))
      : 0;
  const segments = 9;
  const segmentW = (SCORE_LEFT_END - 18) / segments;
  for (let segment = 0; segment < segments; segment += 1) {
    const fill = Math.max(0, Math.min(1, rate * segments - segment));
    const sx = x + 14 + segment * segmentW;
    frame.poly(parallelogramPoints(sx, y + 88, segmentW - 2, 5, 2)).fill(PHANTOM_SLATE);
    if (fill > 0) {
      frame
        .poly(parallelogramPoints(sx, y + 88, (segmentW - 2) * fill, 5, 2))
        .fill(segment >= 7 ? PHANTOM_GOLD : PHANTOM_RED_HOT);
    }
  }

  // Right column on the same rows: COMBO, MAX, then RANK beside the badge in the lower corner.
  // The combo value sits under its label (a 3–4 digit combo would run into the label on one line), still clear of MAX.
  addText(layer, 'COMBO', x + SCORE_RIGHT, y + 12, tagLabelStyle(PHANTOM_RED), pool);
  addNumber(
    layer,
    formatCount(runtime.combo),
    x + w - 12,
    y + 15,
    { ...displayStyle(22, PHANTOM_WHITE), anchorX: 1, maxWidth: 60 },
    pool,
  );
  addText(layer, 'MAX', x + SCORE_RIGHT, y + 44, tagLabelStyle(PHANTOM_ASH), pool);
  addNumber(
    layer,
    formatCount(runtime.maxCombo),
    x + w - 12,
    y + 40,
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
  addText(layer, 'RANK', x + SCORE_RIGHT, y + 72, tagLabelStyle(PHANTOM_ASH), pool);
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
): number {
  // Top-aligned with the BGA band so the header chip clears the status bar's beat-driven teeth.
  const y = 56;
  const w = DESIGN_WIDTH - HUD_MARGIN - x;
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
  return y + h;
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
    const word = judgeDisplayWord(display.judge);
    // The judgement and the combo are cut out of magazines like the count-in's READY? / GO!!: a fresh ransom note on
    // every hit, each card popping in a beat after the last (a miss lands plainly). The letters on the dark cards carry
    // the judgement colour (a PERFECT's GREAT flashes through the palette); the combo turns gold from 200. Both stay
    // small so the notes falling through them stay readable.
    const miss = display.judge === 'POOR' || display.judge === 'BAD';
    const age = runtime.judgeAtMs !== undefined ? nowMs - runtime.judgeAtMs : Number.POSITIVE_INFINITY;
    const cards = pool?.acquireGraphics() ?? new Graphics();
    cards.label = 'default-gameplay/judge-cards';
    if (!pool) layer.addChild(cards);
    const glyph = hudGlyphs(layer, pool);
    // Fast enough to finish between hits in a dense passage, and only a slight overshoot so it never covers lanes.
    const appear = (delayMs: number) => (index: number) =>
      miss || amount <= 0 ? 1 : (age - delayMs - index * 10) / 60;
    addRansomText(cards, glyph, word, display.x, 238, {
      size: Math.min(JUDGE_WORD_SIZE, display.maxWidth / (word.length * 0.95)),
      seed: (display.combo ?? 0) * 7 + word.length,
      angle: -0.06,
      accent: isFlashingGreat(display.judge) ? flashingGreatColor(nowMs, PHANTOM_FLASHING_GREAT) : style.fill,
      appear: appear(0),
      pop: 0.22,
    });
    if (combo > 0) {
      const digits = formatCount(combo);
      addRansomText(cards, glyph, digits, display.x, 238 + JUDGE_WORD_SIZE + 2, {
        size: Math.min(JUDGE_COMBO_SIZE, display.maxWidth / (digits.length * 0.95)),
        seed: combo * 13 + 5,
        angle: 0.05,
        accent: combo >= 200 ? PHANTOM_GOLD : PHANTOM_WHITE,
        appear: appear(30),
        pop: 0.22,
      });
    }
  }
}

/**
 * NOW LOADING on the lanes while the chart's assets load: the words cut out of magazines like the count-in, re-cut
 * every so often so the notice looks alive, with ink dots ticking underneath.
 */
function drawLoading(
  layer: Container,
  nowMs: number,
  playfield: FallbackPlayfieldLayout,
  pool: ChildPool | undefined,
): void {
  const cards = pool?.acquireGraphics() ?? new Graphics();
  cards.label = 'default-gameplay/loading';
  if (!pool) layer.addChild(cards);
  const glyph = hudGlyphs(layer, pool);
  const cx = playfield.centerX;
  const cy = 170;
  const recut = Math.floor(nowMs / 700);
  const size = Math.min(24, (playfield.w - 24) / (7 * 0.95));
  addRansomText(cards, glyph, 'NOW', cx, cy, { size, seed: recut * 3 + 1, angle: -0.06 });
  addRansomText(cards, glyph, 'LOADING', cx, cy + size + 6, { size, seed: recut * 3 + 2, angle: 0.04 });
  addText(
    layer,
    loadingDots(nowMs).padEnd(3, ' '),
    cx,
    cy + size * 2 + 16,
    { ...displayStyle(22, PHANTOM_WHITE), anchorX: 0.5, anchorY: 0.5 },
    pool,
  );
}

/** Ransom-note glyphs from the pooled HUD text (or fresh nodes without a pool). */
function hudGlyphs(layer: Container, pool: ChildPool | undefined): GlyphFactory {
  return (char, options) =>
    addText(
      layer,
      char,
      0,
      0,
      { size: options.size, weight: options.weight, fill: options.fill, fontFamily: options.fontFamily },
      pool,
    );
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

/** Judgement word / combo ransom-note sizes: small enough that the notes read through them. */
const JUDGE_WORD_SIZE = 22;
const JUDGE_COMBO_SIZE = 18;

/** Colours the PERFECT judgement's flashing GREAT cycles through. */
const PHANTOM_FLASHING_GREAT = [PHANTOM_WHITE, PHANTOM_CYAN, PHANTOM_GOLD, 0xff7ad9] as const;

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
