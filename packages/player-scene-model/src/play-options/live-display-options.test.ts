import { expect, test } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS } from './choices.ts';
import { LIVE_DISPLAY_PLAY_OPTION_KEYS, pickLiveDisplayPlayOptions } from './live-display-options.ts';

test('every live display option is a play option', () => {
  for (const key of LIVE_DISPLAY_PLAY_OPTION_KEYS) expect(Object.hasOwn(DEFAULT_PLAY_OPTIONS, key)).toBe(true);
  expect(new Set(LIVE_DISPLAY_PLAY_OPTION_KEYS).size).toBe(LIVE_DISPLAY_PLAY_OPTION_KEYS.length);
});

test('picks the display options a running play follows, and leaves the rest', () => {
  expect(pickLiveDisplayPlayOptions({ laneBrightness: 40, judgeDisplay: 'OFF', gauge1P: 'HARD' })).toEqual({
    laneBrightness: 40,
    judgeDisplay: 'OFF',
  });
  expect(pickLiveDisplayPlayOptions({ lr2Tornado: 60, showJudgeArea: true, scoreTarget: 'MAX' })).toEqual({
    lr2Tornado: 60,
    showJudgeArea: true,
    scoreTarget: 'MAX',
  });
});

test('gives nothing for options read at the start of a play, and drops an invalid value', () => {
  // Options that change the chart, the judgment or the record are not live.
  expect(
    pickLiveDisplayPlayOptions({ random1P: 'MIRROR', lr2AddNotes: 50, lr2Gambol: 1, bpmGuide: true }),
  ).toBeUndefined();
  expect(pickLiveDisplayPlayOptions({})).toBeUndefined();
  expect(pickLiveDisplayPlayOptions({ laneBrightness: 45 })).toBeUndefined();
  expect(pickLiveDisplayPlayOptions({ judgeDisplay: 'UP' as never, lr2Wave: 20 })).toEqual({ lr2Wave: 20 });
});
