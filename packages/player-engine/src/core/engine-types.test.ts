import { describe, expect, test } from 'vite-plus/test';
import type {
  PlayerOptions,
  PlayerPlayDebug,
  PlayerPlayRecording,
  PlayerPlayRuntime,
  PlayerPlaySettings,
  PlayerPlayTuning,
} from './engine-types.ts';

// Compile-time checks (run by `pnpm run typecheck`): every `PlayerOptions` key sits in exactly one category, so a new
// option cannot be added without classifying it.
type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type Groups = {
  settings: PlayerPlaySettings;
  runtime: PlayerPlayRuntime;
  tuning: PlayerPlayTuning;
  debug: PlayerPlayDebug;
  recording: PlayerPlayRecording;
};
type GroupName = keyof Groups;
/** Every key of the named groups (distributes over a union of names, unlike `keyof Groups[G]`). */
type GroupKeys<G extends GroupName> = { [N in G]: keyof Groups[N] }[G];
/** Keys a group shares with any other group — `never` when the groups are disjoint. */
type OverlapWithOthers<G extends GroupName> = GroupKeys<G> & GroupKeys<Exclude<GroupName, G>>;

export type PlayerOptionGroupChecks = [
  Assert<IsEqual<keyof PlayerOptions, GroupKeys<GroupName>>>,
  Assert<IsEqual<OverlapWithOthers<'settings'>, never>>,
  Assert<IsEqual<OverlapWithOthers<'runtime'>, never>>,
  Assert<IsEqual<OverlapWithOthers<'tuning'>, never>>,
  Assert<IsEqual<OverlapWithOthers<'debug'>, never>>,
  Assert<IsEqual<OverlapWithOthers<'recording'>, never>>,
];

describe('PlayerOptions groups', () => {
  test('a value built from the five groups is a PlayerOptions', () => {
    const settings: PlayerPlaySettings = { gauge: 'HARD', judgeRuleset: 'beatoraja', autoScratch: true };
    const tuning: PlayerPlayTuning = { audio: false, leadInMs: 0 };
    const debug: PlayerPlayDebug = { judgeWindowMs: 120 };
    const runtime: PlayerPlayRuntime = { onLog: () => {} };
    const recording: PlayerPlayRecording = { replayInputs: [] };
    const options: PlayerOptions = { ...settings, ...tuning, ...debug, ...runtime, ...recording };
    expect(Object.keys(options).sort()).toEqual(
      ['audio', 'autoScratch', 'gauge', 'judgeRuleset', 'judgeWindowMs', 'leadInMs', 'onLog', 'replayInputs'].sort(),
    );
  });
});
