import { findFirstIndexAtOrAfter } from '@be-music/shared-utils/core';
import type { Text } from 'pixi.js';
import type { ChildPool } from '../../skins/pixi-kit/pools.ts';
import type { BeMusicGuideLabelStyle } from '@be-music/player-skin-sdk';
import {
  DEFAULT_BPM_GUIDE_KINDS,
  type BPMGuideEvent,
  type BPMGuideKind,
  type BPMGuideKinds,
} from '../../chart/bpm-guide.ts';
import {
  isDrawnAtTime,
  isPastDrawWindow,
  resolveDrawBottom,
  resolveDrawY,
  type NoteDrawWindow,
} from '../../chart/note-draw-window.ts';

/** beatoraja 0.8.9's guide colours, with Be-Music's for the `#SCROLL` and `#SPEED` labels. */
export const DEFAULT_BPM_GUIDE_COLORS: Readonly<Record<BPMGuideKind, number>> = {
  bpm: 0x00c000,
  stop: 0xc0c000,
  scroll: 0x00c0c0,
  speed: 0xc060ff,
};

/** The gap between a label and its lane's right edge, and between the label and its line. */
const LABEL_INSET = 4;
const LABEL_LIFT = 2;

/**
 * The label font size for a lane group `width` wide: the skin's size, else beatoraja's lane-relative size (a fourteenth
 * of the lanes, 10 to 20).
 */
export function resolveBPMGuideFontSize(width: number, style?: BeMusicGuideLabelStyle): number {
  return style?.fontSize ?? Math.max(10, Math.min(20, width / 14));
}

/**
 * Where a label sits and how much it shrinks: right-aligned at `inset` from the lane group's right edge, its baseline
 * just above the line at `y`, scaled down so a label wider than the lanes still fits inside them.
 */
export function placeBPMGuideLabel(
  lane: { readonly x: number; readonly w: number },
  y: number,
  textWidth: number,
): { x: number; y: number; scale: number } {
  const room = Math.max(1, lane.w - LABEL_INSET * 2);
  return {
    x: lane.x + lane.w - LABEL_INSET,
    y: y - LABEL_LIFT,
    scale: textWidth > room ? room / textWidth : 1,
  };
}

/** How far the leader's slant runs sideways for each pixel it rises. */
const LEADER_SLOPE = 0.45;
/** The shortest tick from the leader to a label, and the gap between a tick and its label. */
const LEADER_TICK = 6;
const LEADER_GAP = 3;
/** The space between two stacked labels. */
const ROW_GAP = 2;

/** One label of a callout: its drawn size. */
export interface BPMGuideCalloutLabel {
  readonly width: number;
  readonly height: number;
}

/**
 * Where the labels of changes that fall on one line sit (`lineY`, labels right-aligned at `rightX`). One label sits just
 * above its line. Two or more stack in a callout: right-aligned rows, the shortest at the top and the longest nearest
 * the line, and a leader that rises from the line in a slant up to the top row, with a tick across to each label.
 * `rows[i]` is the baseline of `labels[i]`.
 */
export function layoutBPMGuideCallout(
  lineY: number,
  rightX: number,
  labels: readonly BPMGuideCalloutLabel[],
): {
  rows: number[];
  leader?: {
    from: readonly [number, number];
    to: readonly [number, number];
    ticks: { x1: number; x2: number; y: number }[];
  };
} {
  if (labels.length <= 1) return { rows: labels.map(() => lineY - LABEL_LIFT) };
  // The longest label nearest the line; equal widths keep their order (the earlier change lower).
  const order = labels.map((_, index) => index).sort((a, b) => labels[b]!.width - labels[a]!.width || a - b);
  const rowHeight = Math.max(...labels.map((label) => label.height)) + ROW_GAP;
  // The bottom row clears the line by half a row, so the leader has a slant to run before its first tick.
  const bottom = lineY - LABEL_LIFT - Math.round(rowHeight / 2);
  const rows: number[] = Array.from<number>({ length: labels.length });
  const mids: number[] = Array.from<number>({ length: labels.length });
  order.forEach((index, rank) => {
    rows[index] = bottom - rank * rowHeight;
    mids[index] = Math.round(rows[index] - labels[index]!.height / 2) + 0.5;
  });
  const topMid = mids[order[order.length - 1]!]!;
  // The slant's x at the top row: far enough left that every tick is at least LEADER_TICK long.
  const topX = Math.min(
    ...order.map(
      (index) => rightX - labels[index]!.width - LEADER_GAP - LEADER_TICK + LEADER_SLOPE * (mids[index]! - topMid),
    ),
  );
  const slantX = (y: number): number => topX - LEADER_SLOPE * (y - topMid);
  return {
    rows,
    leader: {
      from: [slantX(lineY), lineY],
      to: [topX, topMid],
      ticks: order.map((index) => ({
        x1: slantX(mids[index]!),
        x2: rightX - labels[index]!.width - LEADER_GAP,
        y: mids[index]!,
      })),
    },
  };
}

/** The leader's colour, neutral whatever the labels' colours. */
const LEADER_COLOR = 0xd8d8d8;
const LEADER_ALPHA = 0.7;

