// The status line: the Debug Menu's read-only Status row, which every load, play, result and failure writes to, and
// which the test hook logs (`statusLog`).

export interface StatusLineOptions {
  /** The state the line is kept in: the Debug Menu's, whose Status row shows it. */
  readonly settings: { status: string };
  /** Repaints the Status row (`DebugMenu.refreshStatus`). */
  readonly refresh: () => void;
  /** Hands the line to the test hook (`TestHookRecorder.recordStatus`), when it is installed. */
  readonly record: (text: string) => void;
}

/** The status line, and whether it describes a play or result. */
export class StatusLine {
  /** Whether the status line describes a play or result, which a return to the select screen replaces. */
  private playStatusShown = false;
  private readonly settings: StatusLineOptions['settings'];
  private readonly refresh: StatusLineOptions['refresh'];
  private readonly record: StatusLineOptions['record'];

  public constructor(options: StatusLineOptions) {
    this.settings = options.settings;
    this.refresh = options.refresh;
    this.record = options.record;
  }

  /** Whether the line was last set by {@link setPlay}. */
  public get playShown(): boolean {
    return this.playStatusShown;
  }

  /**
   * Single chokepoint for status-text updates. Writes the new value into `guiState` and refreshes the lil-gui
   * controller so the read-only row repaints with the new text.
   */
  public set(text: string): void {
    this.settings.status = text;
    this.playStatusShown = false;
    this.refresh();
    this.record(text);
  }

  /** Shows a status about the play or result on screen, which the select screen replaces when it comes back. */
  public setPlay(text: string): void {
    this.set(text);
    this.playStatusShown = true;
  }
}
