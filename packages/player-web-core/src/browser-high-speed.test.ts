import { describe, expect, test } from 'vitest';
import {
  decreaseBrowserHighSpeed,
  formatBrowserHighSpeed,
  increaseBrowserHighSpeed,
  normalizeBrowserHighSpeed,
} from './browser-high-speed.ts';

describe('player-web-core browser high speed', () => {
  test('normalizes high speed to 0.5 steps within the allowed range', () => {
    expect(normalizeBrowserHighSpeed(undefined)).toBe(1);
    expect(normalizeBrowserHighSpeed(0.2)).toBe(0.5);
    expect(normalizeBrowserHighSpeed(1.24)).toBe(1);
    expect(normalizeBrowserHighSpeed(1.26)).toBe(1.5);
    expect(normalizeBrowserHighSpeed(10.7)).toBe(10);
  });

  test('increments and decrements in 0.5 steps', () => {
    expect(increaseBrowserHighSpeed(1)).toBe(1.5);
    expect(decreaseBrowserHighSpeed(1)).toBe(0.5);
    expect(increaseBrowserHighSpeed(10)).toBe(10);
  });

  test('formats high speed consistently', () => {
    expect(formatBrowserHighSpeed(1)).toBe('1.0');
    expect(formatBrowserHighSpeed(3.5)).toBe('3.5');
  });
});
