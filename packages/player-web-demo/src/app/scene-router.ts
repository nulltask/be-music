// The web demo's scene router (ADR 0006): the one owner of the scene on stage. Every transition finalizes a recording
// in progress, hands the stage over with one `setScene` (the scene showing exits as the next enters, so the stage never
// shows an empty frame) and then disposes the scene that went, before the transition resolves. Transitions run one at a
// time, and a scene built for a navigation that a newer one replaced is disposed instead of shown.
//
// The select scene is kept alive across a decide, play and result (`docs/player-web.md`, "Scene lifecycle"); a play
// can load off stage behind a decide screen (`prepare`); and a play's sound can outlive its screen (`playDispose`).
//
// A run is the screens the scenes lead through on their own: a decide screen, a play and its result, and a course's
// every stage. A navigation the scenes asked for carries their run on (`continuesRun`); any other one (a drop, a skin
// or theme change, files or a replay loaded) interrupts it, and the host ends it (`onInterrupt`).

/** What the router asks of a scene: it disposes the scenes it owns. */
export interface RoutedScene {
  dispose(): void;
}

/** What the router asks of a play scene: it also loads it, off stage or while it shows. */
export interface RoutedPlayScene extends RoutedScene {
  prepare(onProgress?: (progress: number) => void): Promise<void>;
}

/**
 * The stage: `setScene(next)` exits the scene showing, then enters `next` (`undefined` leaves the stage empty), and
 * resolves once `next` has entered. `PixiSceneHost` is one.
 */
export interface SceneRouterHost<S> {
  setScene(scene: S | undefined): Promise<void>;
}

/** The video recording of a play: `finalize` stops and saves one in progress, and does nothing otherwise. */
export interface SceneRouterRecorder {
  finalize(): Promise<void>;
}

/** The screen a scene is shown as. */
export type SceneRole = 'select' | 'decide' | 'play' | 'result';

/**
 * A navigation's generation (`begin`). A transition or a `prepare` handed a token runs only while no navigation has
 * begun since.
 */
export type SceneRouteToken = number;

/** How a transition ends the play leaving the stage with it; the default is `play.dispose()`. */
export type PlayDispose<P> = (play: P) => void;

/** What a router step reports to `onError`: a recording's finalize, a scene's dispose or the host's `onInterrupt`. */
export type SceneRouterErrorStep = 'finalize' | 'dispose' | 'interrupt';

export interface SceneNavigationOptions {
  /**
   * The scenes asked for this navigation, and it carries their run on: a play's result, a result's next stage or retry,
   * a course's decide screen and stages. Without it the navigation interrupts the run
   * ({@link SceneRouterOptions.onInterrupt}). Read only by a call that begins the navigation (`begin`, or a `show` or
   * `leave` with no `token`).
   */
  readonly continuesRun?: boolean;
}

export interface SceneShowOptions<P> extends SceneNavigationOptions {
  readonly role: SceneRole;
  /**
   * Keep the scene alive after another one takes over: the router exits it but never disposes it. The default is `true`
   * for the select scene, which the router then holds as {@link SceneRouter.select}, and `false` for every other
   * screen. The caller disposes a kept scene of another role itself.
   */
  readonly keep?: boolean;
  /** How the play leaving the stage with this transition is ended (`preserveAudioTail` when its result shows). */
  readonly playDispose?: PlayDispose<P>;
  /**
   * The navigation the scene was built for (`begin`). When a newer navigation has begun, the scene is disposed instead
   * of shown. Without one the transition begins a navigation of its own.
   */
  readonly token?: SceneRouteToken;
}

export interface SceneLeaveOptions<P> extends SceneNavigationOptions {
  /** How the play leaving the stage is ended. */
  readonly playDispose?: PlayDispose<P>;
  /** The navigation the leave belongs to; without one it begins a navigation of its own. */
  readonly token?: SceneRouteToken;
}

export interface ScenePrepareOptions {
  /** The navigation the play was built for; a stale play is disposed instead of loaded. */
  readonly token?: SceneRouteToken;
  readonly onProgress?: (progress: number) => void;
}

export interface SceneRouterOptions<S> {
  readonly host: SceneRouterHost<S>;
  readonly recorder: SceneRouterRecorder;
  /**
   * A navigation begins that does not carry the run on ({@link SceneNavigationOptions.continuesRun}): the host ends
   * what the run was part of (a course's stages), so that it does not reach into the next play. Called as the
   * navigation begins, before any of its transitions runs; the scene showing then is still the run's.
   */
  readonly onInterrupt?: () => void;
  /**
   * A recording that failed to finalize, a scene that threw on dispose or an `onInterrupt` that threw; the navigation
   * goes on. Without it the error is rethrown on its own, as an uncaught error.
   */
  readonly onError?: (error: unknown, step: SceneRouterErrorStep) => void;
}

