import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../gameplay-constants.ts';
import {
  resolveFallbackLaneLayout,
  shouldPreserveFallbackSideWidth,
  type FallbackLaneLayoutRect,
} from '../gameplay-lanes.ts';
import type { SkinlessGameplayChromeRuntime } from '../gameplay-chrome.ts';
import { DEFAULT_JUDGE_FONT, DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import type { ChildPool } from '../pixi-utils.ts';

const SURFACE = 0x070b14;
const PANEL = 0x0d1322;
const PANEL_DARK = 0x030711;
const LINE = 0x243048;
const LANE = 0x01030a;
const TEXT = 0xf6f2e8;
const MUTED = 0xa9a39a;
const SUBTLE = 0x6e685d;
const TEAL = 0x4bd7c8;
const AMBER = 0xffc857;
const RED = 0xff5c5c;
const GREEN = 0x6ee07f;
const BLUE = 0x76a8ff;
const ORANGE = 0xff9b54;
// Background gradient bands, top to bottom. Drawn as flat rows because pixi FillGradients would allocate a texture
// per frame under the pooled-Graphics repaint model.
const BG_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0x0a1120, 96],
  [0x080d19, 176],
  [0x060a13, 260],
  [0x04070e, 356],
  [0x03050a, 480],
];
// Metallic side-rail shades for the playfield frame.
const RAIL_EDGE = 0x3d4c68;
const RAIL_BODY = 0x151d2f;
const RAIL_DARK = 0x0a0f1c;
const JUDGE_RED = 0xff3b55;
const FONT = DEFAULT_TEXT_FONT;
const NUMERIC_FONT = DEFAULT_NUMERIC_FONT;
const SCORE_PANEL = { x: 384, y: 350, w: 238, h: 112 } as const;

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
 * Built-in gameplay chrome for the default skin family. It is intentionally not an LR2 atlas facsimile: this path is the
 * skinless experience, so it keeps only the information a player can act on while playing.
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
  drawBackground(frame, hasBga);

  drawPlayfield(frame, playfield, runtime.progressRatio);
  drawBgaFrame(frame, hasBga);
  drawGauge(frame, runtime.gauge, runtime.clearThreshold, runtime.nowMs);
  drawSongPlate(frame);
  drawScorePlate(frame);
  const tallyX = resolveJudgeTallyX(playfield);
  if (tallyX !== undefined) {
    drawJudgeTally(frame, layer, runtime, tallyX, layerPool);
  }
  if (!layerPool) {
    layer.addChildAt(frame, 0);
  }

  const frontLayer = options.overlayLayer && options.overlayLayerPool ? options.overlayLayer : layer;
  const frontPool = frontLayer === layer ? layerPool : options.overlayLayerPool;
  drawStatusBar(frontLayer, runtime.autoplay === true, frontPool);
  addText(
    frontLayer,
    runtime.autoplay ? 'AUTO PLAY' : 'PLAY',
    62,
    14,
    {
      size: 10,
      weight: '900',
      fill: runtime.autoplay ? AMBER : TEAL,
      letterSpacing: 1.4,
      anchorX: 0.5,
    },
    frontPool,
  );
  addText(frontLayer, 'BPM', 128, 18, labelStyle(), frontPool);
  addText(
    frontLayer,
    formatBpmValue(runtime.bpm),
    156,
    12,
    { size: 15, weight: '900', fill: TEXT, fontFamily: NUMERIC_FONT },
    frontPool,
  );
  addText(frontLayer, 'HI-SPEED', 216, 18, labelStyle(), frontPool);
  addText(
    frontLayer,
    `x${formatHiSpeed(runtime.hiSpeed)}`,
    268,
    12,
    { size: 15, weight: '900', fill: TEXT, fontFamily: NUMERIC_FONT },
    frontPool,
  );

  const gauge = clampPercent(runtime.gauge ?? 0);
  const clearLine = clampPercent(runtime.clearThreshold ?? 80);
  const gaugeCleared = clearLine <= 0 ? gauge > 0 : gauge >= clearLine;
  addText(layer, 'GROOVE GAUGE', GROOVE.x - 2, GROOVE.y - 17, labelStyle(), layerPool);
  addText(
    layer,
    `${Math.round(gauge)}%`,
    GROOVE.x + GROOVE.w + 8,
    GROOVE.y - 23,
    metricStyle(15, gaugeCleared ? JUDGE_RED : 0xff7a2f, 1),
    layerPool,
  );

  const title = runtime.songTitle?.trim() || 'Untitled chart';
  addText(
    layer,
    title,
    28,
    416,
    {
      size: 16,
      weight: '800',
      fill: TEXT,
      maxWidth: 324,
    },
    layerPool,
  );
  const artist = runtime.songArtist?.trim();
  if (artist) {
    addText(
      layer,
      artist,
      28,
      438,
      {
        size: 10,
        weight: '600',
        fill: MUTED,
        maxWidth: 324,
      },
      layerPool,
    );
  }

  const rank = runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F';
  addText(layer, 'SCORE', SCORE_PANEL.x + 12, SCORE_PANEL.y + 16, labelStyle(), layerPool);
  addText(
    layer,
    formatCount(runtime.score),
    SCORE_PANEL.x + 96,
    SCORE_PANEL.y + 22,
    {
      ...metricStyle(20, AMBER, 1),
      maxWidth: 126,
    },
    layerPool,
  );
  addText(layer, 'EX SCORE', SCORE_PANEL.x + 12, SCORE_PANEL.y + 46, labelStyle(), layerPool);
  addText(
    layer,
    `${formatCount(runtime.exScore)} / ${formatCount(runtime.exScoreMax)}`,
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 54,
    {
      ...metricStyle(12, TEXT, 1),
      maxWidth: 112,
    },
    layerPool,
  );
  addText(layer, 'EX RATE', SCORE_PANEL.x + 12, SCORE_PANEL.y + 76, labelStyle(), layerPool);
  addText(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 84,
    {
      ...metricStyle(12, TEXT, 1),
      maxWidth: 112,
    },
    layerPool,
  );
  // Right column rows share one baseline per row: labelTop = valueTop + 0.8 x (valueSize - labelSize).
  addText(layer, 'COMBO', SCORE_PANEL.x + 148, SCORE_PANEL.y + 21, labelStyle(), layerPool);
  addText(
    layer,
    formatCount(runtime.combo),
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 16,
    {
      ...metricStyle(14, TEAL, 1),
      fontFamily: DEFAULT_JUDGE_FONT,
      maxWidth: 40,
    },
    layerPool,
  );
  addText(layer, 'MAX', SCORE_PANEL.x + 148, SCORE_PANEL.y + 52, labelStyle(), layerPool);
  addText(
    layer,
    formatCount(runtime.maxCombo),
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 48,
    {
      ...metricStyle(13, TEXT, 1),
      fontFamily: DEFAULT_JUDGE_FONT,
      maxWidth: 40,
    },
    layerPool,
  );
  addText(layer, 'RANK', SCORE_PANEL.x + 148, SCORE_PANEL.y + 81, labelStyle(), layerPool);
  addText(layer, rank, SCORE_PANEL.x + 226, SCORE_PANEL.y + 70, { ...metricStyle(22, AMBER, 1), maxWidth: 42 }, layerPool);

  for (const display of resolveJudgeDisplays(runtime, playfield)) {
    const combo = resolveVisibleCombo(display.judge, display.combo);
    addText(
      frontLayer,
      display.judge,
      display.x,
      232,
      {
        size: 22,
        weight: '900',
        fill: judgeColor(display.judge),
        fontFamily: DEFAULT_JUDGE_FONT,
        anchorX: 0.5,
        stroke: { color: 0x000000, width: 4, alignment: 0.5, join: 'round' },
        maxWidth: display.maxWidth,
      },
      frontPool,
    );
    if (combo > 0) {
      addText(
        frontLayer,
        formatCount(combo),
        display.x,
        258,
        {
          size: 18,
          weight: '900',
          fill: TEXT,
          fontFamily: DEFAULT_JUDGE_FONT,
          anchorX: 0.5,
          stroke: { color: 0x000000, width: 4, alignment: 0.5, join: 'round' },
          maxWidth: Math.max(72, display.maxWidth - 36),
        },
        frontPool,
      );
    }
  }
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
 * Deep-navy vertical gradient plus an edge vignette. With a live BGA the bands leave a hole over the BGA rect —
 * the BGA layer renders BEHIND this chrome layer, so anything painted there would cover the video.
 */
