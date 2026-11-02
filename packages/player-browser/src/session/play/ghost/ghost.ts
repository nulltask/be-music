/**
 * A replay ghost (docs/replay.md, "Ghost"): a recorded play shown beside the live one. It is two parts that swap apart,
 * so the sources and the ways of showing one can be built side by side and compared:
 *
 * - a {@link GhostSource} says which replay the ghost plays (the player's own best, a replay slot, a Leaderboard run, a
 *   replay file);
 * - a {@link GhostPresentation} shows its timeline (`ghost-timeline.ts`) while the play runs, in one of the
 *   {@link GhostPresentationMode}s: a second playfield (`side-playfield-ghost.ts`), a pacemaker alone
 *   (`pacemaker-ghost.ts`), or a pacemaker with the recorded inputs over the player's own lanes
 *   (`lane-overlay-ghost.ts`).
 *
 * A ghost only ever draws: it plays no sound, takes no input, and leaves the live play's judging, records, replay and
 * Leaderboard submission alone.
 */

import type { BeMusicReplay } from '@be-music/player-engine/replay';
import type { ScoreSummary } from '@be-music/player-engine/ruleset';
import type { PlayfieldRuntime } from '../../../view/shared/playfield/context.ts';

/** Which replay a ghost plays. */
export interface GhostSource {
  /** What the source is, for logs (`'own-best'`, `'replay-slot'`, `'leaderboard'`, `'replay-file'`). */
  readonly kind: string;
  /** The pacemaker's name a score graph shows for it (`GHOST` when absent). */
  readonly label?: string;
  /** The replay, or `undefined` when there is none to play. Read once, while the play loads. */
  load(): Promise<BeMusicReplay | undefined>;
}

/**
 * How a ghost shows:
 *
 * - `'side-playfield'`: a second playfield beside the live one, on the 2P side of a 5 / 7 KEY single-play chart;
 * - `'pacemaker'`: no field of its own, only a pacemaker: the ghost's EX score at the notes the live play has judged,
 *   shown in the score graph and against the player's EX score (the score difference);
 * - `'lane-overlay'`: the pacemaker, with the ghost's recorded key presses and judgments flashed over the player's own
 *   lanes.
 */
export type GhostPresentationMode = 'side-playfield' | 'pacemaker' | 'lane-overlay';

/**
 * A ghost as a pacemaker, as a play frame's `scoreTargets` carry it: the ghost's EX score over the whole chart, its EX
 * score at the notes the live play has judged, and its name.
 */
export interface GhostScoreTarget {
  readonly targetEXScore: number;
  readonly targetPaceEXScore: number;
  readonly targetLabel: string;
}

/** The judgment counts a pacemaker reads off the live play to know how many notes it has judged. */
export type GhostPaceScore = Pick<ScoreSummary, 'perfect' | 'great' | 'good' | 'bad' | 'poor'>;

/** How a ghost shows its timeline while the play runs. */
export interface GhostPresentation {
  /**
   * Whether it draws a field of its own, which only a built-in family view has room for: such a ghost stands still on
   * another family's view. One that does not (a pacemaker) keeps running on every view.
   */
  readonly drawsOnPlayfield: boolean;
  /**
   * Brings the ghost to chart second `seconds` (`nowMs` on the play clock stamps the effects it starts). A second
   * before the last one rewinds it; a jump ahead catches it up without replaying every effect on the way.
   */
  update(seconds: number, nowMs: number): void;
  /** The running play as a built-in view draws it with the ghost. */
  present(play: PlayfieldRuntime): PlayfieldRuntime;
  /** The ghost as a pacemaker against the live play's `score`; absent for a presentation that shows none. */
  scoreTarget?(score: GhostPaceScore): GhostScoreTarget;
}
