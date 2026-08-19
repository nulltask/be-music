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
import type { DefaultHudMotion } from './hud-motion.ts';
import { resolveJudgeHudDisplays } from './judge-hud.ts';
import {
  beatImpulse,
  impactOffset,
  introFill,
  judgePopup,
  slamAlpha,
  slamOffset,
  slamScale,
  staggerProgress,
} from './motion.ts';
import { coverAmount, fallbackSceneElapsed, GAMEPLAY_TIMELINE, pieceRawT, readyAlpha } from './transition.ts';
import {
  DEFAULT_THEME as T,
  DEFAULT_BG_BANDS,
  defaultJudgeColor,
  fillDiamond,
  fillDiamondCluster,
  fillParallelogram,
  fillSlash,
  paintSceneCover,
  playfieldComboFill,
  strokeDiamond,
  strokeParallelogram,
} from './theme.ts';

const SCORE_PANEL = { x: 384, y: 350, w: 238, h: 112 } as const;
const PLAYFIELD_FRAME_BOTTOM = 344;

type PlaySide = '1P' | '2P';

export type FallbackGameplayRuntime = SkinlessGameplayChromeRuntime;

export interface FallbackGameplayRenderOptions {
  overlayLayer?: Container;
  layerPool?: ChildPool;
  overlayLayerPool?: ChildPool;
  motion?: DefaultHudMotion;
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

export function renderDefaultGameplayFrame(
  layer: Container,
  runtime: FallbackGameplayRuntime = {},
  options: FallbackGameplayRenderOptions = {},
): void {
  const layerPool = options.layerPool;
  const frame = layerPool?.acquireGraphics() ?? new Graphics();
  const hasBga = runtime.hasBga === true;
  const playfield = resolveFallbackPlayfieldLayout(runtime.laneChannels, runtime.laneCount, runtime.playVariant);
  const nowMs = runtime.nowMs ?? 10_000;
  const elapsed = fallbackSceneElapsed(runtime.sceneElapsedMs);
  if (elapsed <= 0) options.motion?.reset();
  const pulse = beatImpulse(runtime.beatPhase);
  frame.label = 'default-gameplay/chrome';
  drawBackground(frame, hasBga, nowMs);
  drawPlayfield(frame, playfield, runtime.progressRatio, pulse, pieceRawT(elapsed, GAMEPLAY_TIMELINE.playfield), nowMs);
  drawBgaFrame(frame, hasBga, pulse, pieceRawT(elapsed, GAMEPLAY_TIMELINE.bga), nowMs);
  drawGauge(frame, runtime, pieceRawT(elapsed, GAMEPLAY_TIMELINE.gauge), nowMs, pulse);
  drawSongPlate(frame, pieceRawT(elapsed, GAMEPLAY_TIMELINE.song), nowMs);
  drawScorePlate(frame, runtime.exScore, runtime.exScoreMax, pieceRawT(elapsed, GAMEPLAY_TIMELINE.score), nowMs);
  const tallyX = resolveJudgeTallyX(playfield);
  if (tallyX !== undefined) {
    drawJudgeTally(frame, layer, runtime, tallyX, pieceRawT(elapsed, GAMEPLAY_TIMELINE.tally), layerPool);
  }
  if (!layerPool) layer.addChildAt(frame, 0);

  const frontLayer = options.overlayLayer && options.overlayLayerPool ? options.overlayLayer : layer;
  const frontPool = frontLayer === layer ? layerPool : options.overlayLayerPool;
  const headerT = pieceRawT(elapsed, GAMEPLAY_TIMELINE.header);
  drawStatusBar(frontLayer, runtime.autoplay === true, pulse, headerT, nowMs, frontPool);
  paintHeaderTexts(frontLayer, runtime, headerT, frontPool);
  const punches = options.motion?.sample({
    judge: runtime.lastJudge,
    combo: runtime.combo,
    score: runtime.score,
    nowMs,
  });
  paintSongTexts(layer, runtime, pieceRawT(elapsed, GAMEPLAY_TIMELINE.song), layerPool);
  paintGaugeTexts(layer, runtime, pieceRawT(elapsed, GAMEPLAY_TIMELINE.gauge), pulse, layerPool);
  paintScoreTexts(layer, runtime, pieceRawT(elapsed, GAMEPLAY_TIMELINE.score), punches, pulse, layerPool);
  paintJudge(frontLayer, runtime, playfield, punches, nowMs, frontPool);
  paintReady(frontLayer, elapsed, nowMs, frontPool);
  drawBeatSlashes(frontLayer, pulse, nowMs, frontPool);

  paintSceneCover(
    frontLayer,
    coverAmount(elapsed, GAMEPLAY_TIMELINE.coverDelay, GAMEPLAY_TIMELINE.coverDuration, 'open'),
    nowMs,
    { pool: frontPool },
  );
}

export const renderFallbackLr2Frame: typeof renderDefaultGameplayFrame = renderDefaultGameplayFrame;

function drawBackground(frame: Graphics, hasBga: boolean, nowMs: number): void {
  let bandTop = 0;
  for (const [color, bandBottom] of DEFAULT_BG_BANDS) {
    fillBandAroundHole(frame, bandTop, bandBottom, color, hasBga);
    bandTop = bandBottom;
  }
  fillSlash(frame, -40, 8, 220, 18, 14, T.accent, 0.22);
  fillSlash(frame, 420, 430, 280, 22, 16, T.accent, 0.16);
  fillDiamond(frame, { cx: 580, cy: 28, rx: 11, ry: 15, nowMs, wobble: 3.2 }, T.accent, 0.32);
  fillDiamond(frame, { cx: 18, cy: 458, rx: 10, ry: 13, nowMs, phase: 0.8, wobble: 2.8 }, T.accent, 0.24);
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
  if (sideBounds['1P']) sideCenters['1P'] = (sideBounds['1P'].left + sideBounds['1P'].right) / 2;
  if (sideBounds['2P']) sideCenters['2P'] = (sideBounds['2P'].left + sideBounds['2P'].right) / 2;
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
  t: number,
  nowMs: number,
): void {
  if (t <= 0) return;
  const wellTop = PLAYFIELD.y;
  const wellBottom = PLAYFIELD_FRAME_BOTTOM;
  const wellHeight = wellBottom - wellTop;
  const railW = 8;
  const leftRailX = playfield.x - railW - 2;
  const rightRailX = playfield.right + 2;
  const throwX = slamOffset(t, -28);
  frame.rect(playfield.x - 2 + throwX, wellTop, playfield.w + 4, wellHeight).fill({ color: T.lane, alpha: slamAlpha(t) });
  frame.rect(playfield.x - 2 + throwX, wellTop, playfield.w + 4, 90).fill({ color: 0x000000, alpha: 0.5 * slamAlpha(t) });
  if (playfield.sideGap) {
    frame.rect(playfield.sideGap.x + throwX, wellTop, playfield.sideGap.w, wellHeight).fill({
      color: T.inkDeep,
      alpha: 0.96 * slamAlpha(t),
    });
  }
  for (const railX of [leftRailX, rightRailX]) {
    frame.rect(railX + throwX, wellTop, railW, wellBottom).fill({ color: T.rail, alpha: slamAlpha(t) });
    frame.rect(railX + throwX, wellTop, 1, wellBottom).fill({ color: T.railEdge, alpha: 0.95 * slamAlpha(t) });
    frame.rect(railX + railW - 1 + throwX, wellTop, 1, wellBottom).fill({
      color: T.accent,
      alpha: (0.55 + 0.4 * pulse) * slamAlpha(t),
    });
  }
  const trackX = leftRailX + 2 + throwX;
  const trackTop = wellTop + 6;
  const trackHeight = wellBottom - 12 - trackTop;
  frame.rect(trackX, trackTop, railW - 4, trackHeight).fill({ color: 0x000000, alpha: 0.55 * slamAlpha(t) });
  const ratio = progressRatio !== undefined && Number.isFinite(progressRatio) ? Math.max(0, Math.min(1, progressRatio)) : 0;
  if (ratio > 0) {
    const fillHeight = Math.max(2, Math.round(trackHeight * ratio));
    frame.rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, fillHeight).fill({
      color: T.accent,
      alpha: 0.9 * slamAlpha(t),
    });
    frame.rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, 2).fill({ color: T.paper, alpha: 0.95 * slamAlpha(t) });
  }
  fillParallelogram(frame, leftRailX + throwX, wellBottom, rightRailX + railW - leftRailX, 6, 8, T.rail, slamAlpha(t));
  fillSlash(
    frame,
    leftRailX - 4 + throwX,
    wellBottom - 2,
    rightRailX + railW - leftRailX + 10,
    4,
    3,
    T.accent,
    0.85 * slamAlpha(t),
  );
  fillDiamond(frame, { cx: leftRailX + throwX + 4, cy: wellTop + 18, rx: 6, ry: 8, nowMs, wobble: 2.6 }, T.accent, 0.7 * slamAlpha(t));
  fillDiamond(frame, { cx: rightRailX + throwX + 4, cy: wellTop + 18, rx: 6, ry: 8, nowMs, phase: 0.5, wobble: 2.6 }, T.accent, 0.7 * slamAlpha(t));
  fillDiamond(frame, { cx: leftRailX + throwX + 4, cy: wellBottom - 10, rx: 7, ry: 9, nowMs, phase: 1.1, wobble: 3 }, T.paper, 0.55 * slamAlpha(t));
  fillDiamond(frame, { cx: rightRailX + throwX + 4, cy: wellBottom - 10, rx: 7, ry: 9, nowMs, phase: 1.6, wobble: 3 }, T.paper, 0.55 * slamAlpha(t));
}

