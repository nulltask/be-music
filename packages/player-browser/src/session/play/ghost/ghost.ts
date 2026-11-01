/**
 * A replay ghost (docs/replay.md, "Ghost"): a recorded play shown beside the live one. It is two parts that swap apart,
 * so other sources and other ways of showing one can be built and compared:
 *
 * - a {@link GhostSource} says which replay the ghost plays (the player's own best for now);
 * - a {@link GhostPresentation} shows its timeline (`ghost-timeline.ts`) while the play runs (a second playfield for
 *   now, `side-playfield-ghost.ts`).
 *
 * A ghost only ever draws: it plays no sound, takes no input, and leaves the live play's judging, records, replay and
 * Leaderboard submission alone.
 */

import type { BeMusicReplay } from '@be-music/player-engine/replay';
import type { PlayfieldRuntime } from '../../../view/shared/playfield/context.ts';

/** Which replay a ghost plays. */
export interface GhostSource {
  /** What the source is, for logs and the host's labels (`'own-best'`). */
  readonly kind: string;
  /** The replay, or `undefined` when there is none to play. Read once, while the play loads. */
  load(): Promise<BeMusicReplay | undefined>;
}

/** How a ghost shows its timeline while the play runs. */
export interface GhostPresentation {
  /**
   * Brings the ghost to chart second `seconds` (`nowMs` on the play clock stamps the effects it starts). A second
   * before the last one rewinds it; a jump ahead catches it up without replaying every effect on the way.
   */
  update(seconds: number, nowMs: number): void;
  /** The running play as the view draws it with the ghost. */
  present(play: PlayfieldRuntime): PlayfieldRuntime;
}
