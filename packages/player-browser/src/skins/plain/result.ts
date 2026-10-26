import {
  resolveResultLamp,
  resolveResultTrackRows,
  resolveStageOrientation,
  type BeMusicResultData,
  type BeMusicResultFrame,
  type BeMusicSurface,
  resolveResultVerdict,
} from '@be-music/player-skin-sdk';
import { resolvePortraitResult } from './layout.ts';
import { ACCENT, DANGER, INK, MUTED, PANEL, stat, text } from './theme.ts';

const MARGIN = 16;

/**
 * The result screen: verdict and rank, the score figures, the judgement counts, and the chart's facts — side by side on
 * the landscape stage, stacked on the portrait one.
 */
export function drawResult(surface: BeMusicSurface<'2d'>, frame: BeMusicResultFrame): void {
  const { context: ctx, width, height } = surface;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);
  if (resolveStageOrientation(surface) === 'portrait') {
    drawPortraitResult(ctx, frame, width, height);
    return;
  }
  const { result, nowMs } = frame;

  text(ctx, resolveResultVerdict(result), MARGIN, 28, {
    size: 20,
    weight: 800,
    color: result.cleared ? ACCENT : DANGER,
  });

  // Rank and rate.
  ctx.fillStyle = PANEL;
  ctx.fillRect(MARGIN, 60, 200, 160);
  text(ctx, frame.rankLabel, MARGIN + 100, 130, { size: 56, weight: 800, align: 'center' });
  text(ctx, `${frame.ratePercent.toFixed(2)}%`, MARGIN + 100, 196, { size: 14, color: MUTED, align: 'center' });

  // Score figures in two rows of three.
  scoreFigures(result).forEach(([label, value], index) => {
    stat(ctx, label, value, 240 + (index % 3) * 130, 76 + Math.floor(index / 3) * 56, { maxWidth: 120, nowMs });
  });

  // Judgement counts.
  judgeCounts(result).forEach(([label, count], index) => {
    const y = 250 + index * 26;
    text(ctx, label, MARGIN, y, { size: 12, color: MUTED, weight: 700 });
    text(ctx, String(count), MARGIN + 200, y, { size: 14, align: 'right' });
  });

  // The chart, its facts, and the clear lamp on the right.
  const x = width - MARGIN - 220;
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, 60, 220, 330);
  // Genre, title, artist — the order every built-in skin uses.
  const lift = result.chart.genre ? 12 : 0;
  if (result.chart.genre) text(ctx, result.chart.genre, x + 14, 78, { size: 10, color: MUTED, maxWidth: 192, nowMs });
  text(ctx, result.chart.title, x + 14, 82 + lift, { size: 14, weight: 800, maxWidth: 192, nowMs });
  text(ctx, result.chart.artist ?? '', x + 14, 102 + lift, { size: 11, color: MUTED, maxWidth: 192, nowMs });
  resolveResultTrackRows(result).forEach((row, index) => {
    const y = 140 + index * 34;
    text(ctx, row.label, x + 14, y, { size: 10, color: MUTED, weight: 700 });
    text(ctx, row.value, x + 206, y, { size: 14, align: 'right', maxWidth: 120, nowMs });
  });
  const lamp = resolveResultLamp(result);
  text(ctx, lamp, x + 110, 360, { size: 18, weight: 800, align: 'center', color: lamp === 'FAILED' ? DANGER : ACCENT });

  text(ctx, `TOTAL SCORE  ${result.score.score}`, MARGIN, height - 24, { size: 14, weight: 700 });
  // Between the 1P counts and the chart panel.
  if (result.secondPlayer) drawSecondPlayer(ctx, result.secondPlayer, 240, 236, width - MARGIN - 220 - 16 - 240, nowMs);
}

/**
 * A two-player play's 2P result (LR2 BATTLE), between the 1P counts and the chart panel: its verdict, lamp, the
 * figures and the judgement counts.
 */
function drawSecondPlayer(
  ctx: CanvasRenderingContext2D,
  result: BeMusicResultData,
  x: number,
  y: number,
  w: number,
  nowMs: number,
): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, 190);
  const lamp = resolveResultLamp(result);
  text(ctx, `2P  ${resolveResultVerdict(result)}`, x + 14, y + 20, {
    size: 14,
    weight: 800,
    color: result.cleared ? ACCENT : DANGER,
  });
  text(ctx, lamp, x + w - 14, y + 20, {
    size: 12,
    weight: 800,
    align: 'right',
    color: lamp === 'FAILED' ? DANGER : ACCENT,
  });
  const column = (w - 150) / 2;
  scoreFigures(result)
    .slice(0, 4)
    .forEach(([label, value], index) => {
      stat(ctx, label, value, x + 14 + (index % 2) * column, y + 46 + Math.floor(index / 2) * 56, {
        maxWidth: column - 10,
        nowMs,
      });
    });
  judgeCounts(result).forEach(([label, count], index) => {
    const rowY = y + 48 + index * 26;
    text(ctx, label, x + w - 130, rowY, { size: 12, color: MUTED, weight: 700 });
    text(ctx, String(count), x + w - 14, rowY, { size: 14, align: 'right' });
  });
}

