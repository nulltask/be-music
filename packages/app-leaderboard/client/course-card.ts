/**
 * Draws a course run's share card (1200 x 630, the link-preview picture of its course run page) on a canvas, on a
 * play's card's grid (client/score-card.ts): the heading names the course, its kind and how far the run went; the
 * result, the pills, the counts and the footer are a play's; the panel on the right lists the stages instead of a
 * playfield, each with the run's rate on it, above the lamp-coloured judge line.
 */
import { courseCardByline, type CourseCardData, type CourseCardStage } from '../src/pages/course-card-data.ts';
import type { Box } from '../src/pages/share-card-safe-area.ts';
import {
  CARD_HEIGHT,
  cardPen,
  COUNTS_BASELINE,
  drawCardBackground,
  drawCardFooter,
  drawCardHeading,
  drawCardResult,
  hexAlpha,
  MUTED,
  PANEL_LEFT,
  PANEL_WIDTH,
  RIGHT,
  SCORE_CARD_BOXES,
  SOFT,
  TEXT,
} from './score-card.ts';

/**
 * Where the stage list goes: from past the panel's fade to the right margin, from below the site's name to above the
 * judge line's glow.
 */
export const STAGE_FRAME = {
  left: PANEL_LEFT + 48,
  right: RIGHT,
  top: SCORE_CARD_BOXES.siteName.y + SCORE_CARD_BOXES.siteName.height + 26,
  bottom: COUNTS_BASELINE - 28,
} as const;

/** A row's height: two lines (the stage's label and rate, then its title) need the least; few stages get the most. */
export const STAGE_ROW_MIN = 56;
export const STAGE_ROW_MAX = 76;

/**
 * The stage list's rows: one per stage, as tall as the frame allows up to STAGE_ROW_MAX. When the stages need rows
 * shorter than STAGE_ROW_MIN, the list shows as many as fit but one, and the last row says how many more there are.
 */
export function stageRows(count: number, frame = STAGE_FRAME): { rows: Box[]; shown: number; more: number } {
  const span = frame.bottom - frame.top;
  const fits = Math.max(1, Math.floor(span / STAGE_ROW_MIN));
  const slots = Math.min(count, fits);
  const shown = count <= fits ? count : fits - 1;
  const height = slots === 0 ? 0 : Math.min(STAGE_ROW_MAX, Math.floor(span / slots));
  const rows = Array.from({ length: slots }, (_, i) => ({
    x: frame.left,
    y: frame.top + i * height,
    width: frame.right - frame.left,
    height,
  }));
  return { rows, shown, more: count - shown };
}

/**
 * The colour of a stage's accent bar: light for a cleared stage, red for a failed one, dim for the rest. The lamp's
 * colour stays the card's one accent, so a cleared stage of a failed run does not read as its lamp.
 */
export function stageAccent(state: CourseCardStage['state']): string {
  switch (state) {
    case 'cleared':
      return SOFT;
    case 'failed':
      return '#ff4d5e';
    case 'played':
      return MUTED;
    default:
      return '#2e3657';
  }
}

/** The panel on the right: a dark field fading in from its left edge, the lamp's glow and judge line at its foot. */
function drawStagePanel(ctx: CanvasRenderingContext2D, lampColor: string): void {
  const layer = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(PANEL_WIDTH, CARD_HEIGHT) : null;
  const target = layer?.getContext('2d') ?? null;
  const g = target ?? ctx;
  const x0 = target !== null ? 0 : PANEL_LEFT;
  g.fillStyle = '#0b0f1f';
  g.fillRect(x0, 0, PANEL_WIDTH, CARD_HEIGHT);
  const glow = g.createLinearGradient(0, COUNTS_BASELINE - 64, 0, COUNTS_BASELINE);
  glow.addColorStop(0, hexAlpha(lampColor, 0));
  glow.addColorStop(1, hexAlpha(lampColor, 0.5));
  g.fillStyle = glow;
  g.fillRect(x0, COUNTS_BASELINE - 64, PANEL_WIDTH, 64);
  g.fillStyle = lampColor;
  g.fillRect(x0, COUNTS_BASELINE - 8, PANEL_WIDTH, 8);
  if (target === null || layer === null) return;
  target.globalCompositeOperation = 'destination-out';
  const fade = target.createLinearGradient(0, 0, 48, 0);
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  target.fillStyle = fade;
  target.fillRect(0, 0, 48, CARD_HEIGHT);
  ctx.drawImage(layer, PANEL_LEFT, 0);
}

/** Draws the card. `avatar` is the player's icon, already loaded, or null to draw their initial instead. */
export function drawCourseCard(
  ctx: CanvasRenderingContext2D,
  data: CourseCardData,
  avatar: CanvasImageSource | null,
  playedOn: string,
): void {
  const pen = cardPen(ctx);
  drawCardBackground(ctx, data.lamp.color);
  drawStagePanel(ctx, data.lamp.color);
  drawCardHeading(ctx, pen, { label: data.kindLabel, title: data.courseName, byline: courseCardByline(data) });
  drawCardResult(ctx, pen, data);

  // The stages: an accent bar, the stage's label and the run's rate on it, then the chart's title.
  const { rows, shown, more } = stageRows(data.stages.length);
  rows.forEach((row, i) => {
    const top = row.y + Math.max(0, Math.round((row.height - STAGE_ROW_MIN) / 2));
    const textX = row.x + 16;
    const textWidth = row.x + row.width - textX;
    if (i >= shown) {
      pen.label(`+${more} MORE`, textX, top + 20);
      return;
    }
    const stage = data.stages[i];
    if (stage === undefined) return;
    ctx.fillStyle = stageAccent(stage.state);
    ctx.fillRect(row.x, top + 4, 4, STAGE_ROW_MIN - 12);
    const labelBaseline = pen.label(`STAGE ${i + 1}`, textX, top + 4);
    if (stage.rate !== null) {
      pen.set(700, 20, stage.state === 'failed' ? MUTED : TEXT);
      ctx.textAlign = 'right';
      ctx.fillText(stage.rate, row.x + row.width, labelBaseline);
      ctx.textAlign = 'left';
    }
    pen.set(600, 22, stage.state === 'unreached' ? MUTED : TEXT);
    pen.inkText(pen.fit(stage.title, textWidth), textX, labelBaseline + 28);
  });

  drawCardFooter(ctx, pen, data, avatar, playedOn);
}

/** The box the stage list may take, whatever the course; the tests keep it inside the safe area. */
export const STAGE_LIST_BOX: Box = {
  x: STAGE_FRAME.left,
  y: STAGE_FRAME.top,
  width: STAGE_FRAME.right - STAGE_FRAME.left,
  height: STAGE_FRAME.bottom - STAGE_FRAME.top,
};
