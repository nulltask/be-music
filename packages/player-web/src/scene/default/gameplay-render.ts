import { Container, Graphics } from 'pixi.js';
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
import { addChromeText } from './chrome-text.ts';
import { beatImpulse, clamp01, impactOffset, slamOffset, slamScale, staggerProgress } from './motion.ts';
import {
  DEFAULT_BG_BANDS,
  DEFAULT_THEME,
  defaultJudgeColor,
  fillParallelogram,
  fillSlash,
  strokeParallelogram,
} from './theme.ts';

const SCORE_PANEL = { x: 384, y: 350, w: 238, h: 112 } as const;
const PLAYFIELD_FRAME_BOTTOM = 344;
const JUDGE_SLAM_MS = 180;
const INTRO_MS = 520;

type PlaySide = '1P' | '2P';

const judgeSlamAt = new Map<string, number>();
const judgeSlamKey = new Map<string, string>();

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
 * Built-in gameplay chrome for the default skin family. Cut-in stamps, diagonal plates, and beat-synced slashes —
 * the playfield geometry contract stays the LR2 default 7-keys rectangle.
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
  const nowMs = runtime.nowMs ?? 0;
  const introT = staggerProgress(nowMs, 0, INTRO_MS);
  const pulse = beatImpulse(runtime.beatPhase);
  frame.label = 'default-gameplay/chrome';
  drawBackground(frame, hasBga);
  drawPlayfield(frame, playfield, runtime.progressRatio, pulse);
  drawBgaFrame(frame, hasBga, pulse);
  drawGauge(frame, runtime.gauge, runtime.clearThreshold, runtime.gaugeSurvival === true, nowMs, pulse);
  drawSongPlate(frame);
  drawScorePlate(frame, runtime.exScore, runtime.exScoreMax);
  const tallyX = resolveJudgeTallyX(playfield);
  if (tallyX !== undefined) {
    drawJudgeTally(frame, layer, runtime, tallyX, layerPool, introT);
  }
  if (!layerPool) {
    layer.addChildAt(frame, 0);
  }

  const frontLayer = options.overlayLayer && options.overlayLayerPool ? options.overlayLayer : layer;
  const frontPool = frontLayer === layer ? layerPool : options.overlayLayerPool;
  drawStatusBar(frontLayer, runtime.autoplay === true, pulse, frontPool);
  const headerSlam = slamScale(introT, 1.8);
  const headerThrow = slamOffset(introT, -36);
  addChromeText(
    frontLayer,
    runtime.autoplay ? 'AUTO' : 'PLAY',
    58,
    10,
    {
      size: 18,
      fill: runtime.autoplay ? DEFAULT_THEME.gold : DEFAULT_THEME.paper,
      fontFamily: DEFAULT_NUMERIC_FONT,
      letterSpacing: 1.6,
      anchorX: 0.5,
      rotation: -0.12,
      slam: headerSlam,
      offsetX: headerThrow,
      stroke: { color: DEFAULT_THEME.ink, width: 4, alignment: 0.5, join: 'round' },
    },
    frontPool,
  );
  addChromeText(frontLayer, 'BPM', 118, 8, { ...stampLabel(), offsetX: slamOffset(introT, -18) }, frontPool);
  addChromeText(
    frontLayer,
    formatBpmValue(runtime.bpm),
    148,
    6,
    {
      size: 22,
      fill: DEFAULT_THEME.paper,
      fontFamily: DEFAULT_NUMERIC_FONT,
      slam: slamScale(staggerProgress(nowMs, 40, 280), 1.7),
      offsetX: slamOffset(staggerProgress(nowMs, 40, 280), -24),
    },
    frontPool,
  );
  addChromeText(frontLayer, 'HI-SPEED', 210, 8, stampLabel(), frontPool);
  addChromeText(
    frontLayer,
    `x${formatHiSpeed(runtime.hiSpeed)}`,
    268,
    6,
    {
      size: 22,
      fill: DEFAULT_THEME.paper,
      fontFamily: DEFAULT_NUMERIC_FONT,
      slam: slamScale(staggerProgress(nowMs, 80, 280), 1.7),
    },
    frontPool,
  );
  addChromeText(frontLayer, 'RULESET', 400, 8, { ...stampLabel(), fill: DEFAULT_THEME.mute }, frontPool);
  addChromeText(
    frontLayer,
    formatRulesetLabel(runtime.rulesetLabel),
    502,
    6,
    {
      size: 16,
      fill: DEFAULT_THEME.crimson,
      fontFamily: DEFAULT_NUMERIC_FONT,
      letterSpacing: 1.2,
      anchorX: 1,
      maxWidth: 72,
      rotation: -0.06,
      slam: slamScale(staggerProgress(nowMs, 110, 260), 2.1),
    },
    frontPool,
  );

  const gauge = clampPercent(runtime.gauge ?? 0);
  const clearLine = clampPercent(runtime.clearThreshold ?? 80);
  const survivalGauge = runtime.gaugeSurvival === true || clearLine <= 0;
  const gaugeCleared = survivalGauge ? gauge > 0 : gauge >= clearLine;
  addChromeText(
    layer,
    `${(runtime.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`,
    GROOVE.x - 2,
    GROOVE.y - 18,
    { ...stampLabel(), maxWidth: 120 },
    layerPool,
  );
  addChromeText(
    layer,
    `${Math.round(gauge)}%`,
    GROOVE.x + GROOVE.w + 8,
    GROOVE.y - 26,
    {
      size: 22,
      fill: survivalGauge
        ? gaugeCleared
          ? DEFAULT_THEME.crimson
          : DEFAULT_THEME.mute
        : gaugeCleared
          ? DEFAULT_THEME.crimson
          : 0xff8a3d,
      fontFamily: DEFAULT_NUMERIC_FONT,
      slam: 1 + pulse * 0.08,
    },
    layerPool,
  );

  const title = runtime.songTitle?.trim() || 'Untitled chart';
  addChromeText(
    layer,
    title,
    30,
    414,
    {
      size: 15,
      fill: DEFAULT_THEME.paper,
      fontFamily: DEFAULT_TEXT_FONT,
      maxWidth: 318,
      slam: slamScale(staggerProgress(nowMs, 160, 320), 1.35),
      offsetX: slamOffset(staggerProgress(nowMs, 160, 320), -28),
      rotation: -0.02,
    },
    layerPool,
  );
  const artist = runtime.songArtist?.trim();
  if (artist) {
    addChromeText(
      layer,
      artist,
      30,
      438,
      {
        size: 10,
        fill: DEFAULT_THEME.mute,
        fontFamily: DEFAULT_TEXT_FONT,
        maxWidth: 318,
      },
      layerPool,
    );
  }

  const rank = runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F';
  addChromeText(layer, 'SCORE', SCORE_PANEL.x + 14, SCORE_PANEL.y + 12, stampLabel(), layerPool);
  addChromeText(
    layer,
    formatCount(runtime.score),
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 14,
    { size: 24, fill: DEFAULT_THEME.gold, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: 112 },
    layerPool,
  );
  addChromeText(layer, 'EX SCORE', SCORE_PANEL.x + 14, SCORE_PANEL.y + 44, stampLabel(), layerPool);
  addChromeText(
    layer,
    `${formatCount(runtime.exScore)} / ${formatCount(runtime.exScoreMax)}`,
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 48,
    { size: 14, fill: DEFAULT_THEME.paper, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: 112 },
    layerPool,
  );
  addChromeText(layer, 'EX RATE', SCORE_PANEL.x + 14, SCORE_PANEL.y + 74, stampLabel(), layerPool);
  addChromeText(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 78,
    { size: 14, fill: DEFAULT_THEME.paper, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: 112 },
    layerPool,
  );
  addChromeText(layer, 'COMBO', SCORE_PANEL.x + 148, SCORE_PANEL.y + 16, stampLabel(), layerPool);
  addChromeText(
    layer,
    formatCount(runtime.combo),
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 10,
    {
      size: 18,
      fill: DEFAULT_THEME.crimson,
      fontFamily: DEFAULT_JUDGE_FONT,
      maxWidth: 40,
      slam: 1 + pulse * 0.06,
    },
    layerPool,
  );
  addChromeText(layer, 'MAX', SCORE_PANEL.x + 148, SCORE_PANEL.y + 48, stampLabel(), layerPool);
  addChromeText(
    layer,
    formatCount(runtime.maxCombo),
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 42,
    { size: 16, fill: DEFAULT_THEME.paper, fontFamily: DEFAULT_JUDGE_FONT, maxWidth: 40 },
    layerPool,
  );
  addChromeText(layer, 'RANK', SCORE_PANEL.x + 148, SCORE_PANEL.y + 78, stampLabel(), layerPool);
  addChromeText(
    layer,
    rank,
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 64,
    {
      size: 26,
      fill: DEFAULT_THEME.gold,
      fontFamily: DEFAULT_NUMERIC_FONT,
      maxWidth: 42,
      rotation: -0.08,
    },
    layerPool,
  );

  drawBeatSlashes(frontLayer, pulse, frontPool);
  drawIntroWipe(frontLayer, introT, frontPool);

  for (const display of resolveJudgeDisplays(runtime, playfield)) {
    paintJudgeStamp(frontLayer, display, nowMs, frontPool);
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

function drawBackground(frame: Graphics, hasBga: boolean): void {
  let bandTop = 0;
  for (const [color, bandBottom] of DEFAULT_BG_BANDS) {
    fillBandAroundHole(frame, bandTop, bandBottom, color, hasBga);
    bandTop = bandBottom;
  }
  fillSlash(frame, -40, 8, 220, 18, 14, DEFAULT_THEME.crimson, 0.22);
  fillSlash(frame, 420, 430, 280, 22, 16, DEFAULT_THEME.crimson, 0.16);
  frame.rect(0, 0, DESIGN_WIDTH, 6).fill({ color: 0x000000, alpha: 0.45 });
  frame.rect(0, DESIGN_HEIGHT - 14, DESIGN_WIDTH, 14).fill({ color: 0x000000, alpha: 0.35 });
}

function fillBandAroundHole(frame: Graphics, top: number, bottom: number, color: number, hasBga: boolean): void {
  const height = bottom - top;
  if (height <= 0) return;
  if (!hasBga || bottom <= BGA.y || top >= BGA.y + BGA.h) {
    frame.rect(0, top, DESIGN_WIDTH, height).fill(color);
    return;
  }
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

function drawPlayfield(
  frame: Graphics,
  playfield: FallbackPlayfieldLayout,
  progressRatio: number | undefined,
  pulse: number,
): void {
  const wellTop = PLAYFIELD.y;
  const wellBottom = PLAYFIELD_FRAME_BOTTOM;
  const wellHeight = wellBottom - wellTop;
  const railW = 8;
  const leftRailX = playfield.x - railW - 2;
  const rightRailX = playfield.right + 2;

  frame.rect(playfield.x - 2, wellTop, playfield.w + 4, wellHeight).fill(DEFAULT_THEME.lane);
  frame.rect(playfield.x - 2, wellTop, playfield.w + 4, 90).fill({ color: 0x000000, alpha: 0.5 });
  if (playfield.sideGap) {
    frame.rect(playfield.sideGap.x, wellTop, playfield.sideGap.w, wellHeight).fill({
      color: DEFAULT_THEME.inkDeep,
      alpha: 0.96,
    });
  }

  for (const railX of [leftRailX, rightRailX]) {
    frame.rect(railX, wellTop, railW, wellBottom).fill(DEFAULT_THEME.rail);
    frame.rect(railX, wellTop, 1, wellBottom).fill({ color: DEFAULT_THEME.railEdge, alpha: 0.95 });
    frame
      .rect(railX + railW - 1, wellTop, 1, wellBottom)
      .fill({ color: DEFAULT_THEME.crimson, alpha: 0.55 + 0.4 * pulse });
  }

  const trackX = leftRailX + 2;
  const trackTop = wellTop + 6;
  const trackHeight = wellBottom - 12 - trackTop;
  frame.rect(trackX, trackTop, railW - 4, trackHeight).fill({ color: 0x000000, alpha: 0.55 });
  const ratio =
    progressRatio !== undefined && Number.isFinite(progressRatio) ? Math.max(0, Math.min(1, progressRatio)) : 0;
  if (ratio > 0) {
    const fillHeight = Math.max(2, Math.round(trackHeight * ratio));
    frame.rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, fillHeight).fill({
      color: DEFAULT_THEME.crimson,
      alpha: 0.9,
    });
    frame
      .rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, 2)
      .fill({ color: DEFAULT_THEME.paper, alpha: 0.95 });
  }

  fillParallelogram(frame, leftRailX, wellBottom, rightRailX + railW - leftRailX, 6, 8, DEFAULT_THEME.rail, 1);
  fillSlash(
    frame,
    leftRailX - 4,
    wellBottom - 2,
    rightRailX + railW - leftRailX + 10,
    4,
    3,
    DEFAULT_THEME.crimson,
    0.85,
  );
}