function scoreFigures(result: BeMusicResultData): Array<[string, string]> {
  return [
    ['SCORE', String(result.score.score)],
    ['EX SCORE', `${result.score.exScore} / ${result.score.total * 2}`],
    ['MAX COMBO', String(result.maxCombo)],
    ['GAUGE', `${Math.round(result.gauge)}%`],
    ['PLAY TIME', `${result.playSeconds.toFixed(1)}s`],
    ['NOTES', String(result.score.total)],
  ];
}

function judgeCounts(result: BeMusicResultData): Array<[string, number]> {
  return [
    ['PGREAT', result.score.perfect],
    ['GREAT', result.score.great],
    ['GOOD', result.score.good],
    ['BAD', result.score.bad],
    ['POOR', result.score.poor],
  ];
}

/**
 * The portrait result: the same pieces as the landscape one, stacked (see {@link resolvePortraitResult}) — the verdict,
 * the DJ LEVEL beside the score figures, the judgement counts, the chart with its facts and lamp, and the total.
 */
function drawPortraitResult(
  ctx: CanvasRenderingContext2D,
  frame: BeMusicResultFrame,
  width: number,
  height: number,
): void {
  const { result, nowMs } = frame;
  const grid = resolvePortraitResult(width, height);

  text(ctx, resolveResultVerdict(result), grid.rank.x, grid.verdictY, {
    size: 20,
    weight: 800,
    color: result.cleared ? ACCENT : DANGER,
  });

  // Rank and rate.
  const { rank } = grid;
  ctx.fillStyle = PANEL;
  ctx.fillRect(rank.x, rank.y, rank.w, rank.h);
  text(ctx, frame.rankLabel, rank.x + rank.w / 2, rank.y + rank.h * 0.42, { size: 56, weight: 800, align: 'center' });
  text(ctx, `${frame.ratePercent.toFixed(2)}%`, rank.x + rank.w / 2, rank.y + rank.h - 26, {
    size: 14,
    color: MUTED,
    align: 'center',
  });

  // Score figures, two columns of three beside the rank.
  scoreFigures(result).forEach(([label, value], index) => {
    const box = grid.figures[index]!;
    stat(ctx, label, value, box.x, box.y, { maxWidth: box.w - 10, nowMs, labelSize: 10 });
  });

  // Judgement counts, one row each across the panel.
  const { judges } = grid;
  ctx.fillStyle = PANEL;
  ctx.fillRect(judges.x, judges.y, judges.w, judges.h);
  judgeCounts(result).forEach(([label, count], index) => {
    const y = grid.judgeRowsY + index * grid.rowPitch;
    text(ctx, label, judges.x + 14, y, { size: 12, color: MUTED, weight: 700 });
    text(ctx, String(count), judges.x + judges.w - 14, y, { size: 14, align: 'right' });
  });

  // The chart: genre, title, artist, its facts one per row, and the clear lamp at the foot.
  const { track } = grid;
  ctx.fillStyle = PANEL;
  ctx.fillRect(track.x, track.y, track.w, track.h);
  const left = track.x + 14;
  const right = track.x + track.w - 14;
  const textW = right - left;
  const lift = result.chart.genre ? 12 : 0;
  if (result.chart.genre) {
    text(ctx, result.chart.genre, left, track.y + 18, { size: 10, color: MUTED, maxWidth: textW, nowMs });
  }
  text(ctx, result.chart.title, left, track.y + 24 + lift, { size: 16, weight: 800, maxWidth: textW, nowMs });
  text(ctx, result.chart.artist ?? '', left, track.y + 46 + lift, { size: 11, color: MUTED, maxWidth: textW, nowMs });
  resolveResultTrackRows(result).forEach((row, index) => {
    const y = grid.trackRowsY + index * grid.rowPitch;
    text(ctx, row.label, left, y, { size: 10, color: MUTED, weight: 700 });
    text(ctx, row.value, right, y, { size: 14, align: 'right', maxWidth: textW - 120, nowMs });
  });
  const lamp = resolveResultLamp(result);
  text(ctx, lamp, track.x + track.w / 2, grid.lampY, {
    size: 18,
    weight: 800,
    align: 'center',
    color: lamp === 'FAILED' ? DANGER : ACCENT,
  });

  text(ctx, `TOTAL SCORE  ${result.score.score}`, grid.rank.x, grid.totalY, { size: 14, weight: 700 });
}
