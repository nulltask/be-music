import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { BGA, BG, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../gameplay-constants.ts';
import {
  resolveFallbackLaneLayout,
  shouldPreserveFallbackSideWidth,
  type FallbackLaneLayoutRect,
} from '../gameplay-lanes.ts';
import type { SkinlessGameplayChromeRuntime } from '../gameplay-chrome.ts';
import { DEFAULT_JUDGE_FONT, DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import type { ChildPool } from '../pixi-utils.ts';

const SURFACE = 0x080d16;
const PANEL = 0x101827;
const PANEL_DARK = 0x030711;
const LINE = 0x2a3548;
const LANE = 0x01040b;
const LANE_ALT = 0x0b1320;
const TEXT = 0xf6f2e8;
const MUTED = 0xa9a39a;
const SUBTLE = 0x6e685d;
const TEAL = 0x4bd7c8;
const AMBER = 0xffc857;
const RED = 0xff5c5c;
const GREEN = 0x6ee07f;
const BLUE = 0x76a8ff;
const ORANGE = 0xff9b54;
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
  if (hasBga) {
    drawBackgroundAroundBga(frame);
  } else {
    frame.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill(BG);
  }

  drawPlayfield(frame, playfield);
  drawBgaFrame(frame, hasBga);
  drawGauge(frame, runtime.gauge, runtime.clearThreshold);
  drawSongPlate(frame);
  drawScorePlate(frame);
  if (!layerPool) {
    layer.addChildAt(frame, 0);
  }

  const frontLayer = options.overlayLayer && options.overlayLayerPool ? options.overlayLayer : layer;
  const frontPool = frontLayer === layer ? layerPool : options.overlayLayerPool;
  drawStatusBar(frontLayer, frontPool);
  addText(
    frontLayer,
    runtime.autoplay ? 'AUTO PLAY' : 'PLAY',
    24,
    14,
    {
      size: 10,
      weight: '800',
      fill: runtime.autoplay ? AMBER : TEAL,
      letterSpacing: 1.2,
    },
    frontPool,
  );
  addText(
    frontLayer,
    formatNumber(runtime.bpm, 'BPM --'),
    116,
    14,
    {
      size: 10,
      weight: '700',
      fill: MUTED,
      fontFamily: NUMERIC_FONT,
    },
    frontPool,
  );
  addText(
    frontLayer,
    `HS ${formatHiSpeed(runtime.hiSpeed)}`,
    176,
    14,
    {
      size: 10,
      weight: '700',
      fill: MUTED,
      fontFamily: NUMERIC_FONT,
    },
    frontPool,
  );

  const gauge = clampPercent(runtime.gauge ?? 0);
  addText(layer, 'GAUGE', GROOVE.x, GROOVE.y - 18, labelStyle(), layerPool);
  addText(layer, `${Math.round(gauge)}%`, GROOVE.x + GROOVE.w, GROOVE.y - 21, metricStyle(14, TEXT, 1), layerPool);

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
  addText(layer, 'EX SCORE', SCORE_PANEL.x + 12, SCORE_PANEL.y + 48, labelStyle(), layerPool);
  addText(
    layer,
    `${formatCount(runtime.exScore)} / ${formatCount(runtime.exScoreMax)}`,
    SCORE_PANEL.x + 126,
    SCORE_PANEL.y + 48,
    {
      ...metricStyle(12, TEXT, 1),
      maxWidth: 96,
    },
    layerPool,
  );
  addText(layer, 'EX RATE', SCORE_PANEL.x + 12, SCORE_PANEL.y + 78, labelStyle(), layerPool);
  addText(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    SCORE_PANEL.x + 126,
    SCORE_PANEL.y + 78,
    {
      ...metricStyle(12, TEXT, 1),
      maxWidth: 96,
    },
    layerPool,
  );
  addText(layer, 'COMBO', SCORE_PANEL.x + 148, SCORE_PANEL.y + 16, labelStyle(), layerPool);
  addText(
    layer,
    formatCount(runtime.combo),
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 16,
    {
      ...metricStyle(14, TEAL, 1),
      fontFamily: DEFAULT_JUDGE_FONT,
      maxWidth: 58,
    },
    layerPool,
  );
  addText(layer, 'MAX', SCORE_PANEL.x + 148, SCORE_PANEL.y + 48, labelStyle(), layerPool);
  addText(
    layer,
    formatCount(runtime.maxCombo),
    SCORE_PANEL.x + 226,
    SCORE_PANEL.y + 48,
    {
      ...metricStyle(13, TEXT, 1),
      fontFamily: DEFAULT_JUDGE_FONT,
      maxWidth: 58,
    },
    layerPool,
  );
  addText(layer, 'RANK', SCORE_PANEL.x + 148, SCORE_PANEL.y + 78, labelStyle(), layerPool);
  addText(layer, rank, SCORE_PANEL.x + 226, SCORE_PANEL.y + 70, metricStyle(22, AMBER, 1), layerPool);

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

function drawBackgroundAroundBga(frame: Graphics): void {
  frame.rect(0, 0, DESIGN_WIDTH, BGA.y).fill(BG);
  frame.rect(0, BGA.y + BGA.h, DESIGN_WIDTH, DESIGN_HEIGHT - (BGA.y + BGA.h)).fill(BG);
  frame.rect(0, BGA.y, BGA.x, BGA.h).fill(BG);
  frame.rect(BGA.x + BGA.w, BGA.y, DESIGN_WIDTH - (BGA.x + BGA.w), BGA.h).fill(BG);
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

function drawPlayfield(frame: Graphics, playfield: FallbackPlayfieldLayout): void {
  const lanes = playfield.lanes;
  const playfieldHeight = PLAYFIELD.judgementY - PLAYFIELD.y;
  frame
    .roundRect(playfield.x - 10, 54, playfield.w + 20, PLAYFIELD.judgementY - 38, 6)
    .fill(PANEL)
    .stroke({ color: LINE, width: 1 });
  frame.rect(playfield.x, PLAYFIELD.y, playfield.w, playfieldHeight).fill(LANE);
  if (playfield.sideGap) {
    frame.rect(playfield.sideGap.x, PLAYFIELD.y, playfield.sideGap.w, playfieldHeight).fill({
      color: PANEL_DARK,
      alpha: 0.96,
    });
    frame.rect(playfield.sideGap.x + playfield.sideGap.w / 2 - 0.5, PLAYFIELD.y, 1, playfieldHeight).fill({
      color: LINE,
      alpha: 0.55,
    });
  }
  for (let index = 0; index < lanes.length; index += 1) {
    const lane = lanes[index]!;
    if (lane.isScratch) {
      frame.rect(lane.x, PLAYFIELD.y, lane.w, playfieldHeight).fill({ color: PANEL_DARK, alpha: 0.72 });
    } else if (index % 2 === 1) {
      frame.rect(lane.x, PLAYFIELD.y, lane.w, playfieldHeight).fill({ color: LANE_ALT, alpha: 0.28 });
    }
    frame.rect(lane.x, PLAYFIELD.y, 1, playfieldHeight).fill({ color: 0xffffff, alpha: 0.08 });
  }
  frame.rect(playfield.right, PLAYFIELD.y, 1, playfieldHeight).fill({
    color: 0xffffff,
    alpha: 0.08,
  });
  frame.rect(playfield.x, PLAYFIELD.judgementY - 8, playfield.w, 8).fill(AMBER);
  frame.rect(playfield.x, PLAYFIELD.judgementY, playfield.w, 2).fill({ color: 0xffffff, alpha: 0.85 });
}

function drawBgaFrame(frame: Graphics, hasBga: boolean): void {
  if (!hasBga) {
    frame.roundRect(BGA.x - 10, BGA.y - 28, BGA.w + 20, BGA.h + 52, 6).fill({ color: PANEL, alpha: 0.7 });
  }
  frame.roundRect(BGA.x - 10, BGA.y - 28, BGA.w + 20, BGA.h + 52, 6).stroke({ color: LINE, width: 1 });
  frame.rect(BGA.x, BGA.y, BGA.w, 1).fill({ color: 0xffffff, alpha: 0.12 });
  frame.rect(BGA.x, BGA.y + BGA.h - 1, BGA.w, 1).fill({ color: 0xffffff, alpha: 0.12 });
  frame.rect(BGA.x, BGA.y, 1, BGA.h).fill({ color: 0xffffff, alpha: 0.12 });
  frame.rect(BGA.x + BGA.w - 1, BGA.y, 1, BGA.h).fill({ color: 0xffffff, alpha: 0.12 });
  if (!hasBga) {
    frame.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill({ color: PANEL_DARK, alpha: 0.95 });
  }
}

function drawStatusBar(layer: Container, pool?: ChildPool): void {
  const status = pool?.acquireGraphics() ?? new Graphics();
  status.label = 'default-gameplay/status';
  status.rect(0, 0, DESIGN_WIDTH, 48).fill({ color: SURFACE, alpha: 0.94 });
  status.rect(0, 46, DESIGN_WIDTH, 2).fill({ color: LINE, alpha: 0.85 });
  if (!pool) {
    layer.addChild(status);
  }
}

function drawGauge(frame: Graphics, value: number | undefined, threshold: number | undefined): void {
  const gauge = clampPercent(value ?? 0);
  const clear = clampPercent(threshold ?? 80);
  const fillWidth = Math.round(GROOVE.w * (gauge / 100));
  const clearX = GROOVE.x + Math.round(GROOVE.w * (clear / 100));
  frame
    .roundRect(GROOVE.x - 8, GROOVE.y - 28, GROOVE.w + 16, 50, 6)
    .fill(PANEL)
    .stroke({ color: LINE, width: 1 });
  frame.rect(GROOVE.x, GROOVE.y, GROOVE.w, GROOVE.h).fill(PANEL_DARK);
  frame.rect(GROOVE.x, GROOVE.y, fillWidth, GROOVE.h).fill(gauge >= clear ? GREEN : AMBER);
  frame.rect(clearX, GROOVE.y - 3, 2, GROOVE.h + 6).fill({ color: TEXT, alpha: 0.9 });
}

function drawSongPlate(frame: Graphics): void {
  frame.roundRect(18, 404, 352, 58, 6).fill(PANEL).stroke({ color: LINE, width: 1 });
}

function drawScorePlate(frame: Graphics): void {
  frame.roundRect(SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w, SCORE_PANEL.h, 6).fill(PANEL).stroke({
    color: LINE,
    width: 1,
  });
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 40, SCORE_PANEL.w - 24, 1).fill({ color: LINE, alpha: 0.45 });
  frame.rect(SCORE_PANEL.x + 12, SCORE_PANEL.y + 70, SCORE_PANEL.w - 24, 1).fill({ color: LINE, alpha: 0.45 });
  frame.rect(SCORE_PANEL.x + 140, SCORE_PANEL.y + 12, 1, SCORE_PANEL.h - 24).fill({ color: LINE, alpha: 0.45 });
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

function formatNumber(value: number | undefined, fallback: string): string {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return `BPM ${Math.round(value)}`;
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
