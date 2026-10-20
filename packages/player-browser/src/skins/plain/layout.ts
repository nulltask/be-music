import type { BeMusicGameplayLayout, BeMusicRect, BeMusicSelectLayout } from '@be-music/player-skin-sdk';

/**
 * Where Plain puts things on a portrait stage (`tallStage`, 480x854, or any stage taller than wide). Each screen's
 * landscape layout is written inline in its own file; the portrait one is worked out here, from the stage size (and,
 * for gameplay, from the host's `layout`), as plain functions that are easy to test. A skin of your own can follow the
 * same split: draw code asks "where?", these functions answer.
 *
 * Text on the portrait stage is never set below {@link PORTRAIT_MIN_TEXT} design px: a phone shows the 480 px wide
 * stage at about 0.8 CSS px per design px.
 */
export const PORTRAIT_MIN_TEXT = 10;

/** Page margin of the portrait select and result screens. */
const MARGIN = 16;

// ---------------------------------------------------------------------------------------------------------------------
// Select

/**
 * The portrait song list: full width under the focused-song card, with two-line rows tall enough to tap. The host
 * hit-tests the rows with these numbers, so {@link drawSelect} draws them at exactly this pitch.
 */
export const PORTRAIT_SELECT_LAYOUT: BeMusicSelectLayout = {
  listX: MARGIN,
  listTop: 304,
  listBottomInset: 30,
  rowHeight: 40,
};

/** The focused-song card on the portrait select screen and what sits in it. */
export interface PortraitSelectCard {
  card: BeMusicRect;
  /** Left edges of the three fact columns, and the width a value may take in one. */
  factColumns: readonly [number, number, number];
  factWidth: number;
  /** Tops of the two fact rows (the label line; the value sits 16 px under it). */
  factRows: readonly [number, number];
  play: BeMusicRect;
  auto: BeMusicRect;
}

/**
 * The focused-song card for a portrait select screen `width` wide: across the top, from under the header down to the
 * list ({@link PORTRAIT_SELECT_LAYOUT}`.listTop`). Genre, title and artist on top, then two rows of three facts, then
 * PLAY and AUTO side by side along its foot.
 */
