import type { BeMusicJSON } from '@be-music/chart-source';
import type { PlayerOptions, PlayerSummary } from './engine-types.ts';
import { autoStrategy } from './play-auto.ts';
import { createPlayControls } from './play-controls.ts';
import { finishPlay } from './play-finish.ts';
import { runPlayLoop } from './play-loop.ts';
import { manualStrategy } from './play-manual.ts';
import { replayStrategy } from './play-replay.ts';
import { createPlaySession } from './play-session.ts';
import type { JudgeStrategy } from './play-strategy.ts';
import { createTwoPlayerJudge } from './two-player.ts';

/**
 * Plays `json` with the judge `strategy` through the one play loop: sets the session up, runs the loop and finishes
 * the play. Internal: hosts call {@link manualPlay} or {@link autoPlay}.
 */
export async function play(json: BeMusicJSON, options: PlayerOptions, strategy: JudgeStrategy): Promise<PlayerSummary> {
  const session = await createPlaySession(json, options, strategy);
  const judge =
    session.secondPlayer !== undefined
      ? createTwoPlayerJudge(strategy, session, session.secondPlayer)
      : strategy.createJudge(session);
  const controls = createPlayControls(session, judge);
  const outcome = await runPlayLoop(session, judge, controls);
  return finishPlay(session, judge, controls, outcome);
}

/**
 * Manual play: judges the player's keys, or re-drives a recorded replay when `options.replayInputs` is set.
 */
export async function manualPlay(json: BeMusicJSON, options: PlayerOptions = {}): Promise<PlayerSummary> {
  return play(json, options, options.replayInputs !== undefined ? replayStrategy : manualStrategy);
}

/** AUTO play: plays and judges every note itself. */
export async function autoPlay(json: BeMusicJSON, options: PlayerOptions = {}): Promise<PlayerSummary> {
  return play(json, options, autoStrategy);
}
