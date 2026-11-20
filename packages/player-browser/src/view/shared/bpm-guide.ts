import { findFirstIndexAtOrAfter } from '@be-music/shared-utils/core';
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

/**
 * The baseline of a label `height` tall that would sit at `y`, moved up above the label drawn before it on the same
 * lanes (`below`: its baseline and top) when the two would overlap. Labels are drawn nearest the judgement line first.
 */
export function stackBPMGuideLabel(
  y: number,
  height: number,
  below: { readonly y: number; readonly top: number } | undefined,
): number {
  if (below === undefined || y <= below.top || y - height >= below.y) return y;
  return below.top - 1;
}

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
  // The top of the last label drawn on each lane group: a label that would overlap it (two changes on one beat, or
  // close ones) stacks above it instead.
  const lastTops = new Map<string, { y: number; top: number }>();
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
      const height = text.height;
      const below = lastTops.get(key);
      const labelY = stackBPMGuideLabel(place.y, height, below);
      lastTops.set(key, { y: labelY, top: labelY - height });
      text.position.set(place.x, labelY);
    }
  }
}
