import { describe, expect, it } from 'vitest';
import {
  BEATORAJA_OP,
  BEATORAJA_TEXT,
  bombTimerId,
  judgeOpForKind,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  TIMER_BOMB_1P_BASE,
  TIMER_BOMB_2P_BASE,
  TIMER_BOMB_EXT_BASE,
  TIMER_FADEOUT,
  TIMER_FAILED,
  TIMER_JUDGE_1P,
  TIMER_JUDGE_2P,
  TIMER_KEY_OFF_1P_BASE,
  TIMER_KEY_OFF_2P_BASE,
  TIMER_KEY_ON_1P_BASE,
  TIMER_KEY_ON_2P_BASE,
  TIMER_LN_HOLD_1P_BASE,
  TIMER_LN_HOLD_2P_BASE,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_STARTINPUT,
} from './beatoraja-runtime-ids.ts';

describe('built-in timer constants — match prop.lua', () => {
  it('uses prop.lua names verbatim (startinput=1 / fadeout=2 / failed=3 / ready=40 / play=41)', () => {
    expect(TIMER_STARTINPUT).toBe(1);
    expect(TIMER_FADEOUT).toBe(2);
    expect(TIMER_FAILED).toBe(3);
    expect(TIMER_READY).toBe(40);
    expect(TIMER_PLAY).toBe(41);
  });

  it('judge timer matches prop.lua (judge_1p=46, judge_2p=47)', () => {
    expect(TIMER_JUDGE_1P).toBe(46);
    expect(TIMER_JUDGE_2P).toBe(47);
  });
});

describe('bombTimerId — scratch is lane 0', () => {
  it('returns 50 for 1P scratch (prop.lua bomb_1p_scratch)', () => {
    expect(bombTimerId(1, 0)).toBe(50);
  });

  it('returns 60 for 2P scratch (prop.lua bomb_2p_scratch)', () => {
    expect(bombTimerId(2, 0)).toBe(60);
  });

  it('uses 1P base for lanes 1..9 on side 1', () => {
    expect(bombTimerId(1, 1)).toBe(TIMER_BOMB_1P_BASE + 1);
    expect(bombTimerId(1, 9)).toBe(TIMER_BOMB_1P_BASE + 9);
  });

  it('uses 2P base for lanes 1..9 on side 2', () => {
    expect(bombTimerId(2, 1)).toBe(TIMER_BOMB_2P_BASE + 1);
    expect(bombTimerId(2, 7)).toBe(TIMER_BOMB_2P_BASE + 7);
  });

  it('switches to the 1000-block extension for lanes > 9 regardless of side', () => {
    expect(bombTimerId(1, 10)).toBe(TIMER_BOMB_EXT_BASE + 10);
    expect(bombTimerId(1, 26)).toBe(TIMER_BOMB_EXT_BASE + 26);
    expect(bombTimerId(2, 24)).toBe(TIMER_BOMB_EXT_BASE + 24);
  });

  it('returns undefined for negative / non-integer lanes', () => {
    expect(bombTimerId(1, -3)).toBeUndefined();
    expect(bombTimerId(1, 1.5)).toBeUndefined();
  });
});

