/**
 * Draws a play's share card (1200 x 630, the link-preview picture of its score page) on a canvas. The player's browser
 * draws it and main.ts uploads it. Workers Paid is the official deployment; server-side rendering is a separate option.
 *
 * The layout keeps to a grid: one left edge (MARGIN) for every block, the same margin at the top and right, the site's
 * name in the top right corner and the player in a footer band below, on its right: link previews lay their own labels
 * over the bottom left (src/pages/share-card-safe-area.ts), so nothing that matters sits there. Blocks group what belongs together: the chart (genre, title, artist), the result (DJ Rank,
 * EX-Score, rate), the play (lamp, ruleset, gauge), the counts, and who played it when. Space between the groups is
 * wider than within them. The DJ Rank is the one big thing; the lamp's colour is the one accent, repeated in the
 * glow, the lamp pill and the playfield's judge line. Labels repeat one style (small, spaced capitals, muted).
 */
import { SYNESTHESIA_PLAYFIELD, type ChartExcerpt, type ExcerptTone } from '../src/pages/chart-excerpt.ts';
import type { ScoreCardData } from '../src/pages/score-card-data.ts';
import {
  type Box,
  SAFE_EDGE,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  X_DOMAIN_LABEL_ZONE,
} from '../src/pages/share-card-safe-area.ts';

