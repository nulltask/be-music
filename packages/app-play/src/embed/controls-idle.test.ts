import { describe, expect, it } from 'vite-plus/test';
import { resolveControlsHidden } from './controls-idle.ts';

const base = { idle: true, playing: true, hovered: false, focused: false };

describe('resolveControlsHidden', () => {
  it('hides the controls when the viewer is idle during a play', () => {
    expect(resolveControlsHidden(base)).toBe(true);
  });

  it('shows them on input, while paused or not playing, over them, or with a control focused', () => {
    expect(resolveControlsHidden({ ...base, idle: false })).toBe(false);
    expect(resolveControlsHidden({ ...base, playing: false })).toBe(false);
    expect(resolveControlsHidden({ ...base, hovered: true })).toBe(false);
    expect(resolveControlsHidden({ ...base, focused: true })).toBe(false);
  });
});
