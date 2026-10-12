import { describe, expect, test } from 'vite-plus/test';
import {
  type DeviceSignals,
  resolveDefaultSkinEffects,
  resolveDeviceProfile,
  resolvePlayLayoutMode,
} from './device-profile.ts';

const desktop: DeviceSignals = {
  coarsePointer: false,
  anyCoarsePointer: false,
  prefersReducedMotion: false,
  screenWidth: 1920,
  screenHeight: 1080,
};
const phone: DeviceSignals = {
  ...desktop,
  coarsePointer: true,
  anyCoarsePointer: true,
  screenWidth: 390,
  screenHeight: 844,
};
const tablet: DeviceSignals = { ...phone, screenWidth: 1024, screenHeight: 1366 };

describe('resolveDeviceProfile', () => {
  test('a desktop is neither touch-first nor a phone', () => {
    expect(resolveDeviceProfile(desktop)).toEqual({ touchFirst: false, phone: false });
  });

  test('a phone in either orientation is touch-first and phone-sized', () => {
    expect(resolveDeviceProfile(phone)).toEqual({ touchFirst: true, phone: true });
    expect(resolveDeviceProfile({ ...phone, screenWidth: 844, screenHeight: 390 })).toEqual({
      touchFirst: true,
      phone: true,
    });
  });

  test('a tablet is touch-first but not a phone', () => {
    expect(resolveDeviceProfile(tablet)).toEqual({ touchFirst: true, phone: false });
  });

  test('a touch laptop with a fine primary pointer stays a desktop', () => {
    expect(resolveDeviceProfile({ ...desktop, anyCoarsePointer: true })).toEqual({ touchFirst: false, phone: false });
  });

  test('a small screen without any touch pointer stays a desktop', () => {
    expect(resolveDeviceProfile({ ...desktop, screenWidth: 400, screenHeight: 300 }).touchFirst).toBe(false);
  });

  test('a phone whose primary pointer reads fine still counts through its touch pointer', () => {
    expect(resolveDeviceProfile({ ...phone, coarsePointer: false })).toEqual({ touchFirst: true, phone: true });
  });
});

describe('resolveDefaultSkinEffects', () => {
  test('keeps full effects on a desktop', () => {
    expect(resolveDefaultSkinEffects(null, desktop)).toBe('full');
  });

  test('reduces effects on phones and tablets', () => {
    expect(resolveDefaultSkinEffects(null, phone)).toBe('reduced');
    expect(resolveDefaultSkinEffects(undefined, tablet)).toBe('reduced');
  });

  test('reduces effects when the OS asks for reduced motion', () => {
    expect(resolveDefaultSkinEffects(null, { ...desktop, prefersReducedMotion: true })).toBe('reduced');
  });

  test('a stored pick always wins', () => {
    expect(resolveDefaultSkinEffects('full', phone)).toBe('full');
    expect(resolveDefaultSkinEffects('off', desktop)).toBe('off');
    expect(resolveDefaultSkinEffects('reduced', desktop)).toBe('reduced');
  });

  test('an unknown stored value is ignored', () => {
    expect(resolveDefaultSkinEffects('max', desktop)).toBe('full');
    expect(resolveDefaultSkinEffects('', phone)).toBe('reduced');
  });
});

describe('resolvePlayLayoutMode', () => {
  test('auto follows the device', () => {
    expect(resolvePlayLayoutMode('auto', resolveDeviceProfile(desktop))).toBe('standard');
    expect(resolvePlayLayoutMode('auto', resolveDeviceProfile(phone))).toBe('touch');
    expect(resolvePlayLayoutMode('auto', resolveDeviceProfile(tablet))).toBe('touch');
  });

  test('an explicit pick wins on any device', () => {
    expect(resolvePlayLayoutMode('touch', resolveDeviceProfile(desktop))).toBe('touch');
    expect(resolvePlayLayoutMode('standard', resolveDeviceProfile(phone))).toBe('standard');
  });
});
