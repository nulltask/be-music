import { expect, test, vi } from 'vite-plus/test';
import { createJudgeEffectHandler } from './engine-effects.ts';
import type { JudgeTimingAutoAdjust } from './judge-timing.ts';

function setup(mode: JudgeTimingAutoAdjust = 'BEATORAJA') {
  const recordOptionChange = vi.fn();
  const pushCommand = vi.fn();
  const publishJudgeCombo = vi.fn();
  const timing = { mode, value: 500, currentSeconds: () => 2 };
  const effect = createJudgeEffectHandler({
    judgeTiming: timing,
    uiEnabled: true,
    writeOutput() {},
    wavResources: {},
    idBase: 36,
    audioSession: undefined,
    playbackStateLogger: {} as never,
    playbackEventTracer: {} as never,
    uiSignals: { pushCommand } as never,
    activeStateSignals: { publishJudgeCombo } as never,
    replayRecorder: { recordOptionChange } as never,
    publishUIFrame() {},
    beatAtSeconds: () => 0,
  });
  return {
    timing,
    effect,
    settleJudgeTiming: () => effect.settleJudgeTiming(),
    recordOptionChange,
    pushCommand,
    publishJudgeCombo,
  };
}

test('records every accepted calibration before publishing it, including several hits in one frame', () => {
  const play = setup();
  play.effect({ kind: 'judge-combo', seconds: 1.9, judge: 'GOOD', combo: 1, channel: '16', signedDeltaMs: 150 });
  play.effect({ kind: 'judge-combo', seconds: 1.95, judge: 'GREAT', combo: 2, channel: '11', signedDeltaMs: -45 });
  expect(play.recordOptionChange.mock.calls).toEqual([
    [2, { judgeTimingMs: 505 }],
    [2, { judgeTimingMs: 503 }],
  ]);
  expect(play.pushCommand.mock.calls).toEqual([
    [{ kind: 'judge-timing', value: 505 }],
    [{ kind: 'judge-timing', value: 503 }],
  ]);
  expect(play.timing.value).toBe(503);
  expect(play.publishJudgeCombo).toHaveBeenCalledTimes(2);
  // A later manual adjustment is the next sample's base.
  play.timing.value = -10;
  play.effect({ kind: 'judge-combo', seconds: 2, judge: 'PERFECT', combo: 3, signedDeltaMs: 15 });
  expect(play.timing.value).toBe(-9);
});

test('disabled calibration and judgments without samples publish normally without option changes', () => {
  const disabled = setup('OFF');
  disabled.effect({ kind: 'judge-combo', seconds: 2, judge: 'GREAT', combo: 1, signedDeltaMs: 90 });
  const auto = setup();
  auto.effect({ kind: 'judge-combo', judge: 'PERFECT', combo: 1 });
  auto.effect({ kind: 'judge-combo', seconds: 2, judge: 'BAD', combo: 0, signedDeltaMs: 100 });
  expect(disabled.recordOptionChange).not.toHaveBeenCalled();
  expect(auto.recordOptionChange).not.toHaveBeenCalled();
  expect(auto.publishJudgeCombo).toHaveBeenCalledTimes(2);
});

test('LR2 steps 1 ms once a pass ends with more than nine sampled hits, and records the step', () => {
  const play = setup('LR2-ON');
  play.timing.value = 0;
  const hit = (judge: string, signedDeltaMs: number, longNote = false) =>
    play.effect({ kind: 'judge-combo', seconds: 1, judge, combo: 1, channel: '11', signedDeltaMs, longNote });
  for (let index = 0; index < 9; index += 1) hit(index % 2 === 0 ? 'GOOD' : 'BAD', 30);
  // Long notes, misses and empty POORs are not sampled, nor is a hit without an offset.
  hit('PERFECT', 50, true);
  hit('POOR', 200);
  play.effect({ kind: 'judge-combo', judge: 'POOR', combo: 0 });
  play.settleJudgeTiming();
  expect(play.timing.value).toBe(0);
  // Every hit of the pass counts before the step: the tenth and the eleventh are in one window.
  hit('GREAT', -500);
  hit('PERFECT', -1);
  expect(play.timing.value).toBe(0);
  play.settleJudgeTiming();
  expect(play.timing.value).toBe(-1);
  expect(play.recordOptionChange.mock.calls).toEqual([[2, { judgeTimingMs: -1 }]]);
  expect(play.pushCommand.mock.calls).toEqual([[{ kind: 'judge-timing', value: -1 }]]);
  // The window starts over after a step.
  for (let index = 0; index < 9; index += 1) hit('PERFECT', 5);
  play.settleJudgeTiming();
  expect(play.timing.value).toBe(-1);
  hit('PERFECT', 5);
  play.settleJudgeTiming();
  expect(play.timing.value).toBe(0);
});

test('LR2 SILENT adjusts as ON does, and OFF and beatoraja take no LR2 step', () => {
  const silent = setup('LR2-SILENT');
  for (let index = 0; index < 10; index += 1)
    silent.effect({ kind: 'judge-combo', seconds: 1, judge: 'GREAT', combo: 1, signedDeltaMs: 20 });
  silent.settleJudgeTiming();
  expect(silent.timing.value).toBe(501);
  for (const mode of ['OFF', 'BEATORAJA'] as const) {
    const play = setup(mode);
    for (let index = 0; index < 10; index += 1)
      play.effect({ kind: 'judge-combo', seconds: 1, judge: 'BAD', combo: 0, signedDeltaMs: 20 });
    play.settleJudgeTiming();
    expect(play.timing.value).toBe(500);
  }
});
