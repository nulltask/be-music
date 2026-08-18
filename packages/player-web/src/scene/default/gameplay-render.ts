import { Container, Graphics } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../gameplay-constants.ts';
import {
  resolveFallbackLaneLayout,
  shouldPreserveFallbackSideWidth,
  type FallbackLaneLayoutRect,
} from '../gameplay-lanes.ts';
import type { SkinlessGameplayChromeRuntime } from '../gameplay-chrome.ts';
import { DEFAULT_JUDGE_FONT, DEFAULT_NUMERIC_FONT } from './fonts.ts';
import type { ChildPool } from '../pixi-utils.ts';
import { addChromeText } from './chrome-text.ts';
import type { DefaultHudMotion } from './hud-motion.ts';
import { beatPulse, enterT, idleGlow, introFill, judgePopup, scanlineY, slideOffset } from './motion.ts';
import { coverAmount, fallbackSceneElapsed, GAMEPLAY_TIMELINE, pieceT, readyAlpha } from './transition.ts';
import {
  DEFAULT_THEME as T,
  DEFAULT_BG_BANDS,
  defaultJudgeColor,
  fillTriangle,
  paintSceneCover,
  strokeClockRing,
  strokeCornerBrackets,
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
  frame.label = 'default-gameplay/chrome';
  drawBackground(frame, hasBga, nowMs);
  drawPlayfield(frame, playfield, runtime.progressRatio, nowMs, pieceT(elapsed, GAMEPLAY_TIMELINE.playfield));
  drawBgaFrame(frame, hasBga, pieceT(elapsed, GAMEPLAY_TIMELINE.bga), nowMs);
  drawGauge(frame, runtime, pieceT(elapsed, GAMEPLAY_TIMELINE.gauge), nowMs);
  drawSongPlate(frame, pieceT(elapsed, GAMEPLAY_TIMELINE.song));
  drawScorePlate(frame, runtime.exScore, runtime.exScoreMax, pieceT(elapsed, GAMEPLAY_TIMELINE.score));
  const tallyX = resolveJudgeTallyX(playfield);
  if (tallyX !== undefined) {
    drawJudgeTally(frame, layer, runtime, tallyX, pieceT(elapsed, GAMEPLAY_TIMELINE.tally), layerPool);
  }
  if (!layerPool) layer.addChildAt(frame, 0);

  const frontLayer = options.overlayLayer && options.overlayLayerPool ? options.overlayLayer : layer;
  const frontPool = frontLayer === layer ? layerPool : options.overlayLayerPool;
  const headerT = pieceT(elapsed, GAMEPLAY_TIMELINE.header);
  drawStatusBar(frontLayer, runtime.autoplay === true, runtime.beatPhase, headerT, nowMs, frontPool);
  paintHeaderTexts(frontLayer, runtime, headerT, frontPool);
  const punches = options.motion?.sample({
    judge: runtime.lastJudge,
    combo: runtime.combo,
    score: runtime.score,
    nowMs,
  });
  paintSongTexts(layer, runtime, pieceT(elapsed, GAMEPLAY_TIMELINE.song), layerPool);
  paintGaugeTexts(layer, runtime, pieceT(elapsed, GAMEPLAY_TIMELINE.gauge), layerPool);
  paintScoreTexts(layer, runtime, pieceT(elapsed, GAMEPLAY_TIMELINE.score), punches, layerPool);
  paintJudge(frontLayer, runtime, playfield, punches, frontPool);
  paintReady(frontLayer, elapsed, nowMs, frontPool);

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
  const scanY = scanlineY(nowMs, DESIGN_HEIGHT, 2800);
  frame.rect(0, scanY, DESIGN_WIDTH, 1).fill({ color: T.cyan, alpha: 0.06 });
  frame.rect(0, 0, DESIGN_WIDTH, 4).fill({ color: 0x000000, alpha: 0.45 });
  frame.rect(0, DESIGN_HEIGHT - 10, DESIGN_WIDTH, 10).fill({ color: 0x000000, alpha: 0.28 });
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
  nowMs: number,
  t: number,
): void {
  if (t <= 0) return;
  const wellTop = PLAYFIELD.y;
  const wellBottom = PLAYFIELD_FRAME_BOTTOM;
  const wellHeight = wellBottom - wellTop;
  const railW = 8;
  const leftRailX = playfield.x - railW - 2;
  const rightRailX = playfield.right + 2;
  frame.rect(playfield.x - 2, wellTop, playfield.w + 4, wellHeight).fill({ color: 0x02060a, alpha: t });
  frame.rect(playfield.x - 2, wellTop, playfield.w + 4, 80).fill({ color: 0x000000, alpha: 0.4 * t });
  if (playfield.sideGap) {
    frame.rect(playfield.sideGap.x, wellTop, playfield.sideGap.w, wellHeight).fill({ color: T.panelDeep, alpha: 0.96 * t });
  }
  for (const railX of [leftRailX, rightRailX]) {
    frame.rect(railX, wellTop, railW, wellBottom).fill({ color: 0x0a1822, alpha: t });
    frame.rect(railX, wellTop, 1, wellBottom).fill({ color: T.cyan, alpha: 0.55 * t });
    frame.rect(railX + railW - 1, wellTop, 1, wellBottom).fill({ color: T.cyanDim, alpha: 0.7 * t });
  }
  const trackX = leftRailX + 2;
  const trackTop = wellTop + 6;
  const trackHeight = wellBottom - 12 - trackTop;
  frame.rect(trackX, trackTop, railW - 4, trackHeight).fill({ color: 0x000000, alpha: 0.55 * t });
  const ratio = progressRatio !== undefined && Number.isFinite(progressRatio) ? Math.max(0, Math.min(1, progressRatio)) : 0;
  if (ratio > 0) {
    const fillHeight = Math.max(2, Math.round(trackHeight * ratio));
    frame.rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, fillHeight).fill({ color: T.cyan, alpha: 0.85 * t });
    frame.rect(trackX, trackTop + trackHeight - fillHeight, railW - 4, 2).fill({ color: T.ice, alpha: 0.9 * t });
  }
  frame.rect(leftRailX, wellBottom, rightRailX + railW - leftRailX, 5).fill({ color: 0x0a1822, alpha: t });
  frame.rect(leftRailX, wellBottom, rightRailX + railW - leftRailX, 1).fill({ color: T.cyan, alpha: 0.55 * t });
  fillTriangle(frame, playfield.x - 10, wellTop + 16 + Math.sin(nowMs / 900) * 4, 7, T.cyan, 0.35 * t);
}

