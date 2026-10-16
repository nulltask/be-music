import { describe, expect, it } from 'vite-plus/test';
import type { PixiSceneHost } from '../host.ts';
import {
  attachBeatorajaSceneLoop,
  attachBeatorajaSceneLifecycle,
  createBeatorajaSceneFadeoutTransition,
  createBeatorajaSceneTimerStarts,
  hasBeatorajaSceneFadingTransition,
  hasBeatorajaSceneLockedTransition,
  isBeatorajaSceneInputReady,
} from './shared-scene.ts';

describe('beatoraja scene timing helpers', () => {
  it('creates the common scene timer ladder', () => {
    const timers = createBeatorajaSceneTimerStarts({ inputDelayMs: 500, readyAtMs: 0, playAtMs: 100 });

    expect(timers.get(0)).toBe(0);
    expect(timers.get(1)).toBe(500);
    expect(timers.get(40)).toBe(0);
    expect(timers.get(41)).toBe(100);
  });

  it('checks input readiness relative to scene start', () => {
    expect(isBeatorajaSceneInputReady(1000, 500, 1499)).toBe(false);
    expect(isBeatorajaSceneInputReady(1000, 500, 1500)).toBe(true);
  });
});

describe('beatoraja scene transition helpers', () => {
  it('constructs a fadeout transition that stamps the scene timer map', () => {
    let nowMs = 10;
    let completed = 0;
    const timerStartedAt = new Map<number, number>();
    const transition = createBeatorajaSceneFadeoutTransition({
      skin: { fadeout: 50 },
      getElapsedMs: () => nowMs,
      timerStartedAt,
      onComplete: () => {
        completed += 1;
      },
    });

    transition.begin();
    expect(timerStartedAt.get(2)).toBe(10);
    nowMs = 59;
    transition.tick();
    expect(completed).toBe(0);
    nowMs = 60;
    transition.tick();
    transition.tick();
    expect(completed).toBe(1);
  });

  it('detects fading and locked transition states', () => {
    const idle = { isFadingOut: () => false, isCompleted: () => false };
    const fading = { isFadingOut: () => true, isCompleted: () => false };
    const completed = { isFadingOut: () => false, isCompleted: () => true };

    expect(hasBeatorajaSceneFadingTransition(idle, undefined)).toBe(false);
    expect(hasBeatorajaSceneFadingTransition(idle, fading)).toBe(true);
    expect(hasBeatorajaSceneLockedTransition(idle, completed)).toBe(true);
  });
});

describe('attachBeatorajaSceneLoop', () => {
  it('attaches and detaches the ticker callback', () => {
    const added: Array<() => void> = [];
    const removed: Array<() => void> = [];
    const host = {
      app: {
        ticker: {
          add: (callback: () => void) => added.push(callback),
          remove: (callback: () => void) => removed.push(callback),
        },
      },
    } as unknown as PixiSceneHost;
    let ticks = 0;

    const attachment = attachBeatorajaSceneLoop(
      host,
      () => {
        ticks += 1;
      },
      () => undefined,
    );

    expect(added).toHaveLength(1);
    added[0]!();
    expect(ticks).toBe(1);
    attachment.dispose();
    expect(removed[0]).toBe(added[0]);
  });
});

describe('attachBeatorajaSceneLifecycle', () => {
  it('creates timers, transitions, and loop attachment together', () => {
    const added: Array<() => void> = [];
    const host = {
      app: {
        ticker: {
          add: (callback: () => void) => added.push(callback),
          remove: () => undefined,
        },
      },
    } as unknown as PixiSceneHost;
    let nowMs = 0;
    let ticks = 0;
    let completed = 0;

    const lifecycle = attachBeatorajaSceneLifecycle({
      host,
      skin: { fadeout: 10 },
      inputDelayMs: 500,
      readyAtMs: 0,
      playAtMs: 0,
      getElapsedMs: () => nowMs,
      tick: () => {
        ticks += 1;
      },
      handleKeyDown: () => undefined,
      transitionCompletions: [
        () => {
          completed += 1;
        },
      ],
    });

    expect(lifecycle.timerStartedAt.get(1)).toBe(500);
    expect(lifecycle.timerStartedAt.get(40)).toBe(0);
    expect(lifecycle.transitions).toHaveLength(1);
    added[0]!();
    expect(ticks).toBe(1);

    lifecycle.transitions[0]!.begin();
    expect(lifecycle.timerStartedAt.get(2)).toBe(0);
    nowMs = 10;
    lifecycle.transitions[0]!.tick();
    expect(completed).toBe(1);
  });
});
