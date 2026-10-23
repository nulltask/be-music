import {
  resolveReplayViewAt,
  roundReplayView,
  type ReplayViewChange,
  type ReplayViewState,
} from '@be-music/player-engine/replay';
import { resolveLaneCover } from './lane-cover.ts';
import type { PlayViewState } from './state.ts';

/** The hi-speed scale of the built-in and LR2 scenes (`PIXELS_PER_BEAT × hiSpeed`), as `ReplayViewState.hiSpeedScale`. */
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

/**
 * The hi-speed that shows a note for `whiteNumberMs` below the SUDDEN+ cover ({@link resolveWhiteNumber} solved for the
 * hi-speed), for a lane `laneBeats` beats long at hi-speed 1: a replay on another hi-speed scale works out the speed that
 * shows the visible time a replay recorded. Like the white number it leaves the LIFT out. `undefined` when nothing of
 * the lane is uncovered or an input is not positive.
 */
export function resolveHiSpeedForWhiteNumber(input: {
  laneBeats: number;
  sudden: number;
  bpm: number;
  whiteNumberMs: number;
  scrollRate?: number;
}): number | undefined {
  const atHiSpeed1 = resolveWhiteNumber({
    laneBeats: input.laneBeats,
    hiSpeed: 1,
    sudden: input.sudden,
    bpm: input.bpm,
    ...(input.scrollRate !== undefined ? { scrollRate: input.scrollRate } : {}),
  });
  if (!(atHiSpeed1 > 0) || !(input.whiteNumberMs > 0)) return undefined;
  return atHiSpeed1 / input.whiteNumberMs;
}

/** The IIDX-style green number for a white number: three fifths of it, rounded (beatoraja's `duration_green`). */
export function resolveGreenNumber(whiteNumberMs: number): number {
  return Math.round((whiteNumberMs * 3) / 5);
}

/**
 * What the player sees in the replay's units (`ReplayViewState`): the drawn hi-speed on the scene's hi-speed
 * `scale`, the HS-FIX, each side's covers as fractions of the lane, and the visible time at the chart's main BPM without
 * `#SCROLL` ({@link resolveWhiteNumber} on the first side's cover, for a lane `laneBeats` beats long at hi-speed 1), so
 * a replay on another scale can match it. Rounded to the replay's precision.
 */
export function captureReplayView(
  view: PlayViewState,
  options: { scale: string; laneBeats?: number; mainBPM?: number },
): ReplayViewState {
  const covers = view.covers.map(resolveLaneCover);
  const replayView: ReplayViewState = {
    hiSpeed: view.hiSpeed.drawn,
    hiSpeedScale: options.scale,
    ...(view.hsFix !== undefined ? { hsFix: view.hsFix } : {}),
    covers,
  };
  const { laneBeats, mainBPM } = options;
  if (laneBeats !== undefined && laneBeats > 0 && mainBPM !== undefined && mainBPM > 0 && view.hiSpeed.drawn > 0) {
    replayView.visibleMs = resolveWhiteNumber({
      laneBeats,
      hiSpeed: view.hiSpeed.drawn,
      sudden: covers[0]?.sudden ?? 0,
      bpm: mainBPM,
    });
  }
  return roundReplayView(replayView);
}

/**
 * Walks a replayed replay's view (`play.view`, then `play.viewChanges`) along the playhead, so a screen re-applies it
 * only when it changes instead of resolving it every frame.
 */
export class ReplayViewCursor {
  private applied = -1;
  private readonly initial: ReplayViewState | undefined;
  private readonly changes: readonly ReplayViewChange[];

  constructor(initial: ReplayViewState | undefined, changes: readonly ReplayViewChange[] = []) {
    this.initial = initial;
    this.changes = changes;
  }

  /** The view at a seek, returned even when the target shares the last call's change interval. */
  seek(timeUs: number): ReplayViewState {
    this.applied = -1;
    return this.next(timeUs)!;
  }

  /**
   * The recorded view in force at `timeUs` (chart time, µs) when it differs from the one the last call returned — the
   * first call always returns it — else `undefined`. The playhead may move back (a restart): the view follows it.
   */
  next(timeUs: number): ReplayViewState | undefined {
    const count = countChangesAt(this.changes, timeUs);
    if (count === this.applied) return undefined;
    this.applied = count;
    return resolveReplayViewAt(this.initial, this.changes, timeUs);
  }
}

/** How many of `changes` (in time order) are at or before `timeUs`. */
function countChangesAt(changes: readonly ReplayViewChange[], timeUs: number): number {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (changes[mid]!.timeUs <= timeUs) low = mid + 1;
    else high = mid;
  }
  return low;
}
