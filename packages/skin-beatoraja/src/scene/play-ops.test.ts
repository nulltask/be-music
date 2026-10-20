import type { LaneCoverState } from '@be-music/player-scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { BEATORAJA_OP } from '../runtime-ids.ts';
import {
  BEATORAJA_COVER_OPS,
  BEATORAJA_PLAY_STARTED_OPS,
  beatorajaFastSlowOp,
  beatorajaKeysongOp,
  resolveBeatorajaChartTraitOps,
  resolveBeatorajaCoverOps,
  resolveBeatorajaPlayStartOps,
} from './play-ops.ts';

describe('resolveBeatorajaChartTraitOps', () => {
  it('lights the HAS or NO op of each trait given and nothing for one left out', () => {
    expect(
      resolveBeatorajaChartTraitOps({
        longNote: true,
        bpmChange: false,
        stop: true,
        text: false,
        bga: true,
        stageFile: true,
        banner: false,
        backBMP: false,
      }),
    ).toEqual([
      BEATORAJA_OP.HAS_LN,
      BEATORAJA_OP.NO_BPMCHANGE,
      BEATORAJA_OP.HAS_BPMSTOP,
      BEATORAJA_OP.NO_TEXT,
      BEATORAJA_OP.HAS_BGA,
      BEATORAJA_OP.HAS_STAGEFILE,
      BEATORAJA_OP.NO_BANNER,
      BEATORAJA_OP.NO_BACKBMP,
    ]);
    // A chart without STOPs lights no stop op; `random` only when given.
    expect(resolveBeatorajaChartTraitOps({ stop: false, random: false })).toEqual([BEATORAJA_OP.NO_RANDOMSEQUENCE]);
    expect(resolveBeatorajaChartTraitOps({ random: true })).toEqual([BEATORAJA_OP.HAS_RANDOMSEQUENCE]);
    expect(resolveBeatorajaChartTraitOps({})).toEqual([]);
  });
});

describe('beatorajaKeysongOp', () => {
  it('maps every play variant onto its key-mode op', () => {
    expect(['5', '7', '9', '10', '14', '24', '48'].map(beatorajaKeysongOp)).toEqual([
      BEATORAJA_OP.KEYSONG_5K,
      BEATORAJA_OP.KEYSONG_7K,
      BEATORAJA_OP.KEYSONG_9K,
      BEATORAJA_OP.KEYSONG_10K,
      BEATORAJA_OP.KEYSONG_14K,
      BEATORAJA_OP.KEYSONG_24K,
      BEATORAJA_OP.KEYSONG_24K_DP,
    ]);
    expect(beatorajaKeysongOp('popn')).toBeUndefined();
    expect(beatorajaKeysongOp(undefined)).toBeUndefined();
  });
});

describe('resolveBeatorajaPlayStartOps', () => {
  it('starts loading with the autoplay, gauge, key-mode and trait ops', () => {
    expect(resolveBeatorajaPlayStartOps({ playVariant: '7', autoPlay: false, traits: { longNote: false } })).toEqual([
      BEATORAJA_OP.AUTOPLAY_OFF,
      BEATORAJA_OP.NOW_LOADING,
      BEATORAJA_OP.GAUGE_GROOVE,
      BEATORAJA_OP.KEYSONG_7K,
      BEATORAJA_OP.NO_LN,
    ]);
    expect(resolveBeatorajaPlayStartOps({ playVariant: '48', autoPlay: true })).toEqual([
      BEATORAJA_OP.AUTOPLAY_ON,
      BEATORAJA_OP.NOW_LOADING,
      BEATORAJA_OP.GAUGE_GROOVE,
      BEATORAJA_OP.KEYSONG_24K_DP,
    ]);
    expect(BEATORAJA_PLAY_STARTED_OPS).toEqual({ on: BEATORAJA_OP.LOADED, off: BEATORAJA_OP.NOW_LOADING });
  });
});

describe('resolveBeatorajaCoverOps', () => {
  const cover = (overrides: Partial<LaneCoverState>): LaneCoverState => ({
    side: '1P',
    sudden: 0,
    suddenOn: false,
    hidden: 0,
    hiddenOn: false,
    lift: 0,
    ...overrides,
  });

  it('lights the lane cover and LIFT ops while drawn, and the changing op while changing', () => {
    expect(resolveBeatorajaCoverOps(cover({ sudden: 0.3, suddenOn: true, lift: 0.1 }), true)).toEqual([
      BEATORAJA_OP.LANECOVER1_CHANGING,
      BEATORAJA_OP.LANECOVER1_ON,
      BEATORAJA_OP.LIFT1_ON,
    ]);
    // A cover switched off keeps its height but is not drawn.
    expect(resolveBeatorajaCoverOps(cover({ sudden: 0.3 }), false)).toEqual([]);
    expect(resolveBeatorajaCoverOps(undefined, true)).toEqual([BEATORAJA_OP.LANECOVER1_CHANGING]);
    expect(BEATORAJA_COVER_OPS).toEqual([
      BEATORAJA_OP.LANECOVER1_CHANGING,
      BEATORAJA_OP.LANECOVER1_ON,
      BEATORAJA_OP.LIFT1_ON,
    ]);
  });
});

describe('beatorajaFastSlowOp', () => {
  it("lights each plate's FAST op early and SLOW op late, neither on time", () => {
    expect(beatorajaFastSlowOp(1, -3)).toBe(BEATORAJA_OP.P1_JUDGE_EARLY);
    expect(beatorajaFastSlowOp(1, 4)).toBe(BEATORAJA_OP.P1_JUDGE_LATE);
    expect(beatorajaFastSlowOp(2, -1)).toBe(BEATORAJA_OP.P2_JUDGE_EARLY);
    expect(beatorajaFastSlowOp(2, 1)).toBe(BEATORAJA_OP.P2_JUDGE_LATE);
    expect(beatorajaFastSlowOp(3, -1)).toBe(BEATORAJA_OP.P3_JUDGE_EARLY);
    expect(beatorajaFastSlowOp(3, 1)).toBe(BEATORAJA_OP.P3_JUDGE_LATE);
    expect(beatorajaFastSlowOp(1, 0)).toBeUndefined();
  });
});