function resolveJudgeTallyX(playfield: FallbackPlayfieldLayout): number | undefined {
  const x = BGA.x + BGA.w + 13;
  return playfield.right + 14 <= x && x + 76 <= DESIGN_WIDTH ? x : undefined;
}

function drawBgaFrame(frame: Graphics, hasBga: boolean, pulse: number, t: number, nowMs: number): void {
  if (t <= 0) return;
  const pad = 10;
  const a = slamAlpha(t);
  fillParallelogram(frame, BGA.x - pad, BGA.y - 12, BGA.w + pad * 2, BGA.h + 24, 10, T.panel, hasBga ? 0 : 0.88 * a);
  strokeParallelogram(
    frame,
    BGA.x - pad,
    BGA.y - 12,
    BGA.w + pad * 2,
    BGA.h + 24,
    10,
    T.accent,
    2,
    (0.7 + 0.3 * pulse) * a,
  );
  if (!hasBga) {
    frame.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill({ color: T.inkDeep, alpha: 0.96 * a });
    const cx = BGA.x + BGA.w / 2;
    const cy = BGA.y + BGA.h / 2;
    fillDiamondCluster(frame, cx, cy, 54, 68, nowMs, T.accent, 0.45 * a, 6);
    strokeDiamond(frame, { cx, cy, rx: 72, ry: 90, nowMs, wobble: 7 }, T.paper, 1.5, 0.35 * a);
  }
  fillDiamond(frame, { cx: BGA.x - 2, cy: BGA.y - 2, rx: 8, ry: 10, nowMs, wobble: 3 }, T.accent, 0.55 * a);
  fillDiamond(frame, { cx: BGA.x + BGA.w + 2, cy: BGA.y - 2, rx: 8, ry: 10, nowMs, phase: 0.4, wobble: 3 }, T.paper, 0.4 * a);
  fillDiamond(frame, { cx: BGA.x - 2, cy: BGA.y + BGA.h + 2, rx: 8, ry: 10, nowMs, phase: 0.8, wobble: 3 }, T.paper, 0.4 * a);
  fillDiamond(frame, { cx: BGA.x + BGA.w + 2, cy: BGA.y + BGA.h + 2, rx: 8, ry: 10, nowMs, phase: 1.2, wobble: 3 }, T.accent, 0.55 * a);
  for (const [bx, by, dx, dy] of [
    [BGA.x, BGA.y, 1, 1],
    [BGA.x + BGA.w, BGA.y, -1, 1],
    [BGA.x, BGA.y + BGA.h, 1, -1],
    [BGA.x + BGA.w, BGA.y + BGA.h, -1, -1],
  ] as const) {
    frame.rect(dx > 0 ? bx : bx - 16, by - (dy < 0 ? 2 : 0), 16, 3).fill({ color: T.paper, alpha: 0.8 * a });
    frame.rect(bx - (dx < 0 ? 2 : 0), dy > 0 ? by : by - 16, 3, 16).fill({ color: T.paper, alpha: 0.8 * a });
  }
}

