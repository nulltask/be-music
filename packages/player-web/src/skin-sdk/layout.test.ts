import { describe, expect, it } from 'vite-plus/test';
import { resolveGameplayLayout } from './layout.ts';
import { wideStage } from './stage.ts';

const SP = ['16', '11', '12', '13', '14', '15', '18', '19'];
const DP = [...SP, '21', '22', '23', '24', '25', '28', '29', '26'];

describe('resolveGameplayLayout', () => {
  it('lays out a 7K side with its scratch, keys, and the stage BGA', () => {
    const layout = resolveGameplayLayout({ laneChannels: SP, playVariant: '7' }, wideStage);
    expect(layout.stage).toEqual({ width: 854, height: 480 });
    expect(layout.lanes).toHaveLength(8);
    expect(layout.lanes[0]!.kind).toBe('scratch');
    expect(layout.lanes.map((lane) => lane.kind).slice(1)).toEqual([
      'white',
      'black',
      'white',
      'black',
      'white',
      'black',
      'white',
    ]);
    expect(layout.playfield.right - layout.playfield.left).toBe(194);
    expect(layout.playfield.centerX).toBe((layout.playfield.left + layout.playfield.right) / 2);
    expect(layout.playfield.sides['2P']).toBeUndefined();
    expect(layout.bga).toEqual(wideStage.resolveBgaRect(layout.playfield.right));
  });

  it('reports both sides in double play and keeps the BGA clear of them', () => {
    const layout = resolveGameplayLayout({ laneChannels: DP, playVariant: '14' }, wideStage);
    expect(layout.playfield.sides['1P']).toBeDefined();
    expect(layout.playfield.sides['2P']!.right).toBe(layout.playfield.right);
    expect(layout.bga!.x).toBeGreaterThan(layout.playfield.right);
  });

  it('leaves the BGA out when the stage has no room for it', () => {
    const layout = resolveGameplayLayout(
      { laneChannels: SP, playVariant: '7' },
      { width: 640, height: 480, resolveBgaRect: () => ({ x: 0, y: 0, w: 0, h: 0 }) },
    );
    expect(layout.bga).toBeUndefined();
  });
});
