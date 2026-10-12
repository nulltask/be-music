// Where the beatoraja play skin puts notes and bar lines on the lane when the chart has `#SCROLL` / `#SPEED` (bmson
// `scroll_events` included): the same distance integrator and `LaneRenderer` draw window the core gameplay view uses
// (`../core/note-draw-window.ts`), so SCROLL gimmicks show up in beatoraja skins as they do in beatoraja.

import { createBeatResolver, createScrollTimeline, createSpeedTimeline } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import { createScrollDistanceMapper, type ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import { resolveNoteDrawWindow, type NoteDrawWindow } from '../core/note-draw-window.ts';

/** The chart's `#SCROLL` / `#SPEED` distance integrator, or `undefined` when it has neither. */
export function createBeatorajaScrollMapper(chart: BeMusicJson): ScrollDistanceMapperLike | undefined {
  const beatResolver = createBeatResolver(chart);
  const scroll = createScrollTimeline(chart, beatResolver);
  const speed = createSpeedTimeline(chart, beatResolver);
  if (scroll.length === 0 && speed.length === 0) {
    return undefined;
  }
  return createScrollDistanceMapper(scroll, speed, { invalidDistance: 0 });
}

export interface BeatorajaScrollPlacementInput {
  currentBeat: number;
  /** Chart time of the playhead, in seconds. */
  nowSeconds: number;
  mapper: ScrollDistanceMapperLike | undefined;
  /** The lane's height in beats of scroll distance (lane pixels over pixels per beat). */
  laneBeats: number;
  /** Bottom edge of the stage, in the lanes' coordinates (y grows downward). */
  stageBottomY: number;
}

export interface BeatorajaScrollPlacement {
  /**
   * beatoraja's `LaneRenderer` window when the chart scrolls; `undefined` keeps the skin's plain rules for a chart
   * without `#SCROLL` / `#SPEED`.
   */
  window: NoteDrawWindow | undefined;
  /** Lane distance from the playhead to `beat`, in beats at scroll rate 1. */
  distance: (beat: number) => number;
}

export function resolveBeatorajaScrollPlacement(input: BeatorajaScrollPlacementInput): BeatorajaScrollPlacement {
  const { currentBeat, nowSeconds, mapper, laneBeats, stageBottomY } = input;
  if (mapper === undefined) {
    return { window: undefined, distance: (beat) => beat - currentBeat };
  }
  return {
    window: resolveNoteDrawWindow({
      rules: 'beatoraja',
      currentBeat,
      nowSeconds,
      mapper,
      laneBeats,
      overscanBeats: 0,
      stageBottomY,
    }),
    distance: (beat) => mapper.distanceBetween(currentBeat, beat),
  };
}
