import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vite-plus/test';
import { makeChart } from '../../test/support.ts';
import { safeAreaViolation, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from '../pages/share-card-safe-area.ts';
import { chartCardBackground } from './background.ts';
import { CHART_CARD_FRAME, chartCardRects, EXCERPT_BEATS, renderChartCard } from './card.ts';
import type { ExcerptDocument } from './excerpt.ts';
import { BACKGROUND_COLORS, EXCERPT_COLORS } from './palette.ts';

describe('chart card', () => {
  test("draws the chart document's densest two measures, every note inside the safe area", () => {
    // Measure 1 is sparse; measures 3 and 4 hold eighths on the keys and a scratch note.
    const chart = makeChart([
      '#00111:01',
      '#00311:0101010101010101',
      '#00313:0001000100010001',
      '#00316:01000000',
      '#00412:0101010101010101',
    ]);
    const rects = chartCardRects(chart.chartDocument as ExcerptDocument, '7');
    const heads = rects.filter((rect) => rect.color.startsWith('note-'));
    expect(heads).toHaveLength(8 + 4 + 1 + 8);
    expect(heads.filter((rect) => rect.color === 'note-red')).toHaveLength(1);
    for (const head of heads) expect(safeAreaViolation(head)).toBeNull();
    // The window starts on the judge line: measure 3 begins at beat 12.
    const bottom = Math.max(...heads.map((rect) => rect.y + rect.height));
    expect(bottom).toBe(CHART_CARD_FRAME.judgeY);
    expect(EXCERPT_BEATS).toBe(8);
  });

  test('renders a 1200 x 630 palette PNG: the background, then the excerpt in its own colours', async () => {
    const background = await chartCardBackground();
    expect([background.width, background.height]).toEqual([SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT]);
    expect(background.palette.length / 3).toBeLessThanOrEqual(BACKGROUND_COLORS);
    const png = renderChartCard(background, [{ x: 700, y: 100, width: 40, height: 12, color: 'note-blue' }]);
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT]);
    // Find the image data and check the note's pixel and a background pixel.
    let at = 8;
    let idat = new Uint8Array(0);
    let palette = new Uint8Array(0);
    while (at < png.length) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
      if (type === 'IDAT') idat = png.subarray(at + 8, at + 8 + length);
      if (type === 'PLTE') palette = png.subarray(at + 8, at + 8 + length);
      at += 12 + length;
    }
    const raw = inflateSync(idat);
    const pixel = (x: number, y: number) => raw[y * (SHARE_CARD_WIDTH + 1) + 1 + x] ?? -1;
    const rgb = (index: number) =>
      `#${[...palette.subarray(index * 3, index * 3 + 3)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    expect(rgb(pixel(710, 105))).toBe(EXCERPT_COLORS['note-blue']);
    expect(pixel(10, 10)).toBe(background.pixels[10 * SHARE_CARD_WIDTH + 10]);
    // The background itself is left as it was.
    expect(background.pixels[105 * SHARE_CARD_WIDTH + 710]).toBeLessThan(BACKGROUND_COLORS);
  });
});
