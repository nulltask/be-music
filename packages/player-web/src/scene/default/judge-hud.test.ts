import { describe, expect, it } from 'vitest';
import { resolveJudgeHudDisplays } from './judge-hud.ts';

const SP = { centerX: 130, sideCenters: { '1P': 130 } };
const DP = { centerX: 320, sideCenters: { '1P': 120, '2P': 420 } };

describe('resolveJudgeHudDisplays', () => {
  it('keeps combo visible after the judge popup window expires', () => {
    expect(resolveJudgeHudDisplays({ combo: 128 }, SP)).toEqual([
      { judge: '', combo: 128, x: 130, maxWidth: 160 },
    ]);
  });

  it('pairs a live judge with combo', () => {
    expect(resolveJudgeHudDisplays({ lastJudge: 'GREAT', combo: 12 }, SP)).toEqual([
      { judge: 'GREAT', combo: 12, x: 130, maxWidth: 160 },
    ]);
  });

  it('still shows a POOR flash when combo is broken', () => {
    expect(resolveJudgeHudDisplays({ lastJudge: 'POOR', combo: 0 }, SP)).toEqual([
      { judge: 'POOR', combo: 0, x: 130, maxWidth: 160 },
    ]);
  });

  it('hides the HUD when there is neither a judge nor a combo', () => {
    expect(resolveJudgeHudDisplays({ combo: 0 }, SP)).toEqual([]);
  });

  it('places live DP sides on their own centres', () => {
    expect(
      resolveJudgeHudDisplays(
        {
          combo: 40,
          judgeSides: [
            { side: '1P', judge: 'PERFECT', combo: 21 },
            { side: '2P', judge: 'GREAT', combo: 19 },
          ],
        },
        DP,
      ),
    ).toEqual([
      { judge: 'PERFECT', combo: 21, x: 120, maxWidth: 122 },
      { judge: 'GREAT', combo: 19, x: 420, maxWidth: 122 },
    ]);
  });
});
