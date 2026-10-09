import { Graphics } from 'pixi.js';
import { addStaggeredSkinText, drawNeedleField, drawPaperGrid, drawRulerTicks } from './draw.ts';
import { scrambleText, scrambleTick, springEase } from './field.ts';
import { bounceHeight } from './physics.ts';
import {
  LAT_ACCENT,
  LAT_DISPLAY_FONT,
  LAT_GRAPHITE,
  LAT_INK,
  LAT_MONO_FONT,
  LAT_PAPER,
  LAT_RULE,
  LAT_SIGNAL,
  LAT_TEXT_FONT,
} from './style.ts';
import {
  easeOutCubic,
  resolveResultLamp,
  resolveResultTrackRows,
  rollUpValue,
  stageProgress,
} from '../../skin-sdk/index.ts';
import { addSkinText, type PixiResultFrame, type PixiResultSkin, type SkinTextOptions } from '../pixi-kit/index.ts';

const ROLL_DELAY_MS = 600;
const ROLL_MS = 1100;
const RANK_DELAY_MS = 1500;

export const latticeResultSkin: PixiResultSkin = { render: (frame) => renderLatticeResult(frame) };

function mono(fill: number = LAT_GRAPHITE, extra: SkinTextOptions = {}): SkinTextOptions {
  return { size: 9, weight: '500', fill, fontFamily: LAT_MONO_FONT, letterSpacing: 0.6, ...extra };
}

function display(size: number, fill: number, weight: SkinTextOptions['weight'] = '300'): SkinTextOptions {
  return { size, fill, fontFamily: LAT_DISPLAY_FONT, weight };
}

/**
 * Lattice result: a typeset report on graph paper. The verdict sets itself letter by letter, rules draw across the
 * page, figures roll up on a tabular grid, the judgement bars and graphs draw in as ruled lines, and the rank drops in
 * as huge thin letters on a spring while the needle field behind swings to point at it.
 */