function drawStatusBar(layer: Container, autoplay: boolean, pulse: number, t: number, nowMs: number, pool?: ChildPool): void {
  const status = pool?.acquireGraphics() ?? new Graphics();
  status.label = 'default-gameplay/status';
  status.blendMode = 'normal';
  status.alpha = slamAlpha(t);
  status.position.set(0, slamOffset(t, -36));
  fillParallelogram(status, -12, 0, DESIGN_WIDTH + 24, 40, 18, T.ink, 1);
  fillSlash(status, -20, 32, DESIGN_WIDTH + 40, 6, 4, autoplay ? T.gold : T.accent, 0.55 + 0.45 * pulse);
  fillParallelogram(status, 12, 8, 92, 22, 10, T.accent, 0.95);
  fillDiamond(status, { cx: 24, cy: 19, rx: 7, ry: 9, nowMs, wobble: 2.4 }, T.paper, 0.95);
  fillParallelogram(status, 392, 8, 118, 22, 8, T.panel, 0.95);
  strokeParallelogram(status, 392, 8, 118, 22, 8, T.accent, 1.5, 0.85);
  if (!pool) layer.addChild(status);
}

function paintHeaderTexts(
  layer: Container,
  runtime: FallbackGameplayRuntime,
  t: number,
  pool?: ChildPool,
): void {
  const headerSlam = slamScale(t, 1.8);
  const headerThrow = slamOffset(t, -36);
  const a = slamAlpha(t);
  addChromeText(
    layer,
    runtime.autoplay ? 'AUTO' : 'PLAY',
    58,
    10,
    {
      size: 18,
      fill: runtime.autoplay ? T.gold : T.paper,
      fontFamily: DEFAULT_NUMERIC_FONT,
      letterSpacing: 1.6,
      anchorX: 0.5,
      rotation: -0.12,
      slam: headerSlam,
      offsetX: headerThrow,
      alpha: a,
      stroke: { color: T.ink, width: 4, alignment: 0.5, join: 'round' },
    },
    pool,
  );
  addChromeText(layer, 'BPM', 118, 8, { ...stampLabel(), offsetX: slamOffset(t, -18), alpha: a }, pool);
  addChromeText(
    layer,
    formatBpmValue(runtime.bpm),
    148,
    6,
    {
      size: 22,
      fill: T.paper,
      fontFamily: DEFAULT_NUMERIC_FONT,
      slam: slamScale(t, 1.7),
      offsetX: slamOffset(t, -24),
      alpha: a,
    },
    pool,
  );
  addChromeText(layer, 'HI-SPEED', 210, 8, { ...stampLabel(), alpha: a }, pool);
  addChromeText(
    layer,
    `x${formatHiSpeed(runtime.hiSpeed)}`,
    268,
    6,
    { size: 22, fill: T.paper, fontFamily: DEFAULT_NUMERIC_FONT, slam: slamScale(t, 1.7), alpha: a },
    pool,
  );
  addChromeText(layer, 'RULESET', 400, 8, { ...stampLabel(), fill: T.mute, alpha: a }, pool);
  addChromeText(
    layer,
    formatRulesetLabel(runtime.rulesetLabel),
    502,
    6,
    {
      size: 16,
      fill: T.accent,
      fontFamily: DEFAULT_NUMERIC_FONT,
      letterSpacing: 1.2,
      anchorX: 1,
      maxWidth: 72,
      rotation: -0.06,
      slam: slamScale(t, 2.1),
      alpha: a,
    },
    pool,
  );
}

