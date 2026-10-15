import { describe, expect, test } from 'vite-plus/test';
import { checkPlaylogEligibility } from './eligibility.ts';
import type { BeMusicPlaylog } from './format.ts';

function playlog(play: Partial<BeMusicPlaylog['play']> = {}, chart: Partial<BeMusicPlaylog['chart']> = {}) {
  return {
    format: 'be-music-playlog',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 0,
      notes: [],
      chartFingerprint: 'bmfp0:c',
      playFingerprint: 'bmfp0:p',
      ...chart,
    },
    inputs: [],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...play },
  } as BeMusicPlaylog;
}

describe('checkPlaylogEligibility', () => {
  test('accepts a manual play with both fingerprints and no assist', () => {
    expect(checkPlaylogEligibility(playlog())).toEqual({
      eligible: true,
      chartFingerprint: 'bmfp0:c',
      playFingerprint: 'bmfp0:p',
      assistFlags: [],
    });
  });

  test('rejects auto plays and ESC aborts', () => {
    expect(checkPlaylogEligibility(playlog({ mode: 'auto' }))).toEqual({ eligible: false, reason: 'auto-play' });
    expect(checkPlaylogEligibility(playlog({ aborted: true }))).toEqual({ eligible: false, reason: 'aborted' });
  });

  test('rejects a log without either fingerprint', () => {
    expect(checkPlaylogEligibility(playlog({}, { chartFingerprint: undefined }))).toEqual({
      eligible: false,
      reason: 'missing-fingerprint',
    });
    expect(checkPlaylogEligibility(playlog({}, { playFingerprint: undefined }))).toEqual({
      eligible: false,
      reason: 'missing-fingerprint',
    });
  });

  test('flags assists instead of rejecting them', () => {
    const result = checkPlaylogEligibility(playlog({ autoScratch: true, judgeWindowOverrideMs: 500 }));
    expect(result).toMatchObject({ eligible: true, assistFlags: ['auto-scratch', 'judge-window-override'] });
  });
});
