import { describe, expect, test, vi } from 'vite-plus/test';
import { PlayPresentation } from './play-presentation.ts';

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
