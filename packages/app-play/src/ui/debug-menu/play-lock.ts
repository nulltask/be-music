// The locks a play puts on the Debug Menu: the options it latched as it started stay disabled until it ends, and so do
// the skin controls, which would make the select screen again and end it. A play whose tempo changes live keeps the
// tempo slider. It works on the controls it is handed, so it is tested against the native disabled-state contract.

/** Native bindings and buttons expose the same disabled-state contract. */
export interface LockableControl {
  disabled: boolean;
}

/** The Debug Menu's controls a play locks, as they are when it locks or unlocks (a picker can be made again meanwhile). */
export interface PlayLockControls {
  /** "Auto-save replays", latched as a play starts. */
  readonly replaySave: LockableControl | undefined;
  /** Every option read as a play starts (`DebugMenu.trackPlayOption`). */
  readonly playOptions: readonly LockableControl[];
  /** "Tempo (%)": one of the play options, which a play whose tempo changes live keeps enabled. */
  readonly tempo: LockableControl | undefined;
  /**
   * LR2 theme, Built-in skin, Skin effects and the Add skin buttons. Skin system is not here: during a play it swaps
   * the drawing family and keeps the chart. One not made yet is `undefined`.
   */
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
    if (controls.replaySave) controls.replaySave.disabled = true;
    for (const controller of controls.playOptions) {
      controller.disabled = true;
    }
    this.setSkinControlsLocked(controls, true);
    // The tempo slider changes this play's tempo live (`allowsLiveTempo`).
    this.liveTempo = liveTempo;
    if (liveTempo && controls.tempo) controls.tempo.disabled = false;
  }

  /** Re-enables the replay option controllers, and the skin controls, once no play is in flight. */
  public unlock(): void {
    this.liveTempo = false;
    const controls = this.controls();
    if (controls.replaySave) controls.replaySave.disabled = false;
    for (const controller of controls.playOptions) {
      controller.disabled = false;
    }
    this.setSkinControlsLocked(controls, false);
  }

  /**
   * Disables the Debug Menu's skin controls for a play, or enables them again: Built-in skin, Skin effects, the LR2
   * theme picker and the Add skin buttons make the select screen again, which would end the play. Skin system is not
   * among them. A drop that opens the select screen still can, and the router then ends the course run
   * (`CourseRunService.endRun`). A skin dropped on its own switches the play's family instead.
   */
  private setSkinControlsLocked(controls: PlayLockControls, locked: boolean): void {
    this.skinLocked = locked;
    for (const controller of controls.skin) {
      if (controller) controller.disabled = locked;
    }
  }
}
