import { expect, test } from 'vite-plus/test';
import { isIIDXArcadeGamepad, sampleArcadeScratch } from './arcade-gamepad.ts';

test('recognizes INFINITAS HID IDs and the PHOENIXWAN product name', () => {
  const pad = { id: '', mapping: '' as const, axes: [0, 0], buttons: Array<GamepadButton>(16) };
  expect(isIIDXArcadeGamepad({ ...pad, id: 'Gamepad (Vendor: 1ccf Product: 8048)' })).toBe(true);
  expect(isIIDXArcadeGamepad({ ...pad, id: '1ccf-8048-Gamepad' })).toBe(true);
  expect(isIIDXArcadeGamepad({ ...pad, id: 'Controller INF&BMS' })).toBe(true);
  expect(isIIDXArcadeGamepad({ ...pad, id: 'Gamepad (Vendor: 1ccf Product: 0001)' })).toBe(false);
  expect(isIIDXArcadeGamepad({ ...pad, id: '1ccf-8048-Gamepad', mapping: 'standard' })).toBe(false);
});

test('converts wrapping encoder movement to a held direction and releases when it stops', () => {
  const axis = (tick: number): number => tick / 127.5 - 1;
  const initial = sampleArcadeScratch(axis(254), 0);
  expect(initial?.direction).toBeUndefined();
  expect(sampleArcadeScratch(axis(255), 4, initial)?.direction).toBeUndefined();
  const forward = sampleArcadeScratch(axis(1), 8, initial);
  expect(forward?.direction).toBe('up');
  const backward = sampleArcadeScratch(axis(254), 12, forward);
  expect(backward?.direction).toBe('down');
  expect(sampleArcadeScratch(axis(254), 111, backward)?.direction).toBe('down');
  expect(sampleArcadeScratch(axis(254), 112, backward)?.direction).toBeUndefined();
});
