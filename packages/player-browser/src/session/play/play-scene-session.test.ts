import { createEmptyJSON } from '@be-music/chart-source';
import type { PlayerInputCommand } from '@be-music/player-engine/signals';
import { DEFAULT_PLAY_OPTIONS, type LibraryChart } from '@be-music/player-scene-model';
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
  chart: createEmptyJSON('bms'),
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
    session.queueEvent({ kind: 'gauge', previous: 20, next: 22, at: 8 });
    session.queueEvent({ kind: 'lane-command', command: { kind: 'press-lane', channel: '11' } });
    expect(session.frame(10).events).toEqual([
      { kind: 'scene-start', atMs: 5 },
      { kind: 'gauge', previous: 20, next: 22, atMs: 8 },
      { kind: 'lane', channel: '11', action: 'press' },
    ]);
    expect(session.frame(20).events).toEqual([]);
  });

  test('hands immutable score targets from the host to the frame', () => {
    const targets = { bestEXScore: 120, targetEXScore: 144 };
    const play = new PlaySession();
    const session = new PlaySceneSession(play, {
      chart: CHART,
      playOptions: DEFAULT_PLAY_OPTIONS,
      scoreTargets: targets,
    });
    expect(session.frame(10).scoreTargets).toBe(targets);
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

  test('a quit on an LR2 view fades out on timer 2 alone and leaves after #FADEOUT, without timer 3', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    try {
      const onExit = vi.fn();
      const moments: string[] = [];
      // A fake view with the stock LR2 play skin's ending: `#FADEOUT,550`, `#CLOSE,2050`.
      const play = new PlaySession(
        { onExit },
        {
          timing: () => ({ loadEndOffsetMs: 0, playStartOffsetMs: 0, fadeOutMs: 550, closeMs: 2050 }),
          moment: (moment) => moments.push(moment.kind),
          keyOnFadeMs: () => 100,
        },
      );
      const session = new PlaySceneSession(play, { chart: CHART, playOptions: DEFAULT_PLAY_OPTIONS });
      session.dispatch({ type: 'quit' });
      expect(moments).toEqual(['exit-fade-out']);
      vi.advanceTimersByTime(550);
      expect(onExit).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(3000);
      expect(moments).toEqual(['exit-fade-out']);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
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

describe("the view's touch lanes, as lane intents", () => {
  /** A play whose engine input records the commands pushed, with the 7-key lanes bound to their keys. */
  function createTouchPlay() {
    const { play, session } = createSceneSession();
    const commands: PlayerInputCommand[] = [];
    play.sharedEngineInputSignals = { pushCommand: (command: PlayerInputCommand) => commands.push(command) } as never;
    play.preparedChart = {
      laneBindings: [
        { channel: '16', inputTokens: ['Shift-Left', 'q'] },
        { channel: '11', inputTokens: ['Z'] },
        { channel: '12', inputTokens: ['S'] },
      ],
    } as never;
    return { play, session, commands };
  }
  const at = (atMs: number) => performance.timeOrigin + atMs;

  test('a press goes to the engine as the lane key does: one lane input, then the key held', () => {
    const { play, session, commands } = createTouchPlay();
    session.dispatch({ type: 'lane', channel: '11', pressed: true, atMs: 120 });
    expect(commands).toEqual([
      { kind: 'lane-input', tokens: ['z'], pressedAt: at(120) },
      { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [], pressedAt: at(120) },
    ]);
    expect([...play.touchLanesHeld]).toEqual(['11']);
  });

  test("a release lets the lane's key go, with the binding's first key", () => {
    const { play, session, commands } = createTouchPlay();
    session.dispatch({ type: 'lane', channel: '16', pressed: true, atMs: 10 });
    commands.length = 0;
    session.dispatch({ type: 'lane', channel: '16', pressed: false, atMs: 30 });
    expect(commands).toEqual([
      { kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens: ['shift-left'], pressedAt: at(30) },
    ]);
    expect(play.touchLanesHeld.size).toBe(0);
  });

  test('a lane already held, a release of one not held, and a lane with no key change nothing', () => {
    const { session, commands } = createTouchPlay();
    session.dispatch({ type: 'lane', channel: '11', pressed: true, atMs: 10 });
    commands.length = 0;
    session.dispatch({ type: 'lane', channel: '11', pressed: true, atMs: 20 });
    session.dispatch({ type: 'lane', channel: '12', pressed: false, atMs: 20 });
    session.dispatch({ type: 'lane', channel: '19', pressed: true, atMs: 20 });
    expect(commands).toEqual([]);
  });

  test('pausing lets every held lane go before the engine pauses, and counts the lift for the view', () => {
    const { play, session, commands } = createTouchPlay();
    session.dispatch({ type: 'lane', channel: '12', pressed: true, atMs: 10 });
    session.dispatch({ type: 'lane', channel: '11', pressed: true, atMs: 11 });
    commands.length = 0;
    const before = play.touchLiftCount;
    session.dispatch({ type: 'pause' });
    expect(commands.map((command) => command.kind)).toEqual(['kitty-state', 'toggle-pause']);
    expect(commands[0]).toMatchObject({ pressTokens: [], releaseTokens: ['s', 'z'] });
    expect(play.touchLanesHeld.size).toBe(0);
    expect(play.touchLiftCount).toBe(before + 1);
    // Resuming lifts nothing more.
    session.dispatch({ type: 'pause' });
    expect(play.touchLiftCount).toBe(before + 1);
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
