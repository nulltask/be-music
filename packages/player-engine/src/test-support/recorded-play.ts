import type { BeMusicJSON } from '@be-music/chart-source';
import { manualPlay } from '../index.ts';
import type { PlayerOptions, PlayerSummary } from '../core/engine.ts';
import type { BeMusicReplay, ReplayInputEvent, ReplayInputSource } from '../replay/format.ts';
import type { RulesetId } from '../ruleset/index.ts';

/** Drive the engine from exact recorded input timestamps and capture its newly written replay. */
interface ReplayRun {
  summary: PlayerSummary;
  replay: BeMusicReplay;
}

/**
 * A table naming every source id `inputs` use, for inputs written without one: each id a controller button of its own,
 * so a scratch hold it starts plays the lenient single-source rule, and the replay recorded from it names the same
 * sources.
 */
export function defaultInputSources(inputs: readonly ReplayInputEvent[]): ReplayInputSource[] {
  return [...new Set(inputs.map((input) => input.source))]
    .sort((left, right) => left - right)
    .map((id) => ({ id, kind: 'button', device: 'controller', label: `test-${id}` }));
}

export async function runRecordedPlay(
  json: BeMusicJSON,
  inputs: readonly ReplayInputEvent[],
  ruleset: RulesetId,
  extra: PlayerOptions = {},
): Promise<ReplayRun> {
  let replay: BeMusicReplay | undefined;
  const summary = await manualPlay(json, {
    ...extra,
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    judgeRuleset: ruleset,
    replayInputs: inputs,
    replayInputSources: extra.replayInputSources ?? defaultInputSources(inputs),
    recordReplay: extra.recordReplay ?? {},
    onReplayRecorded: (recorded) => {
      replay = recorded;
    },
  });
  return { summary, replay: replay! };
}
