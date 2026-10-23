/**
 * What a play shows of its run apart from the play state: the lane effects (key beams, bombs, the key flashes still to
 * end), the long notes held, the judgment plates, the POOR image, the latched moments and the score readout's roll. The
 * engine's commands and judge cues build it up as the play runs; a seek voids it at once ({@link
 * PlayPresentation.resetPresentation}), and the engine's seek snapshot and the long notes it announces again rebuild
 * what the second sought shows.
 */

import type { JudgmentKind } from '@be-music/player-engine/ruleset';
import type { BeMusicLaneKind } from '@be-music/player-skin-sdk';
import type { BeMusicJudgmentKind } from '../../skin/be-music/types.ts';
import { LongNoteTracker } from './long-note-tracker.ts';

/** One play side's judgment plate: the judgment shown, until when (chart seconds), and the combos it shows. */
export interface PlayJudgeSideState {
  judge: JudgmentKind | '';
  until: number;
  combo: number;
  courseCombo?: number;
}

/** Play-clock ms of the once-per-play moments, latched as they happen. */
export interface PlayMoments {
  failedAtMs?: number;
  allNotesDoneAtMs?: number;
  outroAtMs?: number;
  gaugeRiseAtMs?: number;
  gaugeMaxAtMs?: number;
}

function createJudgeSideState(): Record<'1P' | '2P', PlayJudgeSideState> {
  return { '1P': { judge: '', until: 0, combo: 0 }, '2P': { judge: '', until: 0, combo: 0 } };
}

/** The presentation of one run of a play. See the module comment. */
export class PlayPresentation {
  /** Long-note holds of the current play, fed from the engine's `long-note-start` / `long-note-end` commands. */
  readonly longNotes: LongNoteTracker = new LongNoteTracker();
  /** The lanes held now: by a key, or by the engine for an AUTO long note. */
  readonly pressedChannels: Set<string> = new Set();
  /**
   * By channel, the `playClock()` timestamp at which the lane's key beam came on (a press, an autoplayed note, a long
   * note's hold); removed once the beam has faded out after the key is up. A view maps the channels onto its own
   * timers: the LR2 view onto LR2's key-on bank (100-119).
   */
  readonly keyBeamStartedAt: Map<string, number> = new Map();
  /**
   * By channel, the play-clock timestamp of a key beam's in-flight release fade. When set, the lane's beam (and a
   * skin's key-on sprites) taper from 1 → 0 over the view's key-beam fade starting at the recorded value, so an LN
   * release decays instead of popping off. Releasing a lane (`releaseKeyBeam`) sets it; a fresh press (`startKeyBeam`)
   * clears it.
   */
  readonly keyBeamFadeStartedAt: Map<string, number> = new Map();
  /** The timeouts that end the key flashes and fades still running. */
  readonly keyFlashTimeouts: Set<number> = new Set();
  /** By channel, when each lane's live bomb started (play clock). */
  readonly bombStartedAt: Map<string, number> = new Map();
  /** Judgement that set off each lane's live bomb, by channel; absent for bombs without one (an autoplayed LN head). */
  readonly bombJudge: Map<string, BeMusicJudgmentKind> = new Map();
  /** Play-clock ms of each lane's last key press / release (also autoplay hits), by channel. */
  readonly lanePressedAt: Map<string, number> = new Map();
  readonly laneReleasedAt: Map<string, number> = new Map();
  /**
   * Set once the player has hit every chart note without a single BAD / POOR break, so the `full-combo` theme event
   * (LR2 FC timers 48 / 49) fires once per run. AUTO reaches it the moment the last note's auto-PERFECT lands.
   */
  fullComboFired = false;
  lastJudge = '';
  lastJudgeUntil = 0;
  /** Play-clock time of the last judgement / key impulse, for the be-music skin's reactive visuals. */
  lastJudgeAt: number | undefined;
  lastImpulseAt: number | undefined;
  lastImpulseKind: BeMusicLaneKind | undefined;
  /** When the POOR image last came up, in pause-aware play-clock milliseconds; `-Infinity` means inactive. */
  lastPoorAt = -Number.POSITIVE_INFINITY;
  /**
   * Per-side judge / combo snapshots: the verdict, the chart-time at which the plate should disappear, and the running
   * combo *at the moment that side's note was judged*, so the DP renderer shows each side's own combo. SP charts only
   * ever populate the `'1P'` slot.
   */
  judgeSideState: Record<'1P' | '2P', PlayJudgeSideState> = createJudgeSideState();
  /** Play-clock ms of the once-per-play moments (gauge failed, last note judged, chart end, gauge risen / full). */
  playMoments: PlayMoments = {};
  /** Smoothed score for the count-up animation. Lerps toward the score. */
  displayedScore = 0;

  /**
   * Voids what the run showed — as a seek does — leaving the presentation as a new play's: the key flashes still to end
   * are cancelled, and every lane effect, held long note, plate, latch and moment goes.
   */
  resetPresentation(): void {
    for (const timeout of this.keyFlashTimeouts) globalThis.clearTimeout(timeout);
    this.keyFlashTimeouts.clear();
    this.longNotes.clear();
    this.pressedChannels.clear();
    this.keyBeamStartedAt.clear();
    this.keyBeamFadeStartedAt.clear();
    this.bombStartedAt.clear();
    this.bombJudge.clear();
    this.lanePressedAt.clear();
    this.laneReleasedAt.clear();
    this.fullComboFired = false;
    this.lastJudge = '';
    this.lastJudgeUntil = 0;
    this.lastJudgeAt = undefined;
    this.lastImpulseAt = undefined;
    this.lastImpulseKind = undefined;
    this.lastPoorAt = -Number.POSITIVE_INFINITY;
    this.judgeSideState = createJudgeSideState();
    this.playMoments = {};
    this.displayedScore = 0;
  }
}
