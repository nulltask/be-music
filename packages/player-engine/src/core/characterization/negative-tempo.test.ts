import { parseChart } from '@be-music/chart-parser/core';
import { expect, test } from 'vite-plus/test';
import { parseReplay, serializeReplay } from '../../replay/format.ts';
import { simulateReplay } from '../../replay/simulate.ts';
import { command, observePlay, tap } from './harness.ts';

test('waits past the chart end and replays the observed reversal and exit', async () => {
  const chart = parseChart('#BPM 120\n#BPM01 -120\n#00008:0001\n#00011:0001\n#00112:01', 'bms');
  const options = { judgeRuleset: 'lr2', gauge: 'lr2:GROOVE' } as const;
  const live = await observePlay({
    driver: 'manual',
    chart,
    options,
    audio: false,
    script: [...tap(1010, '11'), command(8000, { kind: 'interrupt', reason: 'escape' })],
  });
  expect(live.endedAtMs).toBeGreaterThanOrEqual(8000);
  const replay = parseReplay(serializeReplay(live.replay!));
  expect(replay.chart.reversalTimeUs).toBe(1_000_000);
  expect(replay.chart.reversalActivationUs).toBeGreaterThan(1_000_000);
  expect(replay.play.exitedReversal).toBe(true);
  expect(live.summary?.gauge?.current).toBe(0);
  for (const ruleset of ['lr2', 'beatoraja'] as const) {
    expect(simulateReplay(replay, { ruleset }).gauge.final).toBe(0);
  }
  const playback = await observePlay({
    driver: 'manual',
    chart,
    options: {
      ...options,
      replayInputs: replay.inputs,
      replayReversalActivationUs: replay.chart.reversalActivationUs,
      replayAbortedAtUs: replay.play.abortedAtUs,
      replayExitedReversal: replay.play.exitedReversal,
      replayInputSources: replay.play.inputSources,
    },
    audio: false,
  });
  expect(playback.summary).toEqual(live.summary);
});