function resolveJudgeTallyX(playfield: FallbackPlayfieldLayout): number | undefined {
  const x = BGA.x + BGA.w + 13;
  return playfield.right + 14 <= x && x + 76 <= DESIGN_WIDTH ? x : undefined;
}

function drawBgaFrame(frame: Graphics, hasBga: boolean, t: number, nowMs: number): void {
  if (t <= 0) return;
  const glow = idleGlow(nowMs);
  if (!hasBga) {
    frame.rect(BGA.x - 10, BGA.y - 12, BGA.w + 20, BGA.h + 24).fill({ color: T.panel, alpha: 0.7 * t });
  }
  strokeCornerBrackets(frame, BGA.x, BGA.y, BGA.w, BGA.h, 16 * t, T.cyan, (0.45 + 0.25 * glow) * t);
  if (!hasBga) {
    frame.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill({ color: T.panelDeep, alpha: 0.95 * t });
    const cx = BGA.x + BGA.w / 2;
    const cy = BGA.y + BGA.h / 2;
    strokeClockRing(frame, cx, cy, 72 * t, t, T.cyan, 0.18 * t, 1);
    strokeClockRing(frame, cx, cy, 48 * t, t, T.cyan, 0.28 * t, 1, nowMs / 1800);
    fillTriangle(frame, cx, cy, 14, T.cyan, 0.2 * t, true);
  }
}

function drawStatusBar(
  layer: Container,
  autoplay: boolean,
  beatPhase: number | undefined,
  t: number,
  nowMs: number,
  pool?: ChildPool,
): void {
  const status = pool?.acquireGraphics() ?? new Graphics();
  status.label = 'default-gameplay/status';
  status.position.set(0, slideOffset(t, -40));
  status.alpha = t;
  status.rect(0, 0, DESIGN_WIDTH, 40).fill({ color: T.void, alpha: 0.96 });
  const accent = autoplay ? T.gold : T.cyan;
  const pulse = beatPulse(beatPhase, 0.45);
  status.rect(0, 38, DESIGN_WIDTH, 2).fill({ color: accent, alpha: 0.25 + 0.55 * pulse });
  status.poly([8, 10, 108, 10, 100, 30, 8, 30]).fill({ color: T.panelDeep, alpha: 0.95 }).stroke({
    color: accent,
    width: 1,
    alpha: 0.8,
  });
  status.rect(392, 10, 118, 20).fill({ color: T.panelDeep, alpha: 0.9 }).stroke({ color: T.gold, width: 1, alpha: 0.45 });
  fillTriangle(status, 18, 20, 8, accent, 0.9 + 0.1 * idleGlow(nowMs), true);
  if (!pool) layer.addChild(status);
}

