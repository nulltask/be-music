import { describe, expect, test } from 'vite-plus/test';
import { checkReplayEligibility } from './eligibility.ts';
import type { BeMusicReplay } from './format.ts';

function replay(play: Partial<BeMusicReplay['play']> = {}, chart: Partial<BeMusicReplay['chart']> = {}) {
  return {
    format: 'be-music-replay',
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
  } as BeMusicReplay;
}

describe('checkReplayEligibility', () => {
  test('accepts a manual play with both fingerprints and no assist', () => {
    expect(checkReplayEligibility(replay())).toEqual({
      eligible: true,
      chartFingerprint: 'bmfp0:c',
      playFingerprint: 'bmfp0:p',
      assistFlags: [],
    });
  });

  test('rejects auto plays and ESC aborts', () => {
    expect(checkReplayEligibility(replay({ mode: 'auto' }))).toEqual({ eligible: false, reason: 'auto-play' });
    expect(checkReplayEligibility(replay({ aborted: true }))).toEqual({ eligible: false, reason: 'aborted' });
    expect(checkReplayEligibility(replay({ course: { kind: 'grade' } }))).toEqual({
      eligible: false,
      reason: 'course-stage',
    });
  });

  test('rejects a play at another tempo, which is practice', () => {
    expect(checkReplayEligibility(replay({ tempo: 0.8 }))).toEqual({ eligible: false, reason: 'tempo' });
    expect(checkReplayEligibility(replay({ tempo: 1.5 }))).toEqual({ eligible: false, reason: 'tempo' });
    expect(checkReplayEligibility(replay({ tempo: 1 }))).toMatchObject({ eligible: true });
  });

  test('rejects a log without either fingerprint', () => {
    expect(checkReplayEligibility(replay({}, { chartFingerprint: undefined }))).toEqual({
      eligible: false,
      reason: 'missing-fingerprint',
    });
    expect(checkReplayEligibility(replay({}, { playFingerprint: undefined }))).toEqual({
      eligible: false,
      reason: 'missing-fingerprint',
    });
  });

  test('flags assists instead of rejecting them', () => {
    const result = checkReplayEligibility(replay({ autoScratch: true, judgeWindowOverrideMs: 500 }));
    expect(result).toMatchObject({ eligible: true, assistFlags: ['auto-scratch', 'judge-window-override'] });
  });
});
