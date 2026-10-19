// Where the beatoraja play skin puts notes and bar lines on the lane, and which of them it draws: the same distance
// integrator and draw window the shared playfield uses (`chart/note-draw-window.ts`). A chart with `#SCROLL` /
// `#SPEED` (bmson `scroll_events` included) draws by beatoraja's `LaneRenderer` rules, so SCROLL gimmicks show up as they
// do in beatoraja; every other chart draws by LR2's, as in the other skins — a skin is a display choice, not a ruleset.

import {
  createBeatResolver,
  createScrollTimeline,
  createSpeedTimeline,
  resolveChart,
  type TempoReversalPoint,
} from '@be-music/chart';
import type { BeMusicJSON } from '@be-music/json';
import { createScrollDistanceMapper, type ScrollDistanceMapperLike } from '@be-music/player/display';
import {
  changesScrollRate,
  collectResolvedLaneTimelineBeats,
  resolveNoteDrawRules,
  resolveNoteDrawWindow,
  resolveReversedDrawClock,
  type NoteDrawWindow,
} from '../../../chart/note-draw-window.ts';

/** The chart's `#SCROLL` / `#SPEED` distance integrator, or `undefined` when it has neither (or only points at 1). */
export function createBeatorajaScrollMapper(chart: BeMusicJSON): ScrollDistanceMapperLike | undefined {
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

export function createBeatorajaLaneTimelines(chart: BeMusicJSON): BeatorajaLaneTimelines {
  const resolved = resolveChart(chart);
  return { beats: collectResolvedLaneTimelineBeats(resolved), beatToSeconds: resolved.timing.beatToSeconds };
}

export interface BeatorajaScrollPlacementInput {
  /** The beat the lane scrolls from: the mirrored display beat past an LR2 negative-BPM reversal. */
  currentBeat: number;
  /** Chart time of the playhead, in seconds. */
  nowSeconds: number;
  /** The chart's LR2 negative-BPM reversal, if any ({@link resolveReversedDrawClock}). */
  reversal?: TempoReversalPoint;
  mapper: ScrollDistanceMapperLike | undefined;
  /** The lane's height in beats of scroll distance (lane pixels over pixels per beat). */
  laneBeats: number;
  /** Beats of the chart's lane timelines ({@link createBeatorajaLaneTimelines}). */
  timelineBeats?: ArrayLike<number>;
  /** Bottom edge of the stage, in the lanes' coordinates (y grows downward). */
  stageBottomY: number;
}

export interface BeatorajaScrollPlacement {
  /** beatoraja's `LaneRenderer` window when the chart scrolls, LR2's otherwise ({@link resolveNoteDrawRules}). */
  window: NoteDrawWindow;
  /** Lane distance from the playhead to `beat`, in beats at scroll rate 1. */
  distance: (beat: number) => number;
}

export function resolveBeatorajaScrollPlacement(input: BeatorajaScrollPlacementInput): BeatorajaScrollPlacement {
  const { currentBeat, nowSeconds, reversal, mapper, laneBeats, timelineBeats, stageBottomY } = input;
  const clock = resolveReversedDrawClock(reversal, nowSeconds, currentBeat);
  const window = resolveNoteDrawWindow({
    rules: resolveNoteDrawRules(mapper !== undefined),
    currentBeat,
    nowSeconds: clock.nowSeconds,
    reachedBeat: clock.reachedBeat,
    mapper,
    laneBeats,
    timelineBeats,
    overscanBeats: 0,
    stageBottomY,
  });
  if (mapper === undefined) {
    return { window, distance: (beat) => beat - currentBeat };
  }
  return { window, distance: (beat) => mapper.distanceBetween(currentBeat, beat) };
}
