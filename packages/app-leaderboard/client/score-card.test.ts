import { describe, expect, test } from 'vite-plus/test';
import {
  COUNT_LABELS,
  countColumns,
  djRankGradient,
  ellipsize,
  EXCERPT_FRAME,
  excerptLaneBoxes,
  excerptRects,
  fitFontSize,
  opticalInset,
  PLAYER_TEXT_MAX_WIDTH,
  PLAYER_TEXT_RIGHT,
  readableTextColor,
  SCORE_CARD_BOXES,
} from './score-card.ts';
import {
  EXCERPT_BEATS,
  SYNESTHESIA_PLAYFIELD,
  type ChartExcerpt,
  type ExcerptLane,
} from '../src/pages/chart-excerpt.ts';

const tone = (i: number): ExcerptLane['tone'] => (i === 0 ? 'red' : i % 2 === 0 ? 'blue' : 'white');
/** 7 KEY: the scratch on the left, then keys 1..7. */
const lanes7: Pick<ChartExcerpt, 'lanes' | 'widths'> = {
  widths: '____',
  lanes: Array.from({ length: 8 }, (_, i) => ({ tone: tone(i), side: '1P' })),
};
const excerpt7: ChartExcerpt = { ...lanes7, beats: EXCERPT_BEATS, notes: [], bars: [] };
/** 14 KEY: 1P scratch and keys, then 2P keys and its scratch on the right. */
const lanes14: ChartExcerpt = {
  ...excerpt7,
  lanes: [...lanes7.lanes, ...Array.from({ length: 8 }, (_, i): ExcerptLane => ({ tone: tone(7 - i), side: '2P' }))],
};
import { safeAreaViolation, X_DOMAIN_LABEL_ZONE } from '../src/pages/share-card-safe-area.ts';

// A stand-in for canvas measurement: every character is 0.6 em wide.
const measure = (text: string, size = 10) => [...text].length * size * 0.6;

