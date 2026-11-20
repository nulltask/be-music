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

test('finishes on a late reversal, bypasses the host hold and replays the recorded end', async () => {
  const chart = parseChart('#BPM 120\n#BPM01 -120\n#00111:01\n#00208:0001', 'bms');
  const live = await observePlay({
    driver: 'manual',
    chart,
    script: [...tap(2000, '11')],
    audio: false,
    options: { holdAfterChart: { signal: new AbortController().signal } },
  });
  const replay = parseReplay(serializeReplay(live.replay!));
  expect(replay.play.completedAtReversal).toBe(true);
  expect(replay.play.aborted).toBeUndefined();
  expect(live.endedAtMs).toBeGreaterThanOrEqual(5000);
  expect(live.endedAtMs).toBeLessThan(5100);
  let finalSeconds = 0;
  const playback = await observePlay({
    onFrame: (frame) => {
      finalSeconds = frame.currentSeconds;
    },
    driver: 'manual',
    chart,
    audio: false,
    options: {
      replayInputs: replay.inputs,
      replayInputSources: replay.play.inputSources,
      replayCompletedAtReversal: replay.play.completedAtReversal,
      replayReversalActivationUs: replay.chart.reversalActivationUs,
      holdAfterChart: { signal: new AbortController().signal },
    },
  });
  expect(playback.summary).toEqual(live.summary);
  expect(finalSeconds * 1e6).toBeCloseTo(replay.chart.reversalActivationUs!, 5);
});

test.each([false, true])('handles the last internal event with a same-tick STOP: %s', async (stop) => {
  // The generated bar 999 line precedes op 8. A STOP at the same time follows it.
  const chart = parseChart('#BPM 120000\n#BPM01 -120\n#99811:01\n#99908:01' + (stop ? '\n#99909:01' : ''), 'bms');
  const play = await observePlay({
    driver: 'manual',
    chart,
    audio: false,
    script: [command(6000, { kind: 'interrupt', reason: 'escape' })],
  });
  expect(play.replay!.play.completedAtReversal === true).toBe(!stop);
  expect(play.replay!.play.aborted === true).toBe(stop);
});

test('autoplay includes a decoded BGM tail in the deadline tested at reversal', async () => {
  const chart = parseChart('#BPM 120\n#BPM01 -120\n#WAV01 music.wav\n#00101:01\n#00208:01', 'bms');
  const play = await observePlay({
    driver: 'auto',
    chart,
    audio: false,
    options: { loadAudioSampleDurations: async () => new Map([['01', 5]]) },
    script: [command(9000, { kind: 'interrupt', reason: 'escape' })],
  });
  expect(play.endedAtMs).toBeGreaterThanOrEqual(9000);
  expect(play.replay?.play.completedAtReversal).toBeUndefined();
});

test('the clock equaling the song deadline on activation leaves the stage open', async () => {
  // The tap is at 1 s, so its LR2 song deadline is 3 s. The event at 2.5 s fires on the 3 s audio tick.
  const chart = parseChart('#BPM 120\n#BPM01 -120\n#00011:0001\n#00108:00010000', 'bms');
  const play = await observePlay({
    driver: 'manual',
    chart,
    audio: { clock: true, quantumMs: 1000 },
    script: [command(7000, { kind: 'interrupt', reason: 'escape' })],
  });
  expect(play.replay!.chart.reversalActivationUs).toBe(3_000_000);
  expect(play.replay!.play.exitedReversal).toBe(true);
  expect(play.replay!.play.completedAtReversal).toBeUndefined();
});
