import { Container, Graphics } from 'pixi.js';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_JUDGE_FONT, DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import { clamp01, countUp, slamAlpha, slamOffset, slamScale } from './motion.ts';
import { coverAmount, pieceRawT, RESULT_TIMELINE, resultJudgeRawT, resultMetricRawT } from './transition.ts';
import {
  DEFAULT_THEME as T,
  fillBgBands,
  fillParallelogram,
  fillSlash,
  paintSceneCover,
  strokeParallelogram,
} from './theme.ts';

export interface DefaultResultViewModel {
  designWidth: number;
  designHeight: number;
  cleared: boolean;
  title: string;
  artist: string;
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
  gaugeHistory: ReadonlyArray<{ x: number; y: number }>;
  scoreHistory: ReadonlyArray<{ x: number; y: number }>;
  rankRevealed: boolean;
  rankElapsedMs: number;
  sceneElapsedMs: number;
  nowMs: number;
}

const RANK_SLAM_MS = 420;

export function resultRankPunch(elapsedMs: number): { scale: number; alpha: number; offsetX: number } {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return { scale: 1, alpha: 0, offsetX: 0 };
  const t = clamp01(elapsedMs / RANK_SLAM_MS);
  return { scale: slamScale(t, 3.2), alpha: slamAlpha(t), offsetX: slamOffset(t, -88) };
}

