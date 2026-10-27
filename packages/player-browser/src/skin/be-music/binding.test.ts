import { describe, expect, it, vi } from 'vite-plus/test';
import type { BeMusicGameplayFrame, BeMusicGameplayLayout } from '@be-music/player-skin-sdk';
import { nativeSkin } from '../../skins/native/index.ts';
import type { ChildPool } from '../../stage/pixi-utils.ts';
import { BeMusicGameplayBinding } from './binding.ts';

const layout: BeMusicGameplayLayout = {
  stage: { width: 854, height: 480 },
  lanes: [],
  playfield: { left: 0, right: 100, centerX: 50, top: 8, judgementY: 464, sides: {} },
  bga: undefined,
};

describe('BeMusicGameplayBinding for a skin drawing its playfield on DOM', () => {
  it('hands each collected frame to the DOM screen once, without a canvas sprite', () => {
    const drawPlayfield = vi.fn<(frame: BeMusicGameplayFrame) => void>();
    const binding = new BeMusicGameplayBinding(nativeSkin, { drawPlayfield });
    const layerPool = {
      acquireSprite: () => {
        throw new Error('a DOM-drawn playfield needs no sprite');
      },
    } as unknown as ChildPool;
    binding.renderChrome({ layerPool, runtime: { nowMs: 1200 }, layout });
    binding.addNote({ kind: 'white', x: 10, w: 20, y: 300 });
    binding.addMine({ kind: 'black', x: 30, w: 20, y: 200 });
    binding.flush();
    binding.flush();
    expect(drawPlayfield).toHaveBeenCalledTimes(1);
    const frame = drawPlayfield.mock.calls[0]![0];
    expect(frame.nowMs).toBe(1200);
    expect(frame.notes).toEqual([{ kind: 'white', x: 10, w: 20, y: 300 }]);
    expect(frame.mines).toEqual([{ kind: 'black', x: 30, w: 20, y: 200 }]);
    expect(binding.drawsMines && binding.drawsLaneCover && binding.drawsMeasureLines).toBe(true);
    binding.dispose();
  });

  it('keeps a failing screen from breaking the play loop', () => {
    const binding = new BeMusicGameplayBinding(nativeSkin, {
      drawPlayfield: () => {
        throw new Error('detached');
      },
    });
    binding.renderChrome({ layerPool: {} as ChildPool, runtime: {}, layout });
    expect(() => binding.flush()).not.toThrow();
  });
});