function resolveJudgeTallyX(playfield: FallbackPlayfieldLayout): number | undefined {
  const x = BGA.x + BGA.w + 13;
  return playfield.right + 14 <= x && x + 76 <= DESIGN_WIDTH ? x : undefined;
}

function drawBgaFrame(frame: Graphics, hasBga: boolean, pulse: number): void {
  const pad = 10;
  fillParallelogram(
    frame,
    BGA.x - pad,
    BGA.y - 12,
    BGA.w + pad * 2,
    BGA.h + 24,
    10,
    DEFAULT_THEME.panel,
    hasBga ? 0 : 0.88,
  );
  strokeParallelogram(
    frame,
    BGA.x - pad,
    BGA.y - 12,
    BGA.w + pad * 2,
    BGA.h + 24,
    10,
    DEFAULT_THEME.crimson,
    2,
    0.7 + 0.3 * pulse,
  );
  if (!hasBga) {
    frame.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill({ color: DEFAULT_THEME.inkDeep, alpha: 0.96 });
    const cx = BGA.x + BGA.w / 2;
    const cy = BGA.y + BGA.h / 2;
    fillSlash(frame, cx - 90, cy - 10, 180, 8, 18, DEFAULT_THEME.crimson, 0.55);
    fillSlash(frame, cx - 80, cy + 8, 160, 5, -14, DEFAULT_THEME.paper, 0.35);
  }
  for (const [bx, by, dx, dy] of [
    [BGA.x, BGA.y, 1, 1],
    [BGA.x + BGA.w, BGA.y, -1, 1],
    [BGA.x, BGA.y + BGA.h, 1, -1],
    [BGA.x + BGA.w, BGA.y + BGA.h, -1, -1],
  ] as const) {
    frame.rect(dx > 0 ? bx : bx - 16, by - (dy < 0 ? 2 : 0), 16, 3).fill({ color: DEFAULT_THEME.paper, alpha: 0.8 });
    frame.rect(bx - (dx < 0 ? 2 : 0), dy > 0 ? by : by - 16, 3, 16).fill({ color: DEFAULT_THEME.paper, alpha: 0.8 });
  }
}

