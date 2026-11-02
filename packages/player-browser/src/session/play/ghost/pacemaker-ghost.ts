/**
 * The ghost as a pacemaker alone (the `'pacemaker'` {@link GhostPresentation}): no field of its own, only the ghost's EX
 * score at the notes the live play has judged (`ghost-pace.ts`), which the play frame carries as its score target. The
 * built-in skins show it as the score graph's pacemaker bar and the TARGET difference; the LR2 and beatoraja views read it
 * as their target score numbers and bar graphs. It needs no room on the playfield, so it runs on every family's view and
 * on any chart.
 */

import type { GhostPaceScore, GhostPresentation, GhostScoreTarget } from './ghost.ts';
import { buildGhostPace, countJudgedNotes, type GhostPace } from './ghost-pace.ts';
import type { GhostTimeline } from './ghost-timeline.ts';
import type { PlayfieldRuntime } from '../../../view/shared/playfield/context.ts';

/** The pacemaker's name when the source gives none. */
export const DEFAULT_GHOST_LABEL = 'GHOST';

/** The pacemaker. See the module comment. */
export class PacemakerGhost implements GhostPresentation {
  public readonly drawsOnPlayfield: boolean = false;
  protected readonly pace: GhostPace;
  private readonly label: string;

  public constructor(timeline: Pick<GhostTimeline, 'judgments'>, label: string = DEFAULT_GHOST_LABEL) {
    this.pace = buildGhostPace(timeline);
    this.label = label;
  }

  /** A pacemaker follows the live play's judged notes, not the clock: nothing to bring forward. */
  public update(_seconds: number, _nowMs: number): void {}

  public present(play: PlayfieldRuntime): PlayfieldRuntime {
    return play;
  }

  public scoreTarget(score: GhostPaceScore): GhostScoreTarget {
    return {
      targetEXScore: this.pace.finalEXScore,
      targetPaceEXScore: this.pace.exScoreAt(countJudgedNotes(score)),
      targetLabel: this.label,
    };
  }
}
