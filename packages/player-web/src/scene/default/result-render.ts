import { Container, Graphics } from 'pixi.js';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_JUDGE_FONT, DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import { clamp01, slamOffset, slamScale, staggerProgress } from './motion.ts';
import { DEFAULT_THEME, fillParallelogram, fillSlash, strokeParallelogram } from './theme.ts';

export interface DefaultResultViewModel {
  cleared: boolean;
  title: string;
  artist?: string;
  rank: string;
  rate: number;
  score: number;
  exScore: number;
  exMax: number;
  maxCombo: number;
  gauge: number;
  playSeconds: number;
  notes: number;
  perfect: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  gaugeHistory: Array<{ progress: number; value: number }>;
  scoreHistory: Array<{ progress: number; exScore: number }>;
}

export interface DefaultResultChromeInput {
  designWidth: number;
  designHeight: number;
  sceneElapsedMs: number;
  rankRevealed: boolean;
  rankElapsedMs: number;
  result: DefaultResultViewModel;
}

const RANK_SLAM_MS = 420;

export function resultRankSlam(elapsedMs: number): { scale: number; offsetX: number; visible: boolean } {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return { scale: 1, offsetX: 0, visible: false };
  }
  const t = clamp01(elapsedMs / RANK_SLAM_MS);
  return { scale: slamScale(t, 3.2), offsetX: slamOffset(t, -88), visible: true };
}

/**
 * Skinless result chrome: a CLEARED/FAILED slash banner, slamming rank letter, and staggered judge bars.
 */