function drawStatusBar(layer: Container, autoplay: boolean, pulse: number, pool?: ChildPool): void {
  const status = pool?.acquireGraphics() ?? new Graphics();
  status.label = 'default-gameplay/status';
  fillParallelogram(status, -12, 0, DESIGN_WIDTH + 24, 40, 18, DEFAULT_THEME.ink, 1);
  fillSlash(
    status,
    -20,
    32,
    DESIGN_WIDTH + 40,
    6,
    4,
    autoplay ? DEFAULT_THEME.gold : DEFAULT_THEME.crimson,
    0.55 + 0.45 * pulse,
  );
  fillParallelogram(status, 12, 8, 92, 22, 10, DEFAULT_THEME.crimson, 0.95);
  fillParallelogram(status, 392, 8, 118, 22, 8, DEFAULT_THEME.panel, 0.95);
  strokeParallelogram(status, 392, 8, 118, 22, 8, DEFAULT_THEME.crimson, 1.5, 0.85);
  if (!pool) {
    layer.addChild(status);
  }
}

function drawGauge(
  frame: Graphics,
  value: number | undefined,
  threshold: number | undefined,
  survivalGauge: boolean,
  nowMs?: number,
  pulse = 0,
): void {
  const gauge = clampPercent(value ?? 0);
  const clear = clampPercent(threshold ?? 80);
  const survival = survivalGauge || clear <= 0;
  const cellCount = 50;
  const cellStride = GROOVE.w / cellCount;
  const cellW = cellStride - 1;
  const litCells = Math.round((gauge / 100) * cellCount);
  const clearCell = Math.round((clear / 100) * cellCount);

  fillParallelogram(frame, GROOVE.x - 12, GROOVE.y - 26, GROOVE.w + 24, 50, 10, DEFAULT_THEME.panel, 1);
  strokeParallelogram(frame, GROOVE.x - 12, GROOVE.y - 26, GROOVE.w + 24, 50, 10, DEFAULT_THEME.crimson, 1, 0.7);
  frame.rect(GROOVE.x - 4, GROOVE.y - 3, GROOVE.w + 8, GROOVE.h + 6).fill(DEFAULT_THEME.inkDeep);

  const flicker = nowMs !== undefined ? 0.72 + 0.28 * Math.abs(Math.sin(nowMs / 70)) : 1;
  for (let cell = 0; cell < litCells; cell += 1) {
    const hot = survival || cell >= clearCell;
    const isTip = cell === litCells - 1;
    const color = hot ? DEFAULT_THEME.crimson : 0xff8a3d;
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, GROOVE.h).fill({
      color: isTip ? DEFAULT_THEME.paper : color,
      alpha: isTip ? flicker : hot ? 0.96 : 0.9,
    });
  }
  for (let cell = litCells; cell < cellCount; cell += 1) {
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, GROOVE.h).fill({ color: 0x1a1010, alpha: 0.92 });
  }
  if (!survival) {
    const clearX = GROOVE.x + Math.round(clearCell * cellStride) - 1;
    frame.rect(clearX, GROOVE.y - 6, 2, GROOVE.h + 12).fill({ color: DEFAULT_THEME.paper, alpha: 0.95 });
  }
  if (pulse > 0.4 && litCells > 0) {
    fillSlash(frame, GROOVE.x - 6, GROOVE.y - 4, GROOVE.w + 16, 3, 2, DEFAULT_THEME.paper, 0.18 * pulse);
  }
}