/**
 * Owns the scene on stage, the kept select scene and the play (`S` is any scene, `P` a play scene and `Sel` a select
 * scene). Transitions run one at a time, and only those of the newest navigation: `begin` starts one and hands out its
 * token, and a `show` or `leave` without a token starts one of its own. A navigation that does not carry the run on
 * interrupts it as it begins (`onInterrupt`). Read `current`, `select` and `play` for what the router holds.
 */
export class SceneRouter<S extends RoutedScene, P extends S & RoutedPlayScene, Sel extends S = S> {
  private readonly host: SceneRouterHost<S>;
  private readonly recorder: SceneRouterRecorder;
  private readonly onInterrupt: (() => void) | undefined;
  private readonly onError: (error: unknown, step: SceneRouterErrorStep) => void;
  /** The last transition in line; each one starts once it has settled. */
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private currentScene: S | undefined;
  private selectScene: Sel | undefined;
  private playScene: P | undefined;
  /** Scenes the router never disposes on its own. */
  private readonly kept = new WeakSet<S>();
  /** Scenes registered as plays (`prepare` or `role: 'play'`), ended with a `playDispose` when they leave. */
  private readonly plays = new WeakSet<S>();
  private readonly disposed = new WeakSet<S>();

  public constructor(options: SceneRouterOptions<S>) {
    this.host = options.host;
    this.recorder = options.recorder;
    this.onInterrupt = options.onInterrupt;
    this.onError =
      options.onError ??
      ((error) =>
        queueMicrotask(() => {
          throw error;
        }));
  }

  /** The scene on stage, once its transition has handed the stage over. */
  public get current(): S | undefined {
    return this.currentScene;
  }

  /** The kept select scene, on stage or off it. */
  public get select(): Sel | undefined {
    return this.selectScene;
  }

  /** The play: loading off stage behind a decide screen, or on stage. */
  public get play(): P | undefined {
    return this.playScene;
  }

  /**
   * Begins a navigation: every token handed out before is stale from now on. Unless it carries the run on
   * (`options.continuesRun`), it interrupts the run (`onInterrupt`).
   */
  public begin(options: SceneNavigationOptions = {}): SceneRouteToken {
    this.generation += 1;
    if (options.continuesRun !== true) this.interrupt();
    return this.generation;
  }

  /** Whether no navigation has begun since `token`'s. */
  public isCurrent(token: SceneRouteToken): boolean {
    return token === this.generation;
  }

  /**
   * Shows `scene` as `role`, after the transitions already in line: the recording in progress is finalized, `scene`
   * takes the stage from the scene showing (which exits as it enters), and the scene that went is disposed, unless it
   * is kept. A play loading off stage survives only a decide screen. Resolves `false`, with `scene` disposed unless it
   * is kept, when a newer navigation has begun by its turn (it begins one itself without `options.token`, interrupting
   * the run unless `options.continuesRun`), or when `scene` was already disposed.
   */
  public show(scene: P, options: SceneShowOptions<P> & { readonly role: 'play' }): Promise<boolean>;
  public show(scene: Sel, options: SceneShowOptions<P> & { readonly role: 'select' }): Promise<boolean>;
  public show(scene: S, options: SceneShowOptions<P> & { readonly role: 'decide' | 'result' }): Promise<boolean>;
  public show(scene: S, options: SceneShowOptions<P>): Promise<boolean> {
    const token = options.token ?? this.begin(options);
    return this.enqueue(async () => {
      if (!this.isCurrent(token) || this.disposed.has(scene)) {
        this.discard(scene);
        return false;
      }
      await this.finalizeRecording();
      if (!this.isCurrent(token)) {
        this.discard(scene);
        return false;
      }
      const previous = this.currentScene;
      const keep = options.keep ?? options.role === 'select';
      if (keep) this.kept.add(scene);
      const replacedSelect =
        options.role === 'select' && keep && this.selectScene !== scene ? this.selectScene : undefined;
      if (options.role === 'play') this.plays.add(scene);
      await this.host.setScene(scene);
      this.currentScene = scene;
      // The overloads take only a select scene as `role: 'select'`.
      if (options.role === 'select' && keep) this.selectScene = scene as Sel;
      if (previous !== undefined && previous !== scene && !this.kept.has(previous)) {
        this.release(previous, options.playDispose);
      }
      if (replacedSelect !== undefined) this.release(replacedSelect);
      // A play loading off stage waits only behind a decide screen.
      if (options.role !== 'decide') this.dropHeldPlay(scene);
      if (options.role === 'play' && this.isPlay(scene)) this.playScene = scene;
      return true;
    });
  }

