import { describe, expect, test } from 'vite-plus/test';
import { resolveClearLamp } from '@be-music/player/ruleset';
import { BEATORAJA_OP } from '../runtime-ids.ts';
import { beatorajaClearLampOp } from './clear-lamp.ts';

describe('beatorajaClearLampOp', () => {
  test('maps every lamp onto its beatoraja op', () => {
    expect(beatorajaClearLampOp('NO_PLAY')).toBe(BEATORAJA_OP.CLEAR_LAMP_NOPLAY);
    expect(beatorajaClearLampOp('FAILED')).toBe(BEATORAJA_OP.CLEAR_LAMP_FAILED);
    expect(beatorajaClearLampOp('ASSIST_EASY')).toBe(BEATORAJA_OP.CLEAR_LAMP_ASSIST_EASY);
    expect(beatorajaClearLampOp('EASY')).toBe(BEATORAJA_OP.CLEAR_LAMP_EASY);
    expect(beatorajaClearLampOp('NORMAL')).toBe(BEATORAJA_OP.CLEAR_LAMP_NORMAL);
    expect(beatorajaClearLampOp('HARD')).toBe(BEATORAJA_OP.CLEAR_LAMP_HARD);
    expect(beatorajaClearLampOp('EX_HARD')).toBe(BEATORAJA_OP.CLEAR_LAMP_EXHARD);
    expect(beatorajaClearLampOp('FULL_COMBO')).toBe(BEATORAJA_OP.CLEAR_LAMP_FULLCOMBO);
    expect(beatorajaClearLampOp('PERFECT')).toBe(BEATORAJA_OP.CLEAR_LAMP_PERFECT);
    expect(beatorajaClearLampOp('MAX')).toBe(BEATORAJA_OP.CLEAR_LAMP_MAX);
  });

  test('shows an all-PERFECT clear as MAX, as the LR2 and default results do', () => {
    const lamp = resolveClearLamp({ cleared: true, score: { total: 10, perfect: 10, great: 0, good: 0 } });
    expect(beatorajaClearLampOp(lamp)).toBe(BEATORAJA_OP.CLEAR_LAMP_MAX);
  });
});
