import {
  resolvePlaylogViewAt,
  roundPlaylogView,
  type PlaylogViewChange,
  type PlaylogViewState,
} from '@be-music/player/playlog';
import { createHiSpeedState } from './hi-speed.ts';
import { resolveLaneCover, type LaneCoverState } from './lane-cover.ts';
import type { PlayViewState } from './state.ts';
import type { PlaySide } from './types.ts';

/** The hi-speed scale of the built-in and LR2 scenes (`PIXELS_PER_BEAT × hiSpeed`), as `PlaylogViewState.hiSpeedScale`. */
export const BE_MUSIC_HI_SPEED_SCALE = 'be-music';
/** The hi-speed scale of the beatoraja scene (a lane is four beats at hi-speed 1). */
export const BEATORAJA_HI_SPEED_SCALE = 'beatoraja';

/**
 * The white number: how long (ms) a note stays visible below the SUDDEN+ cover, for a lane `laneBeats` beats long at
 * hi-speed 1, at `bpm` and the `#SCROLL` × `#SPEED` rate `scrollRate`. beatoraja's `240000 / bpm / hispeed × (1 -
 * lanecover)` is a lane of four beats. Like beatoraja, the LIFT does not shorten it, and it is 0 while the chart scrolls
 * backwards or stands still, or for a hi-speed, BPM or lane that is not positive.
 */
export function resolveWhiteNumber(input: {
  laneBeats: number;
  hiSpeed: number;
  sudden: number;
  bpm: number;
  scrollRate?: number;
}): number {
  const scrollRate = input.scrollRate ?? 1;
  if (!(input.laneBeats > 0) || !(input.hiSpeed > 0) || !(input.bpm > 0) || !(scrollRate > 0)) return 0;
  const uncovered = Math.max(0, 1 - Math.max(0, input.sudden));
  return ((input.laneBeats / input.hiSpeed / scrollRate) * uncovered * 60_000) / input.bpm;
}

/** The IIDX-style green number for a white number: three fifths of it, rounded (beatoraja's `duration_green`). */
export function resolveGreenNumber(whiteNumberMs: number): number {
  return Math.round((whiteNumberMs * 3) / 5);
}

/**
 * What the player sees in the play log's units (`PlaylogViewState`): the drawn hi-speed on the scene's hi-speed
 * `scale`, the HS-FIX, each side's covers as fractions of the lane, and the visible time at the chart's main BPM without
 * `#SCROLL` ({@link resolveWhiteNumber} on the first side's cover, for a lane `laneBeats` beats long at hi-speed 1), so
 * a replay on another scale can match it. Rounded to the play log's precision.
 */
export function resolvePlaylogView(
  view: PlayViewState,
  options: { scale: string; laneBeats?: number; mainBpm?: number },
): PlaylogViewState {
  const covers = view.covers.map(resolveLaneCover);
  const playlogView: PlaylogViewState = {
    hiSpeed: view.hiSpeed.drawn,
    hiSpeedScale: options.scale,
    ...(view.hsFix !== undefined ? { hsFix: view.hsFix } : {}),
    covers,
  };
  const { laneBeats, mainBpm } = options;
  if (laneBeats !== undefined && laneBeats > 0 && mainBpm !== undefined && mainBpm > 0 && view.hiSpeed.drawn > 0) {
    playlogView.visibleMs = resolveWhiteNumber({
      laneBeats,
      hiSpeed: view.hiSpeed.drawn,
      sudden: covers[0]?.sudden ?? 0,
      bpm: mainBpm,
    });
  }
  return roundPlaylogView(playlogView);
}

/** What the beatoraja scene shows: its hi-speed and its runtime adapter's cover state. */
export interface BeatorajaViewInput {
  hiSpeed: number;
  /** The lane cover (SUDDEN+), a fraction of the lane height. */
  lanecover: number;
  /** The lift, a fraction of the lane height. */
  lift: number;
  /** The HIDDEN cover's ratio, of the lane above the lift. */
  hiddenRatio: number;
  hiddenEnabled: boolean;
  /** The chart's main BPM, for the visible time. */
  mainBpm: number;
  /** The play sides with lanes: the scene's one cover state applies to each. */
  sides: readonly PlaySide[];
}

/**
 * The beatoraja scene's view in the play log's units ({@link resolvePlaylogView} on the beatoraja scale, a lane of four
 * beats): the cover state of its runtime adapter on every side, the HIDDEN cover scaled by `1 - lift`, and the
 * visible time at the main BPM (beatoraja's white number).
 */
export function resolveBeatorajaPlaylogView(input: BeatorajaViewInput): PlaylogViewState {
  const covers = input.sides.map((side): LaneCoverState => ({
    side,
    sudden: input.lanecover,
    suddenOn: true,
    hidden: input.hiddenRatio,
    hiddenOn: input.hiddenEnabled,
    lift: input.lift,
  }));
  const hiSpeed = { ...createHiSpeedState(), player: input.hiSpeed, drawn: input.hiSpeed };
  return resolvePlaylogView(
    { hiSpeed, covers },
    { scale: BEATORAJA_HI_SPEED_SCALE, laneBeats: 4, ...(input.mainBpm > 0 ? { mainBpm: input.mainBpm } : {}) },
  );
}

/**
 * Walks a replayed play log's view (`play.view`, then `play.viewChanges`) along the playhead, so a screen re-applies it
 * only when it changes instead of resolving it every frame.
 */
export class PlaylogViewCursor {
  private applied = -1;
  private readonly initial: PlaylogViewState | undefined;
  private readonly changes: readonly PlaylogViewChange[];

  constructor(initial: PlaylogViewState | undefined, changes: readonly PlaylogViewChange[] = []) {
    this.initial = initial;
    this.changes = changes;
  }

  /**
   * The recorded view in force at `timeUs` (chart time, µs) when it differs from the one the last call returned — the
   * first call always returns it — else `undefined`. The playhead may move back (a restart): the view follows it.
   */
  next(timeUs: number): PlaylogViewState | undefined {
    const count = countChangesAt(this.changes, timeUs);
    if (count === this.applied) return undefined;
    this.applied = count;
    return resolvePlaylogViewAt(this.initial, this.changes, timeUs);
  }
}

/** How many of `changes` (in time order) are at or before `timeUs`. */
function countChangesAt(changes: readonly PlaylogViewChange[], timeUs: number): number {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (changes[mid]!.timeUs <= timeUs) low = mid + 1;
    else high = mid;
  }
  return low;
}
