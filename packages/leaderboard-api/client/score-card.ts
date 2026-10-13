/**
 * Draws a play's share card (1200 x 630, the link-preview picture of its score page) on a canvas. The player's browser
 * draws it, since the Worker cannot rasterize on the Free plan, and main.ts uploads it.
 *
 * The layout keeps to a grid: one left edge (MARGIN) for every block, the same margin at the top and right, and the
 * player in a footer band below. Blocks group what belongs together: the chart (genre, title, artist), the result (DJ Rank,
 * EX-Score, rate), the play (lamp, ruleset, gauge), the counts, and who played it when. Space between the groups is
 * wider than within them. The DJ Rank is the one big thing; the lamp's colour is the one accent, repeated in the
 * glow, the lamp pill and the playfield's judge line. Labels repeat one style (small, spaced capitals, muted).
 */
import type { ScoreCardData } from '../src/pages/score-card-data.ts';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * Latin letters and figures in Inter Tight (main.ts loads it from the site); Japanese and anything else Inter Tight
 * lacks falls through to the system's Japanese fonts, glyph by glyph.
 */
const FONT =
  '"Inter Tight", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif';
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

/** The largest size in [min, max] at which `text` fits `maxWidth`, by `measure(text, size)`. */
export function fitFontSize(
  measure: (text: string, size: number) => number,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
): number {
  for (let size = maxSize; size > minSize; size -= 2) {
    if (measure(text, size) <= maxWidth) return size;
  }
  return minSize;
}

/** `text`, cut with an ellipsis where it would pass `maxWidth` (whole characters, emoji included). */
export function ellipsize(measure: (text: string) => number, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  const characters = [...text];
  while (characters.length > 0 && measure(`${characters.join('')}…`) > maxWidth) characters.pop();
  return `${characters.join('').trimEnd()}…`;
}

/** Black or white, whichever reads better on `hex` (#rrggbb). */
export function readableTextColor(hex: string): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#0a0e18' : '#ffffff';
}

/** The DJ Rank's colours: gold for AAA down to grey for F. */
export function djRankGradient(rank: string): [string, string] {
  switch (rank) {
    case 'AAA':
      return ['#fff3b0', '#f5b301'];
    case 'AA':
      return ['#ffffff', '#b8c4d6'];
    case 'A':
      return ['#ffd9a8', '#e08a2c'];
    default:
      return ['#c7cde0', '#7c86a3'];
  }
}

/** How far the optical correction moves a line's start, as a share of its first glyph's average left inset. */
const OPTICAL_STRENGTH = 0.5;
/** The most it moves a line, in em: a glyph like A or Y would otherwise be pulled far past the edge. */
const OPTICAL_LIMIT = 0.06;

/**
 * How far left of the ink edge a line should start to look aligned with its neighbours. The eye lines text up by its
 * mass, not its extreme pixel: the crossbar of T or t juts out past the stem, round letters bulge, diagonals lean in.
 * `edges` are the first glyph's left ink edge on each of its rows; the inset is part of their average distance from
 * the extreme edge, capped for glyphs that lean in a long way.
 */
export function opticalInset(edges: readonly number[], size: number): number {
  if (edges.length === 0) return 0;
  const extreme = Math.min(...edges);
  const mean = edges.reduce((sum, edge) => sum + edge - extreme, 0) / edges.length;
  return Math.min(mean * OPTICAL_STRENGTH, size * OPTICAL_LIMIT);
}

