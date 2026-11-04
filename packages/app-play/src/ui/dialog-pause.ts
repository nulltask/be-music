/** A play a modal can temporarily pause without resuming a play the user had already paused. */
export interface PausablePlay {
  isPaused(): boolean;
  requestTogglePause(): void;
}

/** Keeps one pause across overlapping Help and Settings dialogs. */
export class DialogPauseController {
  private readonly open = new Set<string>();
  private owned: PausablePlay | undefined;
  private readonly current: () => PausablePlay | undefined;
  constructor(current: () => PausablePlay | undefined) {
    this.current = current;
  }

  setOpen(dialog: string, open: boolean): void {
    if (open) {
      if (this.open.size === 0) {
        const play = this.current();
        if (play && !play.isPaused()) {
          play.requestTogglePause();
          this.owned = play;
        }
      }
      this.open.add(dialog);
      return;
    }
    this.open.delete(dialog);
    if (this.open.size > 0) return;
    const play = this.owned;
    this.owned = undefined;
    if (play && play === this.current() && play.isPaused()) play.requestTogglePause();
  }
}