function drawSongPlate(frame: Graphics): void {
  fillParallelogram(frame, 14, 402, 356, 62, 14, DEFAULT_THEME.panel, 1);
  strokeParallelogram(frame, 14, 402, 356, 62, 14, DEFAULT_THEME.line, 1, 0.9);
  fillSlash(frame, 10, 408, 28, 50, 8, DEFAULT_THEME.crimson, 0.95);
}

function drawScorePlate(frame: Graphics, exScore: number | undefined, exScoreMax: number | undefined): void {
  fillParallelogram(frame, SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w, SCORE_PANEL.h, 12, DEFAULT_THEME.panel, 1);
  strokeParallelogram(
    frame,
    SCORE_PANEL.x,
    SCORE_PANEL.y,
    SCORE_PANEL.w,
    SCORE_PANEL.h,
    12,
    DEFAULT_THEME.line,
    1,
    0.9,
  );
  fillSlash(frame, SCORE_PANEL.x - 4, SCORE_PANEL.y, SCORE_PANEL.w + 8, 5, 3, DEFAULT_THEME.crimson, 0.85);
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 40, 116, 1).fill({ color: DEFAULT_THEME.line, alpha: 0.6 });
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 70, 116, 1).fill({ color: DEFAULT_THEME.line, alpha: 0.6 });
  frame
    .rect(SCORE_PANEL.x + 140, SCORE_PANEL.y + 12, 1, SCORE_PANEL.h - 24)
    .fill({ color: DEFAULT_THEME.line, alpha: 0.5 });

  const meterX = SCORE_PANEL.x + 12;
  const meterY = SCORE_PANEL.y + 100;
  const meterW = 116;
  const rate =
    exScore !== undefined && exScoreMax !== undefined && exScoreMax > 0
      ? Math.max(0, Math.min(1, exScore / exScoreMax))
      : 0;
  frame.rect(meterX, meterY, meterW, 4).fill({ color: 0x000000, alpha: 0.6 });
  if (rate > 0) {
    frame.rect(meterX, meterY, Math.max(1, Math.round(meterW * rate)), 4).fill({
      color: rate >= 8 / 9 ? DEFAULT_THEME.gold : DEFAULT_THEME.crimson,
      alpha: 0.95,
    });
  }
  for (let ninth = 1; ninth < 9; ninth += 1) {
    frame.rect(meterX + Math.round((meterW * ninth) / 9), meterY - 1, 1, 6).fill({
      color: DEFAULT_THEME.paper,
      alpha: ninth >= 6 ? 0.55 : 0.22,
    });
  }
}