/** The left ink edge of `glyph` in `cssFont` on each row it covers, drawn on a scratch canvas. */
function glyphLeftEdges(cssFont: string, glyph: string, size: number): number[] {
  if (typeof OffscreenCanvas !== 'function') return [];
  const extent = Math.ceil(size * 2);
  const g = new OffscreenCanvas(extent, extent).getContext('2d');
  if (g === null) return [];
  g.font = cssFont;
  g.fillText(glyph, size / 2, size * 1.5);
  const { data } = g.getImageData(0, 0, extent, extent);
  const edges: number[] = [];
  for (let y = 0; y < extent; y++) {
    for (let x = 0; x < extent; x++) {
      if ((data[(y * extent + x) * 4 + 3] ?? 0) >= 128) {
        edges.push(x);
        break;
      }
    }
  }
  return edges;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * The grid: the side margin, the text column's width, where the footer band starts. Above the band, the content keeps
 * the same space (TOP) from the card's top edge and from the band.
 */
const MARGIN = 72;
const COLUMN_WIDTH = 720;
const FOOTER_TOP = 518;
const TOP = 60;
/**
 * The chart block's baselines: the title's (a shrunk title keeps it, so the artist stays close below) and the
 * artist's.
 */
const TITLE_BASELINE = TOP + 66;
const BYLINE_BASELINE = TITLE_BASELINE + 38;
/** Where the result block starts, and the counts row's baseline (the playfield's judge line sits on it). */
const RESULT_TOP = 206;
const COUNTS_BASELINE = FOOTER_TOP - TOP;

const TEXT = '#ffffff';
const SOFT = '#c7cde0';
const MUTED = '#8d97b3';

/** The counts row: the five judgments, then BP and the max combo, set apart by a wider gap. */
export const COUNT_LABELS = ['PGREAT', 'GREAT', 'GOOD', 'BAD', 'POOR', 'BP', 'COMBO'] as const;

/**
 * The counts row's column positions: seven columns of one width across `width` from `left`, with `gap` more space
 * before the sixth, which parts the judgments from BP and the combo.
 */
export function countColumns(left: number, width: number, gap: number): number[] {
  const column = (width - gap) / COUNT_LABELS.length;
  return COUNT_LABELS.map((_, i) => Math.round(left + i * column + (i >= 5 ? gap : 0)));
}

/** The 7-key playfield on the right, as in the site icon; the judge line takes the lamp's colour. */
function drawPlayfield(ctx: CanvasRenderingContext2D, lampColor: string): void {
  const lane = 58;
  const width = lane * 7;
  const left = CARD_WIDTH - width;
  const fadeWidth = 200;
  const layer = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, CARD_HEIGHT) : null;
  const target = layer?.getContext('2d') ?? null;
  const g = target ?? ctx;
  const x0 = target !== null ? 0 : left;
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i % 2 === 0 ? '#1a2036' : '#10152a';
    g.fillRect(x0 + i * lane, 0, lane, CARD_HEIGHT);
  }
  const notes: Array<[number, number, string]> = [
    [1, 34, '#4ec9ff'],
    [5, 34, '#4ec9ff'],
    [4, 108, '#ffffff'],
    [2, 182, '#ffffff'],
    [6, 182, '#ffffff'],
    [3, 256, '#4ec9ff'],
    [2, 330, '#ffffff'],
    [6, 330, '#ffffff'],
    [1, 404, '#4ec9ff'],
  ];
  for (const [laneIndex, y, color] of notes) {
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x0 + laneIndex * lane + 4, y, lane - 8, 16, 3);
    g.fill();
  }
  // The judge line sits on the counts row's baseline.
  const glow = g.createLinearGradient(0, COUNTS_BASELINE - 64, 0, COUNTS_BASELINE);
  glow.addColorStop(0, hexAlpha(lampColor, 0));
  glow.addColorStop(1, hexAlpha(lampColor, 0.5));
  g.fillStyle = glow;
  g.fillRect(x0, COUNTS_BASELINE - 64, width, 64);
  g.fillStyle = lampColor;
  g.fillRect(x0, COUNTS_BASELINE - 8, width, 8);
  if (target === null || layer === null) return;
  // Fade the layer's left edge to transparent, then lay it over the background.
  target.globalCompositeOperation = 'destination-out';
  const fade = target.createLinearGradient(0, 0, fadeWidth, 0);
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  target.fillStyle = fade;
  target.fillRect(0, 0, fadeWidth, CARD_HEIGHT);
  ctx.drawImage(layer, left, 0);
}

