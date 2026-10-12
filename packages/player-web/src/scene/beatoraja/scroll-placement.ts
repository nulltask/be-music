// Where the beatoraja play skin puts notes and bar lines on the lane when the chart has `#SCROLL` / `#SPEED` (bmson
// `scroll_events` included): the same distance integrator and `LaneRenderer` draw window the core gameplay view uses
// (`../core/note-draw-window.ts`), so SCROLL gimmicks show up in beatoraja skins as they do in beatoraja.

import { createBeatResolver, createScrollTimeline, createSpeedTimeline, resolveChart } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import { createScrollDistanceMapper, type ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import {
  changesScrollRate,
  collectResolvedLaneTimelineBeats,
  resolveNoteDrawWindow,
  type NoteDrawWindow,
} from '../core/note-draw-window.ts';

/** The chart's `#SCROLL` / `#SPEED` distance integrator, or `undefined` when it has neither (or only points at 1). */
export function createBeatorajaScrollMapper(chart: BeMusicJson): ScrollDistanceMapperLike | undefined {
  const beatResolver = createBeatResolver(chart);
  const scroll = createScrollTimeline(chart, beatResolver);
  const speed = createSpeedTimeline(chart, beatResolver);
  if (!changesScrollRate(scroll, speed)) {
    return undefined;
  }
  return createScrollDistanceMapper(scroll, speed, { invalidDistance: 0 });
}

/** The chart's lane timelines as beatoraja's `LaneRenderer` walks them. */
export interface BeatorajaLaneTimelines {
  /** Beats of the lane timelines, for the last timeline drawn past the lane top. */
  beats: Float64Array;
  /** Chart time of a beat, in seconds, for hiding bar lines whose time has come. */
  beatToSeconds: (beat: number) => number;
}

export function createBeatorajaLaneTimelines(chart: BeMusicJson): BeatorajaLaneTimelines {
  const resolved = resolveChart(chart);
  return { beats: collectResolvedLaneTimelineBeats(resolved), beatToSeconds: resolved.timing.beatToSeconds };
}

export interface BeatorajaScrollPlacementInput {
  currentBeat: number;
  /** Chart time of the playhead, in seconds. */
  nowSeconds: number;
  mapper: ScrollDistanceMapperLike | undefined;
  /** The lane's height in beats of scroll distance (lane pixels over pixels per beat). */
  laneBeats: number;
  /** Beats of the chart's lane timelines ({@link createBeatorajaLaneTimelines}). */
  timelineBeats?: ArrayLike<number>;
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
  const { currentBeat, nowSeconds, mapper, laneBeats, timelineBeats, stageBottomY } = input;
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
      timelineBeats,
      overscanBeats: 0,
      stageBottomY,
    }),
    distance: (beat) => mapper.distanceBetween(currentBeat, beat),
  };
}
