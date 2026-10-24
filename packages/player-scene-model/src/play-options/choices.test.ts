import { describe, expect, test } from 'vite-plus/test';
import {
  resolveRandomModes,
  RANDOM_CYCLE,
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
    expect(resolvePlayOptionValue('random1P', 'UNKNOWN')).toBeUndefined();
    expect(resolvePlayOptionValue('random1P', 'SCATTER')).toBeUndefined();
    expect(resolvePlayOptionValue('random2P', 'SCATTER')).toBeUndefined();
    expect(resolvePlayOptions({ random1P: 'SCATTER', random2P: 'SCATTER' })).toMatchObject({
      random1P: 'OFF',
      random2P: 'OFF',
    });
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
    expect(cyclePlayOptionValue('random1P', 'OFF', -1)).toBe('S-RANDOM');
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

test('START BPM is selectable and preserved by option validation', () => {
  expect(PLAY_OPTION_CHOICES.hsFix).toContain('STARTBPM');
  expect(resolvePlayOptions({ hsFix: 'STARTBPM' }).hsFix).toBe('STARTBPM');
});

test('offers the three confirmed beatoraja launcher algorithms only', () => {
  for (const algorithm of ['combo', 'duration', 'lowest']) {
    expect(resolvePlayOptionValue('judgeAlgorithm', algorithm)).toBe(algorithm);
  }
  expect(resolvePlayOptionValue('judgeAlgorithm', 'score')).toBeUndefined();
});

test('R-RANDOM is a source choice without changing LR2 button indices', () => {
  expect(RANDOM_CYCLE).toEqual(['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM']);
  expect(resolveRandomModes('lr2')).not.toContain('R-RANDOM');
  for (const source of ['beatoraja', '____'] as const) expect(resolveRandomModes(source)).toContain('R-RANDOM');
  expect(resolvePlayOptions({ random1P: 'R-RANDOM', random2P: 'R-RANDOM' })).toMatchObject({
    random1P: 'R-RANDOM',
    random2P: 'R-RANDOM',
  });
});

test('SPIRAL is a beatoraja choice only', () => {
  expect(resolveRandomModes('beatoraja')).toContain('SPIRAL');
  expect(resolveRandomModes('____')).not.toContain('SPIRAL');
  expect(resolveRandomModes('lr2')).not.toContain('SPIRAL');
  expect(resolvePlayOptionValue('random1P', 'SPIRAL')).toBe('SPIRAL');
});

test('H-RANDOM is beatoraja-only and the source threshold is validated', () => {
  expect(resolveRandomModes('beatoraja')).toContain('H-RANDOM');
  expect(resolveRandomModes('lr2')).not.toContain('H-RANDOM');
  expect(resolveRandomModes('____')).not.toContain('H-RANDOM');
  expect(resolvePlayOptionValue('hRandomThresholdBPM', 0)).toBe(1);
  expect(resolvePlayOptionValue('hRandomThresholdBPM', 2000)).toBe(1000);
  expect(DEFAULT_PLAY_OPTIONS.hRandomThresholdBPM).toBe(120);
});

test('LR2 CONVERGE and fixed-lane source settings are selectable and validated', () => {
  expect(resolveRandomModes('lr2')).toContain('CONVERGE');
  expect(resolveRandomModes('beatoraja')).toContain('CONVERGE');
  expect(resolveRandomModes('____')).not.toContain('CONVERGE');
  expect(resolvePlayOptions({ random1P: 'CONVERGE', randomFixedLane1P: 4, randomFixedLane2P: 0 })).toMatchObject({
    random1P: 'CONVERGE',
    randomFixedLane1P: 4,
    randomFixedLane2P: 0,
  });
  expect(resolvePlayOptionValue('randomFixedLane1P', 10)).toBe(9);
  expect(resolvePlayOptionValue('randomFixedLane2P', Number.NaN)).toBe(0);
});

test('ALL-SCR is selectable only for the beatoraja reference', () => {
  expect(resolveRandomModes('beatoraja')).toContain('ALL-SCR');
  expect(resolveRandomModes('lr2')).not.toContain('ALL-SCR');
  expect(resolveRandomModes('____')).not.toContain('ALL-SCR');
  expect(resolvePlayOptions({ random1P: 'ALL-SCR', random2P: 'ALL-SCR' })).toMatchObject({
    random1P: 'ALL-SCR',
    random2P: 'ALL-SCR',
  });
});

test('RANDOM-EX is a separate beatoraja option', () => {
  expect(resolveRandomModes('beatoraja')).toContain('RANDOM-EX');
  expect(resolveRandomModes('lr2')).not.toContain('RANDOM-EX');
  expect(resolveRandomModes('____')).not.toContain('RANDOM-EX');
  expect(resolvePlayOptionValue('random1P', 'RANDOM-EX')).toBe('RANDOM-EX');
});

test('PMS RANDOM_PLAYABLE uses the source option name and survives validation', () => {
  expect(resolveRandomModes('beatoraja')).toContain('RANDOM_PLAYABLE');
  expect(resolveRandomModes('lr2')).not.toContain('RANDOM_PLAYABLE');
  expect(resolveRandomModes('____')).not.toContain('RANDOM_PLAYABLE');
  expect(resolvePlayOptionValue('random1P', 'RANDOM_PLAYABLE')).toBe('RANDOM_PLAYABLE');
});

test('PMS S_RANDOM_PLAYABLE preserves the source option name', () => {
  expect(resolveRandomModes('beatoraja')).toContain('S_RANDOM_PLAYABLE');
  expect(resolveRandomModes('lr2')).not.toContain('S_RANDOM_PLAYABLE');
  expect(resolveRandomModes('____')).not.toContain('S_RANDOM_PLAYABLE');
  expect(resolvePlayOptionValue('random1P', 'S_RANDOM_PLAYABLE')).toBe('S_RANDOM_PLAYABLE');
});

test('S-RANDOM-EX is a separate beatoraja option', () => {
  expect(resolveRandomModes('beatoraja')).toContain('S-RANDOM-EX');
  expect(resolveRandomModes('lr2')).not.toContain('S-RANDOM-EX');
  expect(resolveRandomModes('____')).not.toContain('S-RANDOM-EX');
  expect(resolvePlayOptionValue('random1P', 'S-RANDOM-EX')).toBe('S-RANDOM-EX');
});

test('beatoraja seed settings retain Java-long precision and reject invalid edits', () => {
  expect(DEFAULT_PLAY_OPTIONS.randomSeed1P).toBe('-1');
  expect(resolvePlayOptionValue('randomSeed1P', '9223372036854775807')).toBe('9223372036854775807');
  expect(resolvePlayOptionValue('randomSeed2P', 42)).toBe('42');
  expect(resolvePlayOptionValue('randomSeed1P', '9223372036854775808')).toBeUndefined();
});

test('mine REMOVE is a separate source option from invisible-note or graphics settings', () => {
  expect(DEFAULT_PLAY_OPTIONS.mineModifier).toBe('OFF');
  expect(resolvePlayOptionValue('mineModifier', 'REMOVE')).toBe('REMOVE');
  expect(resolvePlayOptionValue('mineModifier', 'HIDE')).toBeUndefined();
});

test('mine ADD RANDOM is an independent selectable source modifier', () => {
  expect(resolvePlayOptionValue('mineModifier', 'ADD_RANDOM')).toBe('ADD_RANDOM');
});

test('mine ADD NEAR is selectable by its source name', () => {
  expect(resolvePlayOptionValue('mineModifier', 'ADD_NEAR')).toBe('ADD_NEAR');
});

test('mine ADD ALL retains the source ADD_BLANK identifier', () => {
  expect(resolvePlayOptionValue('mineModifier', 'ADD_BLANK')).toBe('ADD_BLANK');
  expect(resolvePlayOptionValue('mineModifier', 'ADD_ALL')).toBeUndefined();
});

test('gauge auto-shift defaults to source NONE and accepts CONTINUE', () => {
  expect(DEFAULT_PLAY_OPTIONS.gaugeAutoShift).toBe('NONE');
  expect(resolvePlayOptionValue('gaugeAutoShift', 'CONTINUE')).toBe('CONTINUE');
  expect(resolvePlayOptionValue('gaugeAutoShift', 'REVIVE')).toBeUndefined();
});