function drawBackground(frame: Graphics, hasBga: boolean): void {
  let bandTop = 0;
  for (const [color, bandBottom] of BG_BANDS) {
    fillBandAroundHole(frame, bandTop, bandBottom, color, hasBga);
    bandTop = bandBottom;
  }
  // Vignette — kept outside the BGA rect (y < 56, y > 340, x < 24) so no hole logic is needed.
  frame.rect(0, 0, DESIGN_WIDTH, 6).fill({ color: 0x000000, alpha: 0.4 });
  frame.rect(0, DESIGN_HEIGHT - 14, DESIGN_WIDTH, 14).fill({ color: 0x000000, alpha: 0.3 });
  frame.rect(0, 0, 14, DESIGN_HEIGHT).fill({ color: 0x000000, alpha: 0.22 });
  frame.rect(DESIGN_WIDTH - 14, 0, 14, DESIGN_HEIGHT).fill({ color: 0x000000, alpha: 0.22 });
}

function fillBandAroundHole(frame: Graphics, top: number, bottom: number, color: number, hasBga: boolean): void {
  const height = bottom - top;
  if (height <= 0) return;
  if (!hasBga || bottom <= BGA.y || top >= BGA.y + BGA.h) {
    frame.rect(0, top, DESIGN_WIDTH, height).fill(color);
    return;
  }
  // Band overlaps the BGA rows: paint the row segments left / right of the hole, plus any sliver above / below it.
  if (top < BGA.y) frame.rect(0, top, DESIGN_WIDTH, BGA.y - top).fill(color);
  const overlapTop = Math.max(top, BGA.y);
  const overlapBottom = Math.min(bottom, BGA.y + BGA.h);
  frame.rect(0, overlapTop, BGA.x, overlapBottom - overlapTop).fill(color);
  frame.rect(BGA.x + BGA.w, overlapTop, DESIGN_WIDTH - (BGA.x + BGA.w), overlapBottom - overlapTop).fill(color);
  if (bottom > BGA.y + BGA.h) frame.rect(0, BGA.y + BGA.h, DESIGN_WIDTH, bottom - (BGA.y + BGA.h)).fill(color);
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

function drawPlayfield(frame: Graphics, playfield: FallbackPlayfieldLayout, progressRatio: number | undefined): void {
  const wellTop = PLAYFIELD.y;
  const wellBottom = PLAYFIELD_FRAME_BOTTOM;
  const wellHeight = wellBottom - wellTop;
  const railW = 8;
  const leftRailX = playfield.x - railW - 2;
  const rightRailX = playfield.right + 2;

  // Lane well — near-black with a faint depth gradient (darker at the top, where notes emerge).
  frame.rect(playfield.x - 2, wellTop, playfield.w + 4, wellHeight).fill(LANE);
  frame.rect(playfield.x - 2, wellTop, playfield.w + 4, 90).fill({ color: 0x000000, alpha: 0.45 });
  frame.rect(playfield.x - 2, wellTop + 90, playfield.w + 4, 90).fill({ color: 0x000000, alpha: 0.2 });

  // DP side gap — a dead column between the 1P / 2P halves.
  if (playfield.sideGap) {
    frame.rect(playfield.sideGap.x, wellTop, playfield.sideGap.w, wellHeight).fill({
      color: RAIL_DARK,
      alpha: 0.96,
    });
    frame.rect(playfield.sideGap.x + 1, wellTop, 1, wellHeight).fill({ color: RAIL_EDGE, alpha: 0.5 });
    frame.rect(playfield.sideGap.x + playfield.sideGap.w - 2, wellTop, 1, wellHeight).fill({
      color: RAIL_EDGE,
      alpha: 0.5,
    });
  }

  // Metallic side rails: bright outer edge, brushed body, seated shadow against the lane well.
  for (const railX of [leftRailX, rightRailX]) {
    frame.rect(railX, wellTop, railW, wellBottom).fill(RAIL_BODY);
    frame.rect(railX, wellTop, 1, wellBottom).fill({ color: RAIL_EDGE, alpha: 0.9 });
    frame.rect(railX + railW - 1, wellTop, 1, wellBottom).fill({ color: RAIL_EDGE, alpha: 0.9 });
    frame.rect(railX + 1, wellTop, railW - 2, 2).fill({ color: RAIL_EDGE, alpha: 0.7 });
    frame.rect(railX, wellBottom - 2, railW, 2).fill(RAIL_DARK);
  }

  // Song-progress track inside the left rail, filling bottom-up — the LR2 default skin's vertical progress bar.
  const trackX = leftRailX + 2;
  const trackTop = wellTop + 6;
  const trackHeight = wellBottom - 12 - trackTop;
  frame.rect(trackX, trackTop, railW - 4, trackHeight).fill({ color: 0x000000, alpha: 0.55 });
  const ratio = progressRatio !== undefined && Number.isFinite(progressRatio) ? Math.max(0, Math.min(1, progressRatio)) : 0;
  if (ratio > 0) {
    const fillHeight = Math.max(2, Math.round(trackHeight * ratio));
    frame.rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, fillHeight).fill({ color: TEAL, alpha: 0.85 });
    frame.rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, 2).fill({ color: 0xffffff, alpha: 0.8 });
  }

  // Frame footer — a plated bar closing the well under the key caps.
  frame.rect(leftRailX, wellBottom, rightRailX + railW - leftRailX, 5).fill(RAIL_BODY);
  frame.rect(leftRailX, wellBottom, rightRailX + railW - leftRailX, 1).fill({ color: RAIL_EDGE, alpha: 0.8 });
  frame.rect(leftRailX, wellBottom + 5, rightRailX + railW - leftRailX, 2).fill({ color: 0x000000, alpha: 0.4 });
}

