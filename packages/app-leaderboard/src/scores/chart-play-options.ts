import { canonicalizeJSONValue, type ChartPlayOptions, type ChartPlayVariant } from '@be-music/chart-model';
import { resolveEffectiveChartPlayOptions } from '@be-music/player-engine';
import type { BeMusicReplay } from '@be-music/player-engine/replay';

export type ChartPlayOptionsCheck = { ok: true } | { ok: false; reason: 'chart-play-options-mismatch' };

/**
 * Checks a replay's chart gameplay program (`chart.chartPlayOptions`, #844 / #932) against the chart it played, so a
 * replay can neither strip nor add one (docs/leaderboard.md section 5.3). The play document, already checked against
 * the play fingerprint (L3), carries the options the chart declares (`playOptions`) and its lane mode; the server narrows
 * them to what takes effect in the play, as the client does (`resolveEffectiveChartPlayOptions`: a course stage keeps
 * its key mode without a NOTES COPY), and the replay must record exactly that. A NONSTOP run's stitched play applies no
 * stage's options, so its program must be empty.
 */
export function checkChartPlayOptions(
  replay: Pick<BeMusicReplay, 'chart' | 'play'>,
  playDocument: unknown,
): ChartPlayOptionsCheck {
  const recorded = replay.chart.chartPlayOptions?.options ?? {};
  const expected = expectedChartPlayOptions(replay, playDocument);
  return expected !== undefined && canonicalizeJSONValue(recorded) === canonicalizeJSONValue(expected)
    ? { ok: true }
    : { ok: false, reason: 'chart-play-options-mismatch' };
}

/** The options a play of the document's chart runs, or `undefined` for a document without a lane mode. */
function expectedChartPlayOptions(
  replay: Pick<BeMusicReplay, 'play'>,
  playDocument: unknown,
): ChartPlayOptions | undefined {
  if (replay.play.course?.kind === 'nonstop') return {};
  if (typeof playDocument !== 'object' || playDocument === null) return undefined;
  const { laneMode, playOptions } = playDocument as { laneMode?: unknown; playOptions?: ChartPlayOptions };
  if (typeof laneMode !== 'string') return undefined;
  return resolveEffectiveChartPlayOptions(
    { version: 1, options: playOptions ?? {} },
    { playVariant: laneMode as ChartPlayVariant, course: replay.play.course !== undefined },
  ).program.options;
}