function drawGauge(frame: Graphics, runtime: FallbackGameplayRuntime, t: number, nowMs: number, pulse: number): void {
  if (t <= 0) return;
  const a = slamAlpha(t);
  const gaugeActual = clampPercent(runtime.gauge ?? 0) / 100;
  const gauge = introFill(gaugeActual, t) * 100;
  const clear = clampPercent(runtime.clearThreshold ?? 80);
  const survival = runtime.gaugeSurvival === true || clear <= 0;
  const cellCount = 50;
  const cellStride = GROOVE.w / cellCount;
  const cellW = cellStride - 1;
  const litCells = Math.round((gauge / 100) * cellCount);
  const clearCell = Math.round((clear / 100) * cellCount);
  fillParallelogram(frame, GROOVE.x - 12, GROOVE.y - 26, GROOVE.w + 24, 50, 10, T.panel, a);
  strokeParallelogram(frame, GROOVE.x - 12, GROOVE.y - 26, GROOVE.w + 24, 50, 10, T.accent, 1, 0.7 * a);
  frame.rect(GROOVE.x - 4, GROOVE.y - 3, GROOVE.w + 8, GROOVE.h + 6).fill({ color: T.inkDeep, alpha: a });
  const flicker = 0.72 + 0.28 * Math.abs(Math.sin(nowMs / 70));
  for (let cell = 0; cell < litCells; cell += 1) {
    const hot = survival || cell >= clearCell;
    const isTip = cell === litCells - 1;
    const color = survival ? T.danger : hot ? T.accent : T.gold;
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, GROOVE.h).fill({
      color: isTip ? T.paper : color,
      alpha: (isTip ? flicker : hot ? 0.96 : 0.9) * a,
    });
  }
  for (let cell = litCells; cell < cellCount; cell += 1) {
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, GROOVE.h).fill({ color: 0x0a1628, alpha: 0.92 * a });
  }
  if (!survival) {
    const clearX = GROOVE.x + Math.round(clearCell * cellStride) - 1;
    frame.rect(clearX, GROOVE.y - 6, 2, GROOVE.h + 12).fill({ color: T.paper, alpha: 0.95 * a });
  }
  if (pulse > 0.4 && litCells > 0) {
    fillSlash(frame, GROOVE.x - 6, GROOVE.y - 4, GROOVE.w + 16, 3, 2, T.paper, 0.18 * pulse * a);
  }
  fillDiamond(frame, { cx: GROOVE.x - 6, cy: GROOVE.y + GROOVE.h / 2, rx: 7, ry: 9, nowMs, wobble: 2.8 }, T.accent, 0.8 * a);
  fillDiamond(frame, { cx: GROOVE.x + GROOVE.w + 6, cy: GROOVE.y + GROOVE.h / 2, rx: 7, ry: 9, nowMs, phase: 0.7, wobble: 2.8 }, T.gold, 0.7 * a);
}