const JUDGE_TALLY_ROWS: ReadonlyArray<readonly [label: string, key: 'perfect' | 'great' | 'good' | 'bad' | 'poor']> = [
  ['PG', 'perfect'],
  ['GR', 'great'],
  ['GD', 'good'],
  ['BD', 'bad'],
  ['PR', 'poor'],
];

function drawJudgeTally(
  frame: Graphics,
  layer: Container,
  runtime: FallbackGameplayRuntime,
  x: number,
  pool: ChildPool | undefined,
  introT: number,
): void {
  const y = BGA.y - 12;
  const w = DESIGN_WIDTH - x - 12;
  const rowH = 24;
  const h = 16 + JUDGE_TALLY_ROWS.length * rowH + 48;
  fillParallelogram(frame, x, y, w, h, 8, DEFAULT_THEME.panel, 0.94);
  strokeParallelogram(frame, x, y, w, h, 8, DEFAULT_THEME.line, 1, 0.9);
  addChromeText(layer, 'JUDGE', x + 8, y + 4, { ...stampLabel(), slam: slamScale(introT, 1.6) }, pool);
  for (let row = 0; row < JUDGE_TALLY_ROWS.length; row += 1) {
    const [label, key] = JUDGE_TALLY_ROWS[row]!;
    const rowY = y + 20 + row * rowH;
    const color = defaultJudgeColor(TALLY_JUDGE_NAMES[key]);
    fillSlash(frame, x + 4, rowY + 4, 10, 12, 3, color, 0.95);
    addChromeText(
      layer,
      label,
      x + 16,
      rowY + 4,
      { size: 11, fill: color, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 0.6 },
      pool,
    );
    addChromeText(
      layer,
      formatCount(runtime[key]),
      x + w - 8,
      rowY,
      {
        size: 16,
        fill: DEFAULT_THEME.paper,
        fontFamily: DEFAULT_NUMERIC_FONT,
        maxWidth: w - 42,
        slam: slamScale(staggerProgress(introT * INTRO_MS, 40 + row * 30, 220), 1.8),
      },
      pool,
    );
  }
  const footerY = y + 20 + JUDGE_TALLY_ROWS.length * rowH + 4;
  frame.rect(x + 6, footerY - 4, w - 12, 1).fill({ color: DEFAULT_THEME.line, alpha: 0.6 });
  const footerRows: ReadonlyArray<readonly [label: string, color: number, count: number | undefined]> = [
    ['FAST', DEFAULT_THEME.paper, runtime.fast],
    ['SLOW', DEFAULT_THEME.gold, runtime.slow],
  ];
  for (let row = 0; row < footerRows.length; row += 1) {
    const [label, color, count] = footerRows[row]!;
    const rowY = footerY + 2 + row * 20;
    addChromeText(
      layer,
      label,
      x + 14,
      rowY + 2,
      { size: 10, fill: color, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 0.8 },
      pool,
    );
    addChromeText(
      layer,
      formatCount(count),
      x + w - 8,
      rowY,
      { size: 14, fill: DEFAULT_THEME.paper, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: w - 48 },
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
  side: PlaySide;
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
      side: state.side,
      judge: state.judge!,
      combo: state.combo,
      x: resolveJudgeDisplayX(playfield, state.side),
      maxWidth,
    }));
  }
  if (!runtime.lastJudge) {
    return [];
  }
  return [
    {
      side: '1P',
      judge: runtime.lastJudge,
      combo: runtime.combo,
      x: resolveJudgeDisplayX(playfield, '1P'),
      maxWidth,
    },
  ];
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

