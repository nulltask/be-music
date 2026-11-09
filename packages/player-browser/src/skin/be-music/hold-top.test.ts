import type { BeMusicLaneFrame, BeMusicLongNote } from '@be-music/player-skin-sdk';
import { describe, expect, test } from 'vite-plus/test';
import { resolveHoldTops } from './hold-top.ts';

function lane(x: number, holding: boolean): BeMusicLaneFrame {
  return { channel: `1${x}`, kind: 'white', x, w: 40, top: 0, bottom: 400, beam: 0, holding };
}

function longNote(x: number, top: number, bottom: number, state: BeMusicLongNote['state']): BeMusicLongNote {
  return { kind: 'white', x, w: 40, top, bottom, state };
}

describe('resolveHoldTops', () => {
  test('gives a held lane the top of the long note held over it', () => {
    const lanes = [lane(0, true), lane(40, false)];
    resolveHoldTops(lanes, [longNote(0, 250, 400, 'held'), longNote(40, 100, 300, 'pending')]);
    expect(lanes[0]!.holdTop).toBe(250);
    expect(lanes[1]!.holdTop).toBeUndefined();
  });

  test('takes the held note nearest the judgement line and ignores notes in other states or lanes', () => {
    const lanes = [lane(0, true)];
    resolveHoldTops(lanes, [
      longNote(0, 50, 150, 'held'),
      longNote(0, 200, 400, 'held'),
      longNote(0, 300, 400, 'dropped'),
      longNote(40, 350, 400, 'held'),
    ]);
    expect(lanes[0]!.holdTop).toBe(200);
  });

  test('stops at the lane top while the end is still above the lane', () => {
    const lanes = [lane(0, true)];
    resolveHoldTops(lanes, [longNote(0, -30, 400, 'held')]);
    expect(lanes[0]!.holdTop).toBe(0);
  });

  test('leaves a held lane without a held note unset', () => {
    const lanes = [lane(0, true)];
    resolveHoldTops(lanes, [longNote(0, 200, 400, 'done')]);
    expect(lanes[0]!.holdTop).toBeUndefined();
  });
});