function drawSongPlate(frame: Graphics, t: number, nowMs: number): void {
  if (t <= 0) return;
  const a = slamAlpha(t);
  fillParallelogram(frame, 14, 402, 356, 62, 14, T.panel, a);
  strokeParallelogram(frame, 14, 402, 356, 62, 14, T.line, 1, 0.9 * a);
  fillSlash(frame, 10, 408, 28, 50, 8, T.accent, 0.95 * a);
  fillDiamond(frame, { cx: 24, cy: 433, rx: 8, ry: 11, nowMs, wobble: 3 }, T.paper, 0.9 * a);
}

function drawScorePlate(frame: Graphics, exScore: number | undefined, exScoreMax: number | undefined, t: number, nowMs: number): void {
  if (t <= 0) return;
  const a = slamAlpha(t);
  fillParallelogram(frame, SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w, SCORE_PANEL.h, 12, T.panel, a);
  strokeParallelogram(frame, SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w, SCORE_PANEL.h, 12, T.line, 1, 0.9 * a);
  fillSlash(frame, SCORE_PANEL.x - 4, SCORE_PANEL.y, SCORE_PANEL.w + 8, 5, 3, T.accent, 0.85 * a);
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 40, 116, 1).fill({ color: T.line, alpha: 0.6 * a });
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 70, 116, 1).fill({ color: T.line, alpha: 0.6 * a });
  frame.rect(SCORE_PANEL.x + 140, SCORE_PANEL.y + 12, 1, SCORE_PANEL.h - 24).fill({ color: T.line, alpha: 0.5 * a });
  const meterX = SCORE_PANEL.x + 12;
  const meterY = SCORE_PANEL.y + 100;
  const meterW = 116;
  const rate =
    exScore !== undefined && exScoreMax !== undefined && exScoreMax > 0
      ? Math.max(0, Math.min(1, exScore / exScoreMax))
      : 0;
  frame.rect(meterX, meterY, meterW, 4).fill({ color: 0x000000, alpha: 0.6 * a });
  if (rate > 0) {
    frame.rect(meterX, meterY, Math.max(1, Math.round(meterW * rate * t)), 4).fill({
      color: rate >= 8 / 9 ? T.gold : T.accent,
      alpha: 0.95 * a,
    });
  }
  for (let ninth = 1; ninth < 9; ninth += 1) {
    frame.rect(meterX + Math.round((meterW * ninth) / 9), meterY - 1, 1, 6).fill({
      color: T.paper,
      alpha: (ninth >= 6 ? 0.55 : 0.22) * a,
    });
  }
  fillDiamond(frame, { cx: SCORE_PANEL.x + SCORE_PANEL.w - 18, cy: SCORE_PANEL.y + 22, rx: 8, ry: 11, nowMs, wobble: 3.2 }, T.gold, 0.75 * a);
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
  t: number,
  pool?: ChildPool,
): void {
  if (t <= 0) return;
  const a = slamAlpha(t);
  const y = BGA.y - 12;
  const w = DESIGN_WIDTH - x - 12;
  const rowH = 24;
  const h = 16 + JUDGE_TALLY_ROWS.length * rowH + 48;
  fillParallelogram(frame, x, y, w, h, 8, T.panel, 0.94 * a);
  strokeParallelogram(frame, x, y, w, h, 8, T.line, 1, 0.9 * a);
  addChromeText(layer, 'JUDGE', x + 8, y + 4, { ...stampLabel(), slam: slamScale(t, 1.6), alpha: a }, pool);
  for (let row = 0; row < JUDGE_TALLY_ROWS.length; row += 1) {
    const [label, key] = JUDGE_TALLY_ROWS[row]!;
    const rowT = staggerProgress(t * GAMEPLAY_TIMELINE.tally.duration, row * 40, 220);
    const rowY = y + 20 + row * rowH;
    const color = defaultJudgeColor(TALLY_JUDGE_NAMES[key]);
    fillSlash(frame, x + 4, rowY + 4, 10, 12, 3, color, 0.95 * a);
    addChromeText(
      layer,
      label,
      x + 16,
      rowY + 4,
      { size: 11, fill: color, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 0.6, alpha: slamAlpha(rowT) * a },
      pool,
    );
    addChromeText(
      layer,
      formatCount(runtime[key]),
      x + w - 8,
      rowY,
      {
        size: 16,
        fill: T.paper,
        fontFamily: DEFAULT_NUMERIC_FONT,
        maxWidth: w - 42,
        slam: slamScale(rowT, 1.8),
        alpha: slamAlpha(rowT) * a,
      },
      pool,
    );
  }
  const footerY = y + 20 + JUDGE_TALLY_ROWS.length * rowH + 4;
  frame.rect(x + 6, footerY - 4, w - 12, 1).fill({ color: T.line, alpha: 0.6 * a });
  const footerRows: ReadonlyArray<readonly [label: string, color: number, count: number | undefined]> = [
    ['FAST', T.paper, runtime.fast],
    ['SLOW', T.gold, runtime.slow],
  ];
  for (let row = 0; row < footerRows.length; row += 1) {
    const [label, color, count] = footerRows[row]!;
    const rowY = footerY + 2 + row * 20;
    addChromeText(layer, label, x + 14, rowY + 2, { size: 10, fill: color, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 0.8, alpha: a }, pool);
    addChromeText(layer, formatCount(count), x + w - 8, rowY, { size: 14, fill: T.paper, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: w - 48, alpha: a }, pool);
  }
}