export function renderDefaultResultChrome(layer: Container, model: DefaultResultViewModel): void {
  const chrome = new Graphics();
  chrome.label = 'default-result/chrome';
  const { designWidth, designHeight } = model;
  const elapsed = model.sceneElapsedMs;
  fillBgBands(chrome);

  const bannerT = pieceRawT(elapsed, RESULT_TIMELINE.banner);
  const statusColor = model.cleared ? T.paper : T.danger;
  const statusFill = model.cleared ? T.accent : T.accentDeep;
  fillSlash(chrome, -100, -20, 420, 70, 36, statusFill, 0.95 * Math.max(0.2, bannerT));
  fillSlash(chrome, 240, 8, 480, 16, 12, T.paper, 0.12 * bannerT);
  fillParallelogram(chrome, -20, 0, designWidth + 40, 50, 24, T.inkDeep, 0.9);

  addChromeText(layer, model.cleared ? 'CLEARED' : 'FAILED', 20, 6, {
    size: 28,
    fill: statusColor,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 2.2,
    rotation: -0.1,
    slam: slamScale(bannerT, 2.8),
    offsetX: slamOffset(bannerT, -90),
    alpha: slamAlpha(bannerT),
    stroke: { color: T.ink, width: 6, alignment: 0.5, join: 'round' },
  });
  addChromeText(layer, `${model.title}${model.artist ? ` / ${model.artist}` : ''}`, designWidth - 18, 14, {
    size: 11,
    fill: T.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    anchorX: 1,
    maxWidth: 360,
    slam: slamScale(bannerT, 1.4),
    alpha: slamAlpha(bannerT),
  });

  fillParallelogram(chrome, 14, 68, 180, 156, 14, T.panel, bannerT);
  strokeParallelogram(chrome, 14, 68, 180, 156, 14, T.accent, 2, 0.85 * bannerT);
  fillParallelogram(chrome, 206, 68, 198, 156, 12, T.panel, bannerT);
  strokeParallelogram(chrome, 206, 68, 198, 156, 12, T.line, 1, 0.85 * bannerT);
  fillParallelogram(chrome, 416, 68, 206, 156, 12, T.panel, bannerT);
  strokeParallelogram(chrome, 416, 68, 206, 156, 12, T.line, 1, 0.85 * bannerT);
  fillParallelogram(chrome, 14, 240, 292, 188, 14, T.panel, bannerT);
  strokeParallelogram(chrome, 14, 240, 292, 188, 14, T.line, 1, 0.85 * bannerT);
  fillParallelogram(chrome, 318, 240, 306, 188, 12, T.panel, bannerT);
  strokeParallelogram(chrome, 318, 240, 306, 188, 12, T.line, 1, 0.85 * bannerT);
  fillParallelogram(chrome, -16, designHeight - 36, designWidth + 32, 40, 16, T.inkDeep, 1);

  addChromeText(layer, 'RANK', 36, 84, { ...stampLabel(), alpha: slamAlpha(bannerT) });
  const punch = model.rankRevealed ? resultRankPunch(model.rankElapsedMs) : { scale: 1, alpha: 0, offsetX: 0 };
  if (model.rankRevealed && punch.alpha > 0) {
    for (let line = 0; line < 6; line += 1) {
      fillSlash(
        chrome,
        28 + line * 18,
        118 + line * 4,
        140 - line * 8,
        3,
        6,
        T.paper,
        (1 - clamp01(model.rankElapsedMs / 280)) * 0.35,
      );
    }
    addChromeText(layer, model.rank, 104, 140, {
      size: model.rank.length >= 3 ? 44 : 64,
      fill: T.gold,
      fontFamily: DEFAULT_NUMERIC_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      rotation: -0.12,
      slam: punch.scale,
      offsetX: punch.offsetX,
      alpha: punch.alpha,
      stroke: { color: T.ink, width: 6, alignment: 0.5, join: 'round' },
      maxWidth: 128,
    });
  } else if (!model.rankRevealed) {
    fillSlash(chrome, 36, 136, 140, 18, 8, T.inkDeep, 0.95);
    addChromeText(layer, '???', 104, 140, {
      size: 36,
      fill: T.mute,
      fontFamily: DEFAULT_NUMERIC_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      rotation: -0.08,
    });
  }
  addChromeText(layer, `${model.rate.toFixed(1)}%`, 104, 188, {
    size: 18,
    fill: T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    slam: slamScale(bannerT, 1.6),
    alpha: slamAlpha(bannerT),
  });

  paintMetric(layer, chrome, 224, 86, 'SCORE', String(countUp(model.score, elapsed, RESULT_TIMELINE.countDuration)), T.gold, resultMetricRawT(elapsed, 0));
  paintMetric(
    layer,
    chrome,
    224,
    132,
    'EX SCORE',
    `${countUp(model.exScore, elapsed, RESULT_TIMELINE.countDuration)} / ${model.exMax}`,
    T.paper,
    resultMetricRawT(elapsed, 1),
  );
  paintMetric(
    layer,
    chrome,
    224,
    178,
    'MAX COMBO',
    String(countUp(model.maxCombo, elapsed, RESULT_TIMELINE.countDuration)),
    T.accent,
    resultMetricRawT(elapsed, 2),
    DEFAULT_JUDGE_FONT,
  );
  paintMetric(layer, chrome, 434, 86, 'GAUGE', `${Math.round(model.gauge)}%`, statusColor, resultMetricRawT(elapsed, 3));
  paintMetric(
    layer,
    chrome,
    434,
    132,
    'PLAY TIME',
    `${model.playSeconds.toFixed(1)}s`,
    T.paper,
    resultMetricRawT(elapsed, 4),
  );
  paintMetric(layer, chrome, 434, 178, 'NOTES', String(model.notes), T.paper, resultMetricRawT(elapsed, 5));

  addChromeText(layer, 'JUDGEMENT', 32, 254, { ...stampLabel(), alpha: slamAlpha(bannerT) });
  const judges: Array<readonly [string, number, number]> = [
    ['PGREAT', model.perfect, T.gold],
    ['GREAT', model.great, T.paper],
    ['GOOD', model.good, T.paperDim],
    ['BAD', model.bad, T.bad],
    ['POOR', model.poor, T.danger],
  ];
  const maxJudge = Math.max(1, ...judges.map((row) => row[1]));
  for (let i = 0; i < judges.length; i += 1) {
    const rowT = resultJudgeRawT(elapsed, i);
    const jy = 280 + i * 24;
    const [label, value, fill] = judges[i]!;
    fillParallelogram(chrome, 32, jy, 254, 20, 6, T.inkDeep, rowT);
    const barW = Math.round(248 * (value / maxJudge) * rowT);
    if (barW > 0) fillSlash(chrome, 34, jy + 2, barW, 16, 3, fill, 0.28 * rowT);
    addChromeText(layer, label, 44, jy + 3, {
      size: 11,
      fill,
      fontFamily: DEFAULT_JUDGE_FONT,
      slam: slamScale(rowT, 1.5),
      offsetX: slamOffset(rowT, -20),
      alpha: slamAlpha(rowT),
    });
    addChromeText(layer, String(countUp(value, elapsed - i * RESULT_TIMELINE.judgeStagger, RESULT_TIMELINE.countDuration)), 270, jy + 1, {
      size: 15,
      fill: T.paper,
      fontFamily: DEFAULT_JUDGE_FONT,
      anchorX: 1,
      slam: slamScale(rowT, 1.7),
      alpha: slamAlpha(rowT),
    });
  }

  const graphT = pieceRawT(elapsed, RESULT_TIMELINE.graphs);
  addChromeText(layer, 'RUN', 336, 254, { ...stampLabel(), alpha: slamAlpha(graphT) });
  chrome.rect(336, 286, 268, 48).fill({ color: T.inkDeep, alpha: graphT });
  chrome.rect(336, 356, 268, 48).fill({ color: T.inkDeep, alpha: graphT });
  addChromeText(layer, 'Gauge', 348, 298, { size: 9, fill: T.mute, fontFamily: DEFAULT_NUMERIC_FONT, alpha: slamAlpha(graphT) });
  addChromeText(layer, 'EX score', 348, 368, { size: 9, fill: T.mute, fontFamily: DEFAULT_NUMERIC_FONT, alpha: slamAlpha(graphT) });
  drawSeries(chrome, 420, 294, 168, 32, model.gaugeHistory, statusColor, graphT);
  drawSeries(chrome, 420, 364, 168, 32, model.scoreHistory, T.gold, graphT);

  const footerT = pieceRawT(elapsed, RESULT_TIMELINE.footer);
  addChromeText(layer, 'TOTAL SCORE', 18, designHeight - 24, { ...stampLabel(), alpha: slamAlpha(footerT) });
  addChromeText(layer, String(countUp(model.score, elapsed, RESULT_TIMELINE.countDuration)), 150, designHeight - 30, {
    size: 22,
    fill: T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    slam: slamScale(footerT, 1.8),
    offsetX: slamOffset(footerT, -24),
    alpha: slamAlpha(footerT),
  });

  paintSceneCover(
    layer,
    coverAmount(elapsed, RESULT_TIMELINE.coverDelay, RESULT_TIMELINE.coverDuration, 'open'),
    model.nowMs,
    { width: designWidth, height: designHeight },
  );
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
  t: number,
  valueFontFamily = DEFAULT_NUMERIC_FONT,
): void {
  fillParallelogram(chrome, x, y, 160, 32, 8, T.inkDeep, t);
  addChromeText(layer, label, x + 10, y + 4, { ...stampLabel(), alpha: slamAlpha(t) });
  addChromeText(layer, value, x + 148, y + 12, {
    size: 15,
    fill,
    fontFamily: valueFontFamily,
    anchorX: 1,
    maxWidth: 92,
    slam: slamScale(t, 1.7),
    offsetX: slamOffset(t, -16),
    alpha: slamAlpha(t),
  });
}

function drawSeries(
  chrome: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  points: ReadonlyArray<{ x: number; y: number }>,
  color: number,
  t: number,
): void {
  if (points.length === 0 || t <= 0) return;
  chrome.rect(x, y + h, w, 1).fill({ color: T.paper, alpha: 0.16 * t });
  const cutoff = t;
  const first = points[0]!;
  chrome.moveTo(x + clamp01(first.x) * w * cutoff, y + (1 - clamp01(first.y)) * h);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    if (point.x > cutoff) break;
    chrome.lineTo(x + clamp01(point.x) * w, y + (1 - clamp01(point.y)) * h);
  }
  chrome.stroke({ color, width: 2, alpha: 0.95 * t, alignment: 0.5 });
}

function stampLabel(): { size: number; fill: number; fontFamily: string; letterSpacing: number } {
  return { size: 9, fill: T.mute, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 1.2 };
}
