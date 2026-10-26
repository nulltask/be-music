import { createEmptyJSON } from '@be-music/chart-source';
import { createPlayerInputSignalBus, type PlayerInputCommand } from '@be-music/player-engine/signals';
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

describe('stage-failure sound', () => {
  test('plays the configured stop cue once, only on failure, owned by the scene', () => {
    const play = new PlaySession();
    const playCue = vi.fn(async () => true);
    const stopOwned = vi.fn();
    const sound = { path: 'sound/playstop.wav' };
    const session = new PlaySceneSession(play, {
      chart: CHART,
      playOptions: DEFAULT_PLAY_OPTIONS,
      audio: { playCue, stopOwned },
      sounds: { playStop: sound },
    });
    session.queueEvent({ kind: 'scene-start', at: 0 });
    session.queueEvent({ kind: 'exit-fade-out', at: 100 });
    expect(playCue).not.toHaveBeenCalled();
    session.queueEvent({ kind: 'exit-close', at: 200 });
    session.queueEvent({ kind: 'exit-close', at: 201 });
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledWith(sound, { owner: session });
    session.exit();
    expect(stopOwned).toHaveBeenCalledWith(session);
    session.dispose();
  });

  test('a theme without a stop cue stays silent', () => {
    const play = new PlaySession();
    const playCue = vi.fn(async () => true);
    const session = new PlaySceneSession(play, {
      chart: CHART,
      playOptions: DEFAULT_PLAY_OPTIONS,
      audio: { playCue, stopOwned: vi.fn() },
    });
    session.queueEvent({ kind: 'exit-close', at: 0 });
    expect(playCue).not.toHaveBeenCalled();
    expect(session.frame(0).events).toContainEqual({ kind: 'exit-close', atMs: 0 });
    session.dispose();
  });
});

test('records actual hi-speed edits alongside the effective replay view', () => {
  const { play, session } = createSceneSession({ initialHiSpeed: 2 });
  const commands: PlayerInputCommand[] = [];
  const bus = createPlayerInputSignalBus();
  play.sharedEngineInputSignals = bus;
  const push = bus.pushCommand;
  bus.pushCommand = (command) => {
    commands.push(command);
    push(command);
  };
  session.frame(0);
  session.dispatch({ type: 'hi-speed', command: { type: 'hi-speed-set', value: 3 } });
  session.frame(1);
  expect(commands).toContainEqual({ kind: 'options', values: { hiSpeed: 3 } });
  session.frame(2);
  expect(commands.filter((command) => command.kind === 'options')).toHaveLength(1);
});

test('records accepted live CONSTANT duration and fade changes', () => {
  const { play, session } = createSceneSession({ visualConstant: true, noteDurationMs: 500, constantFadeMs: 100 });
  const bus = createPlayerInputSignalBus();
  play.sharedEngineInputSignals = bus;
  const push = vi.spyOn(bus, 'pushCommand');
  session.frame(0);
  session.dispatch({ type: 'constant-visibility', durationMs: 250, fadeMs: -200 });
  expect(session.frame(1).playOptions).toMatchObject({ noteDurationMs: 250, constantFadeMs: -200 });
  expect(push).toHaveBeenCalledWith({ kind: 'options', values: { noteDurationMs: 250, constantFadeMs: -200 } });
  session.dispatch({ type: 'constant-visibility', durationMs: -1, fadeMs: 2000 });
  expect(play.options).toMatchObject({ noteDurationMs: 1, constantFadeMs: 1000 });
});

