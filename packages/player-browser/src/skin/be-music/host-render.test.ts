import { describe, expect, it } from 'vite-plus/test';
import { BUILT_IN_BE_MUSIC_SKINS } from '../../skins/built-in.ts';
import { rendersOnPixiHost } from '../../skins/pixi-kit/host-render.ts';

describe('built-in skins drawing through the player renderer', () => {
  it.each([
    ['synesthesia', true],
    ['phantom', true],
    // Canvas 2D: drawn on its canvas.
    ['plain', false],
  ])('%s → %s', (id, expected) => {
    const skin = BUILT_IN_BE_MUSIC_SKINS.find((candidate) => candidate.id === id);
    expect(skin).toBeDefined();
    expect(rendersOnPixiHost(skin!)).toBe(expected);
  });
});
