import { describe, expect, it } from 'vitest';
import { resolveRendererPreference } from './pixi-scene-host.ts';

describe('resolveRendererPreference', () => {
  // Defaults to WebGPU per the project policy. PixiJS auto-falls-
  // back to WebGL2 inside `Application.init` if the browser doesn't
  // expose WebGPU, so the default is safe even on older platforms.
  it('returns "webgpu" by default when no flag is present', () => {
    expect(resolveRendererPreference('')).toBe('webgpu');
    expect(resolveRendererPreference('?')).toBe('webgpu');
    expect(resolveRendererPreference('?other=value')).toBe('webgpu');
  });

  it('returns "webgpu" for the explicit `?renderer=webgpu` form', () => {
    // The explicit form is accepted as documentation in deployed
    // URLs even though it's redundant with the default.
    expect(resolveRendererPreference('?renderer=webgpu')).toBe('webgpu');
  });

  it('returns "webgl" only for the exact `?renderer=webgl` form', () => {
    expect(resolveRendererPreference('?renderer=webgl')).toBe('webgl');
  });

  it('falls back to "webgpu" for unrecognised renderer values', () => {
    // Strict allow-list — typoed flags shouldn't silently disable
    // WebGPU on a user's machine. They get the default and can fix
    // their URL.
    expect(resolveRendererPreference('?renderer=canvas')).toBe('webgpu');
    expect(resolveRendererPreference('?renderer=WebGL')).toBe('webgpu');
    expect(resolveRendererPreference('?renderer=')).toBe('webgpu');
  });
});
