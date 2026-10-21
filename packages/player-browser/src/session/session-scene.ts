/**
 * The scene every screen runs as: a **scene session** (the screen's behaviour, family-neutral) with the **family view**
 * that draws it (ADR 0001). `SessionScene` is the `PixiScene` the host mounts. It owns the parts every screen shares:
 * the ticker that asks the session for a frame and has the view draw it, the key listener that hands keys to the
 * session, and the view's intents routed to the session.
 *
 * Lifecycle (the host's `setScene`): `enter(host)` attaches the view and starts the session, `exit()` detaches both but
 * keeps them for the next `enter` (the select screen is kept through a play), and `dispose()` ends the scene.
 *
 * Sessions use Pixi only for types (`vite.config.ts` lints `session/**`), so a session runs in Node tests against a
 * fake view.
 */

import type { Container } from 'pixi.js';
import type { SceneIdentity } from '../host/family-kit.ts';
import type { PixiScene, PixiSceneHost } from '../host/scene-host.ts';
import type { FamilyView, IntentSink } from '../view/types.ts';

export type { SceneSession, SessionKeyEvent } from './contracts.ts';
import type { SceneSession, SessionKeyEvent } from './contracts.ts';
import { SceneController } from './controller.ts';

/** Where the scene listens for keys: `window` in a browser. */
export interface SessionKeyTarget {
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
}

export interface SessionSceneOptions {
  /** Where keys are listened for. Defaults to `window`; without one (Node) the scene gets no keys. */
  readonly keyTarget?: SessionKeyTarget;
  /** The clock frames are drawn on, in ms. Defaults to `performance.now()`. */
  readonly now?: () => number;
}

type SceneState = 'idle' | 'attaching' | 'entered' | 'disposed';

function defaultKeyTarget(): SessionKeyTarget | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function defaultNow(): number {
  return performance.now();
}

/** A key typed into a text field (the host's search box, a dialog) is the field's, not the scene's. */
function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes(String(element.type));
}

/** The plain-data form of a DOM key event. */
export function toSessionKeyEvent(type: SessionKeyEvent['type'], event: KeyboardEvent): SessionKeyEvent {
  return {
    type,
    code: event.code,
    key: event.key,
    repeat: event.repeat,
    timeStamp: event.timeStamp,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };
}

/** A `PixiScene` made of a scene session and the family view that draws it. See the module comment. */
export class SessionScene<Frame, Intent> implements PixiScene {
  public readonly identity: SceneIdentity;
  /** The view's screenshot descriptor, when it has one. */
  public readonly getStageInfo?: () => { container: Container; width: number; height: number };
  public readonly controller: SceneController<Frame, Intent>;
  private readonly view: FamilyView<Frame, Intent>;
  private readonly keyTarget: SessionKeyTarget | undefined;
  private readonly now: () => number;
  private state: SceneState = 'idle';
  /** Bumped by every `exit` / `dispose`, so an `enter` still waiting on the view's `attach` knows it was overtaken. */
  private generation = 0;
  private host: PixiSceneHost | undefined;

  public constructor(
    session: SceneSession<Frame, Intent>,
    view: FamilyView<Frame, Intent>,
    options: SessionSceneOptions = {},
  ) {
    this.controller = new SceneController(session);
    this.view = view;
    this.keyTarget = options.keyTarget ?? defaultKeyTarget();
    this.now = options.now ?? defaultNow;
    this.identity = { kind: session.kind, family: view.family };
    if (view.getStageInfo !== undefined) {
      this.getStageInfo = () => view.getStageInfo!();
    }
  }

  /** The view's scene graph, which the host puts on the stage. */
  public get root(): Container {
    return this.view.root;
  }

  /** Whether the scene is on the stage: attached, ticking and listening. */
  public get entered(): boolean {
    return this.state === 'entered';
  }

  public get disposed(): boolean {
    return this.state === 'disposed';
  }

  /**
   * Attaches the view, starts the session, then listens for keys and ticks; the first frame is drawn before this
   * resolves, so the stage never shows an empty scene. Entering a scene already entered does nothing.
   */
  public async enter(host: PixiSceneHost): Promise<void> {
    if (this.state === 'disposed') throw new Error('SessionScene: entered after dispose');
    if (this.state !== 'idle') return;
    this.state = 'attaching';
    const generation = this.generation;
    await this.view.attach(host, this.emit);
    if (generation !== this.generation) {
      // Left while the view was attaching: undo the attach, unless the scene ended (the view is disposed) or a newer
      // `enter` is attaching it again.
      if ((this.state as SceneState) === 'idle') this.view.detach();
      return;
    }
    this.state = 'entered';
    this.host = host;
    this.controller.enter(this.now());
    this.keyTarget?.addEventListener('keydown', this.onKeyDown);
    this.keyTarget?.addEventListener('keyup', this.onKeyUp);
    host.app.ticker.add(this.tick);
    this.tick();
  }

  /** Stops ticking and listening and detaches the view and the session, keeping both for the next `enter`. */
  public exit(): void {
    if (this.state === 'attaching') {
      this.generation += 1;
      this.state = 'idle';
      return;
    }
    if (this.state !== 'entered') return;
    this.generation += 1;
    this.state = 'idle';
    this.host?.app.ticker.remove(this.tick);
    this.host = undefined;
    this.keyTarget?.removeEventListener('keydown', this.onKeyDown);
    this.keyTarget?.removeEventListener('keyup', this.onKeyUp);
    this.view.detach();
    this.controller.exit();
  }

  /** Ends the scene: leaves the stage if on it, then disposes the view and the session. */
  public dispose(): void {
    if (this.state === 'disposed') return;
    this.exit();
    this.state = 'disposed';
    this.generation += 1;
    this.view.dispose();
    this.controller.dispose();
  }

  /**
   * One frame: the session advances, the view draws. Advancing can end the screen (a decide screen's time runs out and
   * its host moves on), and a scene its host left or disposed meanwhile draws nothing more.
   */
  private readonly tick = (): void => {
    if (this.state !== 'entered') return;
    const frame = this.controller.advance(this.now());
    if ((this.state as SceneState) !== 'entered' || frame === undefined) return;
    this.view.draw(frame);
  };

  /** The view's intents reach the session only while the scene is on the stage. */
  private readonly emit: IntentSink<Intent> = (intent) => {
    if (this.state !== 'entered') return;
    this.controller.dispatch(intent);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.handleKey('down', event);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.handleKey('up', event);
  };

  private handleKey(type: SessionKeyEvent['type'], event: KeyboardEvent): void {
    const target = event.composedPath?.()[0] ?? event.target;
    if (this.state !== 'entered' || isEditableKeyTarget(target)) return;
    // Native controls activate themselves on Enter/Space. Let their click generate exactly one intent.
    const tag = (target as { tagName?: string } | null)?.tagName;
    if ((tag === 'BUTTON' || tag === 'A') && (event.code === 'Enter' || event.code === 'Space')) return;
    if (this.controller.handleKey(toSessionKeyEvent(type, event))) event.preventDefault();
  }
}