const TALLY_JUDGE_NAMES = {
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  bad: 'BAD',
  poor: 'POOR',
} as const;

function paintSongTexts(layer: Container, runtime: FallbackGameplayRuntime, t: number, pool?: ChildPool): void {
  const a = slamAlpha(t);
  const title = runtime.songTitle?.trim() || 'Untitled chart';
  addChromeText(
    layer,
    title,
    30,
    414,
    {
      size: 15,
      fill: T.paper,
      fontFamily: DEFAULT_TEXT_FONT,
      maxWidth: 318,
      slam: slamScale(t, 1.35),
      offsetX: slamOffset(t, -28),
      rotation: -0.02,
      alpha: a,
    },
    pool,
  );
  const artist = runtime.songArtist?.trim();
  if (artist) {
    addChromeText(layer, artist, 30, 438, { size: 10, fill: T.mute, fontFamily: DEFAULT_TEXT_FONT, maxWidth: 318, alpha: a }, pool);
  }
}

function paintGaugeTexts(
  layer: Container,
  runtime: FallbackGameplayRuntime,
  t: number,
  pulse: number,
  pool?: ChildPool,
): void {
  const a = slamAlpha(t);
  const gauge = clampPercent(runtime.gauge ?? 0);
  const clearLine = clampPercent(runtime.clearThreshold ?? 80);
  const survivalGauge = runtime.gaugeSurvival === true || clearLine <= 0;
  const gaugeCleared = survivalGauge ? gauge > 0 : gauge >= clearLine;
  addChromeText(
    layer,
    `${(runtime.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`,
    GROOVE.x - 2,
    GROOVE.y - 18,
    { ...stampLabel(), maxWidth: 120, alpha: a },
    pool,
  );
  addChromeText(
    layer,
    `${Math.round(gauge)}%`,
    GROOVE.x + GROOVE.w + 8,
    GROOVE.y - 26,
    {
      size: 22,
      fill: survivalGauge ? (gaugeCleared ? T.danger : T.mute) : gaugeCleared ? T.accent : T.gold,
      fontFamily: DEFAULT_NUMERIC_FONT,
      slam: 1 + pulse * 0.08,
      alpha: a,
    },
    pool,
  );
}

function paintScoreTexts(
  layer: Container,
  runtime: FallbackGameplayRuntime,
  t: number,
  punches: { comboPunch: number; scorePunch: number } | undefined,
  pulse: number,
  pool?: ChildPool,
): void {
  const a = slamAlpha(t);
  const rank = runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F';
  addChromeText(layer, 'SCORE', SCORE_PANEL.x + 14, SCORE_PANEL.y + 12, { ...stampLabel(), alpha: a }, pool);
  addChromeText(
    layer,
    formatCount(runtime.score),
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 14,
    {
      size: 24,
      fill: T.gold,
      fontFamily: DEFAULT_NUMERIC_FONT,
      maxWidth: 112,
      slam: slamScale(t, 1.5) * (punches?.scorePunch ?? 1),
      alpha: a,
    },
    pool,
  );
  addChromeText(layer, 'EX SCORE', SCORE_PANEL.x + 14, SCORE_PANEL.y + 44, { ...stampLabel(), alpha: a }, pool);
  addChromeText(
    layer,
    `${formatCount(runtime.exScore)} / ${formatCount(runtime.exScoreMax)}`,
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 48,
    { size: 14, fill: T.paper, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: 112, alpha: a },
    pool,
  );
  addChromeText(layer, 'EX RATE', SCORE_PANEL.x + 14, SCORE_PANEL.y + 74, { ...stampLabel(), alpha: a }, pool);
  addChromeText(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 78,
    { size: 14, fill: T.paper, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: 112, alpha: a },
    pool,
  );
  addChromeText(layer, 'COMBO', SCORE_PANEL.x + 148, SCORE_PANEL.y + 16, { ...stampLabel(), alpha: a }, pool);
  addChromeText(
    layer,
    formatCount(runtime.combo),
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 10,
    {
      size: 18,
      fill: T.accent,
      fontFamily: DEFAULT_JUDGE_FONT,
      maxWidth: 40,
      slam: (punches?.comboPunch ?? 1) * (1 + pulse * 0.06),
      alpha: a,
    },
    pool,
  );
  addChromeText(layer, 'MAX', SCORE_PANEL.x + 148, SCORE_PANEL.y + 48, { ...stampLabel(), alpha: a }, pool);
  addChromeText(
    layer,
    formatCount(runtime.maxCombo),
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 42,
    { size: 16, fill: T.paper, fontFamily: DEFAULT_JUDGE_FONT, maxWidth: 40, alpha: a },
    pool,
  );
  addChromeText(layer, 'RANK', SCORE_PANEL.x + 148, SCORE_PANEL.y + 78, { ...stampLabel(), alpha: a }, pool);
  addChromeText(
    layer,
    rank,
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 64,
    { size: 26, fill: T.gold, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: 42, rotation: -0.08, slam: slamScale(t, 1.9), alpha: a },
    pool,
  );
}

