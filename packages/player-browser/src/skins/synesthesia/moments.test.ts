import { describe, expect, it, vi } from 'vite-plus/test';
import { Container, Graphics } from 'pixi.js';
import { cabinetStage, resolveGameplayLayout, tallStage } from '@be-music/player-skin-sdk';
import type { ChildPool } from '../pixi-kit/index.ts';
import { addHUDNumber, addHUDText } from '../pixi-kit/index.ts';
import { resolveGrooveRect } from './layout.ts';
import { COMBO_MILESTONE_SETTING, drawSynesthesiaMoments } from './moments.ts';

vi.mock('../pixi-kit/index.ts', () => ({
  addHUDText: vi.fn(() => ({ alpha: 1 })),
  addHUDNumber: vi.fn(() => []),
}));

const SP7 = ['16', '11', '12', '13', '14', '15', '18', '19'];
const DP14 = [...SP7, '21', '22', '23', '24', '25', '28', '29', '26'];

describe('100-combo milestones', () => {
  it.each(['SP', 'DP', 'two-player', 'portrait'])('centres the outlined count on the %s BGA', (mode) => {
    const layout = resolveGameplayLayout(
      {
        laneChannels: mode === 'DP' ? DP14 : SP7,
        playVariant: mode === 'DP' ? '14' : '7',
        twoPlayer: mode === 'two-player',
      },
      mode === 'portrait' ? tallStage : cabinetStage,
    );
    expect(layout.bga).toBeDefined();
    const bga = layout.bga!;
    vi.mocked(addHUDNumber).mockClear();
    vi.mocked(addHUDText).mockClear();
    const chrome = new Container();
    const layer = new Container();
    const graphics = new Graphics();
    const pool = { acquireGraphics: () => graphics } as unknown as ChildPool;
    const runtime = { nowMs: 100, combo: 100, effects: 'reduced' } as const;
    const settings = { [COMBO_MILESTONE_SETTING.id]: true };
    drawSynesthesiaMoments(chrome, layer, runtime, 0, 0, pool, layout, settings);
    drawSynesthesiaMoments(chrome, layer, { ...runtime, nowMs: 300 }, 0, 0, pool, layout, settings);
    const count = vi.mocked(addHUDNumber).mock.lastCall!;
    const caption = vi.mocked(addHUDText).mock.lastCall!;
    expect(count.slice(1, 4)).toEqual(['100', bga.x + bga.w / 2, bga.y + bga.h / 2]);
    expect(count[4]?.stroke).toMatchObject({ color: 0x000000 });
    expect(caption[1]).toBe('COMBO');
    expect(caption[4]?.stroke).toMatchObject({ color: 0x000000 });
    graphics.destroy();
    chrome.destroy();
    layer.destroy();
  });

  it.each([undefined, false])('does not display when the setting is %s', (enabled) => {
    vi.mocked(addHUDNumber).mockClear();
    const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7' }, cabinetStage);
    const chrome = new Container();
    const layer = new Container();
    const graphics = new Graphics();
    const pool = { acquireGraphics: () => graphics } as unknown as ChildPool;
    const settings = enabled === undefined ? undefined : { [COMBO_MILESTONE_SETTING.id]: enabled };
    drawSynesthesiaMoments(chrome, layer, { nowMs: 100, combo: 100 }, 0, 0, pool, layout, settings);
    expect(COMBO_MILESTONE_SETTING.default).toBe(false);
    expect(addHUDNumber).not.toHaveBeenCalled();
    graphics.destroy();
    chrome.destroy();
    layer.destroy();
  });
});

describe('CLEAR LINE placement', () => {
  it.each(['SP', 'DP', 'two-player', 'portrait', 'touch'])('centres the effect on the %s gauge', (mode) => {
    vi.mocked(addHUDText).mockClear();
    const layout = resolveGameplayLayout(
      {
        laneChannels: mode === 'DP' ? DP14 : SP7,
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