/** X where the judge tally column can sit, or undefined when the (DP-wide) playfield covers it. */
function resolveJudgeTallyX(playfield: FallbackPlayfieldLayout): number | undefined {
  const x = BGA.x + BGA.w + 13;
  return playfield.right + 14 <= x && x + 76 <= DESIGN_WIDTH ? x : undefined;
}

function drawBgaFrame(frame: Graphics, hasBga: boolean): void {
  if (!hasBga) {
    frame.roundRect(BGA.x - 10, BGA.y - 12, BGA.w + 20, BGA.h + 24, 4).fill({ color: PANEL, alpha: 0.7 });
  }
  frame.roundRect(BGA.x - 10, BGA.y - 12, BGA.w + 20, BGA.h + 24, 4).stroke({ color: LINE, width: 1 });
  if (!hasBga) {
    frame.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill({ color: PANEL_DARK, alpha: 0.95 });
    // Idle emblem — concentric rings so the empty monitor reads as a screen, not a hole.
    const cx = BGA.x + BGA.w / 2;
    const cy = BGA.y + BGA.h / 2;
    for (const [radius, alpha] of [
      [96, 0.05],
      [70, 0.07],
      [46, 0.09],
    ] as const) {
      frame.circle(cx, cy, radius).stroke({ color: TEAL, width: 1, alpha });
    }
    frame.circle(cx, cy, 3).fill({ color: TEAL, alpha: 0.25 });
  }
  // Corner brackets over the monitor edges.
  const bracket = 14;
  for (const [bx, by, dx, dy] of [
    [BGA.x, BGA.y, 1, 1],
    [BGA.x + BGA.w, BGA.y, -1, 1],
    [BGA.x, BGA.y + BGA.h, 1, -1],
    [BGA.x + BGA.w, BGA.y + BGA.h, -1, -1],
  ] as const) {
    const horizontalX = dx > 0 ? bx : bx - bracket;
    const verticalY = dy > 0 ? by : by - bracket;
    frame.rect(horizontalX, by - (dy < 0 ? 2 : 0), bracket, 2).fill({ color: TEAL, alpha: 0.6 });
    frame.rect(bx - (dx < 0 ? 2 : 0), verticalY, 2, bracket).fill({ color: TEAL, alpha: 0.6 });
  }
}

