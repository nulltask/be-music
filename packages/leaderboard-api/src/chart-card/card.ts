/**
 * A chart's share card: the default card's background and text (src/pages/icons/og-chart.svg, prepared by
 * scripts/build-icons.ts) with the chart's densest stretch drawn on the right as lanes and notes. The Worker draws it
 * from the chart's fingerprint document, since a Worker on the Free plan cannot rasterize text or SVG: only the
 * rectangles of the notes are drawn per chart.
 */
import {
  densestWindow,
  documentBeatNotes,
  documentMeasureCount,
  layoutExcerpt,
  measureStartBeats,
  type ExcerptDocument,
  type ExcerptFrame,
  type ExcerptRect,
} from './excerpt.ts';
import { BACKGROUND_COLORS, EXCERPT_COLORS, type ExcerptColor } from './palette.ts';
import { encodeIndexedPng, fillRect, type IndexedImage } from './png.ts';
import { SHARE_CARD_HEIGHT } from '../pages/share-card-safe-area.ts';

/** Bump when the drawing changes, so cached cards are drawn again. */
export const CHART_CARD_LAYOUT = 1;

/** The excerpt's length: two 4/4 measures. */
export const EXCERPT_BEATS = 8;

/**
 * The playfield: the right of the card, as on the default card, 72 px from the right edge like the score card; the
 * lanes run the card's full height, the notes between the safe area's top and the judge line.
 */
export const CHART_CARD_FRAME: ExcerptFrame = {
  box: { x: 664, y: 0, width: 464, height: SHARE_CARD_HEIGHT },
  judgeY: 528,
  topY: 64,
  noteHeight: 12,
  judgeLineHeight: 12,
};

/** The excerpt of a chart, from its fingerprint document and lane mode: its window and rectangles. */
export function chartCardRects(document: ExcerptDocument, laneMode: string): ExcerptRect[] {
  const notes = documentBeatNotes(document).sort((a, b) => a.beat - b.beat);
  const window = densestWindow(notes, EXCERPT_BEATS);
  const measureStarts = measureStartBeats(document.measures.lengths, documentMeasureCount(document));
  return layoutExcerpt(notes, laneMode, window, CHART_CARD_FRAME, measureStarts);
}

/** The card as a PNG: `background` (at most BACKGROUND_COLORS colours) with `rects` drawn over it. */
export function renderChartCard(background: IndexedImage, rects: readonly ExcerptRect[]): Uint8Array<ArrayBuffer> {
  const colors = Object.keys(EXCERPT_COLORS) as ExcerptColor[];
  const backgroundColors = background.palette.length / 3;
  if (backgroundColors > BACKGROUND_COLORS) throw new Error('the background has too many colours');
  const palette = new Uint8Array((backgroundColors + colors.length) * 3);
  palette.set(background.palette);
  colors.forEach((color, i) => {
    const value = Number.parseInt(EXCERPT_COLORS[color].slice(1), 16);
    palette.set([(value >> 16) & 255, (value >> 8) & 255, value & 255], (backgroundColors + i) * 3);
  });
  const image: IndexedImage = { ...background, palette, pixels: background.pixels.slice() };
  for (const rect of rects) {
    fillRect(image, rect.x, rect.y, rect.width, rect.height, backgroundColors + colors.indexOf(rect.color));
  }
  return encodeIndexedPng(image);
}
