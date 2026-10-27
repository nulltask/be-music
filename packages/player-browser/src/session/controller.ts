import type { SceneSession, SessionKeyEvent } from './contracts.ts';

/** A stable selected snapshot suitable for framework subscriptions; undefined before the first advance. */
export interface SceneStore<Value> {
  getSnapshot(): Value | undefined;
  subscribe(listener: () => void): () => void;
}

/** Drives a session without a renderer, DOM, global input or an owned clock. One driver, any number of observers. */
export class SceneController<Frame, Intent> {
  private readonly session: SceneSession<Frame, Intent>;
  private readonly listeners = new Set<() => void>();
  private snapshot: Frame | undefined;
  private active = false;
  private disposed = false;
  private generation = 0;

  public constructor(session: SceneSession<Frame, Intent>) {
    this.session = session;
  }

  public enter(nowMs: number): void {
    if (this.disposed) throw new Error('Cannot enter a disposed scene controller');
    if (this.active) return;
    this.active = true;
    this.generation++;
    this.session.enter(nowMs);
  }

  public exit(): void {
    if (!this.active) return;
    this.active = false;
    this.generation++;
    this.session.exit();
  }

  /** Advances once and broadcasts the same frame; observers never drain the session's transient events again. */
  public advance(nowMs: number): Frame | undefined {
    if (!this.active) return undefined;
    const generation = this.generation;
    const frame = this.session.frame(nowMs);
    if (!this.active || generation !== this.generation) return undefined;
    this.snapshot = frame;
    for (const listener of Array.from(this.listeners)) {
      listener();
      if (!this.active || generation !== this.generation) return undefined;
    }
    return frame;
  }

  public dispatch(intent: Intent): void {
    if (this.active) this.session.dispatch(intent);
  }

  public handleKey(event: SessionKeyEvent): boolean {
    return this.active && this.session.handleKey(event);
  }

  public getSnapshot = (): Frame | undefined => this.snapshot;

  public subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Select a read-only value. Use equals for allocated selections; only changed values notify the framework. */
  public createStore<Value>(
    select: (frame: Frame) => Value,
    equals: (a: Value, b: Value) => boolean = Object.is,
  ): SceneStore<Value> {
    let source = this.snapshot;
    let initialized = source !== undefined;
    let value = source === undefined ? undefined : select(source);
    const read = (): Value | undefined => {
      if (source === this.snapshot) return value;
      source = this.snapshot;
      if (source !== undefined) {
        const next = select(source);
        if (!initialized || !equals(value as Value, next)) value = next;
        initialized = true;
      } else {
        initialized = false;
        value = undefined;
      }
      return value;
    };
    return {
      getSnapshot: read,
      subscribe: (listener) => {
        let previous = read();
        return this.subscribe(() => {
          const next = read();
          if (!Object.is(previous, next)) {
            previous = next;
            listener();
          }
        });
      },
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.exit();
    this.disposed = true;
    this.listeners.clear();
    this.snapshot = undefined;
    this.session.dispose();
  }
}
