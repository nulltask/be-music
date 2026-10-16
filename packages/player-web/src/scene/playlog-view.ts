import {
  resolvePlaylogViewAt,
  roundPlaylogView,
  type PlaylogViewChange,
  type PlaylogViewState,
} from '@be-music/player/playlog';

/**
 * Walks a replayed play log's view (`play.view`, then `play.viewChanges`) along the playhead, so a scene re-applies it
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

/** The hi-speed scale of the built-in and LR2 scenes (`PIXELS_PER_BEAT × hiSpeed`), as `PlaylogViewState.hiSpeedScale`. */
export const BE_MUSIC_HI_SPEED_SCALE = 'be-music';
/** The hi-speed scale of the beatoraja scene (a lane is four beats at hi-speed 1). */
export const BEATORAJA_HI_SPEED_SCALE = 'beatoraja';

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
  sides: readonly ('1P' | '2P')[];
}

/**
 * The beatoraja scene's view in the play log's units: the hi-speed on the beatoraja scale, the covers as fractions of
 * the lane height (the HIDDEN cover, a ratio of the lane above the lift, is scaled by `1 - lift`), and the visible time
 * at the main BPM (beatoraja's white number, `240000 / bpm / hispeed × (1 - lanecover)`, rounded).
 */
export function resolveBeatorajaPlaylogView(input: BeatorajaViewInput): PlaylogViewState {
  const lanecover = clampFraction(input.lanecover);
  const lift = clampFraction(input.lift);
  const hidden = input.hiddenEnabled ? clampFraction(input.hiddenRatio) * (1 - lift) : 0;
  const view: PlaylogViewState = {
    hiSpeed: input.hiSpeed,
    hiSpeedScale: BEATORAJA_HI_SPEED_SCALE,
    covers: input.sides.map((side) => ({ side, sudden: lanecover, hidden, lift })),
  };
  if (input.hiSpeed > 0 && input.mainBpm > 0) {
    view.visibleMs = (240_000 / input.mainBpm / input.hiSpeed) * (1 - lanecover);
  }
  // At the play log's precision: the HIDDEN cover's `ratio × (1 - lift)` and the adapter's fractions carry float noise.
  return roundPlaylogView(view);
}

function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
