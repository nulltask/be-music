import type { BeMusicRect } from '@be-music/player-skin-sdk';

/** Where each panel of the Synesthesia result sits, in design px. */
export interface ResultGrid {
  margin: number;
  /** The DJ LEVEL panel. */
  rank: BeMusicRect;
  /** SCORE, EX SCORE, MAX COMBO, GAUGE, PLAY TIME, NOTES. */
  metrics: readonly [BeMusicRect, BeMusicRect, BeMusicRect, BeMusicRect, BeMusicRect, BeMusicRect];
  /** The judgement rows' panel, the first row's top and the row pitch, and the count bars' left offset and width. */
  judges: BeMusicRect;
  rowsTop: number;
  rowPitch: number;
  barOffset: number;
  barWidth: number;
  /** The graphs' panel, and the top and bottom lines the two filaments share. */
  graphs: BeMusicRect;
  graphsTop: number;
  graphsBottom: number;
  /** The track card; its fact rows run in `trackColumns` columns. */
  track: BeMusicRect;
  trackColumns: number;
  /** The total-score line along the foot. */
  totalY: number;
}

const MARGIN = 16;

/**
 * The result grid for a `width` x `height` stage. Landscape (the 16:9 stage): a 16 px page margin and 12 px gutters —
 * top row the DJ LEVEL panel and two columns of metric panels, bottom row the judgement rows and the two graphs (which
 * share one top and bottom line), and the track card down the right. Portrait (9:16): the same panels stacked — the DJ
 * LEVEL beside three metrics, the other three in a row under them, then the judgement rows, the graphs, and the track
 * card, each full width.
 */
export function resolveResultGrid(width: number, height: number): ResultGrid {
  if (height <= width) {
    const top = 64;
    const metricX = [204, 420] as const;
    const metricY = [top, top + 54, top + 108] as const;
    const metric = (column: 0 | 1, row: 0 | 1 | 2): BeMusicRect => ({
      x: metricX[column],
      y: metricY[row],
      w: 204,
      h: 44,
    });
    const bottomTop = 232;
    const bottomH = 200;
    const gridRight = metricX[1] + 204;
    const rowsTop = bottomTop + 34;
    const graphsX = MARGIN + 292 + 12;
    const trackX = gridRight + 12;
    return {
      margin: MARGIN,
      rank: { x: MARGIN, y: top, w: 176, h: 152 },
      metrics: [metric(0, 0), metric(0, 1), metric(0, 2), metric(1, 0), metric(1, 1), metric(1, 2)],
      judges: { x: MARGIN, y: bottomTop, w: 292, h: bottomH },
      rowsTop,
      rowPitch: 32,
      barOffset: 98,
      barWidth: 140,
      graphs: { x: graphsX, y: bottomTop, w: gridRight - graphsX, h: bottomH },
      graphsTop: rowsTop,
      graphsBottom: rowsTop + 4 * 32 + 12,
      track: { x: trackX, y: top, w: width - MARGIN - trackX, h: bottomTop + bottomH - top },
      trackColumns: 1,
      totalY: height - 44,
    };
  }
  const inner = width - 2 * MARGIN;
  const gutter = 12;
  const top = 56;
  const rank = { x: MARGIN, y: top, w: 168, h: 150 };
  const metricX = rank.x + rank.w + gutter;
  const metricW = width - MARGIN - metricX;
  const stacked = (row: number): BeMusicRect => ({ x: metricX, y: top + row * 53, w: metricW, h: 44 });
  const rowY = rank.y + rank.h + 10;
  const thirdW = (inner - 2 * 8) / 3;
  const third = (column: number): BeMusicRect => ({ x: MARGIN + column * (thirdW + 8), y: rowY, w: thirdW, h: 48 });
  const judges = { x: MARGIN, y: rowY + 48 + gutter, w: inner, h: 162 };
  const graphs = { x: MARGIN, y: judges.y + judges.h + gutter, w: inner, h: 132 };
  const totalY = height - 44;
  const trackY = graphs.y + graphs.h + gutter;
  return {
    margin: MARGIN,
    rank,
    metrics: [stacked(0), stacked(1), stacked(2), third(0), third(1), third(2)],
    judges,
    rowsTop: judges.y + 32,
    rowPitch: 26,
    barOffset: 98,
    barWidth: inner - 98 - 70,
    graphs,
    graphsTop: graphs.y + 30,
    graphsBottom: graphs.y + graphs.h - 12,
    track: { x: MARGIN, y: trackY, w: inner, h: totalY - 10 - trackY },
    trackColumns: 2,
    totalY,
  };
}
