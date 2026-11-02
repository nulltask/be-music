import { createHiSpeedState, createPlayState } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { handleSharedEngineExitKey } from './play-input.ts';
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
      expect(back.preventDefault).not.toHaveBeenCalled();
      expect(forward.preventDefault).not.toHaveBeenCalled();
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
    for (const name of ['Space', 'F5', 'Numpad0']) {
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