export const CARD_WIDTH = SHARE_CARD_WIDTH;
export const CARD_HEIGHT = SHARE_CARD_HEIGHT;

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

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function hexAlpha(hex: string, alpha: number): string {
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
export const TOP = 60;
/**
 * The chart block's baselines: the title's (a shrunk title keeps it, so the artist stays close below) and the
 * artist's.
 */
const TITLE_BASELINE = TOP + 66;
const BYLINE_BASELINE = TITLE_BASELINE + 38;
/** Where the result block starts, and the counts row's baseline (the playfield's judge line sits on it). */
const RESULT_TOP = 206;
export const COUNTS_BASELINE = FOOTER_TOP - TOP;
export const RIGHT = CARD_WIDTH - MARGIN;
const FOOTER_MIDDLE = (FOOTER_TOP + CARD_HEIGHT) / 2;
const AVATAR_SIZE = 56;
/** The footer's two lines: the player's name, then their handle and the date, on these baselines. */
const PLAYER_BASELINE = 570;
const HANDLE_BASELINE = PLAYER_BASELINE + 26;
/** The player's lines end left of the avatar, at the right margin, and stay clear of X's domain label. */
export const PLAYER_TEXT_RIGHT = RIGHT - AVATAR_SIZE - 18;
export const PLAYER_TEXT_MAX_WIDTH = PLAYER_TEXT_RIGHT - (X_DOMAIN_LABEL_ZONE.x + X_DOMAIN_LABEL_ZONE.width) - 24;
/** The widest the site's name gets in the top right corner, clear of the chart's column. */
export const SITE_NAME_MAX_WIDTH = RIGHT - (MARGIN + COLUMN_WIDTH) - 24;

/**
 * The boxes the card's important content may take, whatever the play: the chart, the result, the play's pills, the
 * counts, the player and the site's name. Heights reach from the cap height above the first line to the descenders
 * below the last; the tests keep each inside the safe area.
 */
export const SCORE_CARD_BOXES = {
  chart: { x: MARGIN, y: TOP, width: COLUMN_WIDTH, height: BYLINE_BASELINE + 8 - TOP },
  result: { x: MARGIN, y: RESULT_TOP, width: COLUMN_WIDTH, height: 102 },
  play: { x: MARGIN, y: RESULT_TOP + 102 + 24, width: COLUMN_WIDTH, height: 40 },
  counts: { x: MARGIN, y: COUNTS_BASELINE - 60, width: COLUMN_WIDTH, height: 66 },
  avatar: { x: RIGHT - AVATAR_SIZE, y: FOOTER_MIDDLE - AVATAR_SIZE / 2, width: AVATAR_SIZE, height: AVATAR_SIZE },
  player: {
    x: PLAYER_TEXT_RIGHT - PLAYER_TEXT_MAX_WIDTH,
    y: PLAYER_BASELINE - 20,
    width: PLAYER_TEXT_MAX_WIDTH,
    height: HANDLE_BASELINE + 5 - (PLAYER_BASELINE - 20),
  },
  siteName: { x: RIGHT - SITE_NAME_MAX_WIDTH, y: TOP, width: SITE_NAME_MAX_WIDTH, height: 26 },
} as const satisfies Record<string, Box>;

export const TEXT = '#ffffff';
export const SOFT = '#c7cde0';
export const MUTED = '#8d97b3';

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

/** The playfield's panel: 406 px at the card's right edge, its left edge fading into the background. */
export const PANEL_WIDTH = 406;
export const PANEL_LEFT = CARD_WIDTH - PANEL_WIDTH;
const LANE_LIGHT = '#1a2036';
const LANE_DARK = '#10152a';

/**
 * Where the chart's own notes go on the panel: lanes from past the fade to the safe area's right edge; the window's
 * start on the judge line (its top on the counts row's baseline), its end below the site's name, and long notes cut
 * off just above that.
 */
export const EXCERPT_FRAME = {
  left: PANEL_LEFT + 48,
  right: CARD_WIDTH - SAFE_EDGE,
  topY: 112,
  clipY: 96,
  judgeY: COUNTS_BASELINE - 8,
  noteHeight: 10,
  fadeWidth: 48,
} as const;

export type ExcerptRectKind = 'lane-light' | 'lane-dark' | 'bar' | `long-${ExcerptTone}` | `note-${ExcerptTone}`;

export const EXCERPT_RECT_COLORS: Readonly<Record<ExcerptRectKind, string>> = {
  'lane-light': LANE_LIGHT,
  'lane-dark': LANE_DARK,
  bar: '#2e3657',
  'long-white': '#8f97b3',
  'long-blue': '#2c7fa8',
  'long-red': '#a83445',
  'note-white': '#ffffff',
  'note-blue': '#4ec9ff',
  'note-red': '#ff4d5e',
};

export interface ExcerptRect extends Box {
  kind: ExcerptRectKind;
}

/**
 * The excerpt's lanes across the panel, as the Synesthesia skin lays them out (SYNESTHESIA_PLAYFIELD): That-Which-Must-Not-Be-Named modes give
 * the scratch, white and blue keys their fixed widths and part double play's banks by the side gap; 9 KEY shares one
 * side's width evenly. The design widths are scaled by one factor so a 7 KEY side fills the panel (and wider modes fit
 * it), and centred in it. Edges are rounded to whole pixels, each lane starting where the previous one ends.
 */
export function excerptLaneBoxes(excerpt: ChartExcerpt, frame = EXCERPT_FRAME): Array<{ x: number; width: number }> {
  const { laneWidths, sideGap, sideWidth } = SYNESTHESIA_PLAYFIELD;
  const shared = sideWidth / Math.max(1, excerpt.lanes.filter((lane) => lane.side === '1P').length);
  const widths = excerpt.lanes.map(({ tone }) =>
    excerpt.widths === 'shared'
      ? shared
      : tone === 'red'
        ? laneWidths.scratch
        : tone === 'blue'
          ? laneWidths.black
          : laneWidths.white,
  );
  const gaps = excerpt.lanes.map((lane, i): number =>
    i > 0 && excerpt.widths === '____' && lane.side !== excerpt.lanes[i - 1]?.side ? sideGap : 0,
  );
  const total = widths.reduce((sum, width) => sum + width, 0) + gaps.reduce((sum, gap) => sum + gap, 0);
  const span = frame.right - frame.left;
  const scale = Math.min(span / sideWidth, span / total);
  const left = frame.left + (span - total * scale) / 2;
  const boxes: Array<{ x: number; width: number }> = [];
  let edge = 0;
  widths.forEach((width, i) => {
    edge += gaps[i] ?? 0;
    const x = Math.round(left + edge * scale);
    edge += width;
    boxes.push({ x, width: Math.round(left + edge * scale) - x });
  });
  return boxes;
}

/**
 * The rectangles of a chart excerpt on the panel, back to front: lane backgrounds (blue keys' lanes darker), bar lines,
 * long-note bodies, then note heads. Lanes follow excerptLaneBoxes; the vertical scale is Synesthesia's at HIGH SPEED
 * 2.0 (its playfield's height in the window's beats), so the window's start sits on the judge line and its end at
 * `frame.topY`.
 */
export function excerptRects(excerpt: ChartExcerpt, frame = EXCERPT_FRAME): ExcerptRect[] {
  const lanes = excerptLaneBoxes(excerpt, frame);
  const fieldLeft = lanes[0]?.x ?? frame.left;
  const fieldRight = (lanes.at(-1)?.x ?? frame.right) + (lanes.at(-1)?.width ?? 0);
  const pixelsPerBeat = (frame.judgeY - frame.topY) / excerpt.beats;
  const yOf = (beat: number) => Math.round(frame.judgeY - beat * pixelsPerBeat);
  const rects: ExcerptRect[] = excerpt.lanes.map(({ tone }, i) => ({
    x: lanes[i]?.x ?? 0,
    y: 0,
    width: lanes[i]?.width ?? 0,
    height: CARD_HEIGHT,
    kind: tone === 'blue' ? 'lane-dark' : 'lane-light',
  }));
  for (const beat of excerpt.bars) {
    rects.push({ x: fieldLeft, y: yOf(beat) - 1, width: fieldRight - fieldLeft, height: 2, kind: 'bar' });
  }
  const heads: ExcerptRect[] = [];
  for (const note of excerpt.notes) {
    const tone = excerpt.lanes[note.lane]?.tone;
    const lane = lanes[note.lane];
    if (tone === undefined || lane === undefined) continue;
    const gap = lane.width >= 20 ? 2 : 1;
    const x = lane.x + gap;
    const width = lane.width - 2 * gap;
    const bottom = yOf(note.beat);
    if (note.end !== undefined) {
      // The body runs up to its end, or to the clip line when it ends past the window.
      const endY = yOf(note.end);
      const top = Math.max(frame.clipY, endY);
      const inset = Math.max(1, Math.round(width / 6));
      rects.push({ x: x + inset, y: top, width: width - 2 * inset, height: bottom - top, kind: `long-${tone}` });
      if (endY - frame.noteHeight >= frame.clipY) {
        heads.push({ x, y: endY - frame.noteHeight, width, height: frame.noteHeight, kind: `note-${tone}` });
      }
    }
    heads.push({ x, y: bottom - frame.noteHeight, width, height: frame.noteHeight, kind: `note-${tone}` });
  }
  return [...rects, ...heads];
}

/** The decorative notes of a card without its chart: lane, top, colour on 7 lanes of 58 px. */
const DECORATIVE_NOTES: ReadonlyArray<readonly [number, number, string]> = [
  // The top row peeks in from above, leaving the top right corner to the site's name.
  [1, -6, '#4ec9ff'],
  [5, -6, '#4ec9ff'],
  [4, 108, '#ffffff'],
  [2, 182, '#ffffff'],
  [6, 182, '#ffffff'],
  [3, 256, '#4ec9ff'],
  [2, 330, '#ffffff'],
  [6, 330, '#ffffff'],
  [1, 404, '#4ec9ff'],
];

/**
 * The playfield on the right; the judge line takes the lamp's colour. With the chart's excerpt it shows the chart's
 * densest two measures; without it, a 7-key playfield of decorative notes, as in the site icon.
 */
function drawPlayfield(ctx: CanvasRenderingContext2D, lampColor: string, excerpt: ChartExcerpt | undefined): void {
  const width = PANEL_WIDTH;
  const left = PANEL_LEFT;
  const fadeWidth = excerpt !== undefined ? EXCERPT_FRAME.fadeWidth : 200;
  const layer = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, CARD_HEIGHT) : null;
  const target = layer?.getContext('2d') ?? null;
  const g = target ?? ctx;
  const x0 = target !== null ? 0 : left;
  // The glow and the judge line sit on the counts row's baseline.
  const drawGlow = () => {
    const glow = g.createLinearGradient(0, COUNTS_BASELINE - 64, 0, COUNTS_BASELINE);
    glow.addColorStop(0, hexAlpha(lampColor, 0));
    glow.addColorStop(1, hexAlpha(lampColor, 0.5));
    g.fillStyle = glow;
    g.fillRect(x0, COUNTS_BASELINE - 64, width, 64);
  };
  if (excerpt !== undefined) {
    // The panel behind the lanes, and between double play's banks.
    g.fillStyle = '#0b0f1f';
    g.fillRect(x0, 0, width, CARD_HEIGHT);
    const rects = excerptRects(excerpt);
    // Lanes and bar lines under the glow, notes over it.
    const firstNote = rects.findIndex((rect) => rect.kind.startsWith('long-') || rect.kind.startsWith('note-'));
    rects.forEach((rect, i) => {
      if (i === firstNote) drawGlow();
      g.fillStyle = EXCERPT_RECT_COLORS[rect.kind];
      g.beginPath();
      g.roundRect(x0 + rect.x - left, rect.y, rect.width, rect.height, rect.kind.startsWith('note-') ? 2 : 0);
      g.fill();
    });
    if (firstNote < 0) drawGlow();
  } else {
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i % 2 === 0 ? LANE_LIGHT : LANE_DARK;
      g.fillRect(x0 + i * 58, 0, 58, CARD_HEIGHT);
    }
    for (const [laneIndex, y, color] of DECORATIVE_NOTES) {
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x0 + laneIndex * 58 + 4, y, 58 - 8, 16, 3);
      g.fill();
    }
    drawGlow();
  }
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

