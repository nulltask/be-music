import { describe, expect, it } from 'vite-plus/test';
import { resolveGameplayLayout, resolveLaneRuns } from './layout.ts';
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

  it('puts the 24 KEY wheel on the outer edge as wheel-up / wheel-down lanes, as wide as a scratch', () => {
    const keys = Array.from('123456789ABCDEFGHIJKLMNO', (lane) => `1${lane}`);
    // Channels arrive in any order; the layout places the wheel left of the 1P keys.
    const layout = resolveGameplayLayout({ laneChannels: [...keys, '1P', '1Q'], playVariant: '24' }, wideStage);
    const byX = [...layout.lanes].sort((a, b) => a.x - b.x);
    expect(byX.slice(0, 3).map((lane) => [lane.channel, lane.kind])).toEqual([
      ['1P', 'wheel-up'],
      ['1Q', 'wheel-down'],
      ['11', 'white'],
    ]);
    expect(byX[0]!.w).toBeGreaterThan(byX[2]!.w);
    // Keys keep the piano colouring: C# (12) is black.
    expect(layout.lanes.find((lane) => lane.channel === '12')!.kind).toBe('black');
  });

  it('puts the 48 KEY 2P wheel right of the 2P keys', () => {
    const side = (prefix: string) => Array.from('123456789ABCDEFGHIJKLMNOPQ', (lane) => `${prefix}${lane}`);
    const layout = resolveGameplayLayout({ laneChannels: [...side('1'), ...side('2')], playVariant: '48' }, wideStage);
    const byX = [...layout.lanes].sort((a, b) => a.x - b.x);
    expect(byX.map((lane) => lane.channel).slice(0, 2)).toEqual(['1P', '1Q']);
    expect(byX.map((lane) => lane.channel).slice(-3)).toEqual(['2O', '2P', '2Q']);
    expect(byX.at(-1)!.kind).toBe('wheel-down');
    expect(layout.lanes.every((lane) => lane.kind !== 'scratch')).toBe(true);
  });

  it('leaves the BGA out when the stage has no room for it', () => {
    const layout = resolveGameplayLayout(
      { laneChannels: SP, playVariant: '7' },
      { width: 640, height: 480, resolveBgaRect: () => ({ x: 0, y: 0, w: 0, h: 0 }) },
    );
    expect(layout.bga).toBeUndefined();
  });
});

describe('resolveLaneRuns', () => {
  it('merges lanes that touch into one run', () => {
    expect(
      resolveLaneRuns([
        { x: 33, w: 41 },
        { x: 74, w: 24 },
        { x: 98, w: 19 },
      ]),
    ).toEqual([{ left: 33, right: 117 }]);
  });

  it('splits at a gap, sorting lanes by position', () => {
    expect(
      resolveLaneRuns([
        { x: 300, w: 24 },
        { x: 33, w: 41 },
        { x: 74, w: 24 },
        { x: 324, w: 41 },
      ]),
    ).toEqual([
      { left: 33, right: 98 },
      { left: 300, right: 365 },
    ]);
  });

  it('gives one run per side in IIDX double play', () => {
    const layout = resolveGameplayLayout({ laneChannels: DP, playVariant: '14' }, wideStage);
    const runs = resolveLaneRuns(layout.lanes);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(layout.playfield.sides['1P']);
    expect(runs[1]).toEqual(layout.playfield.sides['2P']);
  });

  it('is empty without lanes', () => {
    expect(resolveLaneRuns([])).toEqual([]);
  });
});
