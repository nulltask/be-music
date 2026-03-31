import { effect, effectScope, signal } from 'alien-signals';
import type { PlayerUiFramePayload } from '../core/ui-signal-bus.ts';
import type { PlayerJudgeComboSignalState } from '../state-signals.ts';
import type { PlayerUiFramePatch } from './ui-frame-patch.ts';

type WritableSignal<T> = {
  (): T;
  (value: T): void;
};

interface TerminalSizeState {
  columns: number | undefined;
  rows: number | undefined;
}

export interface CreateUiWorkerFrameStateOptions {
  initialPaused: boolean;
  initialHighSpeed: number;
  initialJudgeCombo: PlayerJudgeComboSignalState;
  applyPaused: (value: boolean) => void;
  applyHighSpeed: (value: number) => void;
  applyJudgeCombo: (state: Readonly<PlayerJudgeComboSignalState>) => void;
  applyTerminalSize: (columns: number | undefined, rows: number | undefined) => void;
  syncFrameLayout: (
    frame: PlayerUiFramePayload | undefined,
    columns: number | undefined,
    rows: number | undefined,
  ) => void;
  requestFrameRender: () => void;
}

export interface UiWorkerFrameState {
  getFrame: () => PlayerUiFramePayload | undefined;
  setFrame: (frame: PlayerUiFramePatch) => void;
  setPaused: (value: boolean) => void;
  setHighSpeed: (value: number) => void;
  setJudgeCombo: (state: PlayerJudgeComboSignalState) => void;
  setTerminalSize: (columns: number | undefined, rows: number | undefined) => void;
  invalidateFrame: () => void;
  dispose: () => void;
}

export function createUiWorkerFrameState(options: CreateUiWorkerFrameStateOptions): UiWorkerFrameState {
  const frame = signal<PlayerUiFramePayload | undefined>(undefined);
  const paused = signal(options.initialPaused);
  const highSpeed = signal(options.initialHighSpeed);
  const judgeCombo = signal(options.initialJudgeCombo);
  const terminalSize = signal<TerminalSizeState>({
    columns: undefined,
    rows: undefined,
  });
  const refreshTick = signal(0);

  const stopEffects = effectScope(() => {
    effect(() => {
      options.applyPaused(paused());
    });
    effect(() => {
      options.applyHighSpeed(highSpeed());
    });
    effect(() => {
      options.applyJudgeCombo(judgeCombo());
    });
    effect(() => {
      const size = terminalSize();
      options.applyTerminalSize(size.columns, size.rows);
    });
    effect(() => {
      const currentFrame = frame();
      const size = terminalSize();
      refreshTick();
      options.syncFrameLayout(currentFrame, size.columns, size.rows);
      if (currentFrame) {
        options.requestFrameRender();
      }
    });
  });

  const updateSignal = <T>(target: WritableSignal<T>, next: T, equals: (left: T, right: T) => boolean): void => {
    const current = target();
    if (equals(current, next)) {
      return;
    }
    target(next);
  };

  return {
    getFrame: () => frame(),
    setFrame: (nextFrame) => {
      const current = frame();
      if (!current) {
        frame(nextFrame as PlayerUiFramePayload);
        return;
      }
      let nextNotes = nextFrame.notes ?? current.notes;
      if (nextFrame.noteStateUpdates && nextNotes.length > 0) {
        const mutableNotes = nextNotes.map((note) => ({ ...note }));
        for (const update of nextFrame.noteStateUpdates) {
          const target = mutableNotes[update.index];
          if (!target) {
            continue;
          }
          target.judged = update.judged;
          if (typeof update.visibleUntilBeat === 'number' && Number.isFinite(update.visibleUntilBeat)) {
            target.visibleUntilBeat = update.visibleUntilBeat;
          } else {
            delete target.visibleUntilBeat;
          }
        }
        nextNotes = mutableNotes;
      }
      frame({
        ...current,
        ...nextFrame,
        notes: nextNotes,
        landmineNotes: nextFrame.landmineNotes ?? current.landmineNotes,
        invisibleNotes: nextFrame.invisibleNotes ?? current.invisibleNotes,
      });
    },
    setPaused: (value) => {
      updateSignal(paused, value, (left, right) => left === right);
    },
    setHighSpeed: (value) => {
      updateSignal(highSpeed, value, (left, right) => Math.abs(left - right) < 1e-9);
    },
    setJudgeCombo: (state) => {
      const nextState: PlayerJudgeComboSignalState = {
        judge: state.judge,
        combo: state.combo,
        channel: state.channel,
        updatedAtMs: state.updatedAtMs,
      };
      updateSignal(
        judgeCombo,
        nextState,
        (left, right) =>
          left.judge === right.judge &&
          left.combo === right.combo &&
          left.channel === right.channel &&
          left.updatedAtMs === right.updatedAtMs,
      );
    },
    setTerminalSize: (columns, rows) => {
      updateSignal(
        terminalSize,
        { columns, rows },
        (left, right) => left.columns === right.columns && left.rows === right.rows,
      );
    },
    invalidateFrame: () => {
      refreshTick(refreshTick() + 1);
    },
    dispose: () => {
      stopEffects();
    },
  };
}