function paintHeaderTexts(
  layer: Container,
  runtime: FallbackGameplayRuntime,
  t: number,
  pool?: ChildPool,
): void {
  const y = 12 + slideOffset(t, -18);
  addChromeText(
    layer,
    runtime.autoplay ? 'AUTO' : 'PLAY',
    62,
    y,
    { size: 11, weight: '700', fill: runtime.autoplay ? T.gold : T.cyan, letterSpacing: 1.6, anchorX: 0.5, fontFamily: DEFAULT_NUMERIC_FONT, alpha: t },
    pool,
  );
  addChromeText(layer, 'BPM', 128, y + 6, { ...labelStyle(), alpha: t }, pool);
  addChromeText(layer, formatBpmValue(runtime.bpm), 156, y, { size: 16, weight: '700', fill: T.ice, fontFamily: DEFAULT_NUMERIC_FONT, alpha: t }, pool);
  addChromeText(layer, 'HI-SPEED', 216, y + 6, { ...labelStyle(), alpha: t }, pool);
  addChromeText(layer, `x${formatHiSpeed(runtime.hiSpeed)}`, 268, y, { size: 16, weight: '700', fill: T.ice, fontFamily: DEFAULT_NUMERIC_FONT, alpha: t }, pool);
  addChromeText(layer, 'RULESET', 404, y + 5, { size: 7, weight: '700', fill: T.subtle, letterSpacing: 0.8, alpha: t }, pool);
  addChromeText(
    layer,
    formatRulesetLabel(runtime.rulesetLabel),
    502,
    y + 1,
    { size: 12, weight: '700', fill: T.gold, letterSpacing: 1, anchorX: 1, maxWidth: 62, fontFamily: DEFAULT_NUMERIC_FONT, alpha: t },
    pool,
  );
}

function drawGauge(frame: Graphics, runtime: FallbackGameplayRuntime, t: number, nowMs: number): void {
  if (t <= 0) return;
  const gaugeActual = clampPercent(runtime.gauge ?? 0) / 100;
  const gauge = introFill(gaugeActual, t) * 100;
  const clear = clampPercent(runtime.clearThreshold ?? 80);
  const survival = runtime.gaugeSurvival === true || clear <= 0;
  const cellCount = 50;
  const cellStride = GROOVE.w / cellCount;
  const cellW = cellStride - 1;
  const litCells = Math.round((gauge / 100) * cellCount);
  const clearCell = Math.round((clear / 100) * cellCount);
  frame.rect(GROOVE.x - 10, GROOVE.y - 26, GROOVE.w + 20, 50).fill({ color: T.panel, alpha: t }).stroke({
    color: T.line,
    width: 1,
    alpha: t,
  });
  frame.rect(GROOVE.x - 10, GROOVE.y - 26, GROOVE.w + 20, 1).fill({ color: survival ? T.danger : T.cyan, alpha: 0.45 * t });
  frame.rect(GROOVE.x - 4, GROOVE.y - 3, GROOVE.w + 8, GROOVE.h + 6).fill({ color: 0x000000, alpha: t });
  const flicker = 0.72 + 0.28 * Math.abs(Math.sin(nowMs / 90));
  for (let cell = 0; cell < litCells; cell += 1) {
    const hot = survival || cell >= clearCell;
    const isTip = cell === litCells - 1;
    const color = hot ? T.danger : T.goldDeep;
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, GROOVE.h).fill({
      color: isTip ? T.ice : color,
      alpha: (isTip ? flicker : hot ? 0.95 : 0.88) * t,
    });
  }
  for (let cell = litCells; cell < cellCount; cell += 1) {
    frame.rect(GROOVE.x + cell * cellStride, GROOVE.y, cellW, GROOVE.h).fill({ color: 0x102028, alpha: 0.9 * t });
  }
  if (!survival) {
    const clearX = GROOVE.x + Math.round(clearCell * cellStride) - 1;
    frame.rect(clearX, GROOVE.y - 5, 2, GROOVE.h + 10).fill({ color: T.ice, alpha: 0.95 * t });
    fillTriangle(frame, clearX + 1, GROOVE.y - 9, 8, T.ice, 0.95 * t, true);
  }
}

