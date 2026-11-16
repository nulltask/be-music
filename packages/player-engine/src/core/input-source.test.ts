import { describe, expect, test } from 'vite-plus/test';
import { endsBackSpinScratch, hasScratchCounterpart, releasesScratchHold, type InputSource } from './input-source.ts';

const shift: InputSource = { kind: 'key', device: 'keyboard', label: 'shift-left' };
const ctrl: InputSource = { kind: 'key', device: 'keyboard', label: 'control-left' };
const ttUp: InputSource = { kind: 'turntable', device: 'controller', label: 'tt', direction: 'up' };
const ttDown: InputSource = { kind: 'turntable', device: 'controller', label: 'tt', direction: 'down' };
const touch: InputSource = { kind: 'button', device: 'touch', label: 'scratch' };
const button: InputSource = { kind: 'button', device: 'controller', label: 'b8' };
const otherButton: InputSource = { kind: 'button', device: 'controller', label: 'b9' };

// The lenient rule for a lane only one source can press is Be-Music's input policy, not a reference behavior (ADR
// 0040, #1181): it is decided from the recorded source alone.
describe('single-source BSS policy (#1181)', () => {
  test('a turntable direction and a keyboard key have a counterpart; a touch zone, a button and no source do not', () => {
    expect(hasScratchCounterpart(ttUp)).toBe(true);
    expect(hasScratchCounterpart(shift)).toBe(true);
    expect(hasScratchCounterpart(touch)).toBe(false);
    expect(hasScratchCounterpart(button)).toBe(false);
    expect(hasScratchCounterpart(undefined)).toBe(false);
  });

  test('a strict source ends a BSS only on another source’s press', () => {
    expect(endsBackSpinScratch(shift, ctrl)).toBe(true);
    expect(endsBackSpinScratch(shift, shift)).toBe(false);
    expect(endsBackSpinScratch(ttUp, ttDown)).toBe(true);
    expect(endsBackSpinScratch(ttUp, ttUp)).toBe(false);
  });

  test('a single source ends a BSS on any fresh press, its own included', () => {
    expect(endsBackSpinScratch(touch, touch)).toBe(true);
    expect(endsBackSpinScratch(button, button)).toBe(true);
    expect(endsBackSpinScratch(undefined, shift)).toBe(true);
  });

  test('known limit: a controller button counts as single-source even with a second button on the lane', () => {
    // The kind decides, not the bindings: the button's own re-press still ends it, and so does the other button.
    expect(endsBackSpinScratch(button, button)).toBe(true);
    expect(endsBackSpinScratch(button, otherButton)).toBe(true);
  });

  test('only the head’s own source releases a scratch hold; an unknown source matches any', () => {
    expect(releasesScratchHold(shift, shift)).toBe(true);
    expect(releasesScratchHold(shift, ctrl)).toBe(false);
    expect(releasesScratchHold(ttUp, ttDown)).toBe(false);
    expect(releasesScratchHold(touch, touch)).toBe(true);
    expect(releasesScratchHold(undefined, shift)).toBe(true);
    expect(releasesScratchHold(shift, undefined)).toBe(true);
  });
});
