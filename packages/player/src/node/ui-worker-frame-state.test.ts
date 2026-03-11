import { describe, expect, test, vi } from 'vitest';
import { createUiWorkerFrameState } from './ui-worker-frame-state.ts';

describe('ui worker frame state', () => {
  test('applies reactive HUD updates and rerenders frame layout on changes', () => {
    const applyPaused = vi.fn();
    const applyHighSpeed = vi.fn();
    const applyJudgeCombo = vi.fn();
    const applyTerminalSize = vi.fn();
    const syncFrameLayout = vi.fn();
    const requestFrameRender = vi.fn();
    const frameState = createUiWorkerFrameState({
      initialPaused: false,
      initialHighSpeed: 1,
      initialJudgeCombo: {
        judge: 'READY',
        combo: 0,
        updatedAtMs: 0,
      },
      applyPaused,
      applyHighSpeed,
      applyJudgeCombo,
      applyTerminalSize,
      syncFrameLayout,
      requestFrameRender,
    });

    expect(applyPaused).toHaveBeenLastCalledWith(false);
    expect(applyHighSpeed).toHaveBeenLastCalledWith(1);
    expect(applyJudgeCombo).toHaveBeenLastCalledWith({
      judge: 'READY',
      combo: 0,
      updatedAtMs: 0,
    });
    expect(syncFrameLayout).toHaveBeenLastCalledWith(undefined, undefined, undefined);
    expect(requestFrameRender).toHaveBeenCalledTimes(0);

    const frame = {
      currentBeat: 2,
      currentSeconds: 1.5,
      totalSeconds: 120,
      summary: {
        total: 100,
        perfect: 0,
        fast: 0,
        slow: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        exScore: 0,
        score: 0,
      },
      notes: [],
    };
    frameState.setFrame(frame);
    expect(syncFrameLayout).toHaveBeenLastCalledWith(frame, undefined, undefined);
    expect(requestFrameRender).toHaveBeenCalledTimes(1);

    frameState.setPaused(true);
    frameState.setHighSpeed(1.5);
    frameState.setJudgeCombo({
      judge: 'GREAT',
      combo: 12,
      channel: '11',
      updatedAtMs: 1234,
    });
    expect(applyPaused).toHaveBeenLastCalledWith(true);
    expect(applyHighSpeed).toHaveBeenLastCalledWith(1.5);
    expect(applyJudgeCombo).toHaveBeenLastCalledWith({
      judge: 'GREAT',
      combo: 12,
      channel: '11',
      updatedAtMs: 1234,
    });

    frameState.setTerminalSize(120, 32);
    expect(applyTerminalSize).toHaveBeenLastCalledWith(120, 32);
    expect(syncFrameLayout).toHaveBeenLastCalledWith(frame, 120, 32);
    expect(requestFrameRender).toHaveBeenCalledTimes(2);

    frameState.invalidateFrame();
    expect(requestFrameRender).toHaveBeenCalledTimes(3);

    frameState.dispose();
  });

  test('deduplicates equivalent state writes', () => {
    const applyPaused = vi.fn();
    const applyHighSpeed = vi.fn();
    const applyJudgeCombo = vi.fn();
    const applyTerminalSize = vi.fn();
    const syncFrameLayout = vi.fn();
    const requestFrameRender = vi.fn();
    const frameState = createUiWorkerFrameState({
      initialPaused: false,
      initialHighSpeed: 1,
      initialJudgeCombo: {
        judge: 'READY',
        combo: 0,
        updatedAtMs: 0,
      },
      applyPaused,
      applyHighSpeed,
      applyJudgeCombo,
      applyTerminalSize,
      syncFrameLayout,
      requestFrameRender,
    });

    applyPaused.mockClear();
    applyHighSpeed.mockClear();
    applyJudgeCombo.mockClear();
    applyTerminalSize.mockClear();
    syncFrameLayout.mockClear();

    frameState.setPaused(false);
    frameState.setHighSpeed(1);
    frameState.setJudgeCombo({
      judge: 'READY',
      combo: 0,
      updatedAtMs: 0,
    });
    frameState.setTerminalSize(undefined, undefined);

    expect(applyPaused).not.toHaveBeenCalled();
    expect(applyHighSpeed).not.toHaveBeenCalled();
    expect(applyJudgeCombo).not.toHaveBeenCalled();
    expect(applyTerminalSize).not.toHaveBeenCalled();
    expect(syncFrameLayout).not.toHaveBeenCalled();
    expect(requestFrameRender).not.toHaveBeenCalled();

    frameState.dispose();
  });
});
