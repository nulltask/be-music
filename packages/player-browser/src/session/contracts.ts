import type { SceneKind } from '../host/family-kit.ts';

/** A key going down or up, as plain data so a session reads it without the DOM. */
export interface SessionKeyEvent {
  readonly type: 'down' | 'up';
  /** The physical key (`KeyboardEvent.code`, e.g. `'KeyZ'`, `'Escape'`). */
  readonly code: string;
  /** The key's value under the current layout (`KeyboardEvent.key`). */
  readonly key: string;
  /** An auto-repeat of a key held down. */
  readonly repeat: boolean;
  /** When the event happened (`KeyboardEvent.timeStamp`), on the host clock. */
  readonly timeStamp: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** A screen's behaviour, whatever family draws it: it reads keys and intents and answers each tick with a frame. */
export interface SceneSession<Frame, Intent> {
  readonly kind: SceneKind;
  /** The scene is on the stage from `nowMs`: start (or restart) the session's timers and sounds. */
  enter(nowMs: number): void;
  /** The scene left the stage: stop the session's timers and sounds, keeping its state for the next `enter`. */
  exit(): void;
  /** The scene ends. */
  dispose(): void;
  /** A key went down or up; returns whether the session used it, so the browser does not act on it too. */
  handleKey(event: SessionKeyEvent): boolean;
  /** Something the player asked for on the view. */
  dispatch(intent: Intent): void;
  /** Advances the session to `nowMs` and returns what the view draws. */
  frame(nowMs: number): Frame;
}