export function renderDefaultResultChrome(layer: Container, input: DefaultResultChromeInput): void {
  const { designWidth, designHeight, sceneElapsedMs, result } = input;
  const chrome = new Graphics();
  chrome.label = 'default-result/chrome';
  const intro = staggerProgress(sceneElapsedMs, 0, 380);
  const statusColor = result.cleared ? DEFAULT_THEME.paper : DEFAULT_THEME.crimson;
  const statusLabel = result.cleared ? 'CLEARED' : 'FAILED';

  chrome.rect(0, 0, designWidth, designHeight).fill(DEFAULT_THEME.ink);
  fillSlash(chrome, -100, -20, 420, 70, 36, result.cleared ? DEFAULT_THEME.crimson : DEFAULT_THEME.blood, 0.95);
  fillSlash(chrome, 240, 8, 480, 16, 12, DEFAULT_THEME.paper, 0.12);
  fillParallelogram(chrome, -20, 0, designWidth + 40, 50, 24, DEFAULT_THEME.inkDeep, 0.9);

  addChromeText(layer, statusLabel, 20, 6, {
    size: 28,
    fill: statusColor,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 2.2,
    rotation: -0.1,
    slam: slamScale(intro, 2.8),
    offsetX: slamOffset(intro, -90),
    stroke: { color: DEFAULT_THEME.ink, width: 6, alignment: 0.5, join: 'round' },
  });
  addChromeText(layer, `${result.title}${result.artist ? ` / ${result.artist}` : ''}`, designWidth - 18, 14, {
    size: 11,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    anchorX: 1,
    maxWidth: 360,
    slam: slamScale(staggerProgress(sceneElapsedMs, 80, 280), 1.4),
  });

  fillParallelogram(chrome, 14, 68, 180, 156, 14, DEFAULT_THEME.panel, 1);
  strokeParallelogram(chrome, 14, 68, 180, 156, 14, DEFAULT_THEME.crimson, 2, 0.85);
  fillParallelogram(chrome, 206, 68, 198, 156, 12, DEFAULT_THEME.panel, 1);
  strokeParallelogram(chrome, 206, 68, 198, 156, 12, DEFAULT_THEME.line, 1, 0.85);
  fillParallelogram(chrome, 416, 68, 206, 156, 12, DEFAULT_THEME.panel, 1);
  strokeParallelogram(chrome, 416, 68, 206, 156, 12, DEFAULT_THEME.line, 1, 0.85);
  fillParallelogram(chrome, 14, 240, 292, 188, 14, DEFAULT_THEME.panel, 1);
  strokeParallelogram(chrome, 14, 240, 292, 188, 14, DEFAULT_THEME.line, 1, 0.85);
  fillParallelogram(chrome, 318, 240, 306, 188, 12, DEFAULT_THEME.panel, 1);
  strokeParallelogram(chrome, 318, 240, 306, 188, 12, DEFAULT_THEME.line, 1, 0.85);
  fillParallelogram(chrome, -16, designHeight - 36, designWidth + 32, 40, 16, DEFAULT_THEME.inkDeep, 1);

  addChromeText(layer, 'RANK', 36, 84, stampLabel());
  const rankMotion = input.rankRevealed
    ? resultRankSlam(input.rankElapsedMs)
    : { scale: 1, offsetX: 0, visible: false };
  if (rankMotion.visible) {
    for (let line = 0; line < 6; line += 1) {
      fillSlash(
        chrome,
        28 + line * 18,
        118 + line * 4,
        140 - line * 8,
        3,
        6,
        DEFAULT_THEME.paper,
        (1 - clamp01(input.rankElapsedMs / 280)) * 0.35,
      );
    }
    addChromeText(layer, result.rank, 104, 140, {
      size: result.rank.length >= 3 ? 44 : 64,
      fill: DEFAULT_THEME.gold,
      fontFamily: DEFAULT_NUMERIC_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      rotation: -0.12,
      slam: rankMotion.scale,
      offsetX: rankMotion.offsetX,
      stroke: { color: DEFAULT_THEME.ink, width: 6, alignment: 0.5, join: 'round' },
      maxWidth: 128,
    });
  } else {
    fillSlash(chrome, 36, 136, 140, 18, 8, DEFAULT_THEME.inkDeep, 0.95);
    addChromeText(layer, '???', 104, 140, {
      size: 36,
      fill: DEFAULT_THEME.mute,
      fontFamily: DEFAULT_NUMERIC_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      rotation: -0.08,
    });
  }
  addChromeText(layer, `${result.rate.toFixed(1)}%`, 104, 188, {
    size: 18,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    slam: slamScale(staggerProgress(sceneElapsedMs, 120, 260), 1.6),
  });

  paintMetric(layer, chrome, 224, 86, 'SCORE', String(result.score), DEFAULT_THEME.gold, sceneElapsedMs, 80);
  paintMetric(
    layer,
    chrome,
    224,
    132,
    'EX SCORE',
    `${result.exScore} / ${result.exMax}`,
    DEFAULT_THEME.paper,
    sceneElapsedMs,
    110,
  );
  paintMetric(
    layer,
    chrome,
    224,
    178,
    'MAX COMBO',
    String(result.maxCombo),
    DEFAULT_THEME.crimson,
    sceneElapsedMs,
    140,
  );
  paintMetric(layer, chrome, 434, 86, 'GAUGE', `${Math.round(result.gauge)}%`, statusColor, sceneElapsedMs, 100);
  paintMetric(
    layer,
    chrome,
    434,
    132,
    'PLAY TIME',
    `${result.playSeconds.toFixed(1)}s`,
    DEFAULT_THEME.paper,
    sceneElapsedMs,
    130,
  );
  paintMetric(layer, chrome, 434, 178, 'NOTES', String(result.notes), DEFAULT_THEME.paper, sceneElapsedMs, 160);

  addChromeText(layer, 'JUDGEMENT', 32, 254, stampLabel());
  const judges: Array<readonly [string, string, number, number]> = [
    ['PGREAT', String(result.perfect), DEFAULT_THEME.gold, result.perfect],
    ['GREAT', String(result.great), DEFAULT_THEME.paper, result.great],
    ['GOOD', String(result.good), DEFAULT_THEME.paperDim, result.good],
    ['BAD', String(result.bad), 0xff8a3d, result.bad],
    ['POOR', String(result.poor), DEFAULT_THEME.crimson, result.poor],
  ];
  for (let i = 0; i < judges.length; i += 1) {
    const jy = 280 + i * 24;
    const [label, value, fill, count] = judges[i]!;
    const barT = staggerProgress(sceneElapsedMs, 180 + i * 55, 280);
    fillParallelogram(chrome, 32, jy, 254, 20, 6, DEFAULT_THEME.inkDeep, 1);
    const barW = Math.min(248, count * 2) * barT;
    if (barW > 0) {
      fillSlash(chrome, 34, jy + 2, barW, 16, 3, fill, 0.28);
    }
    addChromeText(layer, label, 44, jy + 3, {
      size: 11,
      fill,
      fontFamily: DEFAULT_JUDGE_FONT,
      slam: slamScale(barT, 1.5),
      offsetX: slamOffset(barT, -20),
    });
    addChromeText(layer, value, 270, jy + 1, {
      size: 15,
      fill: DEFAULT_THEME.paper,
      fontFamily: DEFAULT_JUDGE_FONT,
      anchorX: 1,
      slam: slamScale(barT, 1.7),
    });
  }

  addChromeText(layer, 'RUN', 336, 254, stampLabel());
  chrome.rect(336, 286, 268, 48).fill(DEFAULT_THEME.inkDeep);
  chrome.rect(336, 356, 268, 48).fill(DEFAULT_THEME.inkDeep);
  addChromeText(layer, 'Gauge', 348, 298, { size: 9, fill: DEFAULT_THEME.mute, fontFamily: DEFAULT_NUMERIC_FONT });
  addChromeText(layer, 'EX score', 348, 368, { size: 9, fill: DEFAULT_THEME.mute, fontFamily: DEFAULT_NUMERIC_FONT });
  drawSeries(
    chrome,
    420,
    294,
    168,
    32,
    result.gaugeHistory.map((sample) => ({ x: sample.progress, y: sample.value / 100 })),
    statusColor,
  );
  drawSeries(
    chrome,
    420,
    364,
    168,
    32,
    result.scoreHistory.map((sample) => ({
      x: sample.progress,
      y: result.exMax > 0 ? sample.exScore / result.exMax : 0,
    })),
    DEFAULT_THEME.gold,
  );

  addChromeText(layer, 'TOTAL SCORE', 18, designHeight - 24, stampLabel());
  addChromeText(layer, String(result.score), 150, designHeight - 30, {
    size: 22,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    slam: slamScale(staggerProgress(sceneElapsedMs, 200, 280), 1.8),
    offsetX: slamOffset(staggerProgress(sceneElapsedMs, 200, 280), -24),
  });

  const wipeT = staggerProgress(sceneElapsedMs, 0, 360);
  if (wipeT < 1) {
    fillParallelogram(
      chrome,
      -80,
      -20,
      designWidth * (1 - wipeT) + 140,
      designHeight + 40,
      70,
      DEFAULT_THEME.ink,
      0.96,
    );
    fillSlash(chrome, designWidth * (1 - wipeT) - 30, -10, 80, designHeight + 20, 36, DEFAULT_THEME.crimson, 0.9);
  }

  layer.addChildAt(chrome, 0);
}