function drawStatusBar(layer: Container, autoplay: boolean, pool?: ChildPool): void {
  const status = pool?.acquireGraphics() ?? new Graphics();
  status.label = 'default-gameplay/status';
  status.rect(0, 0, DESIGN_WIDTH, 40).fill({ color: SURFACE, alpha: 1 });
  status.rect(0, 0, DESIGN_WIDTH, 12).fill({ color: 0x000000, alpha: 0.3 });
  // Accent underline — bright at the left, decaying to the right, like a lit cabinet trim.
  status.rect(0, 39, DESIGN_WIDTH, 1).fill({ color: LINE, alpha: 0.9 });
  const accent = autoplay ? AMBER : TEAL;
  for (const [x0, w, alpha] of [
    [0, 160, 0.9],
    [160, 160, 0.45],
    [320, 160, 0.2],
    [480, 160, 0.08],
  ] as const) {
    status.rect(x0, 38, w, 2).fill({ color: accent, alpha });
  }
  // Mode pill housing.
  status.roundRect(16, 10, 92, 20, 10).fill({ color: PANEL_DARK, alpha: 0.9 }).stroke({ color: accent, width: 1, alpha: 0.75 });
  if (!pool) {
    layer.addChild(status);
  }
}

/**
 * LR2-style segmented groove gauge: 50 cells of 2 % each. Cells below the clear line burn orange, cells at/above it
 * burn red-hot, and the newest lit cell flickers. Survival gauges (clear threshold 0) run the all-red scheme.
 */
