import { createHiSpeedState, createPlayState } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { createPlayerInputSignalBus } from '@be-music/player-engine/signals';
import {
  handleSharedEngineExitKey,
  isQuickRetryHeld,
  QUICK_RETRY_HOLD_MS,
  recordControlKey,
  START_SELECT_QUIT_MS,
  trackPlayKey,
} from './play-input.ts';
import { HISPEED_STEP } from '@be-music/player-scene-model';
import { PlaySession } from './play-session.ts';

function key(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    code: key,
    repeat: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as KeyboardEvent;
}

function coveredPlay() {
  const play = new PlaySession({ initialHiSpeed: 2, coverKeys: true });
  play.playState = createPlayState({
    view: {
      hiSpeed: createHiSpeedState({ hiSpeed: 2 }),
      covers: [{ side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0 }],
    },
  });
  return play;
}

describe('play adjustment keys', () => {
  test('holding either hi-speed arrow keeps stepping the speed', () => {
    const play = new PlaySession({ initialHiSpeed: 2 });
    for (const name of ['ArrowUp', 'ArrowDown']) {
      handleSharedEngineExitKey(play, key(name));
      for (let i = 0; i < 3; i++) handleSharedEngineExitKey(play, key(name, { repeat: true }));
      expect(play.getHiSpeed()).toBe(name === 'ArrowUp' ? 2.4 : 2);
    }
  });

  test('holding cover and lift keys repeats adjustments without changing normal hi-speed', () => {
    const play = coveredPlay();
    for (const name of ['PageDown', 'End']) {
      handleSharedEngineExitKey(play, key(name));
      handleSharedEngineExitKey(play, key(name, { repeat: true }));
    }
    expect(play.playState.view.covers[0]).toMatchObject({ sudden: 0.02, lift: 0.02 });
    for (const name of ['PageUp', 'Home']) {
      handleSharedEngineExitKey(play, key(name));
      handleSharedEngineExitKey(play, key(name, { repeat: true }));
    }
    expect(play.playState.view.covers[0]).toMatchObject({ sudden: 0, lift: 0 });
    expect(play.getHiSpeed()).toBe(2);
  });

  test('holding H toggles HIDDEN only once', () => {
    const play = coveredPlay();
    handleSharedEngineExitKey(play, key('h', { code: 'KeyH' }));
    const repeat = key('h', { code: 'KeyH', repeat: true });
    handleSharedEngineExitKey(play, repeat);
    expect(play.playState.view.covers[0]?.hiddenOn).toBe(true);
    expect(repeat.preventDefault).toHaveBeenCalled();
  });

  test('left and right arrows seek five seconds only while AUTO play is on', () => {
    const auto = new PlaySession({ autoPlay: true });
    vi.spyOn(auto, 'currentSeconds').mockReturnValue(12);
    const seek = vi.spyOn(auto, 'seek').mockResolvedValue();
    const left = key('ArrowLeft');
    const right = key('ArrowRight');
    handleSharedEngineExitKey(auto, left);
    handleSharedEngineExitKey(auto, right);
    expect(seek).toHaveBeenNthCalledWith(1, 7);
    expect(seek).toHaveBeenNthCalledWith(2, 17);
    expect(left.preventDefault).toHaveBeenCalledOnce();
    expect(right.preventDefault).toHaveBeenCalledOnce();

    const manual = new PlaySession({ autoPlay: false });
    const practice = new PlaySession({ autoPlay: false, allowSeek: 'practice' });
    const replay = new PlaySession({ autoPlay: false });
    Object.assign(replay.options, { replay: { play: {} } });
    for (const play of [manual, practice, replay]) {
      const blocked = vi.spyOn(play, 'seek').mockResolvedValue();
      const back = key('ArrowLeft');
      const forward = key('ArrowRight');
      handleSharedEngineExitKey(play, back);
      handleSharedEngineExitKey(play, forward);
      expect(blocked).not.toHaveBeenCalled();
      // LR2's ← / → move the lane cover instead.
      expect(back.preventDefault).toHaveBeenCalledOnce();
      expect(forward.preventDefault).toHaveBeenCalledOnce();
    }
  });

  test('Fn navigation keys never fall through to hi-speed or seek when cover keys are disabled', () => {
    const play = new PlaySession({ initialHiSpeed: 2, autoPlay: true });
    const seek = vi.spyOn(play, 'seek').mockResolvedValue();
    for (const [name, code] of [
      ['PageUp', 'ArrowUp'],
      ['PageDown', 'ArrowDown'],
      ['Home', 'ArrowLeft'],
      ['End', 'ArrowRight'],
    ] as const) {
      handleSharedEngineExitKey(play, key(name, { code }));
      expect(play.getHiSpeed()).toBe(2);
    }
    expect(seek).not.toHaveBeenCalled();
  });

  test('Fn PageDown adjusts only the cover when cover keys are enabled', () => {
    const play = coveredPlay();
    handleSharedEngineExitKey(play, key('PageDown', { code: 'ArrowDown' }));
    handleSharedEngineExitKey(play, key('PageDown', { code: 'ArrowDown', repeat: true }));
    expect(play.playState.view.covers[0]?.sudden).toBe(0.02);
    expect(play.getHiSpeed()).toBe(2);
  });

  test('a course lock blocks held hi-speed and cover adjustments', () => {
    const play = coveredPlay();
    play.playState = createPlayState({
      view: { ...play.playState.view, hiSpeed: createHiSpeedState({ hiSpeed: 2, locked: true }) },
    });
    const state = play.playState;
    for (const name of ['ArrowUp', 'ArrowDown', 'PageDown', 'End']) {
      handleSharedEngineExitKey(play, key(name));
      handleSharedEngineExitKey(play, key(name, { repeat: true }));
    }
    expect(play.playState).toBe(state);
  });

  test('held one-shot keys do not pause, restart or switch floating mode', () => {
    const play = new PlaySession();
    const restart = vi.spyOn(play, 'requestRestart');
    for (const name of ['Pause', 'Tab', 'F5', 'Numpad0']) {
      handleSharedEngineExitKey(play, key(name, { repeat: true }));
    }
    expect(play.paused).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(play.playState.view.hiSpeed.floating).toBeUndefined();
  });

  test('floating hi-speed keeps its fine adjustment on held PageDown with both covers off', () => {
    const play = new PlaySession({ initialHiSpeed: 2, coverKeys: true });
    play.playState = createPlayState({ view: { hiSpeed: createHiSpeedState({ hiSpeed: 2, floating: true }) } });
    handleSharedEngineExitKey(play, key('PageDown'));
    const once = play.getHiSpeed();
    handleSharedEngineExitKey(play, key('PageDown', { repeat: true }));
    expect(play.getHiSpeed()).toBeLessThan(once);
    expect(play.playState.view.covers[0]?.suddenOn).not.toBe(true);
  });
});

