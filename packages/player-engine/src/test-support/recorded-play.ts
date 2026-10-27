import type { BeMusicJSON } from '@be-music/chart-source';
import { manualPlay } from '../index.ts';
import type { PlayerOptions, PlayerSummary } from '../core/engine.ts';
import type { BeMusicReplay, ReplayInputEvent } from '../replay/format.ts';
import type { RulesetId } from '../ruleset/index.ts';

/** Drive the engine from exact recorded input timestamps and capture its newly written replay. */
interface ReplayRun {
  summary: PlayerSummary;
  replay: BeMusicReplay;
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
    recordReplay: extra.recordReplay ?? {},
    onReplayRecorded: (recorded) => {
      replay = recorded;
    },
  });
  return { summary, replay: replay! };
}