function drawGauge(frame: Graphics, value: number | undefined, threshold: number | undefined, nowMs?: number): void {
  const gauge = clampPercent(value ?? 0);
  const clear = clampPercent(threshold ?? 80);
  const survival = clear <= 0;
  const cellCount = 50;
  const cellStride = GROOVE.w / cellCount;
  const cellW = cellStride - 1;
  const litCells = Math.round((gauge / 100) * cellCount);
  const clearCell = Math.round((clear / 100) * cellCount);

  // Plated housing.
  frame
    .roundRect(GROOVE.x - 10, GROOVE.y - 26, GROOVE.w + 20, 50, 4)
    .fill(PANEL)
    .stroke({ color: LINE, width: 1 });
  frame.rect(GROOVE.x - 10, GROOVE.y - 26, GROOVE.w + 20, 1).fill({ color: RAIL_EDGE, alpha: 0.55 });
  frame
    .rect(GROOVE.x - 4, GROOVE.y - 3, GROOVE.w + 8, GROOVE.h + 6)
    .fill(0x000000)
    .stroke({ color: LINE, width: 1 });

  const flicker = nowMs !== undefined ? 0.72 + 0.28 * Math.abs(Math.sin(nowMs / 90)) : 1;
  for (let cell = 0; cell < litCells; cell += 1) {
    const hot = survival || cell >= clearCell;
    const isTip = cell === litCells - 1;
    const color = hot ? JUDGE_RED : 0xff7a2f;
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, GROOVE.h).fill({
      color: isTip ? 0xffffff : color,
      alpha: isTip ? flicker : hot ? 0.95 : 0.9,
    });
    // Cell top shine.
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, 2).fill({ color: 0xffffff, alpha: isTip ? 0.5 : 0.25 });
  }
  for (let cell = litCells; cell < cellCount; cell += 1) {
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, GROOVE.h).fill({ color: 0x1a2233, alpha: 0.9 });
  }
  if (!survival) {
    const clearX = GROOVE.x + Math.round(clearCell * cellStride) - 1;
    frame.rect(clearX, GROOVE.y - 5, 2, GROOVE.h + 10).fill({ color: TEXT, alpha: 0.95 });
    frame.poly([clearX - 3, GROOVE.y - 9, clearX + 5, GROOVE.y - 9, clearX + 1, GROOVE.y - 4]).fill({
      color: TEXT,
      alpha: 0.95,
    });
  }
}