export function renderLatticeResult(frame: PixiResultFrame): void {
  const { result, designWidth, designHeight, nowMs, rankLabel, layer } = frame;
  const elapsed = frame.effects === 'off' ? Number.POSITIVE_INFINITY : frame.elapsedMs;
  const motion = frame.effects === 'off' ? 0 : frame.effects === 'reduced' ? 0.5 : 1;
  const cleared = result.cleared;
  const verdictColor = cleared ? LAT_ACCENT : LAT_SIGNAL;
  const exMax = Math.max(0, result.score.total * 2);
  const roll = stageProgress(elapsed, ROLL_DELAY_MS, ROLL_MS);
  const g = new Graphics();
  g.label = 'lattice-result/paper';
  layer.addChild(g);
  const text = (value: string, x: number, y: number, options: SkinTextOptions) =>
    addSkinText(layer, value, x, y, options);
  const rule = (x: number, y: number, w: number, delayMs: number, color = LAT_INK) => {
    const grow = easeOutCubic(stageProgress(elapsed, delayMs, 500));
    if (grow > 0) g.rect(x, y, w * grow, 1).fill(color);
  };
  const fadeIn = (delayMs: number) => Math.min(1, stageProgress(elapsed, delayMs, 300));
  // Text scramble: every string decodes in as its block arrives.
  const tick = scrambleTick(nowMs);
  const decode = (value: string, delayMs: number, seed: number, durationMs = 460) =>
    scrambleText(value, stageProgress(elapsed, delayMs, durationMs), tick, seed);

  g.rect(0, 0, designWidth, designHeight).fill(LAT_PAPER);
  drawPaperGrid(g, { x: 0, y: 0, w: designWidth, h: designHeight }, 0.45);
  const rankCx = 112;
  const rankCy = 156;
  const rankIn = stageProgress(elapsed, RANK_DELAY_MS, 600);
  drawNeedleField(
    g,
    { x: 0, y: 44, w: designWidth, h: designHeight - 44 },
    {
      seconds: (nowMs / 1000) * motion,
      beatPhase: ((nowMs / 1000) * motion * 0.5) % 1,
      flow: 0.3 * motion,
      beatWave: 0.25 * motion,
      attractor: { x: rankCx, y: rankCy, strength: 0.7 * easeOutCubic(rankIn) },
    },
    {
      alpha: 0.4,
      skip: (x, y) => (x > 14 && x < designWidth - 14 && y > 56 && y < 430) || y > designHeight - 50,
    },
  );

  // Verdict and title.
  rule(0, 43, designWidth, 0);
  addStaggeredSkinText(
    layer,
    decode(cleared ? 'STAGE CLEAR' : 'FAILED', 60, 1, 620),
    20,
    10,
    { ...display(20, verdictColor, '200'), letterSpacing: 5 },
    (index) => {
      const local = Math.max(0, (elapsed - 80 - index * 40) / 320);
      return { dy: -12 * (1 - springEase(Math.min(1, local))), alpha: Math.min(1, local * 3) };
    },
  );

  // Rank block with crop marks.
  const rankBox = { x: 20, y: 66, w: 184, h: 166 };
  g.rect(rankBox.x, rankBox.y, rankBox.w, rankBox.h).fill({ color: LAT_PAPER, alpha: fadeIn(200) });
  rule(rankBox.x, rankBox.y, rankBox.w, 200);
  text(decode('01 DJ LEVEL', 250, 3), rankBox.x, rankBox.y + 8, { ...mono(), alpha: fadeIn(250) });
  addStaggeredSkinText(
    layer,
    rankLabel,
    rankCx,
    rankCy,
    {
      ...display(rankLabel.length >= 3 ? 64 : 92, rankLabel.startsWith('AA') ? LAT_ACCENT : LAT_INK, '200'),
      anchorX: 0.5,
      anchorY: 0.5,
      maxWidth: 170,
    },
    (index) => {
      // Physics: each letter drops from above the box and bounces to rest.
      const age = (elapsed - RANK_DELAY_MS - index * 110) / 1000;
      return { dy: -bounceHeight(age, 90, 2800, 0.45), alpha: age > 0 ? 1 : 0 };
    },
  );
  const rate = frame.ratePercent * easeOutCubic(roll);
  text(`${rate.toFixed(2)}%`, rankBox.x + rankBox.w, rankBox.y + rankBox.h - 18, {
    ...display(12, LAT_INK, '400'),
    anchorX: 1,
    alpha: fadeIn(ROLL_DELAY_MS),
  });
  drawRulerTicks(g, rankBox.x, rankBox.y + rankBox.h, rankBox.w, -1, LAT_INK, 0.5 * fadeIn(300));

  // Figures.
  const metrics: ReadonlyArray<readonly [x: number, y: number, name: string, value: string, fill: number]> = [
    [220, 66, '02 SCORE', String(rollUpValue(result.score.score, roll)), LAT_INK],
    [220, 122, '03 EX SCORE', `${rollUpValue(result.score.exScore, roll)} / ${exMax}`, LAT_INK],
    [220, 178, '04 MAX COMBO', String(rollUpValue(result.maxCombo, roll)), LAT_ACCENT],
    [428, 66, '05 GAUGE', `${rollUpValue(Math.round(result.gauge), roll)}%`, cleared ? LAT_ACCENT : LAT_SIGNAL],
    [428, 122, '06 PLAY TIME', `${(result.playSeconds * easeOutCubic(roll)).toFixed(1)}s`, LAT_INK],
    [428, 178, '07 NOTES', String(rollUpValue(result.score.total, roll)), LAT_INK],
  ];
  metrics.forEach(([x, y, name, value, fill], index) => {
    const delay = 300 + index * 70;
    rule(x, y, 192, delay);
    text(decode(name, delay, 10 + index), x, y + 8, { ...mono(), alpha: fadeIn(delay) });
    text(value, x + 192, y + 20, { ...display(22, fill, '200'), anchorX: 1, maxWidth: 150, alpha: fadeIn(delay + 60) });
  });

  // Judgement bars.
  rule(20, 244, 290, 520);
  text(decode('08 JUDGEMENT', 520, 4), 20, 252, { ...mono(), alpha: fadeIn(520) });
  const rows: ReadonlyArray<readonly [name: string, count: number, color: number]> = [
    ['PGREAT', result.score.perfect, LAT_ACCENT],
    ['GREAT', result.score.great, LAT_INK],
    ['GOOD', result.score.good, LAT_GRAPHITE],
    ['BAD', result.score.bad, 0xd9730d],
    ['POOR', result.score.poor, LAT_SIGNAL],
  ];
  const judgeTotal = Math.max(1, result.score.total);
  rows.forEach(([name, count, color], index) => {
    // Rows on a 32 px pitch, so the last one shares the EX SCORE plot's baseline across the gutter.
    const y = 276 + index * 32;
    const grow = easeOutCubic(stageProgress(elapsed, ROLL_DELAY_MS + index * 70, ROLL_MS));
    text(decode(name, 560 + index * 50, 20 + index), 20, y, { ...mono(color), alpha: fadeIn(560 + index * 50) });
    g.rect(84, y + 5, 170, 1).fill({ color: LAT_RULE, alpha: 1 });
    const barW = (170 * Math.min(count, judgeTotal) * grow) / judgeTotal;
    if (barW > 0) g.rect(84, y + 3, Math.max(1, barW), 5).fill(color);
    text(String(rollUpValue(count, roll)), 310, y - 3, { ...display(13, LAT_INK, '400'), anchorX: 1 });
  });

  // Graphs as ruled lines.
  rule(326, 244, 294, 600);
  text(decode('09 GROOVE GAUGE', 600, 5), 326, 252, { ...mono(), alpha: fadeIn(600) });
  text(decode('10 EX SCORE', 640, 6), 326, 338, { ...mono(), alpha: fadeIn(640) });
  const draw = easeOutCubic(stageProgress(elapsed, ROLL_DELAY_MS + 150, ROLL_MS + 300));
  plot(
    g,
    326,
    266,
    294,
    58,
    result.gaugeHistory.map((s) => ({ x: s.progress, y: s.value / 100 })),
    cleared ? LAT_ACCENT : LAT_SIGNAL,
    draw,
    true,
  );
  plot(
    g,
    326,
    352,
    294,
    58,
    result.scoreHistory.map((s) => ({ x: s.progress, y: exMax > 0 ? s.exScore / exMax : 0 })),
    LAT_INK,
    draw,
    false,
  );

  // Track column (16:9): the chart's card and facts as numbered entries, the clear lamp ruled off at the foot.
  const trackX = 636;
  const trackW = designWidth - 20 - trackX;
  rule(trackX, 66, trackW, 680);
  text(decode('11 TRACK', 680, 8), trackX, 74, { ...mono(), alpha: fadeIn(680) });
  text(decode(result.song.title || 'Untitled chart', 700, 9, 600), trackX, 92, {
    size: 15,
    weight: '500',
    fill: LAT_INK,
    fontFamily: LAT_TEXT_FONT,
    maxWidth: trackW,
    alpha: fadeIn(700),
  });
  text(result.song.artist ?? '', trackX, 114, {
    size: 10,
    weight: '400',
    fill: LAT_GRAPHITE,
    fontFamily: LAT_TEXT_FONT,
    maxWidth: trackW,
    alpha: fadeIn(720),
  });
  if (result.song.genre) {
    text(result.song.genre.toUpperCase(), trackX, 130, { ...mono(), maxWidth: trackW, alpha: fadeIn(740) });
  }
  resolveResultTrackRows(result).forEach((row, index) => {
    const y = 178 + index * 44;
    const delay = 740 + index * 60;
    rule(trackX, y, trackW, delay, LAT_RULE);
    text(decode(`${12 + index} ${row.label}`, delay, 30 + index), trackX, y + 8, { ...mono(), alpha: fadeIn(delay) });
    text(row.value, trackX + trackW, y + 18, {
      ...display(18, LAT_INK, '300'),
      anchorX: 1,
      maxWidth: trackW - 20,
      alpha: fadeIn(delay + 60),
    });
  });
  const lamp = resolveResultLamp(result);
  const lampColor = lamp === 'FAILED' ? LAT_SIGNAL : lamp === 'CLEAR' ? LAT_INK : LAT_ACCENT;
  const lampY = 378;
  rule(trackX, lampY, trackW, 980, lampColor);
  g.rect(trackX, lampY + 1, trackW, 31).fill({ color: lampColor, alpha: 0.08 * fadeIn(1000) });
  text(decode(lamp, 1000, 40), trackX + trackW / 2, lampY + 16, {
    ...display(16, lampColor, '400'),
    anchorX: 0.5,
    anchorY: 0.5,
    letterSpacing: 4,
    maxWidth: trackW - 12,
    alpha: fadeIn(1000),
  });

  // Total score.
  rule(0, designHeight - 44, designWidth, 440);
  text(decode('TOTAL SCORE', 440, 7), 20, designHeight - 27, { ...mono(LAT_INK), alpha: fadeIn(440) });
  text(String(rollUpValue(result.score.score, roll)), 120, designHeight - 22, {
    ...display(18, LAT_INK, '300'),
    anchorY: 0.5,
    letterSpacing: 2,
    alpha: fadeIn(460),
  });
}

/** A graph drawn up to `progress` of its span: stepped (like a plotter) or straight, over a ruler baseline. */
function plot(
  graphics: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  points: ReadonlyArray<{ x: number; y: number }>,
  color: number,
  progress: number,
  stepped: boolean,
): void {
  graphics.rect(x, y + h, w, 1).fill(LAT_INK);
  drawRulerTicks(graphics, x, y + h + 1, w, 1, LAT_INK, 0.4, 10, 50);
  if (points.length === 0 || progress <= 0) return;
  const clamp = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
  const path: number[] = [];
  let previousY: number | undefined;
  for (const point of points) {
    const px = clamp(point.x);
    if (px > progress) break;
    const sx = x + px * w;
    const sy = y + (1 - clamp(point.y)) * h;
    if (stepped && previousY !== undefined) path.push(sx, previousY);
    path.push(sx, sy);
    previousY = sy;
  }
  if (path.length < 4) return;
  graphics.poly(path, false).stroke({ color, width: 1.5 });
  const headX = path[path.length - 2]!;
  const headY = path[path.length - 1]!;
  graphics.rect(headX - 2, headY - 2, 4, 4).fill(color);
}
