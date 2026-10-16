import { describe, expect, it, vi } from 'vite-plus/test';
import type { Container } from 'pixi.js';
import type { SceneFamily } from '../host/family-kit.ts';
import type { PixiSceneHost } from '../scene/host.ts';
import type { FamilyView, IntentSink } from '../view/types.ts';
import {
  SessionScene,
  toSessionKeyEvent,
  type SceneSession,
  type SessionKeyEvent,
  type SessionKeyTarget,
} from './session-scene.ts';

type Frame = { readonly nowMs: number; readonly index: number };
type Intent = { readonly type: 'start' } | { readonly type: 'exit' };

/** A host whose ticker runs only when the test fires it. */
function createFakeHost(): { host: PixiSceneHost; callbacks: Set<() => void>; fire: () => void } {
  const callbacks = new Set<() => void>();
  const ticker = {
    add: vi.fn((callback: () => void) => callbacks.add(callback)),
    remove: vi.fn((callback: () => void) => callbacks.delete(callback)),
  };
  const host = { app: { ticker } } as unknown as PixiSceneHost;
  return {
    host,
    callbacks,
    fire: () => {
      for (const callback of Array.from(callbacks)) callback();
    },
  };
}

/** A session that numbers its frames and records what reached it. */
function createFakeSession(handledCodes: readonly string[] = ['Escape']) {
  let index = 0;
  const session = {
    kind: 'select' as const,
    enter: vi.fn<(nowMs: number) => void>(),
    exit: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
    handleKey: vi.fn((event: SessionKeyEvent) => handledCodes.includes(event.code)),
    dispatch: vi.fn<(intent: Intent) => void>(),
    frame: vi.fn((nowMs: number): Frame => ({ nowMs, index: index++ })),
  } satisfies SceneSession<Frame, Intent>;
  return session;
}

/** A view that records its lifecycle and keeps the sink it was attached with. */
function createFakeView(options: { attach?: () => Promise<void>; family?: SceneFamily; stage?: boolean } = {}) {
  const root = { label: 'view-root' } as unknown as Container;
  let sink: IntentSink<Intent> | undefined;
  const view = {
    family: options.family ?? 'lr2',
    root,
    attach: vi.fn(async (_host: PixiSceneHost, emit: IntentSink<Intent>) => {
      sink = emit;
      await options.attach?.();
    }),
    draw: vi.fn<(frame: Frame) => void>(),
    detach: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
    ...(options.stage === true ? { getStageInfo: () => ({ container: root, width: 640, height: 480 }) } : {}),
  } satisfies FamilyView<Frame, Intent>;
  return { view, emit: (intent: Intent) => sink?.(intent) };
}