function drawSongPlate(frame: Graphics): void {
  frame.roundRect(18, 404, 352, 58, 4).fill(PANEL).stroke({ color: LINE, width: 1 });
  frame.rect(18, 404, 352, 1).fill({ color: RAIL_EDGE, alpha: 0.55 });
  // Accent notch on the leading edge — makes the plate read as a marquee, not a form field.
  frame.rect(18, 410, 3, 46).fill({ color: TEAL, alpha: 0.9 });
}

function drawScorePlate(frame: Graphics): void {
  frame.roundRect(SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w, SCORE_PANEL.h, 4).fill(PANEL).stroke({
    color: LINE,
    width: 1,
  });
  frame.rect(SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w, 1).fill({ color: RAIL_EDGE, alpha: 0.55 });
  frame.rect(SCORE_PANEL.x, SCORE_PANEL.y + SCORE_PANEL.h - 3, SCORE_PANEL.w, 3).fill({ color: 0x000000, alpha: 0.35 });
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 42, 128 - 12, 1).fill({ color: LINE, alpha: 0.45 });
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 72, 128 - 12, 1).fill({ color: LINE, alpha: 0.45 });
  frame.rect(SCORE_PANEL.x + 140, SCORE_PANEL.y + 12, 1, SCORE_PANEL.h - 24).fill({ color: LINE, alpha: 0.45 });
}

const JUDGE_TALLY_ROWS: ReadonlyArray<readonly [label: string, key: 'perfect' | 'great' | 'good' | 'bad' | 'poor']> = [
  ['PG', 'perfect'],
  ['GR', 'great'],
  ['GD', 'good'],
  ['BD', 'bad'],
  ['PR', 'poor'],
];