/** Draws the card. `avatar` is the player's icon, already loaded, or null to draw their initial instead. */
export function drawScoreCard(
  ctx: CanvasRenderingContext2D,
  data: ScoreCardData,
  avatar: CanvasImageSource | null,
  playedOn: string,
): void {
  const right = CARD_WIDTH - MARGIN;
  let fontSize = 0;
  const set = (weight: number, size: number, color: string, spacing = 0) => {
    fontSize = size;
    ctx.font = font(weight, size);
    ctx.fillStyle = color;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  };
  /** The height of capitals in the current font: blocks align on their ink, not on their em box. */
  const capHeight = () => ctx.measureText('H').actualBoundingBoxAscent;
  const fit = (text: string, maxWidth: number) => ellipsize((t) => ctx.measureText(t).width, text, maxWidth);
  /**
   * Draws `text` starting at `x` by its ink, not its side bearing, then nudged left by the first glyph's optical inset
   * (opticalInset); returns the ink's right edge.
   */
  const inkText = (text: string, x: number, baseline: number) => {
    const metrics = ctx.measureText(text);
    const inset = opticalInset(glyphLeftEdges(ctx.font, [...text][0] ?? '', fontSize), fontSize);
    ctx.fillText(text, x + metrics.actualBoundingBoxLeft - inset, baseline);
    return x + metrics.actualBoundingBoxLeft - inset + metrics.actualBoundingBoxRight;
  };
  /** A label: small spaced capitals, the one style every label repeats. */
  const label = (text: string, x: number, top: number) => {
    set(700, 15, MUTED, 1.5);
    const baseline = top + capHeight();
    inkText(text, x, baseline);
    return baseline;
  };
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Background: deep navy, the lamp's colour glowing from the top left.
  const sky = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  sky.addColorStop(0, '#0a0e18');
  sky.addColorStop(1, '#161c38');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const aura = ctx.createRadialGradient(MARGIN, RESULT_TOP, 0, MARGIN, RESULT_TOP, 620);
  aura.addColorStop(0, hexAlpha(data.lamp.color, 0.26));
  aura.addColorStop(1, hexAlpha(data.lamp.color, 0));
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawPlayfield(ctx, data.lamp.color);

  // The chart: the genre as a label on the top margin, the title (shrunk to fit, then cut) and the artist below. The
  // rows keep their places when the chart names no genre, so every card shares one grid.
  if (data.genre !== null && data.genre.length > 0) {
    set(700, 15, MUTED, 1.5);
    inkText(fit(data.genre, COLUMN_WIDTH), MARGIN, TOP + capHeight());
  }
  const titleSize = fitFontSize(
    (text, size) => {
      ctx.font = font(800, size);
      return ctx.measureText(text).width;
    },
    data.title,
    COLUMN_WIDTH,
    50,
    34,
  );
  set(800, titleSize, TEXT, -0.5);
  inkText(fit(data.title, COLUMN_WIDTH), MARGIN, TITLE_BASELINE);
  const byline = [data.subtitle, data.artist].filter((part) => part !== null && part.length > 0).join('  ·  ');
  if (byline.length > 0) {
    set(400, 24, SOFT);
    inkText(fit(byline, COLUMN_WIDTH), MARGIN, BYLINE_BASELINE);
  }

  // The result: the DJ Rank, big, in its colour; the EX-Score and rate beside it, top and baseline on the rank's.
  set(900, 140, TEXT, -2);
  const rankBaseline = RESULT_TOP + capHeight();
  const [rankLight, rankDark] = djRankGradient(data.djRank);
  const rankGradient = ctx.createLinearGradient(0, RESULT_TOP, 0, rankBaseline);
  rankGradient.addColorStop(0, rankLight);
  rankGradient.addColorStop(1, rankDark);
  ctx.fillStyle = rankGradient;
  const scoreX = inkText(data.djRank, MARGIN, rankBaseline) + 48;
  const labelBaseline = label('EX-SCORE', scoreX, RESULT_TOP);
  set(700, 26, TEXT);
  const rateCap = capHeight();
  set(800, 60, TEXT, -1);
  const scoreCap = capHeight();
  // The score sits midway between the label and the rate line.
  const scoreBaseline = Math.round(labelBaseline + (rankBaseline - rateCap - labelBaseline + scoreCap) / 2);
  const scoreRight = inkText(String(data.exScore), scoreX, scoreBaseline);
  set(500, 26, MUTED);
  ctx.fillText(`/ ${data.maxExScore}`, scoreRight + 12, scoreBaseline);
  set(700, 26, TEXT);
  inkText(data.rate, scoreX, rankBaseline);

  // The play: lamp pill, ruleset pill, gauge — one row of equal height, text on one baseline.
  const pillTop = rankBaseline + 24;
  const pillHeight = 40;
  set(800, 19, TEXT, 1);
  const pillBaseline = Math.round(pillTop + (pillHeight + capHeight()) / 2);
  const lampWidth = ctx.measureText(data.lamp.label).width + 40;
  ctx.fillStyle = data.lamp.color;
  ctx.shadowColor = hexAlpha(data.lamp.color, 0.6);
  ctx.shadowBlur = 24;
  roundRect(ctx, MARGIN, pillTop, lampWidth, pillHeight, pillHeight / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = readableTextColor(data.lamp.color);
  ctx.fillText(data.lamp.label, MARGIN + 20, pillBaseline);
  const rulesetX = MARGIN + lampWidth + 12;
  const rulesetWidth = ctx.measureText(data.rulesetLabel).width + 40;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 2;
  roundRect(ctx, rulesetX + 1, pillTop + 1, rulesetWidth - 2, pillHeight - 2, pillHeight / 2 - 1);
  ctx.stroke();
  ctx.fillStyle = TEXT;
  ctx.fillText(data.rulesetLabel, rulesetX + 20, pillBaseline);
  set(500, 20, SOFT);
  ctx.fillText(data.gauge, rulesetX + rulesetWidth + 20, pillBaseline);

  // The counts: label over value, one column each.
  const counts = [
    data.judges.pgreat,
    data.judges.great,
    data.judges.good,
    data.judges.bad,
    data.judges.poor,
    data.bp,
    data.maxCombo,
  ];
  const columns = countColumns(MARGIN, COLUMN_WIDTH, 24);
  set(700, 28, TEXT);
  const countsTop = COUNTS_BASELINE - capHeight();
  set(700, 15, MUTED, 1.5);
  const labelTop = countsTop - 12 - capHeight();
  columns.forEach((x, i) => {
    label(COUNT_LABELS[i] ?? '', x, labelTop);
    set(700, 28, TEXT);
    inkText(String(counts[i]), x, COUNTS_BASELINE);
  });

  // The footer band: who played it, and when, on the site.
  ctx.fillStyle = 'rgba(5, 7, 14, 0.78)';
  ctx.fillRect(0, FOOTER_TOP, CARD_WIDTH, CARD_HEIGHT - FOOTER_TOP);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(0, FOOTER_TOP, CARD_WIDTH, 1);
  const footerMiddle = (FOOTER_TOP + CARD_HEIGHT) / 2;
  const avatarSize = 56;
  const avatarTop = footerMiddle - avatarSize / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(MARGIN + avatarSize / 2, footerMiddle, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatar !== null) {
    ctx.drawImage(avatar, MARGIN, avatarTop, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = '#334155';
    ctx.fillRect(MARGIN, avatarTop, avatarSize, avatarSize);
    set(700, 26, TEXT);
    ctx.textAlign = 'center';
    ctx.fillText([...data.playerName][0] ?? '?', MARGIN + avatarSize / 2, footerMiddle + capHeight() / 2);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  // Two lines on each side, on the same two baselines, centred in the band.
  set(700, 26, TEXT);
  const nameCap = capHeight();
  const lineGap = 26;
  const firstBaseline = Math.round(footerMiddle + (nameCap - lineGap) / 2);
  const secondBaseline = firstBaseline + lineGap;
  const nameX = MARGIN + avatarSize + 18;
  ctx.fillText(fit(data.playerName, 420), nameX, firstBaseline);
  set(400, 18, MUTED);
  ctx.fillText(fit(`@${data.handle}`, 420), nameX, secondBaseline);
  ctx.textAlign = 'right';
  set(400, 26, MUTED);
  const siteWidth = ctx.measureText(' Leaderboard').width;
  ctx.fillText(' Leaderboard', right, firstBaseline);
  set(700, 26, TEXT);
  ctx.fillText('be-music', right - siteWidth, firstBaseline);
  set(400, 18, MUTED);
  ctx.fillText(playedOn, right, secondBaseline);
  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