export function resolvePortraitSelectCard(width: number): PortraitSelectCard {
  const top = 44;
  const card = { x: MARGIN, y: top, w: width - 2 * MARGIN, h: PORTRAIT_SELECT_LAYOUT.listTop - 12 - top };
  const inner = card.w - 32;
  const left = card.x + 16;
  const column = inner / 3;
  const buttonH = 44;
  const buttonY = card.y + card.h - 16 - buttonH;
  const gap = 10;
  const playW = Math.round((inner - gap) * 0.64);
  return {
    card,
    factColumns: [left, left + column, left + 2 * column],
    factWidth: column - 12,
    factRows: [card.y + 96, card.y + 140],
    play: { x: left, y: buttonY, w: playW, h: buttonH },
    auto: { x: left + playW + gap, y: buttonY, w: inner - playW - gap, h: buttonH },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Gameplay

/** Side margin of the portrait play screen, matching the touch lanes' and `tallStage`'s BGA margin. */
const PLAY_MARGIN = 12;
/**
 * Room the header leaves in its top corners for a host's controls over the stage (a pause button on the left while
 * playing by touch, a menu tab on the right).
 */
const CORNER = 52;
/** Height of the header band. */
const HEADER_H = 40;
/** Height of the gauge band above the lanes: its label line and the bar. */
const GAUGE_BAND_H = 36;

/** Where the portrait play screen's HUD goes. Every rect sits above `layout.playfield.top`, clear of the lanes. */
export interface PortraitGameplayHUD {
  /** The header band, and the x range its text keeps to (the top corners stay free). */
  header: { height: number; left: number; right: number };
  /** The column beside the BGA: the track (genre, title, artist) on top. */
  track: BeMusicRect;
  /** SCORE, EX SCORE, COMBO, RANK as a 2x2 grid. */
  scores: readonly [BeMusicRect, BeMusicRect, BeMusicRect, BeMusicRect];
  /** PG, GR, GD, BD, PR in one row along the column's foot. */
  counts: readonly [BeMusicRect, BeMusicRect, BeMusicRect, BeMusicRect, BeMusicRect];
  /** The gauge bar across the stage, just above the lanes (its label line goes above it). */
  gauge: BeMusicRect;
  /** Middle of the judgement word over the lanes. */
  judgeY: number;
}

/**
 * The portrait HUD for a gameplay `layout` on a portrait stage. The host puts the lanes in the stage's lower part and
 * the BGA at the top left (`tallStage`); Plain fills what is left: a header band over everything, a column right of
 * the BGA (the track over the score figures over the judgement counts), and the gauge across the band between the BGA
 * and the lanes. Without a BGA the column takes the full width in the same band. All of it is placed from
 * `layout.stage`, `layout.bga` and `layout.playfield.top`, so a portrait stage of another size works too.
 */
export function resolvePortraitGameplayHUD(
  layout: Pick<BeMusicGameplayLayout, 'stage' | 'bga' | 'playfield'>,
): PortraitGameplayHUD {
  const { stage, bga, playfield } = layout;
  const gauge = {
    x: PLAY_MARGIN,
    y: playfield.top - 18,
    w: stage.width - 2 * PLAY_MARGIN,
    h: 8,
  };
  const top = bga && bga.w > 0 ? bga.y : HEADER_H + 6;
  const bottom = bga && bga.w > 0 ? bga.y + bga.h : playfield.top - GAUGE_BAND_H;
  const x = bga && bga.w > 0 ? bga.x + bga.w + PLAY_MARGIN : PLAY_MARGIN;
  const w = stage.width - PLAY_MARGIN - x;
  // Stat rects are as tall as a label over its value (10 px label line, 16 px figure 16 px under it).
  const statH = 26;
  const half = Math.floor(w / 2);
  const scoreTop = top + 70;
  const scores = [
    { x, y: scoreTop, w: half, h: statH },
    { x: x + half, y: scoreTop, w: half, h: statH },
    { x, y: scoreTop + 46, w: half, h: statH },
    { x: x + half, y: scoreTop + 46, w: half, h: statH },
  ] as const;
  const fifth = Math.floor(w / 5);
  const countY = bottom - 30;
  const count = (index: number): BeMusicRect => ({ x: x + index * fifth, y: countY, w: fifth, h: 24 });
  return {
    header: { height: HEADER_H, left: CORNER, right: stage.width - CORNER },
    track: { x, y: top, w, h: 56 },
    scores,
    counts: [count(0), count(1), count(2), count(3), count(4)],
    gauge,
    // Two fifths of the way down the lanes: under the falling notes' entry, well above the judgement line.
    judgeY: Math.round(playfield.top + (playfield.judgementY - playfield.top) * 0.4),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Result

/** The portrait result screen's sections, top to bottom. */
export interface PortraitResult {
  /** Middle of the verdict line (STAGE CLEAR / FAILED). */
  verdictY: number;
  /** The DJ LEVEL panel, and the six score figures in two columns of three beside it. */
  rank: BeMusicRect;
  figures: readonly BeMusicRect[];
  /** The judgement counts' panel and the middle of its first row; rows are `rowPitch` apart. */
  judges: BeMusicRect;
  judgeRowsY: number;
  rowPitch: number;
  /** The chart's panel: genre, title, artist, then its facts from `trackRowsY`, `rowPitch` apart, and the clear lamp. */
  track: BeMusicRect;
  trackRowsY: number;
  /** Middle of the clear lamp, at the chart panel's foot. */
  lampY: number;
  /** Middle of the total-score line along the foot. */
  totalY: number;
}

/**
 * The result screen on a `width` x `height` portrait stage, as stacked full-width sections: the verdict, the DJ LEVEL
 * beside the score figures, the judgement counts, the chart's panel, and the total along the stage's foot. A stage
 * taller than `tallStage` leaves more room above the total line; one shorter squeezes the chart panel first.
 */
export function resolvePortraitResult(width: number, height: number): PortraitResult {
  const inner = width - 2 * MARGIN;
  const gutter = 16;
  const rank = { x: MARGIN, y: 56, w: 150, h: 180 };
  const figuresX = rank.x + rank.w + gutter;
  const figureW = (width - MARGIN - figuresX) / 2;
  const figures = Array.from({ length: 6 }, (_, index) => ({
    x: figuresX + (index % 2) * figureW,
    y: rank.y + 12 + Math.floor(index / 2) * 58,
    w: figureW,
    h: 26,
  }));
  const rowPitch = 30;
  const judges = { x: MARGIN, y: rank.y + rank.h + gutter, w: inner, h: 5 * rowPitch + 16 };
  const totalY = height - 32;
  const trackY = judges.y + judges.h + gutter;
  // Title block (about 70 px), four fact rows, and the lamp under them — but never down into the total line.
  const trackH = Math.min(84 + 4 * rowPitch + 44, totalY - 24 - trackY);
  return {
    verdictY: 28,
    rank,
    figures,
    judges,
    judgeRowsY: judges.y + 8 + rowPitch / 2,
    rowPitch,
    track: { x: MARGIN, y: trackY, w: inner, h: trackH },
    trackRowsY: trackY + 84,
    lampY: trackY + trackH - 26,
    totalY,
  };
}