function drawSongPlate(frame: Graphics, t: number): void {
  if (t <= 0) return;
  frame.rect(18, 404, 352, 58).fill({ color: T.panel, alpha: t }).stroke({ color: T.line, width: 1, alpha: t });
  frame.rect(18, 404, 3, 58).fill({ color: T.cyan, alpha: 0.85 * t });
  frame.rect(18, 404, 352 * t, 1).fill({ color: T.cyan, alpha: 0.55 * t });
}

function drawScorePlate(frame: Graphics, exScore: number | undefined, exScoreMax: number | undefined, t: number): void {
  if (t <= 0) return;
  frame.rect(SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w, SCORE_PANEL.h).fill({ color: T.panel, alpha: t }).stroke({
    color: T.line,
    width: 1,
    alpha: t,
  });
  frame.rect(SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w * t, 1).fill({ color: T.cyan, alpha: 0.5 * t });
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 42, 116, 1).fill({ color: T.line, alpha: 0.45 * t });
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 72, 116, 1).fill({ color: T.line, alpha: 0.45 * t });
  frame.rect(SCORE_PANEL.x + 140, SCORE_PANEL.y + 12, 1, SCORE_PANEL.h - 24).fill({ color: T.line, alpha: 0.45 * t });
  const meterX = SCORE_PANEL.x + 12;
  const meterY = SCORE_PANEL.y + 100;
  const meterW = 116;
  const rate =
    exScore !== undefined && exScoreMax !== undefined && exScoreMax > 0
      ? Math.max(0, Math.min(1, exScore / exScoreMax))
      : 0;
  frame.rect(meterX, meterY, meterW, 4).fill({ color: 0x000000, alpha: 0.6 * t });
  if (rate > 0) {
    frame.rect(meterX, meterY, Math.max(1, Math.round(meterW * rate * t)), 4).fill({
      color: rate >= 8 / 9 ? T.gold : T.cyan,
      alpha: 0.9 * t,
    });
  }
  for (let ninth = 1; ninth < 9; ninth += 1) {
    frame.rect(meterX + Math.round((meterW * ninth) / 9), meterY - 1, 1, 6).fill({
      color: T.ice,
      alpha: (ninth >= 6 ? 0.5 : 0.2) * t,
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
  t: number,
  pool?: ChildPool,
): void {
  if (t <= 0) return;
  const y = BGA.y - 12;
  const w = DESIGN_WIDTH - x - 12;
  const rowH = 24;
  const h = 16 + JUDGE_TALLY_ROWS.length * rowH + 48;
  frame.rect(x, y, w, h).fill({ color: T.panel, alpha: 0.92 * t }).stroke({ color: T.line, width: 1, alpha: t });
  addChromeText(layer, 'JUDGE', x + 8, y + 6, { ...labelStyle(), alpha: t }, pool);
  for (let row = 0; row < JUDGE_TALLY_ROWS.length; row += 1) {
    const [label, key] = JUDGE_TALLY_ROWS[row]!;
    const rowT = enterT(t * 800, row * 40, 220);
    const rowY = y + 20 + row * rowH;
    const color = defaultJudgeColor(TALLY_JUDGE_NAMES[key]);
    frame.rect(x + 6, rowY + 3, 2, 12).fill({ color, alpha: 0.9 * rowT });
    addChromeText(layer, label, x + 14, rowY + 5, { size: 9, weight: '700', fill: color, letterSpacing: 0.5, alpha: rowT }, pool);
    addChromeText(layer, formatCount(runtime[key]), x + w - 8, rowY + 1, { ...metricStyle(14, T.ice, 1), maxWidth: w - 42, alpha: rowT }, pool);
  }
  const footerY = y + 20 + JUDGE_TALLY_ROWS.length * rowH + 4;
  frame.rect(x + 6, footerY - 4, w - 12, 1).fill({ color: T.line, alpha: 0.6 * t });
  const footerRows: ReadonlyArray<readonly [label: string, color: number, count: number | undefined]> = [
    ['FAST', T.cyan, runtime.fast],
    ['SLOW', T.bad, runtime.slow],
  ];
  for (let row = 0; row < footerRows.length; row += 1) {
    const [label, color, count] = footerRows[row]!;
    const rowY = footerY + 2 + row * 20;
    addChromeText(layer, label, x + 14, rowY + 4, { size: 8, weight: '700', fill: color, letterSpacing: 0.5, alpha: t }, pool);
    addChromeText(layer, formatCount(count), x + w - 8, rowY + 1, { ...metricStyle(12, T.ice, 1), maxWidth: w - 48, alpha: t }, pool);
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
  const title = runtime.songTitle?.trim() || 'Untitled chart';
  addChromeText(layer, title, 28, 416 + slideOffset(t, 16), { size: 16, weight: '700', fill: T.ice, maxWidth: 324, alpha: t }, pool);
  const artist = runtime.songArtist?.trim();
  if (artist) {
    addChromeText(layer, artist, 28, 438 + slideOffset(t, 12), { size: 10, weight: '500', fill: T.mute, maxWidth: 324, alpha: t }, pool);
  }
}

function paintGaugeTexts(layer: Container, runtime: FallbackGameplayRuntime, t: number, pool?: ChildPool): void {
  const gauge = clampPercent(runtime.gauge ?? 0);
  const clearLine = clampPercent(runtime.clearThreshold ?? 80);
  const survivalGauge = runtime.gaugeSurvival === true || clearLine <= 0;
  const gaugeCleared = survivalGauge ? gauge > 0 : gauge >= clearLine;
  addChromeText(layer, `${(runtime.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`, GROOVE.x - 2, GROOVE.y - 17, { ...labelStyle(), maxWidth: 120, alpha: t }, pool);
  addChromeText(
    layer,
    `${Math.round(gauge)}%`,
    GROOVE.x + GROOVE.w + 8,
    GROOVE.y - 23,
    metricStyle(15, survivalGauge ? (gaugeCleared ? T.danger : T.mute) : gaugeCleared ? T.danger : T.goldDeep, 1, t),
    pool,
  );
}

function paintScoreTexts(
  layer: Container,
  runtime: FallbackGameplayRuntime,
  t: number,
  punches: { comboPunch: number; scorePunch: number } | undefined,
  pool?: ChildPool,
): void {
  const rank = runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F';
  addChromeText(layer, 'SCORE', SCORE_PANEL.x + 12, SCORE_PANEL.y + 16, { ...labelStyle(), alpha: t }, pool);
  addChromeText(layer, formatCount(runtime.score), SCORE_PANEL.x + 128, SCORE_PANEL.y + 20, {
    ...metricStyle(22, T.gold, 1, t),
    maxWidth: 112,
    scale: punches?.scorePunch ?? 1,
  }, pool);
  addChromeText(layer, 'EX SCORE', SCORE_PANEL.x + 12, SCORE_PANEL.y + 46, { ...labelStyle(), alpha: t }, pool);
  addChromeText(
    layer,
    `${formatCount(runtime.exScore)} / ${formatCount(runtime.exScoreMax)}`,
    SCORE_PANEL.x + 128,
    SCORE_PANEL.y + 54,
    { ...metricStyle(12, T.ice, 1, t), maxWidth: 112 },
    pool,
  );
  addChromeText(layer, 'EX RATE', SCORE_PANEL.x + 12, SCORE_PANEL.y + 76, { ...labelStyle(), alpha: t }, pool);
  addChromeText(layer, formatExRate(runtime.exScore, runtime.exScoreMax), SCORE_PANEL.x + 128, SCORE_PANEL.y + 84, {
    ...metricStyle(12, T.ice, 1, t),
    maxWidth: 112,
  }, pool);
  addChromeText(layer, 'COMBO', SCORE_PANEL.x + 148, SCORE_PANEL.y + 21, { ...labelStyle(), alpha: t }, pool);
  addChromeText(layer, formatCount(runtime.combo), SCORE_PANEL.x + 226, SCORE_PANEL.y + 16, {
    ...metricStyle(14, T.cyan, 1, t),
    fontFamily: DEFAULT_JUDGE_FONT,
    maxWidth: 40,
    scale: punches?.comboPunch ?? 1,
  }, pool);
  addChromeText(layer, 'MAX', SCORE_PANEL.x + 148, SCORE_PANEL.y + 52, { ...labelStyle(), alpha: t }, pool);
  addChromeText(layer, formatCount(runtime.maxCombo), SCORE_PANEL.x + 226, SCORE_PANEL.y + 48, {
    ...metricStyle(13, T.ice, 1, t),
    fontFamily: DEFAULT_JUDGE_FONT,
    maxWidth: 40,
  }, pool);
  addChromeText(layer, 'RANK', SCORE_PANEL.x + 148, SCORE_PANEL.y + 81, { ...labelStyle(), alpha: t }, pool);
  addChromeText(layer, rank, SCORE_PANEL.x + 226, SCORE_PANEL.y + 70, { ...metricStyle(22, T.gold, 1, t), maxWidth: 42 }, pool);
}

function paintJudge(
  layer: Container,
  runtime: FallbackGameplayRuntime,
  playfield: FallbackPlayfieldLayout,
  punches: { judgeElapsed: number; comboPunch: number } | undefined,
  pool?: ChildPool,
): void {
  for (const display of resolveJudgeDisplays(runtime, playfield)) {
    const popup = judgePopup(punches?.judgeElapsed ?? 10_000);
    const combo = resolveVisibleCombo(display.judge, display.combo);
    const color = defaultJudgeColor(display.judge);
    addChromeText(layer, display.judge, display.x, 230 + popup.y, {
      size: 26,
      weight: '700',
      fill: color,
      fontFamily: DEFAULT_JUDGE_FONT,
      anchorX: 0.5,
      stroke: { color: 0x031018, width: 5, alignment: 0.5, join: 'round' },
      dropShadow: { color, alpha: 0.45 * popup.glow, blur: 8, distance: 0 },
      maxWidth: display.maxWidth,
      scale: popup.scale,
      alpha: popup.alpha,
    }, pool);
    if (combo > 0 && popup.alpha > 0) {
      addChromeText(layer, formatCount(combo), display.x, 258 + popup.y * 0.4, {
        size: 18,
        weight: '700',
        fill: combo >= 200 ? T.gold : combo >= 50 ? T.cyan : T.ice,
        fontFamily: DEFAULT_JUDGE_FONT,
        anchorX: 0.5,
        stroke: { color: 0x031018, width: 4, alignment: 0.5, join: 'round' },
        maxWidth: Math.max(72, display.maxWidth - 36),
        scale: (punches?.comboPunch ?? 1) * 0.92 + 0.08,
        alpha: popup.alpha,
      }, pool);
    }
  }
}

function paintReady(layer: Container, elapsed: number, nowMs: number, pool?: ChildPool): void {
  const alpha = readyAlpha(elapsed);
  if (alpha <= 0) return;
  const gfx = pool?.acquireGraphics() ?? new Graphics();
  gfx.label = 'default-gameplay/ready';
  gfx.alpha = alpha;
  const cx = PLAYFIELD.x + PLAYFIELD.w / 2;
  const cy = 168;
  strokeClockRing(gfx, cx, cy, 36, 1, T.cyan, 0.45, 2, nowMs / 900);
  fillTriangle(gfx, cx, cy, 18, T.gold, 0.85, true);
  if (!pool) layer.addChild(gfx);
  addChromeText(layer, 'READY', cx, cy + 28, {
    size: 18,
    weight: '700',
    fill: T.ice,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 6,
    anchorX: 0.5,
    alpha,
    stroke: { color: 0x031018, width: 4, alignment: 0.5, join: 'round' },
  }, pool);
}

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
      x: playfield.sideCenters[state.side] ?? playfield.centerX,
      maxWidth,
    }));
  }
  if (!runtime.lastJudge) return [];
  return [{ judge: runtime.lastJudge, combo: runtime.combo, x: playfield.sideCenters['1P'] ?? playfield.centerX, maxWidth }];
}

function resolveVisibleCombo(judge: string, combo: number | undefined): number {
  if (judge !== 'PERFECT' && judge !== 'GREAT' && judge !== 'GOOD') return 0;
  return combo !== undefined && Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
}

function labelStyle(): { size: number; weight: '700'; fill: number; letterSpacing: number } {
  return { size: 8, weight: '700', fill: T.subtle, letterSpacing: 0.9 };
}

function metricStyle(
  size: number,
  fill: number,
  anchorX = 0,
  alpha = 1,
): { size: number; weight: '700'; fill: number; fontFamily: string; anchorX: number; alpha: number } {
  return { size, weight: '700', fill, fontFamily: DEFAULT_NUMERIC_FONT, anchorX, alpha };
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

