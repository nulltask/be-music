// The result screen's gauge graphs (beatoraja's CHANGE_GRAPH): a play's gauge history under each gauge of its ruleset.
// beatoraja logs every gauge during the play; here the others are re-simulated from the play's replay
// (`resolveReplayGaugeHistories`), which is deterministic, so each graph is what that gauge would have drawn.
import type { ResultGaugeGraph } from '@be-music/player-browser/host';
import { resolveReplayGaugeHistories } from '@be-music/player-engine/replay';
import type { PlayResult } from '@be-music/player-scene-model';

/** What the gauge graphs are worked out from: a single play's result. */
export type GaugeGraphResult = Pick<
  PlayResult,
  'replay' | 'gaugeHistory' | 'chartSeconds' | 'run' | 'course' | 'practice' | 'fromReplay'
>;

/**
 * The gauge graphs of a finished play, in its ruleset's gauge order, or none when they cannot be worked out: a play
 * without a replay or a chart length, and a course's (a stage's other gauges start from values the stage did not
 * record). A graph ends where the play ended, so a play that stopped as its gauge emptied shows no judgment after it.
 */
export function resolveResultGaugeGraphs(result: GaugeGraphResult): ResultGaugeGraph[] {
  const { replay, chartSeconds } = result;
  if (replay === undefined || chartSeconds === undefined || chartSeconds <= 0) return [];
  if (result.course !== undefined || replay.play.course !== undefined) return [];
  if (result.run !== undefined && result.run !== 'single') return [];
  const endProgress = result.gaugeHistory.at(-1)?.progress ?? 1;
  const chartUs = chartSeconds * 1_000_000;
  const histories = resolveReplayGaugeHistories(replay, endProgress < 1 ? { untilUs: endProgress * chartUs } : {});
  return histories.map(({ gauge, initial, samples }) => {
    const history = [{ progress: 0, value: initial }];
    for (const sample of samples)
      history.push({ progress: Math.max(0, Math.min(endProgress, sample.atUs / chartUs)), value: sample.gauge });
    // The graph reaches the end of the play, as the play's own does.
    history.push({ progress: endProgress, value: history.at(-1)!.value });
    return { type: gauge, history };
  });
}