/** Labels share the note walk's window and scroll distance, including STOPs and negative scroll. */
export function renderBPMGuide(input: {
  enabled: boolean;
  events: readonly BPMGuideEvent[];
  window: NoteDrawWindow;
  distance: (beat: number) => number;
  pixelsPerBeat: number;
  lanes: readonly { x: number; w: number; top: number; bottom: number; scrollScale?: number }[];
  pool: ChildPool;
  /** A source skin may already supply the colored marker lines: `false`, or the kinds whose lines to draw. */
  drawLines?: boolean | ReadonlySet<BPMGuideKind>;
  /** Which kinds of label to show; beatoraja's BPM and STOP by default. */
  kinds?: BPMGuideKinds;
  /** The skin's label look; beatoraja's monospace and colours without one. */
  style?: BeMusicGuideLabelStyle;
  alphaAt?: (eventSeconds: number) => number;
}): void {
  if (!input.enabled) return;
  const kinds = input.kinds ?? DEFAULT_BPM_GUIDE_KINDS;
  const style = input.style;
  const threshold =
    (input.window.rules === 'lr2' ? input.window.reachedBeat : input.window.currentBeat) -
    1 / Math.max(Number.EPSILON, input.pixelsPerBeat);
  const first = findFirstIndexAtOrAfter(input.events, threshold, (event) => event.beat);
  // Each lane group's labels, nearest the judgement line first, laid out once all are known.
  const pending = new Map<string, PendingLabel[]>();
  for (let index = first; index < input.events.length; index += 1) {
    const event = input.events[index]!;
    if (!kinds[event.kind]) continue;
    const alpha = input.alphaAt?.(event.seconds) ?? 1;
    if (alpha <= 0) continue;
    if (isPastDrawWindow(input.window, event.beat)) break;
    if (event.seconds < input.window.nowSeconds || !isDrawnAtTime(input.window, event.seconds)) continue;
    if (
      input.window.rules === 'lr2' &&
      event.beat < input.window.reachedBeat - 1 / Math.max(Number.EPSILON, input.pixelsPerBeat)
    )
      continue;
    const sides = new Set<string>();
    for (const lane of input.lanes) {
      const y = resolveDrawY(
        input.window,
        lane.bottom - input.distance(event.beat) * input.pixelsPerBeat * (lane.scrollScale ?? 1),
        lane.bottom,
      );
      if (y < lane.top || y > resolveDrawBottom(input.window, lane.bottom)) continue;
      // Lanes supplied here are merged per side: one marker and label across each player's lane group.
      const key = `${lane.x}:${lane.w}`;
      if (sides.has(key)) continue;
      sides.add(key);
      const color = style?.colors?.[event.kind] ?? DEFAULT_BPM_GUIDE_COLORS[event.kind];
      const drawLine =
        input.drawLines === undefined || input.drawLines === true
          ? true
          : input.drawLines !== false && input.drawLines.has(event.kind);
      if (drawLine) input.pool.acquireGraphics().rect(lane.x, Math.round(y), lane.w, 1).fill({ color, alpha });
      const text = input.pool.acquireText(event.text);
      text.label = `bpm-guide:${event.kind}:${event.beat}`;
      text.text = event.text;
      text.alpha = alpha;
      text.style.fontFamily = style?.fontFamily ?? 'monospace';
      text.style.fontWeight = style?.fontWeight ?? 'normal';
      text.style.fontSize = resolveBPMGuideFontSize(lane.w, style);
      text.style.fill = color;
      text.anchor.set(1, 1);
      text.scale.set(1);
      const place = placeBPMGuideLabel(lane, Math.round(y), text.width);
      text.scale.set(place.scale);
      let group = pending.get(key);
      if (group === undefined) pending.set(key, (group = []));
      group.push({ text, lineY: Math.round(y), rightX: place.x, alpha });
    }
  }
  for (const labels of pending.values()) placeLabels(input.pool, labels);
}

interface PendingLabel {
  readonly text: Text;
  readonly lineY: number;
  readonly rightX: number;
  readonly alpha: number;
}

/**
 * Places a lane group's labels: those whose lines fall within a label's height of each other share a callout
 * ({@link layoutBPMGuideCallout}), anchored on the line nearest the judgement line; a label alone sits above its line.
 */
function placeLabels(pool: ChildPool, labels: readonly PendingLabel[]): void {
  let start = 0;
  while (start < labels.length) {
    const anchor = labels[start]!;
    let end = start + 1;
    while (end < labels.length && Math.abs(labels[end]!.lineY - anchor.lineY) < anchor.text.height + ROW_GAP) end += 1;
    const group = labels.slice(start, end);
    const layout = layoutBPMGuideCallout(
      anchor.lineY,
      anchor.rightX,
      group.map((label) => ({ width: label.text.width, height: label.text.height })),
    );
    group.forEach((label, index) => label.text.position.set(anchor.rightX, layout.rows[index]!));
    if (layout.leader !== undefined) {
      const alpha = LEADER_ALPHA * Math.max(...group.map((label) => label.alpha));
      const leader = pool.acquireGraphics();
      leader.moveTo(...layout.leader.from).lineTo(...layout.leader.to);
      for (const tick of layout.leader.ticks) leader.moveTo(tick.x1, tick.y).lineTo(tick.x2, tick.y);
      leader.stroke({ color: LEADER_COLOR, width: 1, alpha });
    }
    start = end;
  }
}
