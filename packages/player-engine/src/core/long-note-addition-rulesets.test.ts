import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { observePlay } from './characterization/harness.ts';

// One note on key 1 at 0 s, and a BGM row at 1 s for the added long note to end on.
const chart = (): ReturnType<typeof parseBMS> => parseBMS('#BPM 120\n#TOTAL 200\n#WAV01 a.wav\n#00011:01\n#00001:0001');

// Long-note addition is offered under every judge ruleset (#774). The added long notes are judged as the ruleset's long
// notes: LR2 judges a long note once (LN), That-Which-Must-Not-Be-Named judges head and tail (charge note), and only
// beatoraja keeps the added CN / HCN apart from an LN.
test.each([
  ['lr2', 'ADD_LN', 1],
  ['lr2', 'ADD_CN', 1],
  ['lr2', 'ADD_HCN', 1],
  ['____', 'ADD_LN', 2],
  ['____', 'ADD_CN', 2],
  ['beatoraja', 'ADD_LN', 1],
  ['beatoraja', 'ADD_CN', 2],
  ['beatoraja', 'ADD_HCN', 2],
] as const)('%s judges %s as its own long notes', async (ruleset, longNoteModifier, judgments) => {
  const play = await observePlay({
    driver: 'auto',
    chart: chart(),
    options: { judgeRuleset: ruleset, longNoteModifier },
  });
  expect(play.outcome).toBe('completed');
  expect(play.summary?.total).toBe(judgments);
  expect(play.replay?.play).toMatchObject({ longNoteModifier, longNoteModifierChangeCount: 1 });
  expect(play.simulated?.[ruleset]?.noteCount).toBe(judgments);
});
