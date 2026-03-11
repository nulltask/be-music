import { signal } from 'alien-signals';

type WritableSignal<T> = {
  (): T;
  (value: T): void;
};

export interface PlayerJudgeComboSignalState {
  judge: string;
  combo: number;
  channel?: string;
  updatedAtMs: number;
}

export interface PlayerStateSignals {
  readonly paused: WritableSignal<boolean>;
  readonly highSpeed: WritableSignal<number>;
  readonly judgeComboTick: WritableSignal<number>;
  getJudgeCombo: () => Readonly<PlayerJudgeComboSignalState>;
  setPaused: (value: boolean) => void;
  setHighSpeed: (value: number) => void;
  publishJudgeCombo: (judge: string, combo: number, channel?: string, updatedAtMs?: number) => void;
}

export function createPlayerStateSignals(initialHighSpeed: number): PlayerStateSignals {
  const paused = signal(false);
  const highSpeed = signal(initialHighSpeed);
  const judgeComboTick = signal(0);
  const judgeComboState: PlayerJudgeComboSignalState = {
    judge: 'READY',
    combo: 0,
    updatedAtMs: 0,
  };

  const setPaused = (value: boolean): void => {
    if (paused() === value) {
      return;
    }
    paused(value);
  };

  const setHighSpeed = (value: number): void => {
    if (highSpeed() === value) {
      return;
    }
    highSpeed(value);
  };

  const publishJudgeCombo = (judge: string, combo: number, channel?: string, updatedAtMs = Date.now()): void => {
    judgeComboState.judge = judge;
    judgeComboState.combo = Math.max(0, Math.floor(combo));
    judgeComboState.channel = channel;
    judgeComboState.updatedAtMs = updatedAtMs;
    judgeComboTick(judgeComboTick() + 1);
  };

  return {
    paused,
    highSpeed,
    judgeComboTick,
    getJudgeCombo: () => judgeComboState,
    setPaused,
    setHighSpeed,
    publishJudgeCombo,
  };
}
