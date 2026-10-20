import { describe, expect, test } from 'vite-plus/test';
import {
  clampHiSpeed,
  clampShutter,
  cyclePlayOptionValue,
  DEFAULT_PLAY_OPTIONS,
  isListPlayOption,
  nextChoice,
  PLAY_OPTION_CHOICES,
  resolvePlayOptions,
  resolvePlayOptionValue,
  SHUTTER_DEFAULT,
} from './choices.ts';
import { DEFAULT_HISPEED, HISPEED_MAX, HISPEED_MIN } from './hi-speed.ts';
import type { PlayOptions } from './options.ts';

describe('DEFAULT_PLAY_OPTIONS', () => {
  test('seeds LR2-style visual options for the first play', () => {
    expect(DEFAULT_PLAY_OPTIONS.hiSpeed).toBe(DEFAULT_HISPEED);
    expect(DEFAULT_PLAY_OPTIONS.hiSpeed).toBe(2.0);
    expect(DEFAULT_PLAY_OPTIONS.bga).toBe('ON');
    expect(DEFAULT_PLAY_OPTIONS.bgaSize).toBe('EXTEND');
    expect(DEFAULT_PLAY_OPTIONS.scoreGraph).toBe(true);
    expect(DEFAULT_PLAY_OPTIONS.shutter).toBe(SHUTTER_DEFAULT);
    expect(DEFAULT_PLAY_OPTIONS.gauge1P).toBe('GROOVE');
    expect(DEFAULT_PLAY_OPTIONS.gauge2P).toBe('GROOVE');
  });

  test('offers a value of each option with choices among them', () => {
    for (const [key, choices] of Object.entries(PLAY_OPTION_CHOICES)) {
      expect(choices).toContain(DEFAULT_PLAY_OPTIONS[key as keyof PlayOptions]);
    }
  });
});

describe('resolvePlayOptionValue', () => {
  test("accepts a value from the option's choices", () => {
    expect(resolvePlayOptionValue('random1P', 'MIRROR')).toBe('MIRROR');
    expect(resolvePlayOptionValue('autoScratch1P', true)).toBe(true);
    expect(resolvePlayOptionValue('sort', 'LEVEL')).toBe('LEVEL');
  });

  test("rejects a value outside the option's choices", () => {
    expect(resolvePlayOptionValue('random1P', 'R-RANDOM')).toBeUndefined();
    expect(resolvePlayOptionValue('autoScratch1P', 1)).toBeUndefined();
    expect(resolvePlayOptionValue('gauge1P', undefined)).toBeUndefined();
    // beatoraja's own sorts and key modes are not on the LR2 buttons a skin cycles.
    expect(resolvePlayOptionValue('sort', 'ARTIST')).toBeUndefined();
  });

  test('clamps the numeric options and rejects non-finite or non-numeric values', () => {
    expect(resolvePlayOptionValue('hiSpeed', 99)).toBe(HISPEED_MAX);
    expect(resolvePlayOptionValue('hiSpeed', 2.5)).toBe(2.5);
    expect(resolvePlayOptionValue('shutter', -1)).toBe(0);
    expect(resolvePlayOptionValue('shutter', Number.NaN)).toBeUndefined();
    expect(resolvePlayOptionValue('hiSpeed', '3')).toBeUndefined();
  });

  test('rejects keys that are not play options', () => {
    // Skins are plain JavaScript at runtime: an unknown key must not grow the play-option object.
    expect(resolvePlayOptionValue('bogus' as keyof PlayOptions, 3)).toBeUndefined();
    expect(resolvePlayOptionValue('toString' as keyof PlayOptions, 3)).toBeUndefined();
  });
});

describe('cyclePlayOptionValue', () => {
  test('moves forward and wraps past the last choice', () => {
    expect(cyclePlayOptionValue('gauge1P', 'GROOVE')).toBe('HARD');
    expect(cyclePlayOptionValue('gauge1P', 'EASY', 1)).toBe('GROOVE');
    expect(cyclePlayOptionValue('dpFlip', false)).toBe(true);
  });

  test('moves backwards with a negative step and wraps past the first choice', () => {
    expect(cyclePlayOptionValue('gauge1P', 'HARD', -1)).toBe('GROOVE');
    expect(cyclePlayOptionValue('gauge1P', 'GROOVE', -1)).toBe('EASY');
    expect(cyclePlayOptionValue('random1P', 'OFF', -1)).toBe('SCATTER');
  });

  test('treats any other step as one choice in its direction', () => {
    expect(cyclePlayOptionValue('gauge1P', 'GROOVE', 3)).toBe('HARD');
    expect(cyclePlayOptionValue('gauge1P', 'GROOVE', -5)).toBe('EASY');
  });

  test('lands on the first choice when the current value is not one of them', () => {
    expect(cyclePlayOptionValue('bga', 'BOGUS' as PlayOptions['bga'])).toBe('OFF');
  });

  test('leaves numeric options and unknown keys alone', () => {
    expect(cyclePlayOptionValue('hiSpeed', DEFAULT_PLAY_OPTIONS.hiSpeed)).toBeUndefined();
    expect(cyclePlayOptionValue('shutter', DEFAULT_PLAY_OPTIONS.shutter, -1)).toBeUndefined();
    expect(cyclePlayOptionValue('bogus' as keyof PlayOptions, 0 as never)).toBeUndefined();
  });
});

describe('nextChoice', () => {
  test('cycles any list of choices either way', () => {
    expect(nextChoice(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextChoice(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(nextChoice(['a', 'b'], 'z')).toBe('a');
  });
});

describe('clampHiSpeed / clampShutter', () => {
  test('snap and clamp, falling back to the default for non-finite input', () => {
    expect(clampHiSpeed(0)).toBe(HISPEED_MIN);
    expect(clampHiSpeed(Number.POSITIVE_INFINITY)).toBe(DEFAULT_HISPEED);
    expect(clampShutter(0.30000000000000004)).toBe(0.3);
    expect(clampShutter(2)).toBe(1);
    expect(clampShutter(Number.NaN)).toBe(SHUTTER_DEFAULT);
  });
});

describe('isListPlayOption', () => {
  test('names the options that change the bar list', () => {
    expect(isListPlayOption('sort')).toBe(true);
    expect(isListPlayOption('keysFilter')).toBe(true);
    expect(isListPlayOption('difficultyFilter')).toBe(true);
    expect(isListPlayOption('gauge1P')).toBe(false);
  });
});

describe('resolvePlayOptions', () => {
  test('fills what a host stored over the defaults, keeping only valid values', () => {
    const options = resolvePlayOptions({ hiSpeed: 3.25, random1P: 'MIRROR', gauge1P: 'BOGUS', shutter: 'x' });
    expect(options).toEqual({ ...DEFAULT_PLAY_OPTIONS, hiSpeed: 3.25, random1P: 'MIRROR' });
  });

  test('returns the defaults, as a copy, for nothing stored', () => {
    const options = resolvePlayOptions();
    expect(options).toEqual(DEFAULT_PLAY_OPTIONS);
    expect(options).not.toBe(DEFAULT_PLAY_OPTIONS);
  });
});
