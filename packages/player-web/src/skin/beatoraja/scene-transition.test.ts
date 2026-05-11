import { describe, expect, it, vi } from 'vitest';
import { TIMER_FADEOUT } from '@be-music/beatoraja-skin';
import {
  BeatorajaSceneTransition,
  DEFAULT_BEATORAJA_FADEOUT_MS,
  type BeatorajaSceneTransitionOptions,
} from './scene-transition.ts';

interface Harness {
  transition: BeatorajaSceneTransition;
  stampFadeoutTimer: ReturnType<typeof vi.fn>;
  onComplete: ReturnType<typeof vi.fn>;
  setElapsed: (ms: number) => void;
}

function makeHarness(opts: Partial<BeatorajaSceneTransitionOptions> = {}): Harness {
  let elapsed = 0;
  const stampFadeoutTimer = vi.fn();
  const onComplete = vi.fn();
  const transition = new BeatorajaSceneTransition({
    getElapsedMs: () => elapsed,
    stampFadeoutTimer,
    onComplete,
    ...opts,
  });
  return {
    transition,
    stampFadeoutTimer,
    onComplete,
    setElapsed: (ms) => {
      elapsed = ms;
    },
  };
}

describe('BeatorajaSceneTransition', () => {
  describe('initial state', () => {
    it('reports neither fading-out nor completed before begin()', () => {
      const { transition } = makeHarness();
      expect(transition.isFadingOut()).toBe(false);
      expect(transition.isCompleted()).toBe(false);
    });

    it('falls through to DEFAULT_BEATORAJA_FADEOUT_MS when fadeoutMs is unset', () => {
      // Mirrors upstream `Skin.getFadeout()` returning 0 for un-set fields, which would
      // collapse the transition window. We override with the default-skin value (500 ms)
      // so fixtures without an authored value behave consistently with reference skins.
      const { transition } = makeHarness();
      expect(transition.fadeoutWindowMs).toBe(DEFAULT_BEATORAJA_FADEOUT_MS);
    });

    it.each([
      [-1, 'negative'],
      [Number.NaN, 'NaN'],
      [Number.POSITIVE_INFINITY, 'Infinity'],
    ])('falls through to default for %s fadeoutMs (%s)', (badValue) => {
      const { transition } = makeHarness({ fadeoutMs: badValue });
      expect(transition.fadeoutWindowMs).toBe(DEFAULT_BEATORAJA_FADEOUT_MS);
    });

    it('honors a finite non-negative fadeoutMs override', () => {
      const { transition } = makeHarness({ fadeoutMs: 250 });
      expect(transition.fadeoutWindowMs).toBe(250);
    });

    it('accepts fadeoutMs = 0 verbatim (instant transition)', () => {
      const { transition } = makeHarness({ fadeoutMs: 0 });
      expect(transition.fadeoutWindowMs).toBe(0);
    });
  });

  describe('begin()', () => {
    it('stamps TIMER_FADEOUT with the current elapsed ms and flips isFadingOut', () => {
      // Mirrors upstream `MusicDecide.render` line 30: `timer.setTimerOn(TIMER_FADEOUT)`.
      const harness = makeHarness({ fadeoutMs: 500 });
      harness.setElapsed(750);
      harness.transition.begin();
      expect(harness.stampFadeoutTimer).toHaveBeenCalledTimes(1);
      expect(harness.stampFadeoutTimer).toHaveBeenCalledWith(TIMER_FADEOUT, 750);
      expect(harness.transition.isFadingOut()).toBe(true);
      expect(harness.transition.isCompleted()).toBe(false);
    });

    it('is idempotent — second begin() does not re-stamp the timer', () => {
      // Mirrors upstream's `if (timer.isTimerOn(TIMER_FADEOUT))` short-circuit:
      // additional triggers (e.g. user Enter spam after the auto-advance fired) do
      // NOT reset the fadeout window's start time.
      const harness = makeHarness({ fadeoutMs: 500 });
      harness.setElapsed(100);
      harness.transition.begin();
      harness.setElapsed(200);
      harness.transition.begin();
      harness.setElapsed(300);
      harness.transition.begin();
      expect(harness.stampFadeoutTimer).toHaveBeenCalledTimes(1);
      expect(harness.stampFadeoutTimer).toHaveBeenLastCalledWith(TIMER_FADEOUT, 100);
    });

    it('refuses to begin after onComplete has fired', () => {
      // Once the transition has run to completion, the scene is in tear-down — re-firing
      // begin() would re-stamp the timer and potentially re-invoke onComplete on a stale
      // scene. Reject that case explicitly.
      const harness = makeHarness({ fadeoutMs: 100 });
      harness.setElapsed(0);
      harness.transition.begin();
      harness.setElapsed(150);
      harness.transition.tick();
      expect(harness.transition.isCompleted()).toBe(true);
      harness.transition.begin();
      expect(harness.stampFadeoutTimer).toHaveBeenCalledTimes(1);
    });
  });

  describe('tick()', () => {
    it('does not fire onComplete before begin() is called', () => {
      const harness = makeHarness({ fadeoutMs: 500 });
      harness.setElapsed(10_000);
      harness.transition.tick();
      expect(harness.onComplete).not.toHaveBeenCalled();
      expect(harness.transition.isFadingOut()).toBe(false);
    });

    it('fires onComplete exactly once when sinceStamp >= fadeoutMs', () => {
      // Mirrors upstream `MusicDecide.render` line 26-27: `if (timer.getNowTime
      // (TIMER_FADEOUT) > getSkin().getFadeout()) main.changeState(...)`.
      const harness = makeHarness({ fadeoutMs: 500 });
      harness.setElapsed(1000);
      harness.transition.begin();
      harness.setElapsed(1499);
      harness.transition.tick();
      expect(harness.onComplete).not.toHaveBeenCalled();
      harness.setElapsed(1500);
      harness.transition.tick();
      expect(harness.onComplete).toHaveBeenCalledTimes(1);
      expect(harness.transition.isFadingOut()).toBe(false);
      expect(harness.transition.isCompleted()).toBe(true);
    });

    it('does not re-fire onComplete on subsequent ticks past the threshold', () => {
      const harness = makeHarness({ fadeoutMs: 250 });
      harness.setElapsed(0);
      harness.transition.begin();
      harness.setElapsed(300);
      harness.transition.tick();
      harness.setElapsed(400);
      harness.transition.tick();
      harness.setElapsed(500);
      harness.transition.tick();
      expect(harness.onComplete).toHaveBeenCalledTimes(1);
    });

    it('fires onComplete on the same tick when fadeoutMs is 0', () => {
      // begin() stamps at elapsed=100; the next tick at elapsed=100 has sinceStamp=0
      // which satisfies `>= 0`, matching upstream's `> 0` (the JNI timer increments by
      // one frame between the two checks; in our paced model the same-frame `tick()`
      // is the equivalent).
      const harness = makeHarness({ fadeoutMs: 0 });
      harness.setElapsed(100);
      harness.transition.begin();
      harness.transition.tick();
      expect(harness.onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('isFadingOut() during the window', () => {
    it('returns true while fading and false after completion', () => {
      // Drives the scene's "ignore additional inputs" gate. Authored ESC after fadeout
      // already started should NOT re-trigger.
      const harness = makeHarness({ fadeoutMs: 500 });
      expect(harness.transition.isFadingOut()).toBe(false);
      harness.setElapsed(0);
      harness.transition.begin();
      expect(harness.transition.isFadingOut()).toBe(true);
      harness.setElapsed(300);
      harness.transition.tick();
      expect(harness.transition.isFadingOut()).toBe(true);
      harness.setElapsed(500);
      harness.transition.tick();
      expect(harness.transition.isFadingOut()).toBe(false);
    });
  });
});
