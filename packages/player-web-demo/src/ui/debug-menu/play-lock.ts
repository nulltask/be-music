// The locks a play puts on the Debug Menu: the options it latched as it started stay disabled until it ends, and so do
// the skin controls, which would make the select screen again and end it. A play whose tempo changes live keeps the
// tempo slider. It works on the controls it is handed, so it is tested with stand-ins for lil-gui's controllers.

/** What a lock does to a Debug Menu control; a lil-gui `Controller` is one. */
export interface LockableControl {
  enable(enabled?: boolean): unknown;
  disable(disabled?: boolean): unknown;
}

/** The Debug Menu's controls a play locks, as they are when it locks or unlocks (a picker can be made again meanwhile). */
export interface PlayLockControls {
  /** "Auto-save play history", latched as a play starts. */
  readonly playlogSave: LockableControl | undefined;
  /** Every option read as a play starts (`DebugMenu.trackPlayOption`). */
  readonly playOptions: readonly LockableControl[];
  /** "Tempo (%)": one of the play options, which a play whose tempo changes live keeps enabled. */
  readonly tempo: LockableControl | undefined;
  /** Skin system, LR2 theme, Built-in skin, Skin effects and the Add skin buttons; one not made yet is `undefined`. */
  readonly skin: readonly (LockableControl | undefined)[];
}

/** Whether a play runs, and the Debug Menu controls it disables meanwhile. */
export class PlayLock {
  private skinLocked = false;
  private liveTempo = false;
  private readonly controls: () => PlayLockControls;

  /** `controls` is read each time the lock changes. */
  public constructor(controls: () => PlayLockControls) {
    this.controls = controls;
  }

  /** Whether a play runs, so the skin controls are disabled: a picker made meanwhile starts disabled too. */
  public get skinControlsLocked(): boolean {
    return this.skinLocked;
  }

  /** Whether the running play takes the tempo slider live (`allowsLiveTempo` at its start). */
  public get liveTempoPlay(): boolean {
    return this.liveTempo;
  }

  /**
   * Disables the options a play latches as it starts, and the skin controls with them, until {@link unlock}. With
   * `liveTempo`, the tempo slider stays enabled.
   */
  public lock(liveTempo = false): void {
    const controls = this.controls();
    controls.playlogSave?.disable();
    for (const controller of controls.playOptions) {
      controller.disable();
    }
    this.setSkinControlsLocked(controls, true);
    // The tempo slider changes this play's tempo live (`allowsLiveTempo`).
    this.liveTempo = liveTempo;
    if (liveTempo) controls.tempo?.enable();
  }

  /** Re-enables the playlog option controllers, and the skin controls, once no play is in flight. */
  public unlock(): void {
    this.liveTempo = false;
    const controls = this.controls();
    controls.playlogSave?.enable();
    for (const controller of controls.playOptions) {
      controller.enable();
    }
    this.setSkinControlsLocked(controls, false);
  }

  /**
   * Disables the Debug Menu's skin controls for a play, or enables them again: Skin system, Built-in skin, Skin
   * effects, the LR2 theme picker and the Add skin buttons all make the select screen again, which would end the play.
   * A drop during a play still can; the router then ends the course run (`endCourseRun`).
   */
  private setSkinControlsLocked(controls: PlayLockControls, locked: boolean): void {
    this.skinLocked = locked;
    for (const controller of controls.skin) {
      controller?.enable(!locked);
    }
  }
}