/** Live judge tally column beside the BGA monitor — the at-a-glance readout every reference player keeps on screen. */
function drawJudgeTally(
  frame: Graphics,
  layer: Container,
  runtime: FallbackGameplayRuntime,
  x: number,
  pool?: ChildPool,
): void {
  const y = BGA.y - 12;
  const w = DESIGN_WIDTH - x - 12;
  const rowH = 24;
  const h = 16 + JUDGE_TALLY_ROWS.length * rowH + 8;
  frame.roundRect(x, y, w, h, 4).fill({ color: PANEL, alpha: 0.92 }).stroke({ color: LINE, width: 1 });
  frame.rect(x, y, w, 1).fill({ color: RAIL_EDGE, alpha: 0.55 });
  addText(layer, 'JUDGE', x + 8, y + 6, labelStyle(), pool);
  for (let row = 0; row < JUDGE_TALLY_ROWS.length; row += 1) {
    const [label, key] = JUDGE_TALLY_ROWS[row]!;
    const rowY = y + 20 + row * rowH;
    const color = judgeColor(TALLY_JUDGE_NAMES[key]);
    frame.rect(x + 6, rowY + 3, 2, 12).fill({ color, alpha: 0.9 });
    addText(layer, label, x + 14, rowY + 5, { size: 9, weight: '800', fill: color, letterSpacing: 0.5 }, pool);
    addText(
      layer,
      formatCount(runtime[key]),
      x + w - 8,
      rowY + 1,
      { ...metricStyle(14, TEXT, 1), maxWidth: w - 42 },
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

function resolveJudgeDisplays(
  runtime: FallbackGameplayRuntime,
  playfield: FallbackPlayfieldLayout,
): ResolvedJudgeDisplay[] {
  const isDoublePlay = playfield.sideCenters['2P'] !== undefined;
  const maxWidth = isDoublePlay ? 122 : 160;
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

function addText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    weight?: '400' | '500' | '600' | '700' | '800' | '900';
    fill?: number;
    fontFamily?: string;
    letterSpacing?: number;
    anchorX?: number;
    anchorY?: number;
    maxWidth?: number;
    stroke?: { color: number; width: number; alignment?: number; join?: 'round' | 'bevel' | 'miter' };
  } = {},
  pool?: ChildPool,
): Text {
  const node = pool?.acquireText() ?? new Text();
  const style = resolveTextStyle(opts);
  node.text = text;
  if (node.style !== style) {
    node.style = style;
  }
  node.anchor.set(opts.anchorX ?? 0, opts.anchorY ?? 0);
  node.position.set(x, y);
  node.scale.set(1, 1);
  if (opts.maxWidth !== undefined && node.width > opts.maxWidth) {
    node.scale.x = opts.maxWidth / node.width;
  }
  if (!pool) {
    layer.addChild(node);
  }
  return node;
}

function resolveTextStyle(opts: {
  size?: number;
  weight?: '400' | '500' | '600' | '700' | '800' | '900';
  fill?: number;
  fontFamily?: string;
  letterSpacing?: number;
  stroke?: { color: number; width: number; alignment?: number; join?: 'round' | 'bevel' | 'miter' };
}): TextStyle {
  const stroke = opts.stroke;
  const key = [
    opts.fill ?? TEXT,
    opts.size ?? 10,
    opts.weight ?? '500',
    opts.fontFamily ?? FONT,
    opts.letterSpacing ?? 0,
    stroke?.color ?? '',
    stroke?.width ?? '',
    stroke?.alignment ?? '',
    stroke?.join ?? '',
  ].join('|');
  let style = TEXT_STYLE_CACHE.get(key);
  if (!style) {
    style = new TextStyle({
      fill: opts.fill ?? TEXT,
      fontSize: opts.size ?? 10,
      fontWeight: opts.weight ?? '500',
      fontFamily: opts.fontFamily ?? FONT,
      letterSpacing: opts.letterSpacing ?? 0,
      stroke: opts.stroke,
    });
    TEXT_STYLE_CACHE.set(key, style);
  }
  return style;
}

const TEXT_STYLE_CACHE = new Map<string, TextStyle>();

function labelStyle(): { size: number; weight: '700'; fill: number; letterSpacing: number } {
  return { size: 8, weight: '700', fill: SUBTLE, letterSpacing: 0.8 };
}

function metricStyle(
  size: number,
  fill: number,
  anchorX = 0,
): { size: number; weight: '900'; fill: number; fontFamily: string; anchorX: number } {
  return { size, weight: '900', fill, fontFamily: NUMERIC_FONT, anchorX };
}

function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0';
  return String(Math.max(0, Math.floor(value)));
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

function judgeColor(judge: string): number {
  switch (judge) {
    case 'PERFECT':
      return AMBER;
    case 'GREAT':
      return GREEN;
    case 'GOOD':
      return BLUE;
    case 'BAD':
      return ORANGE;
    case 'POOR':
      return RED;
    default:
      return TEXT;
  }
}
