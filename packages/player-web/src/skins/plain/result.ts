import {
  resolveResultLamp,
  resolveResultTrackRows,
  type BeMusicResultFrame,
  type CanvasSurface,
} from '../../skin-sdk/index.ts';
import { ACCENT, DANGER, INK, MUTED, PANEL, stat, text } from './theme.ts';

const MARGIN = 16;

/** The result screen: verdict and rank, the score figures, the judgement counts, and the chart's facts. */
export function drawResult({ context: ctx, width, height }: CanvasSurface<'2d'>, frame: BeMusicResultFrame): void {
  const { result } = frame;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);

  text(ctx, result.cleared ? 'STAGE CLEAR' : 'FAILED', MARGIN, 28, {
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
  const figures: Array<[string, string]> = [
    ['SCORE', String(result.score.score)],
    ['EX SCORE', `${result.score.exScore} / ${result.score.total * 2}`],
    ['MAX COMBO', String(result.maxCombo)],
    ['GAUGE', `${Math.round(result.gauge)}%`],
    ['PLAY TIME', `${result.playSeconds.toFixed(1)}s`],
    ['NOTES', String(result.score.total)],
  ];
  figures.forEach(([label, value], index) => {
    stat(ctx, label, value, 240 + (index % 3) * 130, 76 + Math.floor(index / 3) * 56);
  });

  // Judgement counts.
  const counts: Array<[string, number]> = [
    ['PGREAT', result.score.perfect],
    ['GREAT', result.score.great],
    ['GOOD', result.score.good],
    ['BAD', result.score.bad],
    ['POOR', result.score.poor],
  ];
  counts.forEach(([label, count], index) => {
    const y = 250 + index * 26;
    text(ctx, label, MARGIN, y, { size: 12, color: MUTED, weight: 700 });
    text(ctx, String(count), MARGIN + 200, y, { size: 14, align: 'right' });
  });

  // The chart, its facts, and the clear lamp on the right.
  const x = width - MARGIN - 220;
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, 60, 220, 330);
  text(ctx, result.song.title, x + 14, 82, { size: 14, weight: 800, maxWidth: 192 });
  text(ctx, result.song.artist ?? '', x + 14, 102, { size: 11, color: MUTED, maxWidth: 192 });
  resolveResultTrackRows(result).forEach((row, index) => {
    const y = 140 + index * 34;
    text(ctx, row.label, x + 14, y, { size: 10, color: MUTED, weight: 700 });
    text(ctx, row.value, x + 206, y, { size: 14, align: 'right' });
  });
  const lamp = resolveResultLamp(result);
  text(ctx, lamp, x + 110, 360, { size: 18, weight: 800, align: 'center', color: lamp === 'FAILED' ? DANGER : ACCENT });

  text(ctx, `TOTAL SCORE  ${result.score.score}`, MARGIN, height - 24, { size: 14, weight: 700 });
}