function paintJudge(
  layer: Container,
  runtime: FallbackGameplayRuntime,
  playfield: FallbackPlayfieldLayout,
  punches: { judgeElapsed: number; comboPunch: number } | undefined,
  nowMs: number,
  pool?: ChildPool,
): void {
  const displays = resolveJudgeHudDisplays(runtime, playfield);
  for (const display of displays) {
    const popup = judgePopup(punches?.judgeElapsed ?? 10_000);
    const combo = display.combo;
    const showCombo = combo > 0;
    const showJudge = popup.alpha > 0 && display.judge.length > 0;
    if (!showCombo && !showJudge) continue;

    const comboY = PLAYFIELD.judgementY - 36;
    const judgeY = PLAYFIELD.judgementY - 70;
    const plateY = showJudge ? (comboY + judgeY) / 2 : comboY;
    const digits = String(combo).length;
    const plateRx = showJudge ? 54 : 28 + digits * 8;
    const plateRy = showJudge ? 36 : 22;
    const plateAlpha = showJudge ? Math.max(0.78, popup.alpha) : 0.88;
    const plate = pool?.acquireGraphics() ?? new Graphics();
    plate.label = 'default-gameplay/combo-plate';
    plate.blendMode = 'normal';
    fillDiamond(plate, { cx: display.x, cy: plateY, rx: plateRx, ry: plateRy, nowMs, wobble: 5.5 }, T.ink, 0.88 * plateAlpha);
    fillDiamond(plate, { cx: display.x, cy: plateY, rx: plateRx * 0.72, ry: plateRy * 0.72, nowMs, phase: 0.35, wobble: 4.2 }, T.inkDeep, 0.9 * plateAlpha);
    strokeDiamond(plate, { cx: display.x, cy: plateY, rx: plateRx + 4, ry: plateRy + 4, nowMs, wobble: 6 }, T.paper, 2, 0.7 * plateAlpha);
    if (!pool) layer.addChild(plate);

    const glow = pool?.acquireGraphics() ?? new Graphics();
    glow.label = 'default-gameplay/combo-glow';
    glow.blendMode = 'add';
    fillDiamond(glow, { cx: display.x, cy: plateY, rx: plateRx + 10, ry: plateRy + 8, nowMs, wobble: 7 }, T.accent, 0.22 * plateAlpha);
    strokeDiamond(glow, { cx: display.x, cy: plateY, rx: plateRx * 0.78, ry: plateRy * 0.78, nowMs, phase: 0.5, wobble: 5 }, T.cyanGhost, 1.8, 0.45 * plateAlpha);
    if (!pool) layer.addChild(glow);

    if (showJudge) {
      const color = defaultJudgeColor(display.judge);
      const slamT = Math.min(1, (punches?.judgeElapsed ?? 10_000) / 180);
      const jitter = impactOffset(slamT, 8);
      const throwX = slamOffset(slamT, -28);
      if (slamT < 1) {
        addChromeText(
          layer,
          display.judge,
          display.x,
          judgeY + popup.offsetY,
          {
            size: 26,
            fill: T.accent,
            fontFamily: DEFAULT_JUDGE_FONT,
            anchorX: 0.5,
            rotation: -0.1,
            slam: popup.scale,
            offsetX: throwX - jitter,
            alpha: popup.alpha * 0.45,
            maxWidth: display.maxWidth,
          },
          pool,
        );
        addChromeText(
          layer,
          display.judge,
          display.x,
          judgeY + popup.offsetY,
          {
            size: 26,
            fill: T.cyanGhost,
            fontFamily: DEFAULT_JUDGE_FONT,
            anchorX: 0.5,
            rotation: -0.1,
            slam: popup.scale,
            offsetX: throwX + jitter,
            alpha: popup.alpha * 0.35,
            maxWidth: display.maxWidth,
          },
          pool,
        );
      }
      addChromeText(
        layer,
        display.judge,
        display.x,
        judgeY + popup.offsetY,
        {
          size: 26,
          fill: color,
          fontFamily: DEFAULT_JUDGE_FONT,
          anchorX: 0.5,
          rotation: -0.08,
          slam: popup.scale,
          offsetX: throwX,
          alpha: popup.alpha,
          stroke: { color: T.ink, width: 7, alignment: 0.5, join: 'round' },
          maxWidth: display.maxWidth,
        },
        pool,
      );
    }

    if (showCombo) {
      const comboAlpha = showJudge ? Math.max(popup.alpha, 0.95) : 0.96;
      addChromeText(
        layer,
        formatCount(combo),
        display.x,
        comboY,
        {
          size: 28,
          fill: playfieldComboFill(combo),
          fontFamily: DEFAULT_JUDGE_FONT,
          anchorX: 0.5,
          rotation: -0.04,
          slam: showJudge ? popup.scale * 0.85 * (punches?.comboPunch ?? 1) : punches?.comboPunch ?? 1,
          alpha: comboAlpha,
          stroke: { color: T.ink, width: 8, alignment: 0.5, join: 'round' },
          maxWidth: Math.max(72, display.maxWidth - 24),
        },
        pool,
      );
    }
  }
}

