import { describe, expect, test } from 'vite-plus/test';
import { canSeeScore } from './visibility.ts';

describe('canSeeScore', () => {
  test('a shown play is anyone’s to see, a hidden one only its player’s', () => {
    expect(canSeeScore({ userId: 'u1', hidden: false }, undefined)).toBe(true);
    expect(canSeeScore({ userId: 'u1', hidden: false }, 'u2')).toBe(true);
    expect(canSeeScore({ userId: 'u1', hidden: true }, 'u1')).toBe(true);
    expect(canSeeScore({ userId: 'u1', hidden: true }, 'u2')).toBe(false);
    expect(canSeeScore({ userId: 'u1', hidden: true }, undefined)).toBe(false);
  });
});