function paintMetric(
  layer: Container,
  chrome: Graphics,
  x: number,
  y: number,
  label: string,
  value: string,
  fill: number,
  elapsedMs: number,
  delayMs: number,
): void {
  const t = staggerProgress(elapsedMs, delayMs, 240);
  fillParallelogram(chrome, x, y, 160, 32, 8, DEFAULT_THEME.inkDeep, 1);
  addChromeText(layer, label, x + 10, y + 4, stampLabel());
  addChromeText(layer, value, x + 148, y + 12, {
    size: 15,
    fill,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 1,
    maxWidth: 92,
    slam: slamScale(t, 1.7),
    offsetX: slamOffset(t, -16),
  });
}

function drawSeries(
  chrome: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  points: Array<{ x: number; y: number }>,
  color: number,
): void {
  if (points.length === 0) return;
  chrome.rect(x, y + h, w, 1).fill({ color: DEFAULT_THEME.paper, alpha: 0.16 });
  const first = points[0]!;
  chrome.moveTo(x + clamp01(first.x) * w, y + (1 - clamp01(first.y)) * h);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    chrome.lineTo(x + clamp01(point.x) * w, y + (1 - clamp01(point.y)) * h);
  }
  if (points.length === 1) {
    chrome.lineTo(x + clamp01(first.x) * w + 0.5, y + (1 - clamp01(first.y)) * h);
  }
  chrome.stroke({ color, width: 2, alpha: 0.95, alignment: 0.5 });
}

function stampLabel(): { size: number; fill: number; fontFamily: string; letterSpacing: number } {
  return { size: 9, fill: DEFAULT_THEME.mute, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 1.2 };
}
