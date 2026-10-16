import { createEmptyJson } from '@be-music/json';
import { DEFAULT_PLAY_OPTIONS, type LibraryChart } from '@be-music/scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { PlaySceneSession, resolvePlayStage } from './play-scene-session.ts';
import { PlaySession } from './play-session.ts';

const CHART: LibraryChart = {
  id: 'chart',
  sourceId: 'source',
  sourceLabel: 'Source',
  sourceKind: 'directory',
  chartPath: 'song/chart.bms',
  directoryLabel: 'song',
  fileLabel: 'chart.bms',
  title: 'Chart',
  totalNotes: 0,
  chart: createEmptyJson('bms'),
};

function createSceneSession(options: ConstructorParameters<typeof PlaySession>[0] = {}) {
  const play = new PlaySession(options);
  const session = new PlaySceneSession(play, { chart: CHART, playOptions: DEFAULT_PLAY_OPTIONS });
  return { play, session };
}

describe('PlaySceneSession', () => {
  test("a frame carries the play's state and the play itself for the shared playfield", () => {
    const { play, session } = createSceneSession({ initialHiSpeed: 3 });
    const frame = session.frame(100);
    expect(frame.playfield).toBe(play);
    expect(frame.state).toBe(play.playState);
    expect(frame.state.view.hiSpeed.player).toBe(3);
    expect(frame.chart).toBe(CHART);
    expect(frame.playOptions).toBe(DEFAULT_PLAY_OPTIONS);
    // Nothing shows before the play is shown (`start`, or a load while on stage).
    expect(frame.shown).toBe(false);
    expect(frame.autoPlay).toBe(false);
    expect(frame.replay).toBe(false);
  });

  test('hands each moment the play raised to one frame, in the view’s words', () => {
    const { session } = createSceneSession();
    session.queueEvent({ kind: 'scene-start', at: 5 });
    session.queueEvent({ kind: 'bomb-retired', channel: '11' });
    session.queueEvent({ kind: 'lane-command', command: { kind: 'press-lane', channel: '11' } });
    expect(session.frame(10).events).toEqual([
      { kind: 'scene-start', atMs: 5 },
      { kind: 'lane', channel: '11', action: 'press' },
    ]);
    expect(session.frame(20).events).toEqual([]);
  });

  test('reports the load progress while the play loads', () => {
    const { play, session } = createSceneSession();
    play.assetsLoading = true;
    session.loadProgress = 0.5;
    const frame = session.frame(0);
    expect(frame.stage).toBe('loading');
    expect(frame.progress).toBe(0.5);
  });

  test('takes the hi-speed and cover intents through the play state', () => {
    const onHiSpeedChange = vi.fn();
    const { play, session } = createSceneSession({ initialHiSpeed: 2, onHiSpeedChange });
    session.dispatch({ type: 'hi-speed', command: { type: 'hi-speed-step', delta: 0.5 } });
    expect(play.getHiSpeed()).toBe(2.5);
    expect(onHiSpeedChange).toHaveBeenCalledWith(2.5);
    session.dispatch({ type: 'hi-speed', command: { type: 'hi-speed-step', delta: 0 } });
    expect(onHiSpeedChange).toHaveBeenCalledTimes(1);
  });

  test('a quit intent leaves the play as Escape does', () => {
    const onExit = vi.fn();
    const { session } = createSceneSession({ onExit });
    session.dispatch({ type: 'quit' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test('keys are the play’s own: the scene does not take them', () => {
    const { session } = createSceneSession();
    expect(
      session.handleKey({
        type: 'down',
        code: 'Escape',
        key: 'Escape',
        repeat: false,
        timeStamp: 0,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(false);
  });
});

describe('resolvePlayStage', () => {
  const play = { paused: false, exiting: false, chartEnded: false, assetsLoading: false, isIntroPlaying: () => false };

  test('is the pause first, then the ending, the loading, the intro and the play', () => {
    expect(resolvePlayStage({ ...play, paused: true, exiting: true })).toBe('paused');
    expect(resolvePlayStage({ ...play, exiting: true, assetsLoading: true })).toBe('ending');
    expect(resolvePlayStage({ ...play, chartEnded: true })).toBe('ending');
    expect(resolvePlayStage({ ...play, assetsLoading: true, isIntroPlaying: () => true })).toBe('loading');
    expect(resolvePlayStage({ ...play, isIntroPlaying: () => true })).toBe('intro');
    expect(resolvePlayStage(play)).toBe('playing');
  });
});
