import { describe, expect, test } from 'vite-plus/test';
import { createGhostLaneOverlay, GHOST_BEAM_FADE_MS, GHOST_FLASH_MS, resolveGhostLaneMarks } from './ghost-lanes.ts';

describe('resolveGhostLaneMarks', () => {
  test('a lane the ghost never touched shows nothing', () => {
    expect(resolveGhostLaneMarks(createGhostLaneOverlay(), '11', 1000)).toEqual({ beam: 0 });
  });

  test('the beam is full while the ghost holds the key and fades out after it lets go', () => {
    const overlay = createGhostLaneOverlay();
    overlay.pressedAt.set('11', 1000);
    expect(resolveGhostLaneMarks(overlay, '11', 1500).beam).toBe(1);
    overlay.releasedAt.set('11', 2000);
    expect(resolveGhostLaneMarks(overlay, '11', 2000).beam).toBe(1);
    expect(resolveGhostLaneMarks(overlay, '11', 2000 + GHOST_BEAM_FADE_MS / 2).beam).toBeCloseTo(0.5);
    expect(resolveGhostLaneMarks(overlay, '11', 2000 + GHOST_BEAM_FADE_MS).beam).toBe(0);
    // A press after the release lights it again.
    overlay.pressedAt.set('11', 3000);
    expect(resolveGhostLaneMarks(overlay, '11', 3000).beam).toBe(1);
  });

  test('the judgment flash fades over its length', () => {
    const overlay = createGhostLaneOverlay();
    overlay.flashes.set('12', { judgment: 'GREAT', atMs: 1000 });
    expect(resolveGhostLaneMarks(overlay, '12', 1000).flash).toEqual({ judgment: 'GREAT', alpha: 1 });
    expect(resolveGhostLaneMarks(overlay, '12', 1000 + GHOST_FLASH_MS / 4).flash?.alpha).toBeCloseTo(0.75);
    expect(resolveGhostLaneMarks(overlay, '12', 1000 + GHOST_FLASH_MS).flash).toBeUndefined();
    expect(resolveGhostLaneMarks(overlay, '12', 999).flash).toBeUndefined();
  });
});