function paintJudgeStamp(layer: Container, display: ResolvedJudgeDisplay, nowMs: number, pool?: ChildPool): void {
  const slamT = noteJudgeSlam(display.side, display.judge, display.combo, nowMs);
  const color = defaultJudgeColor(display.judge);
  const jitter = impactOffset(slamT, 8);
  const slam = slamScale(slamT, 2.6);
  const throwX = slamOffset(slamT, -40);
  if (slamT < 1) {
    addChromeText(
      layer,
      display.judge,
      display.x,
      228,
      {
        size: 28,
        fill: DEFAULT_THEME.crimson,
        fontFamily: DEFAULT_JUDGE_FONT,
        anchorX: 0.5,
        rotation: -0.1,
        slam,
        offsetX: throwX - jitter,
        alpha: 0.55,
        maxWidth: display.maxWidth,
      },
      pool,
    );
    addChromeText(
      layer,
      display.judge,
      display.x,
      228,
      {
        size: 28,
        fill: DEFAULT_THEME.cyanGhost,
        fontFamily: DEFAULT_JUDGE_FONT,
        anchorX: 0.5,
        rotation: -0.1,
        slam,
        offsetX: throwX + jitter,
        alpha: 0.4,
        maxWidth: display.maxWidth,
      },
      pool,
    );
  }
  addChromeText(
    layer,
    display.judge,
    display.x,
    230,
    {
      size: 28,
      fill: color,
      fontFamily: DEFAULT_JUDGE_FONT,
      anchorX: 0.5,
      rotation: -0.08,
      slam,
      offsetX: throwX,
      stroke: { color: DEFAULT_THEME.ink, width: 5, alignment: 0.5, join: 'round' },
      dropShadow: { color, alpha: 0.45, blur: 6, distance: 0 },
      maxWidth: display.maxWidth,
    },
    pool,
  );
  const combo = resolveVisibleCombo(display.judge, display.combo);
  if (combo > 0) {
    addChromeText(
      layer,
      formatCount(combo),
      display.x,
      258,
      {
        size: 22,
        fill: combo >= 200 ? DEFAULT_THEME.gold : combo >= 50 ? DEFAULT_THEME.crimson : DEFAULT_THEME.paper,
        fontFamily: DEFAULT_JUDGE_FONT,
        anchorX: 0.5,
        rotation: -0.05,
        slam: slamScale(slamT, 2.1),
        offsetX: throwX,
        stroke: { color: DEFAULT_THEME.ink, width: 4, alignment: 0.5, join: 'round' },
        maxWidth: Math.max(72, display.maxWidth - 36),
      },
      pool,
    );
  }
  drawJudgeFlash(layer, display.x, slamT, pool);
}