/** A key target that keeps its listeners, to fire fake key events at them. */
function createKeyTarget(): SessionKeyTarget & {
  listeners: Map<string, Set<(event: KeyboardEvent) => void>>;
  fire: (type: 'keydown' | 'keyup', init: Partial<KeyboardEvent>) => { preventDefault: ReturnType<typeof vi.fn> };
} {
  const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>();
  return {
    listeners,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    fire: (type, init) => {
      const preventDefault = vi.fn();
      const event = {
        code: 'KeyA',
        key: 'a',
        repeat: false,
        timeStamp: 5,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        target: null,
        ...init,
        preventDefault,
      };
      for (const listener of Array.from(listeners.get(type) ?? [])) listener(event as unknown as KeyboardEvent);
      return { preventDefault };
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createScene(options: { attach?: () => Promise<void>; stage?: boolean; family?: SceneFamily } = {}): {
  scene: SessionScene<Frame, Intent>;
  session: ReturnType<typeof createFakeSession>;
  view: ReturnType<typeof createFakeView>['view'];
  emit: (intent: Intent) => void;
  keys: ReturnType<typeof createKeyTarget>;
  clock: { now: number };
} {
  const session = createFakeSession();
  const { view, emit } = createFakeView(options);
  const keys = createKeyTarget();
  const clock = { now: 100 };
  const scene = new SessionScene(session, view, { keyTarget: keys, now: () => clock.now });
  return { scene, session, view, emit, keys, clock };
}

describe('SessionScene', () => {
  it('names itself by the session kind and the view family, and draws on the view root', () => {
    const { scene, view } = createScene({ family: 'beatoraja' });
    expect(scene.identity).toEqual({ kind: 'select', family: 'beatoraja' });
    expect(scene.root).toBe(view.root);
    expect(scene.getStageInfo).toBeUndefined();
    const withStage = createScene({ stage: true });
    expect(withStage.scene.getStageInfo?.()).toEqual({ container: withStage.view.root, width: 640, height: 480 });
  });

  it('attaches the view, starts the session and draws a first frame on enter', async () => {
    const { scene, session, view, keys } = createScene();
    const { host, callbacks } = createFakeHost();
    await scene.enter(host);
    expect(view.attach).toHaveBeenCalledWith(host, expect.any(Function));
    expect(session.enter).toHaveBeenCalledWith(100);
    expect(callbacks.size).toBe(1);
    expect(keys.listeners.get('keydown')?.size).toBe(1);
    expect(keys.listeners.get('keyup')?.size).toBe(1);
    expect(view.draw).toHaveBeenCalledTimes(1);
    expect(view.draw).toHaveBeenLastCalledWith({ nowMs: 100, index: 0 });
    expect(scene.entered).toBe(true);
  });

  it('draws the frame the session gives for the clock on every tick', async () => {
    const { scene, session, view, clock } = createScene();
    const { host, fire } = createFakeHost();
    await scene.enter(host);
    clock.now = 116;
    fire();
    clock.now = 133;
    fire();
    expect(session.frame.mock.calls.map(([nowMs]) => nowMs)).toEqual([100, 116, 133]);
    expect(view.draw).toHaveBeenLastCalledWith({ nowMs: 133, index: 2 });
  });

  it('hands keys to the session and keeps the browser from acting on the ones it used', async () => {
    const { scene, session, keys } = createScene();
    await scene.enter(createFakeHost().host);
    const escape = keys.fire('keydown', { code: 'Escape', key: 'Escape', shiftKey: true, timeStamp: 42 });
    expect(session.handleKey).toHaveBeenLastCalledWith({
      type: 'down',
      code: 'Escape',
      key: 'Escape',
      repeat: false,
      timeStamp: 42,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    expect(escape.preventDefault).toHaveBeenCalled();
    const other = keys.fire('keyup', { code: 'KeyZ', key: 'z' });
    expect(session.handleKey).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'up', code: 'KeyZ' }));
    expect(other.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves keys typed into a text field to the field', async () => {
    const { scene, session, keys } = createScene();
    await scene.enter(createFakeHost().host);
    keys.fire('keydown', { code: 'Escape', target: { tagName: 'INPUT', type: 'search' } as unknown as EventTarget });
    keys.fire('keydown', { code: 'Escape', target: { tagName: 'TEXTAREA' } as unknown as EventTarget });
    keys.fire('keydown', {
      code: 'Escape',
      target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget,
    });
    expect(session.handleKey).not.toHaveBeenCalled();
    // A checkbox holds no text: its keys still reach the scene.
    keys.fire('keydown', { code: 'Escape', target: { tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget });
    expect(session.handleKey).toHaveBeenCalledTimes(1);
  });

  it('routes the view intents to the session only while entered', async () => {
    const { scene, session, emit } = createScene();
    await scene.enter(createFakeHost().host);
    emit({ type: 'start' });
    expect(session.dispatch).toHaveBeenCalledWith({ type: 'start' });
    scene.exit();
    emit({ type: 'exit' });
    expect(session.dispatch).toHaveBeenCalledTimes(1);
  });

  it('stops ticking and listening on exit, and enters again with the same view and session', async () => {
    const { scene, session, view, keys, clock } = createScene();
    const { host, callbacks, fire } = createFakeHost();
    await scene.enter(host);
    scene.exit();
    expect(callbacks.size).toBe(0);
    expect(keys.listeners.get('keydown')?.size).toBe(0);
    expect(keys.listeners.get('keyup')?.size).toBe(0);
    expect(view.detach).toHaveBeenCalledTimes(1);
    expect(session.exit).toHaveBeenCalledTimes(1);
    expect(view.dispose).not.toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
    fire();
    keys.fire('keydown', { code: 'Escape' });
    expect(view.draw).toHaveBeenCalledTimes(1);
    expect(session.handleKey).not.toHaveBeenCalled();
    scene.exit();
    expect(view.detach).toHaveBeenCalledTimes(1);

    clock.now = 500;
    await scene.enter(host);
    await scene.enter(host);
    expect(view.attach).toHaveBeenCalledTimes(2);
    expect(session.enter).toHaveBeenLastCalledWith(500);
    expect(session.enter).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(1);
    expect(keys.listeners.get('keydown')?.size).toBe(1);
  });

  it('undoes an attach that finishes after the scene was left', async () => {
    const attaching = deferred();
    const { scene, session, view } = createScene({ attach: () => attaching.promise });
    const { host, callbacks } = createFakeHost();
    const entering = scene.enter(host);
    scene.exit();
    expect(view.detach).not.toHaveBeenCalled();
    attaching.resolve();
    await entering;
    expect(view.detach).toHaveBeenCalledTimes(1);
    expect(session.enter).not.toHaveBeenCalled();
    expect(session.exit).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
    expect(scene.entered).toBe(false);
  });

  it('draws nothing more once the session ended the scene while making a frame', async () => {
    const { scene, session, view } = createScene();
    const { host, fire } = createFakeHost();
    await scene.enter(host);
    session.frame.mockImplementationOnce((nowMs) => {
      // The screen's time ran out, and its host disposed the scene right away.
      scene.dispose();
      return { nowMs, index: -1 };
    });
    fire();
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(view.draw).toHaveBeenCalledTimes(1);
    expect(view.draw).not.toHaveBeenCalledWith({ nowMs: 100, index: -1 });
  });

  it('disposes the view and the session once, leaving the stage first', async () => {
    const { scene, session, view } = createScene();
    const { host, callbacks } = createFakeHost();
    await scene.enter(host);
    scene.dispose();
    scene.dispose();
    expect(callbacks.size).toBe(0);
    expect(view.detach).toHaveBeenCalledTimes(1);
    expect(session.exit).toHaveBeenCalledTimes(1);
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(scene.disposed).toBe(true);
    await expect(scene.enter(host)).rejects.toThrow('entered after dispose');
  });

  it('disposes a scene still attaching without detaching the disposed view', async () => {
    const attaching = deferred();
    const { scene, session, view } = createScene({ attach: () => attaching.promise });
    const entering = scene.enter(createFakeHost().host);
    scene.dispose();
    attaching.resolve();
    await entering;
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(view.detach).not.toHaveBeenCalled();
    expect(session.enter).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('toSessionKeyEvent', () => {
  it('copies the fields a session reads off a DOM key event', () => {
    const event = {
      code: 'ArrowUp',
      key: 'ArrowUp',
      repeat: true,
      timeStamp: 12.5,
      shiftKey: false,
      ctrlKey: true,
      altKey: false,
      metaKey: true,
      target: null,
    } as unknown as KeyboardEvent;
    expect(toSessionKeyEvent('down', event)).toEqual({
      type: 'down',
      code: 'ArrowUp',
      key: 'ArrowUp',
      repeat: true,
      timeStamp: 12.5,
      shiftKey: false,
      ctrlKey: true,
      altKey: false,
      metaKey: true,
    });
  });
});
