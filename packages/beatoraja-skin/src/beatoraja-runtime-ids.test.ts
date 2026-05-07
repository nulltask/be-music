import { describe, expect, it } from 'vitest';
import {
  bombTimerId,
  judgeOpForKind,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  TIMER_BOMB_1P_BASE,
  TIMER_BOMB_2P_BASE,
  TIMER_BOMB_EXT_BASE,
  TIMER_JUDGE_1P,
  TIMER_JUDGE_2P,
  TIMER_KEY_OFF_1P_BASE,
  TIMER_KEY_OFF_2P_BASE,
  TIMER_KEY_ON_1P_BASE,
  TIMER_KEY_ON_2P_BASE,
  TIMER_LN_HOLD_1P_BASE,
  TIMER_LN_HOLD_2P_BASE,
  BEATORAJA_OP,
} from './beatoraja-runtime-ids.ts';

describe('bombTimerId', () => {
  it('uses LR2 1P base for lanes 1..9 on side 1', () => {
    expect(bombTimerId(1, 1)).toBe(TIMER_BOMB_1P_BASE + 1);
    expect(bombTimerId(1, 9)).toBe(TIMER_BOMB_1P_BASE + 9);
  });

  it('uses LR2 2P base for lanes 1..9 on side 2', () => {
    expect(bombTimerId(2, 1)).toBe(TIMER_BOMB_2P_BASE + 1);
    expect(bombTimerId(2, 7)).toBe(TIMER_BOMB_2P_BASE + 7);
  });

  it('switches to the 1000-block extension for lanes > 9 regardless of side', () => {
    expect(bombTimerId(1, 10)).toBe(TIMER_BOMB_EXT_BASE + 10);
    expect(bombTimerId(1, 26)).toBe(TIMER_BOMB_EXT_BASE + 26);
    expect(bombTimerId(2, 24)).toBe(TIMER_BOMB_EXT_BASE + 24);
  });

  it('returns undefined for non-positive or non-integer lanes', () => {
    expect(bombTimerId(1, 0)).toBeUndefined();
    expect(bombTimerId(1, -3)).toBeUndefined();
    expect(bombTimerId(1, 1.5)).toBeUndefined();
  });
});

describe('lnHoldTimerId / keyOnTimerId / keyOffTimerId', () => {
  it('match beatoraja play24main.lua bases', () => {
    // From `play_24main.lua` reference:
    //   timer_key_hold(i): 70+i for i<=9, 1200+i otherwise
    //   timer_key_on(i):   100+i / 1400+i
    //   timer_key_off(i):  120+i / 1600+i
    expect(lnHoldTimerId(1, 5)).toBe(TIMER_LN_HOLD_1P_BASE + 5);
    expect(lnHoldTimerId(2, 5)).toBe(TIMER_LN_HOLD_2P_BASE + 5);
    expect(keyOnTimerId(1, 7)).toBe(TIMER_KEY_ON_1P_BASE + 7);
    expect(keyOnTimerId(2, 3)).toBe(TIMER_KEY_ON_2P_BASE + 3);
    expect(keyOffTimerId(1, 4)).toBe(TIMER_KEY_OFF_1P_BASE + 4);
    expect(keyOffTimerId(2, 6)).toBe(TIMER_KEY_OFF_2P_BASE + 6);

    // Extension space (24-key lanes 10..26)
    expect(lnHoldTimerId(1, 24)).toBe(1200 + 24);
    expect(keyOnTimerId(1, 18)).toBe(1400 + 18);
    expect(keyOffTimerId(1, 26)).toBe(1600 + 26);
  });
});

describe('judgeTimerId', () => {
  it('returns the side-specific judge timer base', () => {
    expect(judgeTimerId(1)).toBe(TIMER_JUDGE_1P);
    expect(judgeTimerId(2)).toBe(TIMER_JUDGE_2P);
  });
});

describe('judgeOpForKind', () => {
  it('maps engine judge kinds onto the matching per-side op-code', () => {
    expect(judgeOpForKind(1, 'PERFECT')).toBe(BEATORAJA_OP.P1_JUDGE_PG);
    expect(judgeOpForKind(1, 'GREAT')).toBe(BEATORAJA_OP.P1_JUDGE_GR);
    expect(judgeOpForKind(1, 'GOOD')).toBe(BEATORAJA_OP.P1_JUDGE_GD);
    expect(judgeOpForKind(1, 'BAD')).toBe(BEATORAJA_OP.P1_JUDGE_BD);
    expect(judgeOpForKind(1, 'POOR')).toBe(BEATORAJA_OP.P1_JUDGE_PR);
    expect(judgeOpForKind(1, 'MISS')).toBe(BEATORAJA_OP.P1_JUDGE_MS);

    expect(judgeOpForKind(2, 'PERFECT')).toBe(BEATORAJA_OP.P2_JUDGE_PG);
    expect(judgeOpForKind(2, 'MISS')).toBe(BEATORAJA_OP.P2_JUDGE_MS);
  });

  it('is case-insensitive', () => {
    expect(judgeOpForKind(1, 'perfect')).toBe(BEATORAJA_OP.P1_JUDGE_PG);
    expect(judgeOpForKind(1, 'GreaT')).toBe(BEATORAJA_OP.P1_JUDGE_GR);
  });

  it('returns undefined for unrecognized kinds (FAST / SLOW etc. are surfaced via separate ops)', () => {
    expect(judgeOpForKind(1, 'FAST')).toBeUndefined();
    expect(judgeOpForKind(1, 'SLOW')).toBeUndefined();
    expect(judgeOpForKind(1, '')).toBeUndefined();
  });
});