function noteJudgeSlam(side: string, judge: string, combo: number | undefined, nowMs: number): number {
  const key = `${judge}:${combo ?? 0}`;
  if (judgeSlamKey.get(side) !== key) {
    judgeSlamKey.set(side, key);
    judgeSlamAt.set(side, nowMs);
  }
  const started = judgeSlamAt.get(side) ?? nowMs;
  return clamp01((nowMs - started) / JUDGE_SLAM_MS);
}

function drawJudgeFlash(layer: Container, x: number, slamT: number, pool?: ChildPool): void {
  if (slamT >= 1) return;
  const flash = pool?.acquireGraphics() ?? new Graphics();
  flash.label = 'default-gameplay/judge-flash';
  const alpha = (1 - slamT) * 0.45;
  fillSlash(flash, x - 90, 210, 180, 18, 12, DEFAULT_THEME.paper, alpha);
  fillSlash(flash, x - 70, 248, 140, 8, -8, DEFAULT_THEME.crimson, alpha * 0.8);
  if (!pool) {
    layer.addChild(flash);
  }
}

function drawBeatSlashes(layer: Container, pulse: number, pool?: ChildPool): void {
  if (pulse <= 0.02) return;
  const slashes = pool?.acquireGraphics() ?? new Graphics();
  slashes.label = 'default-gameplay/beat-slash';
  fillSlash(slashes, -30, 60, 180, 7, 22, DEFAULT_THEME.crimson, 0.28 * pulse);
  fillSlash(slashes, 480, 300, 200, 6, -18, DEFAULT_THEME.paper, 0.16 * pulse);
  fillSlash(slashes, 250, 8, 140, 4, 8, DEFAULT_THEME.gold, 0.22 * pulse);
  if (!pool) {
    layer.addChild(slashes);
  }
}

function drawIntroWipe(layer: Container, introT: number, pool?: ChildPool): void {
  if (introT >= 1) return;
  const wipe = pool?.acquireGraphics() ?? new Graphics();
  wipe.label = 'default-gameplay/intro-wipe';
  const cover = 1 - introT;
  fillParallelogram(wipe, -80, -20, DESIGN_WIDTH * cover + 120, DESIGN_HEIGHT + 40, 80, DEFAULT_THEME.ink, 0.96);
  fillSlash(wipe, DESIGN_WIDTH * cover - 40, -10, 90, DESIGN_HEIGHT + 20, 40, DEFAULT_THEME.crimson, 0.9);
  fillSlash(wipe, DESIGN_WIDTH * cover + 20, 20, 40, DESIGN_HEIGHT, 28, DEFAULT_THEME.paper, 0.55);
  if (!pool) {
    layer.addChild(wipe);
  }
}

function stampLabel(): { size: number; fill: number; fontFamily: string; letterSpacing: number } {
  return { size: 9, fill: DEFAULT_THEME.mute, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 1.1 };
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