/** The pen every card draws its text with: one font at a time, text placed by its ink. */
export interface CardPen {
  /** Sets the font, the colour and the letter spacing. */
  set(weight: number, size: number, color: string, spacing?: number): void;
  /** The height of capitals in the current font: blocks align on their ink, not on their em box. */
  capHeight(): number;
  /** `text`, cut with an ellipsis to `maxWidth` in the current font. */
  fit(text: string, maxWidth: number): string;
  /**
   * Draws `text` starting at `x` by its ink, not its side bearing, then nudged left by the first glyph's optical inset
   * (opticalInset); returns the ink's right edge.
   */
  inkText(text: string, x: number, baseline: number): number;
  /** A label: small spaced capitals, the one style every label repeats; returns its baseline. */
  label(text: string, x: number, top: number): number;
}

export function cardPen(ctx: CanvasRenderingContext2D): CardPen {
  let fontSize = 0;
  const pen: CardPen = {
    set(weight, size, color, spacing = 0) {
      fontSize = size;
      ctx.font = font(weight, size);
      ctx.fillStyle = color;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    },
    capHeight: () => ctx.measureText('H').actualBoundingBoxAscent,
    fit: (text, maxWidth) => ellipsize((t) => ctx.measureText(t).width, text, maxWidth),
    inkText(text, x, baseline) {
      const metrics = ctx.measureText(text);
      const inset = opticalInset(glyphLeftEdges(ctx.font, [...text][0] ?? '', fontSize), fontSize);
      ctx.fillText(text, x + metrics.actualBoundingBoxLeft - inset, baseline);
      return x + metrics.actualBoundingBoxLeft - inset + metrics.actualBoundingBoxRight;
    },
    label(text, x, top) {
      pen.set(700, 15, MUTED, 1.5);
      const baseline = top + pen.capHeight();
      pen.inkText(text, x, baseline);
      return baseline;
    },
  };
  return pen;
}

