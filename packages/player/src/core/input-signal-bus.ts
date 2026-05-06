import { signal } from 'alien-signals';
import type { HighSpeedControlAction } from './high-speed-control.ts';

type WritableSignal<T> = {
  (): T;
  (value: T): void;
};

export type PlayerInputCommand =
  | { kind: 'interrupt'; reason: 'escape' | 'ctrl-c' | 'restart' }
  | { kind: 'toggle-pause' }
  | { kind: 'high-speed'; action: HighSpeedControlAction }
  | {
      kind: 'lane-input';
      tokens: string[];
      /**
       * `performance.now()` snapshot of the physical key press, in ms. The runtime adapter (web / node) sets this
       * the moment the OS-level event handler fires; the engine then judges against this timestamp instead of the
       * drain-time playback clock so a press that lands a few ms before the next 60 Hz tick still resolves at its
       * true timing rather than getting up to ~16 ms of artificial late-bias. Optional — older runtimes /
       * synthetic inputs that don't have a meaningful press time omit it and the engine falls back to drain-time
       * semantics.
       */
      pressedAt?: number;
    }
  | {
      kind: 'kitty-state';
      pressTokens: string[];
      repeatTokens: string[];
      releaseTokens: string[];
      /** `performance.now()` snapshot of the underlying physical event. See `lane-input.pressedAt` above. */
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
