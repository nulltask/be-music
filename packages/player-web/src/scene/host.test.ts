import { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { PixiSceneHost, resolveRendererPreference, type PixiScene } from './host.ts';

function makeScene(overrides: Partial<PixiScene> = {}): PixiScene {
  return {
    root: new Container(),
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('resolveRendererPreference', () => {
  // Defaults to WebGPU per the project policy. PixiJS auto-falls- back to WebGL2 inside `Application.init` if the
  // browser doesn't expose WebGPU, so the default is safe even on older platforms.
  it('returns "webgpu" by default when no flag is present', () => {
    expect(resolveRendererPreference('')).toBe('webgpu');
    expect(resolveRendererPreference('?')).toBe('webgpu');
    expect(resolveRendererPreference('?other=value')).toBe('webgpu');
  });

  it('returns "webgpu" for the explicit `?renderer=webgpu` form', () => {
    // The explicit form is accepted as documentation in deployed URLs even though it's redundant with the default.
    expect(resolveRendererPreference('?renderer=webgpu')).toBe('webgpu');
  });

  it('returns "webgl" only for the exact `?renderer=webgl` form', () => {
    expect(resolveRendererPreference('?renderer=webgl')).toBe('webgl');
  });

  it('falls back to "webgpu" for unrecognized renderer values', () => {
    // Strict allow-list — typoed flags shouldn't silently disable WebGPU on a user's machine. They get the default and
    // can fix their URL.
    expect(resolveRendererPreference('?renderer=canvas')).toBe('webgpu');
    expect(resolveRendererPreference('?renderer=WebGL')).toBe('webgpu');
    expect(resolveRendererPreference('?renderer=')).toBe('webgpu');
  });
});

describe('PixiSceneHost', () => {
  it('disposes and forgets a scene whose enter hook fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = new PixiSceneHost();
    const error = new Error('enter failed');
    const scene = makeScene({
      enter: vi.fn(() => {
        throw error;
      }),
    });

    try {
      await expect(host.setScene(scene)).rejects.toThrow(error);

      expect(scene.dispose).toHaveBeenCalled();
      expect(host.getCurrentScene()).toBeUndefined();
      expect(scene.root.parent).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});
