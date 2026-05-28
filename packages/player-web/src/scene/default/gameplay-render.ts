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
  frame.rect(0, 0, DESIGN_WIDTH, 48).fill({ color: SURFACE, alpha: 0.9 });
  frame.rect(0, 46, DESIGN_WIDTH, 2).fill({ color: LINE, alpha: 0.85 });

  drawPlayfield(frame, playfield);
  drawBgaFrame(frame, hasBga);
  drawInfoPanel(frame);
  drawGauge(frame, runtime.gauge, runtime.clearThreshold);
  drawSongPlate(frame);
  drawScorePlate(frame);
  if (!layerPool) {
    layer.addChildAt(frame, 0);
  }

  addText(layer, runtime.autoplay ? 'AUTO PLAY' : 'PLAY', 24, 14, {
    size: 10,
    weight: '800',
    fill: runtime.autoplay ? AMBER : TEAL,
    letterSpacing: 1.2,
  }, layerPool);
  addText(layer, formatNumber(runtime.bpm, 'BPM --'), 116, 14, {
    size: 10,
    weight: '700',
    fill: MUTED,
    fontFamily: NUMERIC_FONT,
  }, layerPool);
  addText(layer, `HS ${formatHiSpeed(runtime.hiSpeed)}`, 176, 14, {
    size: 10,
    weight: '700',
    fill: MUTED,
    fontFamily: NUMERIC_FONT,
  }, layerPool);

  addText(layer, 'SCORE', 532, 52, labelStyle(), layerPool);
  addText(layer, formatCount(runtime.score), 616, 68, metricStyle(18, AMBER, 1), layerPool);
  addText(layer, 'EX SCORE', 532, 98, labelStyle(), layerPool);
  addText(
    layer,
    `${formatCount(runtime.exScore)} / ${formatCount(runtime.exScoreMax)}`,
    616,
    114,
    metricStyle(13, TEXT, 1),
    layerPool,
  );
  addText(layer, 'COMBO', 532, 144, labelStyle(), layerPool);
  addText(layer, formatCount(runtime.combo), 616, 160, {
    ...metricStyle(18, TEAL, 1),
    fontFamily: DEFAULT_JUDGE_FONT,
  }, layerPool);
  addText(layer, 'MAX', 532, 190, labelStyle(), layerPool);
  addText(layer, formatCount(runtime.maxCombo), 616, 206, {
    ...metricStyle(16, TEXT, 1),
    fontFamily: DEFAULT_JUDGE_FONT,
  }, layerPool);
  addText(layer, 'RANK', 532, 236, labelStyle(), layerPool);
  addText(layer, runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F', 616, 250, metricStyle(26, AMBER, 1), layerPool);

  const judgeRows: Array<readonly [string, number | undefined, number]> = [
    ['PG', runtime.perfect, AMBER],
    ['GR', runtime.great, GREEN],
    ['GD', runtime.good, BLUE],
    ['BD', runtime.bad, ORANGE],
    ['PR', runtime.poor, RED],
  ];
  for (let index = 0; index < judgeRows.length; index += 1) {
    const [label, value, fill] = judgeRows[index]!;
    const y = 292 + index * 24;
    addText(layer, label, 532, y, { size: 10, weight: '800', fill }, layerPool);
    addText(layer, formatCount(value), 616, y - 2, metricStyle(13, TEXT, 1), layerPool);
  }

  const gauge = clampPercent(runtime.gauge ?? 0);
  addText(layer, 'GAUGE', GROOVE.x, GROOVE.y - 18, labelStyle(), layerPool);
  addText(layer, `${Math.round(gauge)}%`, GROOVE.x + GROOVE.w, GROOVE.y - 21, metricStyle(14, TEXT, 1), layerPool);

  const title = runtime.songTitle?.trim() || 'Untitled chart';
  addText(layer, title, 28, 416, {
    size: 16,
    weight: '800',
    fill: TEXT,
    maxWidth: 324,
  }, layerPool);
  const artist = runtime.songArtist?.trim();
  if (artist) {
    addText(layer, artist, 28, 438, {
      size: 10,
      weight: '600',
      fill: MUTED,
      maxWidth: 324,
    }, layerPool);
  }

  addText(layer, 'SCORE', 394, 397, labelStyle(), layerPool);
  addText(layer, formatCount(runtime.score), 492, 412, metricStyle(18, AMBER, 1), layerPool);
  addText(layer, 'EX RATE', 394, 438, labelStyle(), layerPool);
  addText(layer, formatExRate(runtime.exScore, runtime.exScoreMax), 492, 438, metricStyle(13, TEXT, 1), layerPool);

  if (runtime.lastJudge) {
    const judgeLayer = options.overlayLayer ?? layer;
    const judgePool = judgeLayer === layer ? layerPool : options.overlayLayerPool;
    const combo =
      runtime.combo !== undefined && Number.isFinite(runtime.combo) ? Math.max(0, Math.floor(runtime.combo)) : 0;
    addText(judgeLayer, runtime.lastJudge, playfield.centerX, 232, {
      size: 22,
      weight: '900',
      fill: judgeColor(runtime.lastJudge),
      fontFamily: DEFAULT_JUDGE_FONT,
      anchorX: 0.5,
      stroke: { color: 0x000000, width: 4, alignment: 0.5, join: 'round' },
      maxWidth: 160,
    }, judgePool);
    if (combo > 0) {
      addText(judgeLayer, formatCount(combo), playfield.centerX, 258, {
        size: 18,
        weight: '900',
        fill: TEXT,
        fontFamily: DEFAULT_JUDGE_FONT,
        anchorX: 0.5,
        stroke: { color: 0x000000, width: 4, alignment: 0.5, join: 'round' },
        maxWidth: 120,
      }, judgePool);
    }
  }
}

/**
 * Compatibility alias for older callers. New code should use {@link renderDefaultGameplayFrame}.
 */
export const renderFallbackLr2Frame = renderDefaultGameplayFrame;

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
  return {
    lanes,
    x: PLAYFIELD.x,
    w,
    centerX: PLAYFIELD.x + w / 2,
    right,
  };
}

function drawPlayfield(frame: Graphics, playfield: FallbackPlayfieldLayout): void {
  const lanes = playfield.lanes;
  const playfieldHeight = PLAYFIELD.judgementY - PLAYFIELD.y;
  frame
    .roundRect(playfield.x - 10, 54, playfield.w + 20, PLAYFIELD.judgementY - 38, 6)
    .fill(PANEL)
    .stroke({ color: LINE, width: 1 });
  frame.rect(playfield.x, PLAYFIELD.y, playfield.w, playfieldHeight).fill(LANE);
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

function drawInfoPanel(frame: Graphics): void {
  frame.roundRect(520, 38, 106, 410, 6).fill(PANEL).stroke({ color: LINE, width: 1 });
  for (const y of [86, 132, 178, 224, 270, 310, 334, 358, 382]) {
    frame.rect(532, y, 82, 1).fill({ color: LINE, alpha: 0.45 });
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
  frame.roundRect(384, 386, 128, 76, 6).fill(PANEL).stroke({ color: LINE, width: 1 });
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
