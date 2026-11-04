import { describe, expect, it, vi } from 'vite-plus/test';
import { Container, Graphics } from 'pixi.js';
import { cabinetStage, resolveGameplayLayout, tallStage } from '@be-music/player-skin-sdk';
import type { ChildPool } from '../pixi-kit/index.ts';
import { addHUDText } from '../pixi-kit/index.ts';
import { resolveGrooveRect } from './layout.ts';
import { drawSynesthesiaMoments } from './moments.ts';

vi.mock('../pixi-kit/index.ts', () => ({
  addHUDText: vi.fn(() => ({ alpha: 1 })),
  addHUDNumber: vi.fn(),
}));

const SP7 = ['16', '11', '12', '13', '14', '15', '18', '19'];

describe('CLEAR LINE placement', () => {
  it.each(['SP', 'DP', 'two-player', 'portrait', 'touch'])('centres the effect on the %s gauge', (mode) => {
    vi.mocked(addHUDText).mockClear();
    const layout = resolveGameplayLayout(
      {
        laneChannels: mode === 'DP' ? [...SP7, '21', '22', '23', '24', '25', '28', '29', '26'] : SP7,
        playVariant: mode === 'DP' ? '14' : '7',
        twoPlayer: mode === 'two-player',
        layoutMode: mode === 'touch' ? 'touch' : 'standard',
      },
      mode === 'portrait' ? tallStage : cabinetStage,
    );
    const chrome = new Container();
    const layer = new Container();
    const graphics = new Graphics();
    const pool = { acquireGraphics: () => graphics } as unknown as ChildPool;
    for (const [nowMs, gauge] of [
      [0, 0],
      [100, 80],
      [300, 80],
    ]) {
      drawSynesthesiaMoments(chrome, layer, { nowMs, gauge, effects: 'reduced' }, 0, 0, pool, layout);
    }
    const call = vi
      .mocked(addHUDText)
      .mock.calls.filter((args) => args[1] === 'CLEAR LINE')
      .at(-1)!;
    const groove = resolveGrooveRect(layout);
    expect(call[2]).toBe(groove.x + groove.w / 2);
    expect(call[3]).toBe(groove.y + groove.h / 2);
    expect(call[4]).toMatchObject({ anchorX: 0.5, anchorY: 0.5, maxWidth: groove.w - 8 });
    graphics.destroy();
    chrome.destroy();
    layer.destroy();
  });
});
