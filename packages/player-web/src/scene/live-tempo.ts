import type { PlayerInputCommand } from '@be-music/player/core/input-signal-bus';
import { clampPlayTempo } from '../runtime/play-tempo.ts';

type TempoCommandSink = { pushCommand: (command: PlayerInputCommand) => void };

/**
 * A gameplay scene's live play tempo: the tempo in force (the play's starting one, then each change the engine
 * reports) and the changes the host asks for, pushed to the engine as its `{ kind: 'tempo' }` input command. A change
 * asked for before the engine's input bus is up waits for it. With `enabled` false (keep pitch, or a replay) it takes
 * none.
 */
export class LiveTempo {
  private pending: number | undefined;
  private signals: TempoCommandSink | undefined;

  public constructor(
    public tempo: number,
    private readonly enabled = true,
  ) {}

  /** Asks the engine for `tempo` (clamped by `clampPlayTempo`). Returns whether the change was taken. */
  public request(tempo: number): boolean {
    if (!this.enabled) return false;
    const next = clampPlayTempo(tempo);
    if (this.signals === undefined) this.pending = next;
    else this.signals.pushCommand({ kind: 'tempo', tempo: next });
    return true;
  }

  /** The engine's input bus is up (or gone, `undefined`): a change asked for before goes out now. */
  public attach(signals: TempoCommandSink | undefined): void {
    this.signals = signals;
    if (signals === undefined || this.pending === undefined) return;
    signals.pushCommand({ kind: 'tempo', tempo: this.pending });
    this.pending = undefined;
  }
}