/** Background: deep navy, the lamp's colour glowing from the top left. */
export function drawCardBackground(ctx: CanvasRenderingContext2D, lampColor: string): void {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const sky = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  sky.addColorStop(0, '#0a0e18');
  sky.addColorStop(1, '#161c38');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const aura = ctx.createRadialGradient(MARGIN, RESULT_TOP, 0, MARGIN, RESULT_TOP, 620);
  aura.addColorStop(0, hexAlpha(lampColor, 0.26));
  aura.addColorStop(1, hexAlpha(lampColor, 0));
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

/**
 * The heading block: a label on the top margin (the genre, or what kind of course), the title (shrunk to fit, then
 * cut) and a byline below; and the site's name in the top right corner, its capitals' top on the label's. The rows
 * keep their places when the label or the byline is empty, so every card shares one grid.
 */
export function drawCardHeading(
  ctx: CanvasRenderingContext2D,
  pen: CardPen,
  heading: { label: string | null; title: string; byline: string },
): void {
  if (heading.label !== null && heading.label.length > 0) {
    pen.set(700, 15, MUTED, 1.5);
    pen.inkText(pen.fit(heading.label, COLUMN_WIDTH), MARGIN, TOP + pen.capHeight());
  }
  pen.set(700, 26, TEXT);
  const siteBaseline = TOP + pen.capHeight();
  pen.set(400, 26, MUTED);
  const siteWidth = ctx.measureText(' Leaderboard').width;
  ctx.textAlign = 'right';
  ctx.fillText(' Leaderboard', RIGHT, siteBaseline);
  pen.set(700, 26, TEXT);
  ctx.fillText('be-music', RIGHT - siteWidth, siteBaseline);
  ctx.textAlign = 'left';
  const titleSize = fitFontSize(
    (text, size) => {
      ctx.font = font(800, size);
      return ctx.measureText(text).width;
    },
    heading.title,
    COLUMN_WIDTH,
    50,
    34,
  );
  pen.set(800, titleSize, TEXT, -0.5);
  pen.inkText(pen.fit(heading.title, COLUMN_WIDTH), MARGIN, TITLE_BASELINE);
  if (heading.byline.length > 0) {
    pen.set(400, 24, SOFT);
    pen.inkText(pen.fit(heading.byline, COLUMN_WIDTH), MARGIN, BYLINE_BASELINE);
  }
}

/** What the result, the play's pills, the counts and the footer show; a play's card and a course run's alike. */
export type CardResult = Pick<
  ScoreCardData,
  | 'djRank'
  | 'exScore'
  | 'maxExScore'
  | 'rate'
  | 'lamp'
  | 'rulesetLabel'
  | 'gauge'
  | 'judges'
  | 'bp'
  | 'maxCombo'
  | 'playerName'
  | 'handle'
>;

/**
 * The result: the DJ Rank, big, in its colour; the EX-Score and rate beside it, top and baseline on the rank's. Then
 * the play: lamp pill, ruleset pill, gauge — one row of equal height, text on one baseline.
 */
export function drawCardResult(ctx: CanvasRenderingContext2D, pen: CardPen, data: CardResult): void {
  pen.set(900, 140, TEXT, -2);
  const rankBaseline = RESULT_TOP + pen.capHeight();
  const [rankLight, rankDark] = djRankGradient(data.djRank);
  const rankGradient = ctx.createLinearGradient(0, RESULT_TOP, 0, rankBaseline);
  rankGradient.addColorStop(0, rankLight);
  rankGradient.addColorStop(1, rankDark);
  ctx.fillStyle = rankGradient;
  const scoreX = pen.inkText(data.djRank, MARGIN, rankBaseline) + 48;
  const labelBaseline = pen.label('EX-SCORE', scoreX, RESULT_TOP);
  pen.set(700, 26, TEXT);
  const rateCap = pen.capHeight();
  pen.set(800, 60, TEXT, -1);
  const scoreCap = pen.capHeight();
  // The score sits midway between the label and the rate line.
  const scoreBaseline = Math.round(labelBaseline + (rankBaseline - rateCap - labelBaseline + scoreCap) / 2);
  const scoreRight = pen.inkText(String(data.exScore), scoreX, scoreBaseline);
  pen.set(500, 26, MUTED);
  ctx.fillText(`/ ${data.maxExScore}`, scoreRight + 12, scoreBaseline);
  pen.set(700, 26, TEXT);
  pen.inkText(data.rate, scoreX, rankBaseline);

  const pillTop = rankBaseline + 24;
  const pillHeight = 40;
  pen.set(800, 19, TEXT, 1);
  const pillBaseline = Math.round(pillTop + (pillHeight + pen.capHeight()) / 2);
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
  pen.set(500, 20, SOFT);
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
  pen.set(700, 28, TEXT);
  const countsTop = COUNTS_BASELINE - pen.capHeight();
  pen.set(700, 15, MUTED, 1.5);
  const labelTop = countsTop - 12 - pen.capHeight();
  columns.forEach((x, i) => {
    pen.label(COUNT_LABELS[i] ?? '', x, labelTop);
    pen.set(700, 28, TEXT);
    pen.inkText(String(counts[i]), x, COUNTS_BASELINE);
  });
}

/** The footer band: who played it, and when, on its right; its left is where previews put their own labels. */
export function drawCardFooter(
  ctx: CanvasRenderingContext2D,
  pen: CardPen,
  data: Pick<CardResult, 'playerName' | 'handle'>,
  avatar: CanvasImageSource | null,
  playedOn: string,
): void {
  ctx.fillStyle = 'rgba(5, 7, 14, 0.78)';
  ctx.fillRect(0, FOOTER_TOP, CARD_WIDTH, CARD_HEIGHT - FOOTER_TOP);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(0, FOOTER_TOP, CARD_WIDTH, 1);
  const avatarBox = SCORE_CARD_BOXES.avatar;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarBox.x + AVATAR_SIZE / 2, FOOTER_MIDDLE, AVATAR_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatar !== null) {
    ctx.drawImage(avatar, avatarBox.x, avatarBox.y, AVATAR_SIZE, AVATAR_SIZE);
  } else {
    ctx.fillStyle = '#334155';
    ctx.fillRect(avatarBox.x, avatarBox.y, AVATAR_SIZE, AVATAR_SIZE);
    pen.set(700, 26, TEXT);
    ctx.textAlign = 'center';
    ctx.fillText([...data.playerName][0] ?? '?', avatarBox.x + AVATAR_SIZE / 2, FOOTER_MIDDLE + pen.capHeight() / 2);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  // Two lines, right-aligned to the avatar: the name, then the handle and the date.
  ctx.textAlign = 'right';
  pen.set(700, 26, TEXT);
  ctx.fillText(pen.fit(data.playerName, PLAYER_TEXT_MAX_WIDTH), PLAYER_TEXT_RIGHT, PLAYER_BASELINE);
  pen.set(400, 18, MUTED);
  ctx.fillText(pen.fit(`@${data.handle}  ·  ${playedOn}`, PLAYER_TEXT_MAX_WIDTH), PLAYER_TEXT_RIGHT, HANDLE_BASELINE);
  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

/** Draws the card. `avatar` is the player's icon, already loaded, or null to draw their initial instead. */
export function drawScoreCard(
  ctx: CanvasRenderingContext2D,
  data: ScoreCardData,
  avatar: CanvasImageSource | null,
  playedOn: string,
): void {
  const pen = cardPen(ctx);
  drawCardBackground(ctx, data.lamp.color);
  drawPlayfield(ctx, data.lamp.color, data.excerpt);
  const byline = [data.subtitle, data.artist].filter((part) => part !== null && part.length > 0).join('  ·  ');
  drawCardHeading(ctx, pen, { label: data.genre, title: data.title, byline });
  drawCardResult(ctx, pen, data);
  drawCardFooter(ctx, pen, data, avatar, playedOn);
}