describe('play pause and control keys', () => {
  test('Pause and Tab pause and resume the play, and Space is no longer the pause key', () => {
    const play = new PlaySession();
    handleSharedEngineExitKey(play, key('Space'));
    expect(play.paused).toBe(false);
    handleSharedEngineExitKey(play, key('Pause'));
    expect(play.paused).toBe(true);
    handleSharedEngineExitKey(play, key('Tab'));
    expect(play.paused).toBe(false);
  });

  test('START and SELECT go to the engine for the replay, with the physical key; a key the chart’s lanes take does not', () => {
    const inputSignals = createPlayerInputSignalBus();
    const play = new PlaySession({ controlKeys: { '1P-select': ['z'] } });
    play.sharedEngineInputSignals = inputSignals;
    handleSharedEngineExitKey(play, key('KeyQ'));
    recordControlKey(play, 'up', key('KeyQ'));
    // Auto-repeats record nothing.
    handleSharedEngineExitKey(play, key('KeyQ', { repeat: true }));
    expect(inputSignals.drainCommands()).toEqual([
      { kind: 'control-input', button: '1P-start', action: 'down', code: 'KeyQ' },
      { kind: 'control-input', button: '1P-start', action: 'up', code: 'KeyQ' },
    ]);
    // SELECT moved to Z, which the chart's 1P key 1 takes: it is the lane.
    play.preparedChart = { laneBindings: [{ inputTokens: ['z'] }] } as unknown as typeof play.preparedChart;
    recordControlKey(play, 'down', key('KeyZ'));
    expect(inputSignals.drainCommands()).toEqual([]);
  });
});