function paintReady(layer: Container, elapsed: number, nowMs: number, pool?: ChildPool): void {
  const alpha = readyAlpha(elapsed);
  if (alpha <= 0) return;
  const gfx = pool?.acquireGraphics() ?? new Graphics();
  gfx.label = 'default-gameplay/ready';
  gfx.blendMode = 'normal';
  gfx.alpha = alpha;
  const cx = PLAYFIELD.x + PLAYFIELD.w / 2;
  const cy = 168;
  const readyT = pieceRawT(elapsed, GAMEPLAY_TIMELINE.ready);
  fillSlash(gfx, cx - 110, cy - 18, 220, 36, 14, T.accent, 0.92);
  fillDiamondCluster(gfx, cx, cy - 4, 42, 52, nowMs, T.inkDeep, 0.7, 5);
  strokeDiamond(gfx, { cx, cy: cy - 4, rx: 50, ry: 62, nowMs, wobble: 6 }, T.paper, 2, 0.8);
  if (!pool) layer.addChild(gfx);
  const glow = pool?.acquireGraphics() ?? new Graphics();
  glow.label = 'default-gameplay/ready-glow';
  glow.blendMode = 'add';
  glow.alpha = alpha;
  fillDiamond(glow, { cx, cy: cy - 4, rx: 58, ry: 72, nowMs, wobble: 7 }, T.accent, 0.28);
  if (!pool) layer.addChild(glow);
  addChromeText(
    layer,
    'READY',
    cx,
    cy - 8,
    {
      size: 28,
      fill: T.paper,
      fontFamily: DEFAULT_NUMERIC_FONT,
      letterSpacing: 8,
      anchorX: 0.5,
      rotation: -0.1,
      slam: slamScale(readyT, 2.6),
      offsetX: slamOffset(readyT, -64),
      alpha,
      stroke: { color: T.ink, width: 6, alignment: 0.5, join: 'round' },
    },
    pool,
  );
}

function drawBeatSlashes(layer: Container, pulse: number, nowMs: number, pool?: ChildPool): void {
  if (pulse <= 0.02) return;
  const slashes = pool?.acquireGraphics() ?? new Graphics();
  slashes.label = 'default-gameplay/beat-slash';
  slashes.blendMode = 'add';
  fillSlash(slashes, -30, 60, 180, 7, 22, T.accent, 0.32 * pulse);
  fillSlash(slashes, 480, 300, 200, 6, -18, T.paper, 0.18 * pulse);
  fillSlash(slashes, 250, 8, 140, 4, 8, T.gold, 0.24 * pulse);
  fillDiamond(slashes, { cx: 120, cy: 72, rx: 16, ry: 22, nowMs, wobble: 4 }, T.accent, 0.35 * pulse);
  fillDiamond(slashes, { cx: 520, cy: 310, rx: 14, ry: 18, nowMs, phase: 0.6, wobble: 3.5 }, T.gold, 0.28 * pulse);
  fillDiamond(slashes, { cx: 310, cy: 24, rx: 11, ry: 14, nowMs, phase: 1.2, wobble: 3.2 }, T.paper, 0.2 * pulse);
  if (!pool) layer.addChild(slashes);
}

function stampLabel(): { size: number; fill: number; fontFamily: string; letterSpacing: number } {
  return { size: 9, fill: T.mute, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 1.1 };
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
