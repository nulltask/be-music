import { describe, expect, test } from 'vite-plus/test';
import {
  choiceIndex,
  constrainNumber,
  displayText,
  formatNumber,
  graphPoints,
  sliderFill,
  stepDecimals,
  toChoices,
} from './options-values.ts';

describe('stepDecimals', () => {
  test('counts the decimals of a step, written plainly or with an exponent', () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(5)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.01)).toBe(2);
    expect(stepDecimals(0.001)).toBe(3);
    expect(stepDecimals(1e-7)).toBe(7);
    expect(stepDecimals(1.5e-7)).toBe(8);
  });

  test('is 0 without a usable step', () => {
    expect(stepDecimals(undefined)).toBe(0);
    expect(stepDecimals(0)).toBe(0);
    expect(stepDecimals(-1)).toBe(0);
    expect(stepDecimals(Number.NaN)).toBe(0);
  });
});

describe('constrainNumber', () => {
  test('puts a value on the grid of its step, counted from 0, without float noise', () => {
    expect(constrainNumber(2.2458, { step: 0.01 })).toBe(2.25);
    expect(constrainNumber(0.1 + 0.2, { step: 0.1 })).toBe(0.3);
    expect(constrainNumber(7, { min: 0, max: 1000, step: 5 })).toBe(5);
    expect(constrainNumber(-12.5, { step: 0.5 })).toBe(-12.5);
  });

  test('keeps a value inside its range after snapping it', () => {
    expect(constrainNumber(-600, { min: -500, max: 500, step: 1 })).toBe(-500);
    expect(constrainNumber(1200, { min: 0, max: 1000 })).toBe(1000);
    expect(constrainNumber(20, { min: 25, max: 400, step: 1 })).toBe(25);
  });

  test('leaves a value with no limits as it is, and refuses one that is not a finite number', () => {
    expect(constrainNumber(3.14159, {})).toBe(3.14159);
    expect(constrainNumber(Number.NaN, { min: 0 })).toBeUndefined();
    expect(constrainNumber(Number.POSITIVE_INFINITY, {})).toBeUndefined();
  });

  test('never gives -0', () => {
    expect(Object.is(constrainNumber(-0.001, { step: 0.01 }), 0)).toBe(true);
  });
});

test('formatNumber prints with the step’s decimals', () => {
  expect(formatNumber(2.5, 0.01)).toBe('2.50');
  expect(formatNumber(3, 1)).toBe('3');
  expect(formatNumber(0.125, undefined)).toBe('0.125');
  expect(formatNumber(Number.NaN, 1)).toBe('');
});

test('displayText shows strings, numbers and booleans, and nothing for anything else', () => {
  expect(displayText('Loading…')).toBe('Loading…');
  expect(displayText(-1)).toBe('-1');
  expect(displayText(false)).toBe('false');
  expect(displayText(undefined)).toBe('');
  expect(displayText(null)).toBe('');
  expect(displayText({ text: 'x' })).toBe('');
});

test('sliderFill gives how far along the range a value sits, clamped', () => {
  expect(sliderFill(50, 0, 100)).toBe('50%');
  expect(sliderFill(-50, -50, 50)).toBe('0%');
  expect(sliderFill(1, 0, 3)).toBe('33.33%');
  expect(sliderFill(200, 0, 100)).toBe('100%');
  expect(sliderFill(5, 10, 10)).toBe('0%');
});

test('choiceIndex finds the choice standing for a value, or -1', () => {
  const choices = toChoices({ Off: 0, Auto: -1, On: 1 });
  expect(choiceIndex(choices, -1)).toBe(1);
  expect(choiceIndex(choices, 1)).toBe(2);
  expect(choiceIndex(choices, '1')).toBe(-1);
  expect(choiceIndex(toChoices(['lr2', 'intended']), 'intended')).toBe(1);
});

test('toChoices labels array values by themselves and record values by their keys', () => {
  expect(toChoices([0, 0.5])).toEqual([
    { text: '0', value: 0 },
    { text: '0.5', value: 0.5 },
  ]);
  expect(toChoices({ 'Pitch follows tempo (LR2)': 'pitch' })).toEqual([
    { text: 'Pitch follows tempo (LR2)', value: 'pitch' },
  ]);
});

describe('graphPoints', () => {
  const view = { min: 0, max: 240, width: 100, height: 32 };

  test('spreads the samples over the width and draws them up from the bottom', () => {
    expect(graphPoints([0, 120, 240], view, 3)).toBe('0,32 50,16 100,0');
  });

  test('clamps out-of-range samples and draws a sample that is not a number at the bottom', () => {
    expect(graphPoints([300, -10, Number.NaN], view, 3)).toBe('0,0 50,32 100,32');
  });

  test('draws nothing without samples, and one sample at the left edge', () => {
    expect(graphPoints([], view, 60)).toBe('');
    expect(graphPoints([60], view, 1)).toBe('0,24');
  });
});
