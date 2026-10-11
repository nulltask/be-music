import type { LongNoteStyle } from '@be-music/player/core/engine';
import type { PlayerUiLongNoteMode, PlayerUiLongNoteOutcome } from '@be-music/player/core/ui-signal-bus';
import type { BeMusicLongNoteMode, BeMusicLongNoteState } from '@be-music/skin-sdk';

/**
 * How a ruleset plays a chart long note, mirroring the engine: LR2 plays every one as an LN, IIDX as a charge note
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
  activeMode: PlayerUiLongNoteMode;
  activeStartedAtMs: number;
  /** How each long note that finished on the lane ended, by head beat. */
  readonly outcomes: Map<number, PlayerUiLongNoteOutcome>;
}

/**
 * Per-lane long-note book-keeping fed by the engine's `long-note-start` / `long-note-end` commands, read back each
 * frame to label drawn long notes and lanes. Allocates only when a lane sees its first long note and when a long note
 * finishes; the per-frame reads allocate nothing.
 */
export class LongNoteTracker {
  private readonly lanes = new Map<string, LaneLongNotes>();

  /** A long note with its head at `beat` started being held on `channel` at play-clock `atMs`. */
  start(channel: string, beat: number, mode: PlayerUiLongNoteMode, atMs: number): void {
    let lane = this.lanes.get(channel);
    if (!lane) {
      lane = { activeBeat: undefined, activeMode: mode, activeStartedAtMs: 0, outcomes: new Map() };
      this.lanes.set(channel, lane);
    }
    lane.activeBeat = beat;
    lane.activeMode = mode;
    lane.activeStartedAtMs = atMs;
  }

  /** The long note held on `channel` finished. Ignored when none is held there. */
  end(channel: string, outcome: PlayerUiLongNoteOutcome): void {
    const lane = this.lanes.get(channel);
    if (!lane || lane.activeBeat === undefined) return;
    lane.outcomes.set(lane.activeBeat, outcome);
    lane.activeBeat = undefined;
  }

  clear(): void {
    this.lanes.clear();
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

  /** The mode the engine announced for the long note at `beat` on `channel`, while it is held. */
  heldMode(channel: string, beat: number): PlayerUiLongNoteMode | undefined {
    const lane = this.lanes.get(channel);
    return lane?.activeBeat === beat ? lane.activeMode : undefined;
  }

  /**
   * Where the long note with its head at `beat` on `channel` is in its life. `judged` is the note's own flag: a judged
   * long note that never started was missed at the head, so it reads as dropped.
   */
  stateOf(channel: string, beat: number, judged: boolean): BeMusicLongNoteState {
    const lane = this.lanes.get(channel);
    if (lane) {
      if (lane.activeBeat === beat) return 'held';
      const outcome = lane.outcomes.get(beat);
      if (outcome !== undefined) return outcome === 'complete' ? 'done' : 'dropped';
    }
    return judged ? 'dropped' : 'pending';
  }
}