describe('lnHoldTimerId / keyOnTimerId / keyOffTimerId', () => {
  it('match prop.lua bases (scratch=lane 0, keys 1..9)', () => {
    // hold_1p_scratch = 70, hold_2p_scratch = 80
    expect(lnHoldTimerId(1, 0)).toBe(70);
    expect(lnHoldTimerId(2, 0)).toBe(80);
    expect(lnHoldTimerId(1, 5)).toBe(TIMER_LN_HOLD_1P_BASE + 5);
    expect(lnHoldTimerId(2, 5)).toBe(TIMER_LN_HOLD_2P_BASE + 5);

    // keyon_1p_scratch = 100, keyon_2p_scratch = 110
    expect(keyOnTimerId(1, 0)).toBe(100);
    expect(keyOnTimerId(2, 0)).toBe(110);
    expect(keyOnTimerId(1, 7)).toBe(TIMER_KEY_ON_1P_BASE + 7);
    expect(keyOnTimerId(2, 3)).toBe(TIMER_KEY_ON_2P_BASE + 3);

    // keyoff_1p_scratch = 120, keyoff_2p_scratch = 130
    expect(keyOffTimerId(1, 0)).toBe(120);
    expect(keyOffTimerId(2, 0)).toBe(130);
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

describe('judgeOpForKind — match prop.lua _1p_* / _2p_*', () => {
  it('maps engine judge kinds onto the matching per-side op-code (1P)', () => {
    // prop.lua: _1p_perfect=241, _1p_great=242, _1p_good=243, _1p_bad=244, _1p_poor=245, _1p_miss=246
    expect(judgeOpForKind(1, 'PERFECT')).toBe(241);
    expect(judgeOpForKind(1, 'GREAT')).toBe(242);
    expect(judgeOpForKind(1, 'GOOD')).toBe(243);
    expect(judgeOpForKind(1, 'BAD')).toBe(244);
    expect(judgeOpForKind(1, 'POOR')).toBe(245);
    expect(judgeOpForKind(1, 'MISS')).toBe(246);
  });

  it('maps the 2P side to the prop.lua _2p_* range (261..266)', () => {
    expect(judgeOpForKind(2, 'PERFECT')).toBe(261);
    expect(judgeOpForKind(2, 'GREAT')).toBe(262);
    expect(judgeOpForKind(2, 'GOOD')).toBe(263);
    expect(judgeOpForKind(2, 'BAD')).toBe(264);
    expect(judgeOpForKind(2, 'POOR')).toBe(265);
    expect(judgeOpForKind(2, 'MISS')).toBe(266);
  });

  it('is case-insensitive', () => {
    expect(judgeOpForKind(1, 'perfect')).toBe(BEATORAJA_OP.P1_JUDGE_PERFECT);
    expect(judgeOpForKind(1, 'GreaT')).toBe(BEATORAJA_OP.P1_JUDGE_GREAT);
  });

  it('returns undefined for FAST / SLOW (those use the separate _early / _late ops)', () => {
    expect(judgeOpForKind(1, 'FAST')).toBeUndefined();
    expect(judgeOpForKind(1, 'SLOW')).toBeUndefined();
    expect(judgeOpForKind(1, '')).toBeUndefined();
  });
});

describe('BEATORAJA_OP — runtime ops match prop.lua', () => {
  it('autoplay flags', () => {
    expect(BEATORAJA_OP.AUTOPLAY_OFF).toBe(32);
    expect(BEATORAJA_OP.AUTOPLAY_ON).toBe(33);
  });

  it('loading flags', () => {
    expect(BEATORAJA_OP.NOW_LOADING).toBe(80);
    expect(BEATORAJA_OP.LOADED).toBe(81);
  });

  it('FAST / SLOW judge readout', () => {
    expect(BEATORAJA_OP.P1_JUDGE_EARLY).toBe(1242);
    expect(BEATORAJA_OP.P1_JUDGE_LATE).toBe(1243);
    expect(BEATORAJA_OP.P2_JUDGE_EARLY).toBe(1262);
    expect(BEATORAJA_OP.P2_JUDGE_LATE).toBe(1263);
  });
});

describe('BEATORAJA_TEXT — chart info refs match prop.lua', () => {
  it('exposes title / artist / genre / subtitle / fulltitle / fullartist', () => {
    expect(BEATORAJA_TEXT.TITLE).toBe(10);
    expect(BEATORAJA_TEXT.SUBTITLE).toBe(11);
    expect(BEATORAJA_TEXT.FULLTITLE).toBe(12);
    expect(BEATORAJA_TEXT.GENRE).toBe(13);
    expect(BEATORAJA_TEXT.ARTIST).toBe(14);
    expect(BEATORAJA_TEXT.SUBARTIST).toBe(15);
    expect(BEATORAJA_TEXT.FULLARTIST).toBe(16);
  });
});
