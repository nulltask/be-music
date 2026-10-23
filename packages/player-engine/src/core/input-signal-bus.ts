import { signal } from 'alien-signals';
import type { ReplayViewState } from '../replay/view.ts';
import type { HighSpeedControlAction } from './high-speed-control.ts';

type WritableSignal<T> = {
  (): T;
  (value: T): void;
};

export type PlayerInputCommand =
  | { kind: 'interrupt'; reason: 'escape' | 'ctrl-c' | 'restart' }
  | { kind: 'toggle-pause' }
  | { kind: 'high-speed'; action: HighSpeedControlAction }
  /**
   * The host's view changed (hi-speed, covers, lift): the engine records it in the replay at the chart time it
   * drains the command. It changes no judgment.
   */
  | { kind: 'view'; change: ReplayViewState }
  /**
   * The host changed the play tempo (`PlayerOptions.speed`) during the play: the engine re-anchors its clock at the
   * chart time it drains the command, runs at `tempo` from there on and records the change in the replay. Inputs and
   * judgments stay in chart time.
   */
  | { kind: 'tempo'; tempo: number }
  /**
   * The host moves the play to chart second `seconds` (clamped to the chart). The engine applies the last seek of each
   * drain at its next tick: the judge state becomes the one a play from the start reaches there, the audio follows,
   * chart time re-bases on the play clock (a paused play stays paused), the UI gets a `seek` command and a frame at
   * `seconds` with the next generation, and the play records no replay. During the lead-in it sets where the chart
   * starts. AUTO play and replays rebuild their judgments; manual play starts practice without earlier judgments.
   */
  | { kind: 'seek'; seconds: number }
  | {
      kind: 'lane-input';
      tokens: string[];
      /**
       * Wall-clock-ms snapshot of the physical key press (`performance.timeOrigin + performance.now()`-style,
       * i.e. `Date.now()`-equivalent with sub-ms precision). The runtime adapter (web / node) sets this the
       * moment the OS-level event handler fires; the engine subtracts the wall-clock delta against this when
       * resolving the judge timestamp so a press that lands a few ms before the next 60 Hz tick still resolves
       * at its true timing rather than getting up to ~16 ms of artificial late-bias.
       *
       * The wall-clock domain (NOT raw `performance.now()`) is what makes this safe across `worker_threads`:
       * the TUI runs the input adapter on the main thread and the engine in a worker, and each thread has its
       * own `performance.timeOrigin`, so a raw `performance.now()` snapshot wouldn't survive the cross-thread
       * comparison. Both adapters add `performance.timeOrigin` to whatever event-side timestamp they have so
       * the value is process-shared.
       *
       * Optional — older runtimes / synthetic inputs that don't have a meaningful press time omit it and the
       * engine falls back to drain-time semantics.
       */
      pressedAt?: number;
    }
  | {
      kind: 'kitty-state';
      pressTokens: string[];
      repeatTokens: string[];
      releaseTokens: string[];
      /** Wall-clock-ms snapshot of the underlying physical event. Same domain as `lane-input.pressedAt`. */
      pressedAt?: number;
    };

export interface PlayerInputSignalBus {
  readonly tick: WritableSignal<number>;
  pushCommand: (command: PlayerInputCommand) => void;
  drainCommands: () => PlayerInputCommand[];
}

export function createPlayerInputSignalBus(): PlayerInputSignalBus {
  const tick = signal(0);
  const commandQueue: PlayerInputCommand[] = [];

  const pushCommand = (command: PlayerInputCommand): void => {
    commandQueue.push(command);
    tick(tick() + 1);
  };

  const drainCommands = (): PlayerInputCommand[] => commandQueue.splice(0, commandQueue.length);

  return {
    tick,
    pushCommand,
    drainCommands,
  };
}