describe('score card layout', () => {
  test('fitFontSize shrinks a long title until it fits, but not below the minimum', () => {
    expect(fitFontSize(measure, 'short', 700, 64, 40)).toBe(64);
    expect(fitFontSize(measure, 'x'.repeat(22), 700, 64, 40)).toBe(52);
    expect(fitFontSize(measure, 'x'.repeat(200), 700, 64, 40)).toBe(40);
  });

  test('ellipsize cuts whole characters, emoji included', () => {
    expect(ellipsize((text) => measure(text), 'fits', 100)).toBe('fits');
    // 36 / 6 = six characters, the ellipsis included.
    expect(ellipsize((text) => measure(text), 'あいうえおかきくけこ', 36)).toBe('あいうえお…');
    expect(ellipsize((text) => measure(text), '🎹🎹🎹🎹🎹', 24)).toBe('🎹🎹🎹…');
  });

  test('readableTextColor picks dark text on light lamps and white on dark ones', () => {
    expect(readableTextColor('#ffffff')).toBe('#0a0e18');
    expect(readableTextColor('#f5c518')).toBe('#0a0e18');
    expect(readableTextColor('#7a1f2b')).toBe('#ffffff');
    expect(readableTextColor('#3b82f6')).toBe('#ffffff');
  });

  test('countColumns spaces the counts evenly and sets BP and the combo apart', () => {
    const columns = countColumns(72, 720, 24);
    expect(columns).toHaveLength(COUNT_LABELS.length);
    // (720 - 24) / 7 = 99.43 px a column, rounded to whole pixels; BP and the combo start 24 px later.
    expect(columns).toEqual([72, 171, 271, 370, 470, 593, 693]);
  });

  test("opticalInset pulls a line left by half the first glyph's average inset, within a limit", () => {
    // A straight stem (l, I) needs nothing.
    expect(opticalInset([10, 10, 10, 10], 50)).toBe(0);
    // A T: the crossbar row at 10, the stem 6 px in on the other three rows; the average inset is 4.5.
    expect(opticalInset([10, 16, 16, 16], 50)).toBe(2.25);
    // An A leans in a long way; 0.06 em caps it.
    expect(opticalInset([0, 10, 20, 30, 40], 50)).toBe(3);
    expect(opticalInset([], 50)).toBe(0);
  });

  test('AAA is gold, lower ranks fade', () => {
    expect(djRankGradient('AAA')[1]).toBe('#f5b301');
    expect(djRankGradient('F')).toEqual(djRankGradient('B'));
  });

  test.each(Object.entries(SCORE_CARD_BOXES))('the %s stays inside the safe area', (_, box) => {
    expect(safeAreaViolation(box)).toBeNull();
  });

  test("the player's lines end at the avatar and stay right of X's domain label", () => {
    expect(PLAYER_TEXT_RIGHT).toBeLessThan(SCORE_CARD_BOXES.avatar.x);
    expect(PLAYER_TEXT_RIGHT - PLAYER_TEXT_MAX_WIDTH).toBeGreaterThan(
      X_DOMAIN_LABEL_ZONE.x + X_DOMAIN_LABEL_ZONE.width,
    );
    // Still room for a name of some 25 characters at 26 px.
    expect(PLAYER_TEXT_MAX_WIDTH).toBeGreaterThanOrEqual(400);
  });

  test("the site's name keeps clear of the chart's column", () => {
    expect(SCORE_CARD_BOXES.siteName.x).toBeGreaterThan(SCORE_CARD_BOXES.chart.x + SCORE_CARD_BOXES.chart.width);
  });

  test("excerptLaneBoxes keeps Synesthesia's lane widths: scratch 41, white 24, blue 19, a 60 px gap between DP banks", () => {
    const seven = excerptLaneBoxes(excerpt7);
    // A 7 KEY side (194 design px) fills the panel; every lane keeps its share of it.
    const span = EXCERPT_FRAME.right - EXCERPT_FRAME.left;
    expect(seven[0]?.x).toBe(EXCERPT_FRAME.left);
    expect((seven.at(-1)?.x ?? 0) + (seven.at(-1)?.width ?? 0)).toBe(EXCERPT_FRAME.right);
    const designOf = (width: number) => (width * SYNESTHESIA_PLAYFIELD.sideWidth) / span;
    expect(seven.map((lane) => Math.round(designOf(lane.width)))).toEqual([41, 24, 19, 24, 19, 24, 19, 24]);
    // Lanes sit edge to edge.
    seven.slice(1).forEach((lane, i) => expect(lane.x).toBe((seven[i]?.x ?? 0) + (seven[i]?.width ?? 0)));

    // 14 KEY: the 2P scratch on the right, the banks 60 design px apart, the whole field (448 px) fitted to the panel.
    const fourteen = excerptLaneBoxes(lanes14);
    const scale = span / (2 * 194 + 60);
    // Whole-pixel edges: each width within a pixel of its scaled design width.
    [41, 24, 19, 24, 19, 24, 19, 24, 24, 19, 24, 19, 24, 19, 24, 41].forEach((design, i) =>
      expect(Math.abs((fourteen[i]?.width ?? 0) - design * scale)).toBeLessThanOrEqual(1),
    );
    const gap = (fourteen[8]?.x ?? 0) - ((fourteen[7]?.x ?? 0) + (fourteen[7]?.width ?? 0));
    expect(Math.abs(gap - 60 * scale)).toBeLessThanOrEqual(1);
    expect(fourteen[0]?.x).toBe(EXCERPT_FRAME.left);
    expect((fourteen.at(-1)?.x ?? 0) + (fourteen.at(-1)?.width ?? 0)).toBe(EXCERPT_FRAME.right);

    // 5 KEY keeps the 7 KEY scale (the lanes do not stretch) and is centred; 9 KEY shares one side evenly.
    const five = excerptLaneBoxes({ ...excerpt7, lanes: lanes7.lanes.slice(0, 6) });
    expect(five.map((lane) => Math.round(designOf(lane.width)))).toEqual([41, 24, 19, 24, 19, 24]);
    expect(five[0]?.x).toBeGreaterThan(EXCERPT_FRAME.left);
    const nine = excerptLaneBoxes({
      ...excerpt7,
      widths: 'shared',
      lanes: Array.from({ length: 9 }, () => ({ tone: 'white' as const, side: '1P' as const })),
    });
    for (const lane of nine) expect(Math.abs(lane.width - span / 9)).toBeLessThanOrEqual(1);
    expect((nine.at(-1)?.x ?? 0) + (nine.at(-1)?.width ?? 0) - (nine[0]?.x ?? 0)).toBe(span);
  });

  test('excerptRects lays the lanes across the panel and the notes on their beats, the window start on the judge line', () => {
    const rects = excerptRects({
      ...lanes7,
      beats: 8,
      notes: [
        { lane: 0, beat: 0 },
        { lane: 2, beat: 4 },
        { lane: 3, beat: 2, end: 3 },
      ],
      bars: [0, 4, 8],
    });
    const lanes = rects.filter((rect) => rect.kind.startsWith('lane-'));
    expect(lanes).toHaveLength(8);
    expect(lanes[2]?.kind).toBe('lane-dark');
    const heads = rects.filter((rect) => rect.kind.startsWith('note-'));
    expect(heads.map((rect) => rect.kind)).toEqual(['note-red', 'note-blue', 'note-white', 'note-white']);
    // The scratch note at beat 0 sits on the judge line; the blue one at beat 4 halfway up the window.
    const scratch = heads.find((rect) => rect.kind === 'note-red');
    expect((scratch?.y ?? 0) + (scratch?.height ?? 0)).toBe(EXCERPT_FRAME.judgeY);
    const blue = heads.find((rect) => rect.kind === 'note-blue');
    expect((blue?.y ?? 0) + (blue?.height ?? 0)).toBe(Math.round((EXCERPT_FRAME.judgeY + EXCERPT_FRAME.topY) / 2));
    expect(rects.filter((rect) => rect.kind === 'bar').map((rect) => rect.y + 1)).toEqual([
      EXCERPT_FRAME.judgeY,
      Math.round((EXCERPT_FRAME.judgeY + EXCERPT_FRAME.topY) / 2),
      EXCERPT_FRAME.topY,
    ]);
  });

  test.each([6, 8, 9, 12, 16])('with %i lanes, every note stays in the safe area and below the site name', (count) => {
    const lanes = Array.from({ length: count }, (_, i): ExcerptLane => ({
      tone: i === 0 || i === count - 1 ? 'red' : i % 2 === 0 ? 'blue' : 'white',
      side: count >= 12 && i >= count / 2 ? '2P' : '1P',
    }));
    const rects = excerptRects({
      lanes,
      widths: count === 9 ? 'shared' : '____',
      beats: EXCERPT_BEATS,
      // A note on every lane at the window's start and its end, and a long note running far past it.
      notes: lanes.flatMap((_, lane) => [
        { lane, beat: 0 },
        { lane, beat: EXCERPT_BEATS - 0.01 },
        { lane, beat: 1, end: 40 },
      ]),
      bars: [0],
    });
    for (const rect of rects.filter((r) => !r.kind.startsWith('lane-'))) {
      expect(safeAreaViolation(rect)).toBeNull();
      expect(rect.y).toBeGreaterThanOrEqual(SCORE_CARD_BOXES.siteName.y + SCORE_CARD_BOXES.siteName.height);
      expect(rect.width).toBeGreaterThan(0);
    }
  });
});
