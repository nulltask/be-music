/** Runs background library reads while choosing a chart. An interrupted read starts again after play. */
export class LibraryRefresh {
  private readonly active = new Set<AbortController>();
  private paused: { untilResumed: Promise<void>; resume: () => void } | undefined;

  public pause(): void {
    if (this.paused !== undefined) return;
    let resume!: () => void;
    const untilResumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    this.paused = { untilResumed, resume };
    for (const controller of this.active) controller.abort();
  }

  public resume(): void {
    const paused = this.paused;
    this.paused = undefined;
    paused?.resume();
  }

  public async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (;;) {
      while (this.paused !== undefined) await this.paused.untilResumed;
      const controller = new AbortController();
      this.active.add(controller);
      try {
        return await work(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        this.active.delete(controller);
      }
    }
  }
}
