import { describe, expect, test, vi } from 'vite-plus/test';
import { advanceJudgeSideTimings, PlayPresentation } from './play-presentation.ts';

describe('PlayPresentation', () => {
  test('resetPresentation leaves it as a new one, the key flashes still to end cancelled', () => {
    vi.useFakeTimers();
    try {
      const presentation = new PlayPresentation();
      const flashEnded = vi.fn();
      presentation.keyFlashTimeouts.add(setTimeout(flashEnded, 50) as unknown as number);
      presentation.longNotes.start('11', 4, 'ln', 100);
      presentation.pressedChannels.add('11');
      presentation.keyBeamStartedAt.set('11', 100);
      presentation.keyBeamFadeStartedAt.set('12', 120);
      presentation.bombStartedAt.set('11', 100);
      presentation.bombJudge.set('11', 'PERFECT');
      presentation.lanePressedAt.set('11', 100);
      presentation.laneReleasedAt.set('12', 110);
      presentation.fullComboFired = true;
      presentation.lastJudge = 'PERFECT';
      presentation.lastJudgeUntil = 3.6;
      presentation.lastJudgeAt = 100;
      presentation.lastImpulseAt = 100;
      presentation.lastImpulseKind = 'scratch';
      presentation.lastPoorAt = 90;
      presentation.judgeSideState['1P'] = { judge: 'PERFECT', until: 3.6, combo: 12, courseCombo: 40 };
      presentation.playMoments = { outroAtMs: 1, gaugeRiseAtMs: 2 };
      presentation.displayedScore = 123_456;

      presentation.resetPresentation();

      expect(presentation).toEqual(new PlayPresentation());
      vi.advanceTimersByTime(100);
      expect(flashEnded).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('advanceJudgeSideTimings', () => {
  test('keeps the plate’s own timing and the last of the keys and of the scratch', () => {
    const keys = advanceJudgeSideTimings(undefined, 'GREAT', '11', -12, 1.6);
    expect(keys).toEqual({
      last: { judge: 'GREAT', deltaMs: -12, until: 1.6 },
      keys: { judge: 'GREAT', deltaMs: -12, until: 1.6 },
    });
    const scratch = advanceJudgeSideTimings(keys, 'GOOD', '16', 30, 2.1);
    expect(scratch).toEqual({
      last: { judge: 'GOOD', deltaMs: 30, until: 2.1 },
      keys: { judge: 'GREAT', deltaMs: -12, until: 1.6 },
      scratch: { judge: 'GOOD', deltaMs: 30, until: 2.1 },
    });
    // The 2P side's scratch is channel 26.
    expect(advanceJudgeSideTimings(undefined, 'GREAT', '26', 5, 3)?.scratch?.deltaMs).toBe(5);
  });

  test('an untimed judgment clears the plate’s own timing and keeps the lanes’', () => {
    const timed = advanceJudgeSideTimings(undefined, 'GREAT', '11', -12, 1.6);
    expect(advanceJudgeSideTimings(timed, 'POOR', '12', undefined, 2.6)).toEqual({
      keys: { judge: 'GREAT', deltaMs: -12, until: 1.6 },
    });
    expect(advanceJudgeSideTimings(undefined, 'POOR', undefined, undefined, 2.6)).toBeUndefined();
    expect(advanceJudgeSideTimings(undefined, 'PERFECT', '11', Number.NaN, 2.6)).toBeUndefined();
  });
});
