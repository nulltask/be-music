import type { LongNoteStyle } from '@be-music/player-engine/ruleset';
import type {
  PlayerUIHellChargeState,
  PlayerUILongNoteMode,
  PlayerUILongNoteOutcome,
} from '@be-music/player-engine/signals';
import type { BeMusicLongNoteMode, BeMusicLongNoteState } from '@be-music/player-skin-sdk';

/**
 * How a ruleset plays a chart long note, mirroring the engine: LR2 plays every one as an LN, That-Which-Must-Not-Be-Named as a charge note
 * (hell charge where the chart says 3), beatoraja follows the chart. A chart note without a mode is a CN, as in the
 * engine.
 */
export function resolveBeMusicLongNoteMode(
  style: LongNoteStyle,
  chartMode: 1 | 2 | 3 | undefined,
): BeMusicLongNoteMode {
  const mode = chartMode ?? 2;
  switch (style) {
    case 'ln':
      return 'ln';
    case 'charge':
      return mode === 3 ? 'hcn' : 'cn';
    default:
      return mode === 3 ? 'hcn' : mode === 2 ? 'cn' : 'ln';
  }
}

interface LaneLongNotes {
  /** Head beat of the long note held on the lane, or `undefined` when none is. */
  activeBeat: number | undefined;
  activeMode: PlayerUILongNoteMode;
  activeStartedAtMs: number;
  /** How each long note that finished on the lane ended, by head beat. */
  readonly outcomes: Map<number, PlayerUILongNoteOutcome>;
  /** Play-clock ms each long note that did not complete was let go, by head beat. */
  readonly releasedAtMs: Map<number, number>;
  /** Whether each hell charge note passing the judgement line gains or drains the gauge, by head beat. */
  readonly hellCharge: Map<number, 'gaining' | 'draining'>;
}

/**
 * Per-lane long-note book-keeping fed by the engine's `long-note-start` / `long-note-end` / `hell-charge` commands, read
 * back each frame to label drawn long notes and lanes. Allocates only when a lane sees its first long note and when a
 * long note finishes; the per-frame reads allocate nothing.
 */
export class LongNoteTracker {
  private readonly lanes = new Map<string, LaneLongNotes>();

  /** A long note with its head at `beat` started being held on `channel` at play-clock `atMs`. */
  start(channel: string, beat: number, mode: PlayerUILongNoteMode, atMs: number): void {
    const lane = this.laneOf(channel, mode);
    lane.activeBeat = beat;
    lane.activeMode = mode;
    lane.activeStartedAtMs = atMs;
  }

  /** The long note held on `channel` finished at play-clock `atMs`. Ignored when none is held there. */
  end(channel: string, outcome: PlayerUILongNoteOutcome, atMs: number): void {
    const lane = this.lanes.get(channel);
    if (!lane || lane.activeBeat === undefined) return;
    lane.outcomes.set(lane.activeBeat, outcome);
    if (outcome !== 'complete') lane.releasedAtMs.set(lane.activeBeat, atMs);
    lane.activeBeat = undefined;
  }

  /**
   * The hell charge note with its head at `beat` on `channel` started gaining or draining the gauge, or passed the
   * judgement line (`'passed'`), as the engine's `hell-charge` command says.
   */
  hellCharge(channel: string, beat: number, state: PlayerUIHellChargeState): void {
    if (state === 'passed') {
      this.lanes.get(channel)?.hellCharge.delete(beat);
      return;
    }
    this.laneOf(channel, 'hcn').hellCharge.set(beat, state);
  }

  clear(): void {
    this.lanes.clear();
  }

  private laneOf(channel: string, mode: PlayerUILongNoteMode): LaneLongNotes {
    let lane = this.lanes.get(channel);
    if (!lane) {
      lane = {
        activeBeat: undefined,
        activeMode: mode,
        activeStartedAtMs: 0,
        outcomes: new Map(),
        releasedAtMs: new Map(),
        hellCharge: new Map(),
      };
      this.lanes.set(channel, lane);
    }
    return lane;
  }

  /** True while a long note is held on `channel`. */
  isHolding(channel: string): boolean {
    return this.lanes.get(channel)?.activeBeat !== undefined;
  }

  /** Play-clock ms the hold on `channel` started, while one is held. */
  holdStartedAtMs(channel: string): number | undefined {
    const lane = this.lanes.get(channel);
    return lane?.activeBeat === undefined ? undefined : lane.activeStartedAtMs;
  }

  /** Play-clock ms the long note with its head at `beat` on `channel` was let go early, once it ended dropped. */
  releasedAtMs(channel: string, beat: number): number | undefined {
    return this.lanes.get(channel)?.releasedAtMs.get(beat);
  }

  /** The mode the engine announced for the long note at `beat` on `channel`, while it is held. */
  heldMode(channel: string, beat: number): PlayerUILongNoteMode | undefined {
    const lane = this.lanes.get(channel);
    return lane?.activeBeat === beat ? lane.activeMode : undefined;
  }

  /**
   * Where the long note with its head at `beat` on `channel` is in its life. `judged` is the note's own flag: a judged
   * long note that never started was missed at the head, so it reads as dropped. A hell charge note passing the
   * judgement line reads as the engine last said: `'held'` while it gains (held, or its tail released well), and
   * `'draining'` while it drains (let go or missed at the head, and a press makes it gain again); past its tail it
   * reads as {@link holdStateOf} does.
   */
  stateOf(channel: string, beat: number, judged: boolean): BeMusicLongNoteState {
    const hellCharge = this.lanes.get(channel)?.hellCharge.get(beat);
    if (hellCharge !== undefined) return hellCharge === 'gaining' ? 'held' : 'draining';
    return this.holdStateOf(channel, beat, judged);
  }

  /**
   * {@link stateOf} without the hell charge: a long note let go early or missed at the head reads as dropped for good,
   * whatever its gauge does after. LR2's half alpha follows this.
   */
  holdStateOf(channel: string, beat: number, judged: boolean): Exclude<BeMusicLongNoteState, 'draining'> {
    const lane = this.lanes.get(channel);
    if (lane) {
      if (lane.activeBeat === beat) return 'held';
      const outcome = lane.outcomes.get(beat);
      if (outcome !== undefined) return outcome === 'complete' ? 'done' : 'dropped';
    }
    return judged ? 'dropped' : 'pending';
  }
}