  /**
   * Takes the scene showing off the stage, after the transitions already in line, and leaves the stage empty (files
   * loading, a play being built): the recording in progress is finalized, a kept scene stays for later and any other
   * is disposed, and so is a play loading off stage. Resolves `false` when a newer navigation has begun by its turn
   * (it begins one itself without `options.token`, interrupting the run unless `options.continuesRun`).
   */
  public leave(options: SceneLeaveOptions<P> = {}): Promise<boolean> {
    const token = options.token ?? this.begin(options);
    return this.enqueue(async () => {
      if (!this.isCurrent(token)) return false;
      await this.finalizeRecording();
      if (!this.isCurrent(token)) return false;
      const previous = this.currentScene;
      if (previous !== undefined) {
        await this.host.setScene(undefined);
        this.currentScene = undefined;
        if (!this.kept.has(previous)) this.release(previous, options.playDispose);
      }
      this.dropHeldPlay();
      return true;
    });
  }

  /**
   * Loads the play `scene` (its `prepare`) and holds it as {@link play}: off stage behind a decide screen, or on stage
   * after `show`. A play it replaces is disposed when it is off stage. Not a transition: it runs at once. A play that
   * fails to load is disposed when off stage and the error rethrown; one whose `options.token` goes stale is disposed
   * and resolves `false`.
   */
  public async prepare(scene: P, options: ScenePrepareOptions = {}): Promise<boolean> {
    const { token } = options;
    if ((token !== undefined && !this.isCurrent(token)) || this.disposed.has(scene)) {
      this.discard(scene);
      return false;
    }
    // A play it replaces goes when off stage; one on stage goes with the transition that takes it off.
    if (this.playScene !== this.currentScene) this.dropHeldPlay(scene);
    this.plays.add(scene);
    this.playScene = scene;
    try {
      await scene.prepare(options.onProgress);
    } catch (error) {
      this.discard(scene);
      throw error;
    }
    if (token !== undefined && !this.isCurrent(token)) {
      this.discard(scene);
      return false;
    }
    return !this.disposed.has(scene);
  }

  /**
   * Disposes the kept select scene, after the transitions already in line, first taking it off the stage when it is
   * showing (a new theme or skin family: the next select scene is built afresh).
   */
  public dropSelect(): Promise<void> {
    return this.enqueue(async () => {
      const select = this.selectScene;
      if (select === undefined) return;
      if (this.currentScene === select) {
        await this.host.setScene(undefined);
        this.currentScene = undefined;
      }
      this.selectScene = undefined;
      this.release(select);
    });
  }

  private enqueue<T>(step: () => Promise<T>): Promise<T> {
    const run = this.queue.then(step);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Tells the host the run is interrupted (`onInterrupt`); an error goes to `onError` and the navigation goes on. */
  private interrupt(): void {
    if (this.onInterrupt === undefined) return;
    try {
      this.onInterrupt();
    } catch (error) {
      this.onError(error, 'interrupt');
    }
  }

  private async finalizeRecording(): Promise<void> {
    try {
      await this.recorder.finalize();
    } catch (error) {
      this.onError(error, 'finalize');
    }
  }

  private isPlay(scene: S): scene is P {
    return this.plays.has(scene);
  }

  /** Stops holding the play (other than `except`), disposing it unless it is kept. */
  private dropHeldPlay(except?: S): void {
    const held = this.playScene;
    if (held === undefined || held === except) return;
    if (this.kept.has(held)) this.playScene = undefined;
    else this.release(held);
  }

  /** Disposes a scene that will not be shown, unless the router keeps it, shows it or already disposed it. */
  private discard(scene: S): void {
    if (this.kept.has(scene) || scene === this.currentScene || scene === this.selectScene) return;
    this.release(scene);
  }

  /** Disposes `scene` once (a play with `playDispose`), and forgets it. */
  private release(scene: S, playDispose?: PlayDispose<P>): void {
    const held: S | undefined = this.playScene;
    if (held === scene) this.playScene = undefined;
    if (this.selectScene === scene) this.selectScene = undefined;
    if (this.disposed.has(scene)) return;
    this.disposed.add(scene);
    try {
      if (playDispose !== undefined && this.isPlay(scene)) playDispose(scene);
      else scene.dispose();
    } catch (error) {
      this.onError(error, 'dispose');
    }
  }
}
