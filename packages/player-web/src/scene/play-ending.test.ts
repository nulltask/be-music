import { describe, expect, test } from 'vite-plus/test';
import { FAILED_FADE_OUT_MS, playEndingFadeAlpha, resolvePlayEnding, type PlayEndingInput } from './play-ending.ts';

const timing = { beatToSeconds: (beat: number) => beat * 0.5 };
const notes = [
  { beat: 4, seconds: 2 },
  { beat: 12, seconds: 6 },
];

function input(overrides: Partial<PlayEndingInput>): PlayEndingInput {
  return { summary: undefined, notes, timing, currentSeconds: 6, tempo: 1, themeFadeOutMs: 500, ...overrides };
}

const failedMidPlay = { gauge: { failedMidPlay: true } } as PlayEndingInput['summary'];

describe('resolvePlayEnding', () => {
  test('holds a finished play for the lead-out, then runs the theme fade-out with the sound left ringing', () => {
    expect(resolvePlayEnding(input({}))).toEqual({ failed: false, leadOutMs: 4000, fadeOutMs: 500, fadeAudio: false });
  });

  test('takes the lead-out in chart time: at another tempo it is 1 / tempo as long', () => {
    expect(resolvePlayEnding(input({ tempo: 2 })).leadOutMs).toBe(2000);
  });

  test('ends a play cut short by its gauge at once, fading sound and picture for at least the failed fade', () => {
    expect(resolvePlayEnding(input({ summary: failedMidPlay, currentSeconds: 3 }))).toEqual({
      failed: true,
      leadOutMs: 0,
      fadeOutMs: FAILED_FADE_OUT_MS,
      fadeAudio: true,
    });
    expect(
      resolvePlayEnding(input({ summary: failedMidPlay, currentSeconds: 3, themeFadeOutMs: 3000 })).fadeOutMs,
    ).toBe(3000);
  });

  test('ends normally when the gauge emptied but the play went on past the last note', () => {
    expect(resolvePlayEnding(input({ summary: failedMidPlay, currentSeconds: 6 })).failed).toBe(false);
  });
});

describe('playEndingFadeAlpha', () => {
  test('fades from 1 to 0 over the fade-out, and stays at 1 without one', () => {
    expect(playEndingFadeAlpha(0, 1000)).toBe(1);
    expect(playEndingFadeAlpha(250, 1000)).toBe(0.75);
    expect(playEndingFadeAlpha(2000, 1000)).toBe(0);
    expect(playEndingFadeAlpha(500, 0)).toBe(1);
  });
});
