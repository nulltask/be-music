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
  | { kind: 'lane-input'; tokens: string[] }
  | {
      kind: 'kitty-state';
      pressTokens: string[];
      repeatTokens: string[];
      releaseTokens: string[];
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
