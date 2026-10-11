import { describe, expect, it } from 'vite-plus/test';
import { resolveDecideKeyAction } from './decide.ts';

describe('resolveDecideKeyAction', () => {
  it('continues on Enter and Space', () => {
    expect(resolveDecideKeyAction({ key: 'Enter', repeat: false })).toBe('continue');
    expect(resolveDecideKeyAction({ key: ' ', repeat: false })).toBe('continue');
    expect(resolveDecideKeyAction({ key: 'Spacebar', repeat: false })).toBe('continue');
  });

  it('cancels on Escape', () => {
    expect(resolveDecideKeyAction({ key: 'Escape', repeat: false })).toBe('cancel');
  });

  it('ignores other keys and auto-repeats', () => {
    expect(resolveDecideKeyAction({ key: 'a', repeat: false })).toBeUndefined();
    expect(resolveDecideKeyAction({ key: 'Enter', repeat: true })).toBeUndefined();
    expect(resolveDecideKeyAction({ key: 'Escape', repeat: true })).toBeUndefined();
  });
});
