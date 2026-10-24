import { findFirstIndexAtOrAfter } from '@be-music/shared-utils/core';
import type { ChildPool } from '../../skins/pixi-kit/pools.ts';
import type { BPMGuideEvent } from '../../chart/bpm-guide.ts';
import {
  isDrawnAtTime,
  isPastDrawWindow,
  resolveDrawBottom,
  resolveDrawY,
  type NoteDrawWindow,
} from '../../chart/note-draw-window.ts';

/** Labels share the note walk's window and scroll distance, including STOPs and negative scroll. */
export function renderBPMGuide(input: {
  enabled: boolean;
  events: readonly BPMGuideEvent[];
  window: NoteDrawWindow;
  distance: (beat: number) => number;
  pixelsPerBeat: number;
  lanes: readonly { x: number; w: number; top: number; bottom: number }[];
  pool: ChildPool;
  /** A source skin may already supply the colored marker lines. */
  drawLines?: boolean;
}): void {
  if (!input.enabled) return;
  const colors = { bpm: 0x00c000, stop: 0xc0c000 };
  const threshold =
    (input.window.rules === 'lr2' ? input.window.reachedBeat : input.window.currentBeat) -
    1 / Math.max(Number.EPSILON, input.pixelsPerBeat);
  const first = findFirstIndexAtOrAfter(input.events, threshold, (event) => event.beat);
  for (let index = first; index < input.events.length; index += 1) {
    const event = input.events[index]!;
    if (isPastDrawWindow(input.window, event.beat)) break;
    if (event.seconds < input.window.nowSeconds || !isDrawnAtTime(input.window, event.seconds)) continue;
    if (
      input.window.rules === 'lr2' &&
      event.beat < input.window.reachedBeat - 1 / Math.max(Number.EPSILON, input.pixelsPerBeat)
    )
      continue;
    const sides = new Set<string>();
    for (const lane of input.lanes) {
      const y = resolveDrawY(input.window, lane.bottom - input.distance(event.beat) * input.pixelsPerBeat, lane.bottom);
      if (y < lane.top || y > resolveDrawBottom(input.window, lane.bottom)) continue;
      // Lanes supplied here are merged per side: one marker and label across each player's lane group.
      const key = `${lane.x}:${lane.w}`;
      if (sides.has(key)) continue;
      sides.add(key);
      if (input.drawLines !== false)
        input.pool.acquireGraphics().rect(lane.x, Math.round(y), lane.w, 1).fill(colors[event.kind]);
      const text = input.pool.acquireText();
      text.label = `bpm-guide:${event.kind}:${event.beat}`;
      text.text = event.text;
      text.style.fontFamily = 'monospace';
      text.style.fontSize = Math.max(10, Math.min(20, lane.w / 14));
      text.style.fill = colors[event.kind];
      text.position.set(lane.x + lane.w / 2, y - 20);
    }
  }
}
