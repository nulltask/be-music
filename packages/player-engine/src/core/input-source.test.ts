import { describe, expect, test } from 'vite-plus/test';
import {
  createInputSourceTable,
  endsBackSpinScratch,
  hasScratchCounterpart,
  inputSourceKey,
  isInputSourceDeviceName,
  normalizeInputSourceDeviceName,
  releasesScratchHold,
  type InputSource,
} from './input-source.ts';

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

describe('device names', () => {
  const padName = 'IIDX controller (STANDARD GAMEPAD Vendor: 1ccf Product: 1018)';
  const named: InputSource = { ...ttUp, deviceName: padName };

  test('are not part of a source’s identity', () => {
    expect(inputSourceKey(named)).toBe(inputSourceKey(ttUp));
    expect(endsBackSpinScratch(named, ttUp)).toBe(false);
    expect(releasesScratchHold(named, { ...ttUp, deviceName: 'another pad' })).toBe(true);
  });

  test('a table drops them unless it keeps device names', () => {
    const plain = createInputSourceTable();
    plain.idOf(named);
    expect(plain.list()).toEqual([{ id: 0, kind: 'turntable', device: 'controller', label: 'tt', direction: 'up' }]);

    const kept = createInputSourceTable({ deviceNames: true });
    expect(kept.idOf(named)).toBe(0);
    // The same source from another pad is the same entry, which keeps the name it was first seen with.
    expect(kept.idOf({ ...ttUp, deviceName: 'another pad' })).toBe(0);
    expect(kept.idOf(shift)).toBe(1);
    expect(kept.list()).toEqual([
      { id: 0, kind: 'turntable', device: 'controller', label: 'tt', direction: 'up', deviceName: padName },
      { id: 1, kind: 'key', device: 'keyboard', label: 'shift-left' },
    ]);
  });

  test('are normalised: control characters removed, trimmed, cut to 128 characters', () => {
    expect(normalizeInputSourceDeviceName(padName)).toBe(padName);
    expect(normalizeInputSourceDeviceName('  pad\u0000 name\n ')).toBe('pad name');
    expect(normalizeInputSourceDeviceName('x'.repeat(200))).toBe('x'.repeat(128));
    expect(normalizeInputSourceDeviceName(' \t ')).toBeUndefined();
    expect(normalizeInputSourceDeviceName(undefined)).toBeUndefined();
  });

  test('a kept name has 1 to 128 characters, no control characters and no surrounding spaces', () => {
    expect(isInputSourceDeviceName(padName)).toBe(true);
    expect(isInputSourceDeviceName('x'.repeat(128))).toBe(true);
    expect(isInputSourceDeviceName('x'.repeat(129))).toBe(false);
    expect(isInputSourceDeviceName('')).toBe(false);
    expect(isInputSourceDeviceName(' pad')).toBe(false);
    expect(isInputSourceDeviceName('pad\u0007')).toBe(false);
    expect(isInputSourceDeviceName(42)).toBe(false);
  });
});
