import { describe, expect, it, vi } from 'vite-plus/test';
import { SceneController } from './controller.ts';
import type { SceneSession } from './contracts.ts';

function setup() {
  let score = 0;
  const session = {
    kind: 'play' as const,
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
    handleKey: vi.fn(() => true),
    dispatch: vi.fn((_intent: 'score') => {
      score++;
    }),
    frame: vi.fn((nowMs: number) => ({ nowMs, score, events: ['hit'] })),
  } satisfies SceneSession<{ nowMs: number; score: number; events: string[] }, 'score'>;
  return { session, controller: new SceneController(session) };
}

describe('SceneController', () => {
  it('advances once and shares one snapshot, including transient events, across all observers', () => {
    const { session, controller } = setup();
    const snapshots: unknown[] = [];
    controller.subscribe(() => snapshots.push(controller.getSnapshot()));
    controller.subscribe(() => snapshots.push(controller.getSnapshot()));
    controller.enter(10);
    const frame = controller.advance(20);
    expect(session.frame).toHaveBeenCalledTimes(1);
    expect(snapshots).toEqual([frame, frame]);
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(controller.getSnapshot()).toBe(frame);
  });

  it('notifies selected stores only for changes and retains a stable snapshot between reads', () => {
    const { controller } = setup();
    const store = controller.createStore(
      (frame) => ({ score: frame.score }),
      (a, b) => a.score === b.score,
    );
    const notify = vi.fn();
    const unsubscribe = store.subscribe(notify);
    expect(store.getSnapshot()).toBeUndefined();
    controller.enter(0);
    controller.advance(1);
    const first = store.getSnapshot();
    controller.advance(2);
    expect(store.getSnapshot()).toBe(first);
    expect(notify).toHaveBeenCalledTimes(1);
    controller.dispatch('score');
    controller.advance(3);
    expect(store.getSnapshot()).toEqual({ score: 1 });
    expect(notify).toHaveBeenCalledTimes(2);
    unsubscribe();
    controller.dispatch('score');
    controller.advance(4);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual({ score: 2 });
    controller.dispose();
    expect(store.getSnapshot()).toBeUndefined();
  });

  it('keeps display subscriptions independent of session lifetime and supports re-entry', () => {
    const { session, controller } = setup();
    controller.dispatch('score');
    expect(session.dispatch).not.toHaveBeenCalled();
    controller.enter(0);
    controller.enter(1);
    const unsubscribe = controller.subscribe(vi.fn());
    unsubscribe();
    controller.advance(2);
    expect(session.exit).not.toHaveBeenCalled();
    controller.exit();
    controller.exit();
    expect(controller.advance(3)).toBeUndefined();
    controller.enter(4);
    controller.advance(5);
    expect(session.enter).toHaveBeenCalledTimes(2);
    expect(session.exit).toHaveBeenCalledTimes(1);
    controller.dispose();
    controller.dispose();
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(() => controller.enter(6)).toThrow('disposed');
  });

  it('does not publish a frame when advancing caused a transition', () => {
    const { session, controller } = setup();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.enter(0);
    session.frame.mockImplementation((nowMs) => {
      controller.exit();
      return { nowMs, score: 0, events: [] };
    });
    expect(controller.advance(1)).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });
});
