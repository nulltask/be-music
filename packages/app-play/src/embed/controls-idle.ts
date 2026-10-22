/** How long the viewer may be idle during a play before the video controls fade out. */
export const CONTROLS_IDLE_MS = 3000;

/** What decides whether a preview's video controls show. */
export interface ControlsVisibility {
  /** No pointer, touch, wheel or key input for `CONTROLS_IDLE_MS`. */
  readonly idle: boolean;
  /** The play is running: not paused, ending or not started. */
  readonly playing: boolean;
  /** The pointer is over the controls. */
  readonly hovered: boolean;
  /** A control holds the keyboard focus. */
  readonly focused: boolean;
}

/** The controls fade out only while a play runs and the viewer is idle, away from them, as a video player's do. */
export function resolveControlsHidden(visibility: ControlsVisibility): boolean {
  return visibility.idle && visibility.playing && !visibility.hovered && !visibility.focused;
}

/** The input that wakes the controls. */
const WAKE_EVENTS = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart'] as const;

/**
 * Hides `hud`'s video controls (`controlsHidden`) after `CONTROLS_IDLE_MS` without input during a play, and shows them
 * again on any input. `setPlaying` follows the play's stage; `dispose` removes the listeners and the timer.
 */
export class ControlsIdleController {
  private readonly hud: HTMLElement & { controlsHidden: boolean };
  private readonly window: Window;
  private idle = false;
  private playing = false;
  private hovered = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(hud: HTMLElement & { controlsHidden: boolean }, view: Window) {
    this.hud = hud;
    this.window = view;
    for (const name of WAKE_EVENTS) view.addEventListener(name, this.wake, { capture: true, passive: true });
    hud.addEventListener('pointerover', this.enter);
    hud.addEventListener('pointerout', this.leave);
    hud.addEventListener('focusin', this.update);
    hud.addEventListener('focusout', this.update);
    this.wake();
  }

  public setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    this.playing = playing;
    this.wake();
  }

  public dispose(): void {
    for (const name of WAKE_EVENTS) this.window.removeEventListener(name, this.wake, { capture: true });
    this.hud.removeEventListener('pointerover', this.enter);
    this.hud.removeEventListener('pointerout', this.leave);
    this.hud.removeEventListener('focusin', this.update);
    this.hud.removeEventListener('focusout', this.update);
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  private readonly wake = (): void => {
    this.idle = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.idle = true;
      this.update();
    }, CONTROLS_IDLE_MS);
    this.update();
  };

  private readonly enter = (): void => {
    this.hovered = true;
    this.update();
  };

  private readonly leave = (): void => {
    this.hovered = false;
    this.update();
  };

  private readonly update = (): void => {
    const focused = this.hud.matches(':focus-within');
    this.hud.controlsHidden = resolveControlsHidden({
      idle: this.idle,
      playing: this.playing,
      hovered: this.hovered,
      focused,
    });
  };
}
