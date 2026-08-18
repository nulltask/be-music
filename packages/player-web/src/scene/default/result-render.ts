import { Container, Graphics } from 'pixi.js';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_JUDGE_FONT, DEFAULT_NUMERIC_FONT } from './fonts.ts';
import { countUp, slideOffset } from './motion.ts';
import { coverAmount, pieceT, RESULT_TIMELINE, resultJudgeT, resultMetricT } from './transition.ts';
import { DEFAULT_THEME as T, fillBgBands, fillTriangle, paintSceneCover, strokeCornerBrackets } from './theme.ts';

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

export function resultRankPunch(elapsedMs: number): { scale: number; alpha: number } {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return { scale: 1, alpha: 0 };
  if (elapsedMs < 80) {
    const t = elapsedMs / 80;
    return { scale: 1.65 - 0.5 * t, alpha: t };
  }
  if (elapsedMs < 220) {
    const t = (elapsedMs - 80) / 140;
    return { scale: 1.15 - 0.15 * t, alpha: 1 };
  }
  return { scale: 1, alpha: 1 };
}

export function renderDefaultResultChrome(layer: Container, model: DefaultResultViewModel): void {
  const chrome = new Graphics();
  chrome.label = 'default-result/chrome';
  const { designWidth, designHeight } = model;
  const elapsed = model.sceneElapsedMs;
  fillBgBands(chrome);

  const bannerT = pieceT(elapsed, RESULT_TIMELINE.banner);
  const statusColor = model.cleared ? T.cyan : T.danger;
  chrome.rect(0, 0, designWidth, 48).fill({ color: T.void, alpha: 0.96 });
  chrome.rect(0, 46, designWidth * bannerT, 2).fill({ color: statusColor, alpha: 0.85 * bannerT });
  fillTriangle(chrome, 22, 24, 12, statusColor, 0.9 * bannerT, !model.cleared);
  addChromeText(layer, model.cleared ? 'CLEARED' : 'FAILED', 36, 14 + slideOffset(bannerT, -18), {
    size: 16,
    weight: '700',
    fill: statusColor,
    letterSpacing: 3,
    fontFamily: DEFAULT_NUMERIC_FONT,
    alpha: bannerT,
  });
  addChromeText(layer, `${model.title}${model.artist ? ` / ${model.artist}` : ''}`, designWidth - 18, 16, {
    size: 11,
    weight: '700',
    fill: T.mute,
    anchorX: 1,
    maxWidth: 400,
    alpha: bannerT,
  });

  chrome.rect(18, 72, 172, 148).fill({ color: T.panel, alpha: bannerT }).stroke({ color: T.line, width: 1, alpha: bannerT });
  chrome.rect(210, 72, 194, 148).fill({ color: T.panel, alpha: bannerT }).stroke({ color: T.line, width: 1, alpha: bannerT });
  chrome.rect(424, 72, 198, 148).fill({ color: T.panel, alpha: bannerT }).stroke({ color: T.line, width: 1, alpha: bannerT });
  chrome.rect(18, 246, 286, 180).fill({ color: T.panel, alpha: bannerT }).stroke({ color: T.line, width: 1, alpha: bannerT });
  chrome.rect(324, 246, 298, 180).fill({ color: T.panel, alpha: bannerT }).stroke({ color: T.line, width: 1, alpha: bannerT });
  chrome.rect(0, designHeight - 34, designWidth, 34).fill({ color: T.void, alpha: 0.96 });

  addChromeText(layer, 'RANK', 38, 92, { size: 9, weight: '700', fill: T.mute, letterSpacing: 1.2, alpha: bannerT });
  const punch = model.rankRevealed ? resultRankPunch(model.rankElapsedMs) : { scale: 1, alpha: 0 };
  if (model.rankRevealed) {
    strokeCornerBrackets(chrome, 36, 118, 136, 72, 12, T.gold, punch.alpha);
    fillTriangle(chrome, 104, 154, 28, T.gold, 0.12 * punch.alpha, true);
  }
  addChromeText(layer, model.rankRevealed ? model.rank : '—', 104, 144, {
    size: model.rank.length >= 3 ? 40 : 54,
    weight: '700',
    fill: T.gold,
    anchorX: 0.5,
    anchorY: 0.5,
    stroke: { color: 0x031018, width: 4, alignment: 0.5, join: 'round' },
    maxWidth: 128,
    fontFamily: DEFAULT_NUMERIC_FONT,
    scale: punch.scale,
    alpha: punch.alpha,
  });
  addChromeText(layer, `${model.rate.toFixed(1)}%`, 104, 190, {
    size: 16,
    weight: '700',
    fill: T.ice,
    anchorX: 0.5,
    fontFamily: DEFAULT_NUMERIC_FONT,
    alpha: bannerT,
  });

  paintMetric(layer, chrome, 228, 92, 'SCORE', String(countUp(model.score, elapsed, RESULT_TIMELINE.countDuration)), T.gold, resultMetricT(elapsed, 0));
  paintMetric(layer, chrome, 228, 138, 'EX SCORE', `${countUp(model.exScore, elapsed, RESULT_TIMELINE.countDuration)} / ${model.exMax}`, T.ice, resultMetricT(elapsed, 1));
  paintMetric(layer, chrome, 228, 184, 'MAX COMBO', String(countUp(model.maxCombo, elapsed, RESULT_TIMELINE.countDuration)), T.cyan, resultMetricT(elapsed, 2), DEFAULT_JUDGE_FONT);
  paintMetric(layer, chrome, 442, 92, 'GAUGE', `${Math.round(model.gauge)}%`, statusColor, resultMetricT(elapsed, 3));
  paintMetric(layer, chrome, 442, 138, 'PLAY TIME', `${model.playSeconds.toFixed(1)}s`, T.ice, resultMetricT(elapsed, 4));
  paintMetric(layer, chrome, 442, 184, 'NOTES', String(model.notes), T.ice, resultMetricT(elapsed, 5));

  addChromeText(layer, 'JUDGEMENT', 36, 266, { size: 9, weight: '700', fill: T.mute, letterSpacing: 1.2, alpha: bannerT });
  const judges: Array<readonly [string, number, number]> = [
    ['PGREAT', model.perfect, T.gold],
    ['GREAT', model.great, T.great],
    ['GOOD', model.good, T.good],
    ['BAD', model.bad, T.bad],
    ['POOR', model.poor, T.danger],
  ];
  const maxJudge = Math.max(1, ...judges.map((row) => row[1]));
  for (let i = 0; i < judges.length; i += 1) {
    const rowT = resultJudgeT(elapsed, i);
    const jy = 292 + i * 24;
    const [label, value, fill] = judges[i]!;
    chrome.rect(36, jy, 246, 18).fill({ color: T.panelDeep, alpha: rowT }).stroke({ color: T.line, width: 1, alpha: rowT });
    chrome.rect(38, jy, Math.round(242 * rowT * (value / maxJudge)), 18).fill({ color: fill, alpha: 0.28 * rowT });
    addChromeText(layer, label, 48, jy + 3, { size: 9, weight: '700', fill, fontFamily: DEFAULT_JUDGE_FONT, alpha: rowT });
    addChromeText(layer, String(countUp(value, elapsed - i * RESULT_TIMELINE.judgeStagger, RESULT_TIMELINE.countDuration)), 264, jy + 1, {
      size: 13,
      weight: '700',
      fill: T.ice,
      fontFamily: DEFAULT_JUDGE_FONT,
      anchorX: 1,
      alpha: rowT,
    });
  }

  const graphT = pieceT(elapsed, RESULT_TIMELINE.graphs);
  addChromeText(layer, 'RUN', 342, 266, { size: 9, weight: '700', fill: T.mute, letterSpacing: 1.2, alpha: graphT });
  chrome.rect(342, 292, 256, 46).fill({ color: T.panelDeep, alpha: graphT }).stroke({ color: T.line, width: 1, alpha: graphT });
  chrome.rect(342, 362, 256, 46).fill({ color: T.panelDeep, alpha: graphT }).stroke({ color: T.line, width: 1, alpha: graphT });
  addChromeText(layer, 'Gauge', 354, 304, { size: 9, weight: '700', fill: T.mute, alpha: graphT });
  addChromeText(layer, 'EX score', 354, 374, { size: 9, weight: '700', fill: T.mute, alpha: graphT });
  drawSeries(chrome, 424, 300, 160, 30, model.gaugeHistory, statusColor, graphT);
  drawSeries(chrome, 424, 370, 160, 30, model.scoreHistory, T.gold, graphT);

  const footerT = pieceT(elapsed, RESULT_TIMELINE.footer);
  addChromeText(layer, 'TOTAL SCORE', 18, designHeight - 22, { size: 9, weight: '700', fill: T.mute, letterSpacing: 1.1, alpha: footerT });
  addChromeText(layer, String(countUp(model.score, elapsed, RESULT_TIMELINE.countDuration)), 150, designHeight - 27, {
    size: 18,
    weight: '700',
    fill: T.ice,
    fontFamily: DEFAULT_NUMERIC_FONT,
    alpha: footerT,
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
  chrome.rect(x, y, 156, 30).fill({ color: T.panelDeep, alpha: t }).stroke({ color: T.line, width: 1, alpha: t });
  addChromeText(layer, label, x + 10, y + 4, { size: 8, weight: '700', fill: T.mute, letterSpacing: 0.7, alpha: t });
  addChromeText(layer, value, x + 146, y + 12, {
    size: 14,
    weight: '700',
    fill,
    fontFamily: valueFontFamily,
    anchorX: 1,
    maxWidth: 92,
    alpha: t,
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
  chrome.rect(x, y + h, w, 1).fill({ color: T.ice, alpha: 0.12 * t });
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
