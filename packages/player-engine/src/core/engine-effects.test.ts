import { expect, test, vi } from 'vite-plus/test';
import { createJudgeEffectHandler } from './engine-effects.ts';

function setup(enabled = true) {
  const recordOptionChange = vi.fn();
  const pushCommand = vi.fn();
  const publishJudgeCombo = vi.fn();
  const timing = { enabled, value: 500, currentSeconds: () => 2 };
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
  return { timing, effect, recordOptionChange, pushCommand, publishJudgeCombo };
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
  const disabled = setup(false);
  disabled.effect({ kind: 'judge-combo', seconds: 2, judge: 'GREAT', combo: 1, signedDeltaMs: 90 });
  const auto = setup();
  auto.effect({ kind: 'judge-combo', judge: 'PERFECT', combo: 1 });
  auto.effect({ kind: 'judge-combo', seconds: 2, judge: 'BAD', combo: 0, signedDeltaMs: 100 });
  expect(disabled.recordOptionChange).not.toHaveBeenCalled();
  expect(auto.recordOptionChange).not.toHaveBeenCalled();
  expect(auto.publishJudgeCombo).toHaveBeenCalledTimes(2);
});