test('records LIFT heights and enabled flags even when the effective cover is zero', () => {
  const { play, session } = createSceneSession();
  play.playState = {
    ...play.playState,
    view: {
      ...play.playState.view,
      covers: [
        { side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0.1, liftOn: false },
        { side: '2P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0.1, liftOn: false },
      ],
    },
  };
  const bus = createPlayerInputSignalBus();
  play.sharedEngineInputSignals = bus;
  const push = vi.spyOn(bus, 'pushCommand');
  session.frame(0);
  session.dispatch({ type: 'cover', command: { type: 'cover-set', covers: [{ side: '1P', lift: 0, liftOn: true }] } });
  expect(session.frame(1).playOptions).toMatchObject({ lift1P: 0, liftOn1P: true, lift2P: 0.1, liftOn2P: false });
  expect(push).toHaveBeenCalledWith({ kind: 'options', values: { lift1P: 0, liftOn1P: true } });
  session.dispatch({
    type: 'cover',
    command: { type: 'cover-set', covers: [{ side: '2P', lift: 0.3, liftOn: false }] },
  });
  expect(session.frame(2).playOptions).toMatchObject({ lift2P: 0.3, liftOn2P: false });
  expect(push).toHaveBeenCalledWith({ kind: 'options', values: { lift2P: 0.3 } });
});

test('replay frames restore selected options at the playhead and after a backward seek', () => {
  const replay = {
    play: {
      mode: 'manual',
      options: { displayAreaInfo: 'ON', visualConstant: true, noteDurationMs: 500, constantFadeMs: 100 },
      optionChanges: [
        { timeUs: 2_000_000, values: { displayAreaInfo: 'SUDDEN_ONLY', noteDurationMs: 250, constantFadeMs: -200 } },
      ],
    },
  } as unknown as import('@be-music/player-engine/replay').BeMusicReplay;
  const { play, session } = createSceneSession({ replay });
  let seconds = 0;
  play.currentSeconds = () => seconds;
  expect(session.frame(0).playOptions.displayAreaInfo).toBe('ON');
  expect(session.frame(0).playOptions).toMatchObject({
    visualConstant: true,
    noteDurationMs: 500,
    constantFadeMs: 100,
  });
  seconds = 3;
  expect(session.frame(3).playOptions.displayAreaInfo).toBe('SUDDEN_ONLY');
  expect(session.frame(3).playOptions).toMatchObject({ noteDurationMs: 250, constantFadeMs: -200 });
  seconds = 1;
  expect(session.frame(4).playOptions.displayAreaInfo).toBe('ON');
  expect(session.frame(4).playOptions).toMatchObject({ noteDurationMs: 500, constantFadeMs: 100 });
});

test('automatic calibration restores unclamped offsets and rewinds without recalculating samples', () => {
  // A replay recorded before the modes stores beatoraja's switch as a boolean.
  const replay = {
    play: {
      mode: 'manual',
      options: { judgeTimingAutoAdjust: true, judgeTimingMs: 500 },
      optionChanges: [{ timeUs: 2000000, values: { judgeTimingMs: 505 } }],
    },
  } as unknown as import('@be-music/player-engine/replay').BeMusicReplay;
  const { play, session } = createSceneSession({ replay });
  let seconds = 3;
  play.currentSeconds = () => seconds;
  expect(session.frame(0).playOptions).toMatchObject({ judgeTimingAutoAdjust: 'BEATORAJA', judgeTimingMs: 505 });
  seconds = 1;
  expect(session.frame(1).playOptions.judgeTimingMs).toBe(500);
});

test("an LR2 adjustment's recorded steps replay as recorded", () => {
  const replay = {
    play: {
      mode: 'manual',
      options: { judgeTimingAutoAdjust: 'LR2-SILENT', judgeTimingMs: 120 },
      optionChanges: [
        { timeUs: 2000000, values: { judgeTimingMs: 121 } },
        { timeUs: 4000000, values: { judgeTimingMs: 122 } },
      ],
    },
  } as unknown as import('@be-music/player-engine/replay').BeMusicReplay;
  const { play, session } = createSceneSession({ replay });
  let seconds = 3;
  play.currentSeconds = () => seconds;
  expect(session.frame(0).playOptions).toMatchObject({ judgeTimingAutoAdjust: 'LR2-SILENT', judgeTimingMs: 121 });
  seconds = 5;
  expect(session.frame(1).playOptions.judgeTimingMs).toBe(122);
  seconds = 0;
  expect(session.frame(2).playOptions.judgeTimingMs).toBe(120);
});