describe('START and SELECT in a play', () => {
  const up = (code: string, overrides: Partial<KeyboardEvent> = {}) => ({ ...key(code, overrides) }) as KeyboardEvent;
  const release = (play: PlaySession, code: string, timeStamp = 0) =>
    trackPlayKey(play, 'up', up(code, { timeStamp } as Partial<KeyboardEvent>));

  test('LR2: START or SELECT + keys 1 / 3 / 5 step the hi-speed down, 2 / 4 up', () => {
    const play = new PlaySession({ initialHiSpeed: 2 });
    handleSharedEngineExitKey(play, key('KeyQ'));
    handleSharedEngineExitKey(play, key('KeyS'));
    expect(play.getHiSpeed()).toBeCloseTo(2 + HISPEED_STEP);
    handleSharedEngineExitKey(play, key('KeyZ'));
    handleSharedEngineExitKey(play, key('KeyX'));
    expect(play.getHiSpeed()).toBeCloseTo(2 - HISPEED_STEP);
    release(play, 'KeyQ');
    handleSharedEngineExitKey(play, key('KeyW'));
    handleSharedEngineExitKey(play, key('KeyD'));
    expect(play.getHiSpeed()).toBeCloseTo(2);
    // Without START or SELECT, a lane key steps nothing.
    release(play, 'KeyW');
    handleSharedEngineExitKey(play, key('KeyS'));
    expect(play.getHiSpeed()).toBeCloseTo(2);
  });

  test('beatoraja: START + odd keys down, even keys up, and START + the turntable moves the lane cover', () => {
    const play = coveredPlay();
    play.options.controlScheme = 'beatoraja';
    handleSharedEngineExitKey(play, key('KeyQ'));
    handleSharedEngineExitKey(play, key('KeyF'));
    expect(play.getHiSpeed()).toBeCloseTo(2 + HISPEED_STEP);
    handleSharedEngineExitKey(play, key('ControlLeft'));
    expect(play.playState.view.covers[0]?.sudden).toBeCloseTo(0.01);
  });

  test('START pressed twice switches the lane cover', () => {
    const play = coveredPlay();
    handleSharedEngineExitKey(play, key('KeyQ', { timeStamp: 0 }));
    release(play, 'KeyQ', 50);
    handleSharedEngineExitKey(play, key('KeyQ', { timeStamp: 100 }));
    expect(play.playState.view.covers[0]?.suddenOn).toBe(true);
  });

  test('START and SELECT held for START_SELECT_QUIT_MS quit; after the last note either one ends the play', () => {
    vi.useFakeTimers();
    try {
      const play = new PlaySession();
      const exit = vi.spyOn(play, 'requestExit').mockImplementation(() => {});
      handleSharedEngineExitKey(play, key('KeyQ'));
      handleSharedEngineExitKey(play, key('KeyW'));
      vi.advanceTimersByTime(START_SELECT_QUIT_MS - 1);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledOnce();

      const ended = new PlaySession();
      const end = vi.spyOn(ended, 'requestExit').mockImplementation(() => {});
      ended.playMoments.allNotesDoneAtMs = 1000;
      handleSharedEngineExitKey(ended, key('KeyW'));
      expect(end).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test('the quit key held for QUICK_RETRY_HOLD_MS asks for a quick retry', () => {
    const play = new PlaySession();
    vi.spyOn(play, 'requestExit').mockImplementation(() => {});
    handleSharedEngineExitKey(play, key('Escape', { timeStamp: 100 }));
    expect(isQuickRetryHeld(play, 100 + QUICK_RETRY_HOLD_MS - 1)).toBe(false);
    expect(isQuickRetryHeld(play, 100 + QUICK_RETRY_HOLD_MS)).toBe(true);
    release(play, 'Escape', 200);
    expect(isQuickRetryHeld(play, 100 + QUICK_RETRY_HOLD_MS)).toBe(false);
  });

  test('beatoraja’s ↑ / ↓ move the lane cover; LR2’s step the hi-speed', () => {
    const play = coveredPlay();
    play.options.controlScheme = 'beatoraja';
    handleSharedEngineExitKey(play, key('ArrowDown'));
    expect(play.playState.view.covers[0]?.sudden).toBeCloseTo(0.01);
    expect(play.getHiSpeed()).toBe(2);
  });
});
