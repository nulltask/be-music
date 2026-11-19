import { canonicalizeJSONValue, type ChartPlayOptions, type ChartPlayVariant } from '@be-music/chart-model';
import { resolveChartPlayProgram, type BeMusicReplay } from '@be-music/player-engine/replay';

export type ChartPlayOptionsCheck = { ok: true } | { ok: false; reason: 'chart-play-options-mismatch' };

/**
 * Checks a replay's chart gameplay program (`chart.chartPlayOptions`, #844 / #932) against the chart it played, so a
 * replay can neither strip nor add one (docs/leaderboard.md section 5.3). The play document, already checked against
 * the play fingerprint (L3), carries the options the chart declares (`playOptions`) and its lane mode; the server narrows
 * them using the same rules as the player. The replay must record both the effective options and which ones the
 * player supplied (`play.playerChartPlayOptions`, #1243).
 * A NONSTOP run's stitched play applies no stage's options, so its program must be empty.
 */
export function checkChartPlayOptions(
  replay: Pick<BeMusicReplay, 'chart' | 'play'>,
  playDocument: unknown,
): ChartPlayOptionsCheck {
  const expected = expectedChartPlayOptions(replay, playDocument);
  return expected !== undefined &&
    canonicalizeJSONValue(replay.chart.chartPlayOptions?.options ?? {}) === canonicalizeJSONValue(expected.options) &&
    canonicalizeJSONValue(replay.play.playerChartPlayOptions ?? {}) === canonicalizeJSONValue(expected.playerOptions)
    ? { ok: true }
    : { ok: false, reason: 'chart-play-options-mismatch' };
}

/** The options a play of the document's chart runs, or `undefined` for a document without a lane mode. */
function expectedChartPlayOptions(replay: Pick<BeMusicReplay, 'chart' | 'play'>, playDocument: unknown) {
  if (replay.play.course?.kind === 'nonstop') return { options: {}, playerOptions: {} };
  if (typeof playDocument !== 'object' || playDocument === null) return undefined;
  const { laneMode, playOptions } = playDocument as { laneMode?: unknown; playOptions?: ChartPlayOptions };
  if (typeof laneMode !== 'string') return undefined;
  const recorded = replay.chart.chartPlayOptions;
  const { program, playerOptions } = resolveChartPlayProgram(
    { version: recorded?.version ?? 1, options: playOptions ?? {} },
    recorded?.options,
    { playVariant: laneMode as ChartPlayVariant, course: replay.play.course !== undefined },
  );
  return { options: program.options, playerOptions };
}
