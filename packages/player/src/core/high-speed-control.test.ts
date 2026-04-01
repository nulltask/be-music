import { describe, expect, test } from 'vitest';
import {
  applyHighSpeedControlAction,
  DEFAULT_HIGH_SPEED,
  MAX_HIGH_SPEED,
  MIN_HIGH_SPEED,
  resolveHighSpeedControlActionFromLaneChannels,
  resolveHighSpeedMultiplier,
} from './high-speed-control.ts';

describe('high-speed control', () => {
  test('resolveHighSpeedControlActionFromLaneChannels handles normalized, trimmed, and invalid channels', () => {
    expect(resolveHighSpeedControlActionFromLaneChannels(['11'])).toBe('decrease');
    expect(resolveHighSpeedControlActionFromLaneChannels(['12'])).toBe('increase');
    expect(resolveHighSpeedControlActionFromLaneChannels([' 1a '])).toBe('increase');
    expect(resolveHighSpeedControlActionFromLaneChannels(['2Z'])).toBe('decrease');
    expect(resolveHighSpeedControlActionFromLaneChannels(['xx', ''])).toBeUndefined();
    expect(resolveHighSpeedControlActionFromLaneChannels(['11', '12'])).toBeUndefined();
  });

  test('resolveHighSpeedMultiplier falls back, clamps, and rounds to the configured step', () => {
    expect(resolveHighSpeedMultiplier(undefined)).toBe(DEFAULT_HIGH_SPEED);
    expect(resolveHighSpeedMultiplier(Number.NaN)).toBe(DEFAULT_HIGH_SPEED);
    expect(resolveHighSpeedMultiplier(0)).toBe(DEFAULT_HIGH_SPEED);
    expect(resolveHighSpeedMultiplier(0.74)).toBe(MIN_HIGH_SPEED);
    expect(resolveHighSpeedMultiplier(1.24)).toBe(1);
    expect(resolveHighSpeedMultiplier(1.26)).toBe(1.5);
    expect(resolveHighSpeedMultiplier(99)).toBe(MAX_HIGH_SPEED);
  });

  test('applyHighSpeedControlAction uses safe defaults and respects bounds', () => {
    expect(applyHighSpeedControlAction(Number.NaN, 'increase')).toBe(1.5);
    expect(applyHighSpeedControlAction(Infinity, 'decrease')).toBe(0.5);
    expect(applyHighSpeedControlAction(MIN_HIGH_SPEED, 'decrease')).toBe(MIN_HIGH_SPEED);
    expect(applyHighSpeedControlAction(MAX_HIGH_SPEED, 'increase')).toBe(MAX_HIGH_SPEED);
    expect(applyHighSpeedControlAction(1, 'increase')).toBe(1.5);
    expect(applyHighSpeedControlAction(1, 'decrease')).toBe(0.5);
  });
});
