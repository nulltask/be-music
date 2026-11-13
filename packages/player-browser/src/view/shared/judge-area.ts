/**
 * beatoraja's judge area display (`PlayerConfig.showjudgearea`, `LaneRenderer.JudgeAreaOverlay`): above the judge line
 * of each lane, one translucent band per judgment, each as tall as its window is long at the current scroll. A note is
 * inside a band while a press would still give it that judgment.
 */
import type { BeMusicJudgeWindowSet } from '@be-music/player-skin-sdk';

/** One band: the judgment's window from `fromMs` to `toMs` ahead of the judge line, in beatoraja's colour. */
export interface JudgeAreaBand {
  readonly fromMs: number;
  readonly toMs: number;
  readonly color: number;
}

/** beatoraja's five colours (PGREAT, GREAT, GOOD, BAD, the miss window) and their alpha, `0x20` of `0xff`. */
const JUDGE_AREA_COLORS = [0x0000ff, 0x00ff00, 0xffff00, 0xff8000, 0xff0000] as const;
export const JUDGE_AREA_ALPHA: number = 0x20 / 0xff;

/**
 * The bands of one window set, innermost first. Each starts where the judgment inside it ends; a window no wider than
 * the one inside it has no band. The reach is the early side: how far above the line a note can still be pressed.
 */
export function resolveJudgeAreaBands(windows: BeMusicJudgeWindowSet | undefined): JudgeAreaBand[] {
  if (windows === undefined) return [];
  const reaches = [windows.perfect, windows.great, windows.good, windows.bad, windows.emptyPoor];
  const bands: JudgeAreaBand[] = [];
  let fromMs = 0;
  for (const [index, window] of reaches.entries()) {
    const toMs = window?.earlyMs;
    if (toMs === undefined || !Number.isFinite(toMs) || toMs <= fromMs) continue;
    bands.push({ fromMs, toMs, color: JUDGE_AREA_COLORS[index]! });
    fromMs = toMs;
  }
  return bands;
}

/** A lane the bands are drawn on: its rect up to the lane's top, and which window set judges it. */
export interface JudgeAreaLane {
  readonly x: number;
  readonly w: number;
  readonly top: number;
  /** The judge line. */
  readonly bottom: number;
  readonly scratch: boolean;
}

/** What the bands are drawn with: a pool whose graphics are cleared between frames. */
interface JudgeAreaPool {
  acquireGraphics(): {
    rect(x: number, y: number, w: number, h: number): { fill(style: { color: number; alpha: number }): unknown };
  };
}

/**
 * Draws the bands of every lane. `distanceAt(ms, lane)` is how far above the judge line a note `ms` ahead of it is
 * drawn now, in the lanes' pixels.
 */
export function renderJudgeArea(input: {
  readonly lanes: readonly JudgeAreaLane[];
  readonly note: BeMusicJudgeWindowSet | undefined;
  readonly scratch: BeMusicJudgeWindowSet | undefined;
  readonly distanceAt: (ms: number, lane: JudgeAreaLane) => number;
  readonly pool: JudgeAreaPool;
}): void {
  const noteBands = resolveJudgeAreaBands(input.note);
  const scratchBands = resolveJudgeAreaBands(input.scratch);
  for (const lane of input.lanes) {
    for (const band of lane.scratch ? scratchBands : noteBands) {
      // A band never leaves its lane, however fast the scroll.
      const bottom = Math.max(lane.top, lane.bottom - Math.max(0, input.distanceAt(band.fromMs, lane)));
      const top = Math.max(lane.top, lane.bottom - Math.max(0, input.distanceAt(band.toMs, lane)));
      if (bottom - top <= 0) continue;
      input.pool
        .acquireGraphics()
        .rect(lane.x, top, lane.w, bottom - top)
        .fill({ color: band.color, alpha: JUDGE_AREA_ALPHA });
    }
  }
}
