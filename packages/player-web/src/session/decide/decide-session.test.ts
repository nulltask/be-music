import { createEmptyJson } from '@be-music/json';
import { parseChart } from '@be-music/parser';
import { DEFAULT_PLAY_OPTIONS, type LibraryChart, type SystemSoundSet } from '@be-music/scene-model';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { SceneViewTiming } from '../../view/types.ts';
import type { SessionKeyEvent } from '../session-scene.ts';
import { DecideSession, resolveDecideKeyAction, type DecideAudio } from './decide-session.ts';

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

const JINGLE = { bytes: new Uint8Array([1, 2, 3]) };

function createAudio() {
  return {
    playJingle: vi.fn<DecideAudio['playJingle']>(async () => true),
    stopOwned: vi.fn<DecideAudio['stopOwned']>(),
  } satisfies DecideAudio;
}

function key(key: string, overrides: Partial<SessionKeyEvent> = {}): SessionKeyEvent {
  return {
    type: 'down',
    code: key,
    key,
    repeat: false,
    timeStamp: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

function createSession(
  options: { timing?: Partial<SceneViewTiming>; sounds?: SystemSoundSet; progress?: () => number | undefined } = {},
) {
  const audio = createAudio();
  const on = { continue: vi.fn<() => void>(), cancel: vi.fn<() => void>() };
  const session = new DecideSession({
    chart: CHART,
    sounds: options.sounds ?? {},
    audio,
    timing: { inputDelayMs: 0, fadeOutMs: 0, ...options.timing },
    ...(options.progress !== undefined ? { progress: options.progress } : {}),
    on,
  });
  return { session, audio, on };
}

describe('resolveDecideKeyAction', () => {
  it('continues on Enter and Space', () => {
    expect(resolveDecideKeyAction({ key: 'Enter', repeat: false })).toBe('continue');
    expect(resolveDecideKeyAction({ key: ' ', repeat: false })).toBe('continue');
    expect(resolveDecideKeyAction({ key: 'Spacebar', repeat: false })).toBe('continue');
  });

  it('cancels on Escape', () => {
    expect(resolveDecideKeyAction({ key: 'Escape', repeat: false })).toBe('cancel');
  });

  it('ignores other keys and auto-repeats', () => {
    expect(resolveDecideKeyAction({ key: 'a', repeat: false })).toBeUndefined();
    expect(resolveDecideKeyAction({ key: 'Enter', repeat: true })).toBeUndefined();
    expect(resolveDecideKeyAction({ key: 'Escape', repeat: true })).toBeUndefined();
  });
});

describe('DecideSession', () => {
  it('draws the chart and the options from the entry, and reads the load progress every frame', () => {
    let loaded: number | undefined;
    const { session } = createSession({ timing: { inputDelayMs: 500 }, progress: () => loaded });
    session.enter(1000);
    expect(session.frame(1000)).toEqual({
      clock: { nowMs: 1000, enteredAtMs: 1000 },
      chart: CHART,
      playChart: session.resolved.chart,
      playOptions: DEFAULT_PLAY_OPTIONS,
      inputOpenAtMs: 1500,
    });
    loaded = 0.25;
    expect(session.frame(1100).progress).toBe(0.25);
    loaded = 3;
    expect(session.frame(1200).progress).toBe(1);
  });

  it('moves on to the play by itself once the auto advance is up', () => {
    const { session, on } = createSession({ timing: { autoAdvanceMs: 2000 } });
    session.enter(1000);
    session.frame(2999);
    expect(on.continue).not.toHaveBeenCalled();
    expect(session.frame(3000).leaving).toEqual({ to: 'play', atMs: 3000 });
    session.frame(3016);
    expect(on.continue).toHaveBeenCalledTimes(1);
    expect(on.cancel).not.toHaveBeenCalled();
  });

  it('continues at the first frame when the skin has no time to show', () => {
    const { session, on } = createSession({ timing: { autoAdvanceMs: 0 } });
    session.enter(0);
    session.frame(0);
    expect(on.continue).toHaveBeenCalledTimes(1);
  });

  it('waits for the player without an auto advance', () => {
    const { session, on } = createSession();
    session.enter(0);
    session.frame(60_000);
    expect(on.continue).not.toHaveBeenCalled();
    expect(session.handleKey(key('Enter', { timeStamp: 60_001 }))).toBe(true);
    expect(on.continue).toHaveBeenCalledTimes(1);
  });

  it('continues on Enter, Space or a click only once input is open', () => {
    const { session, on } = createSession({ timing: { inputDelayMs: 500 } });
    session.enter(1000);
    session.frame(1000);
    expect(session.handleKey(key('Enter', { timeStamp: 1499 }))).toBe(true);
    session.dispatch({ type: 'continue' });
    expect(on.continue).not.toHaveBeenCalled();
    session.frame(1500);
    session.dispatch({ type: 'continue' });
    expect(on.continue).toHaveBeenCalledTimes(1);
    expect(session.handleKey(key(' ', { timeStamp: 1600 }))).toBe(true);
    expect(on.continue).toHaveBeenCalledTimes(1);
  });

  it('backs out on Escape before input opens, and only once', () => {
    const { session, on } = createSession({ timing: { inputDelayMs: 500, autoAdvanceMs: 800 } });
    session.enter(0);
    session.frame(0);
    expect(session.handleKey(key('Escape', { timeStamp: 10 }))).toBe(true);
    expect(on.cancel).toHaveBeenCalledTimes(1);
    session.handleKey(key('Enter', { timeStamp: 600 }));
    session.frame(1000);
    expect(on.cancel).toHaveBeenCalledTimes(1);
    expect(on.continue).not.toHaveBeenCalled();
  });

  it('holds Escape back until input opens when the skin holds every key back', () => {
    const { session, on } = createSession({ timing: { inputDelayMs: 500, escapeWaitsForInput: true } });
    session.enter(0);
    session.frame(0);
    session.handleKey(key('Escape', { timeStamp: 499 }));
    session.dispatch({ type: 'cancel' });
    session.frame(499);
    expect(on.cancel).not.toHaveBeenCalled();
    session.handleKey(key('Escape', { timeStamp: 500 }));
    expect(on.cancel).toHaveBeenCalledTimes(1);
  });

  it("shows how much of the auto advance has gone by while the host reports no progress, the host's once it does", () => {
    let loaded: number | undefined;
    const { session } = createSession({ timing: { autoAdvanceMs: 2000 }, progress: () => loaded });
    session.enter(1000);
    expect(session.frame(1000).progress).toBe(0);
    expect(session.frame(1500).progress).toBe(0.25);
    loaded = 0.9;
    expect(session.frame(1600).progress).toBe(0.9);
    loaded = undefined;
    expect(session.frame(2999).progress).toBeCloseTo(0.9995);
    expect(session.frame(3000).progress).toBe(1);
  });

  it('shows no progress without the host reporting one or an auto advance', () => {
    const { session } = createSession({ timing: { autoAdvanceMs: 0 } });
    session.enter(0);
    expect(session.frame(0)).not.toHaveProperty('progress');
    const { session: waiting } = createSession();
    waiting.enter(0);
    expect(waiting.frame(5000)).not.toHaveProperty('progress');
  });

  it('leaves keys it does not use, key releases and auto-repeats to the page', () => {
    const { session, on } = createSession();
    session.enter(0);
    expect(session.handleKey(key('a'))).toBe(false);
    expect(session.handleKey(key('Enter', { type: 'up' }))).toBe(false);
    expect(session.handleKey(key('Enter', { repeat: true }))).toBe(false);
    expect(on.continue).not.toHaveBeenCalled();
  });

  it('fades out before it says where it goes', () => {
    const { session, on } = createSession({ timing: { fadeOutMs: 500 } });
    session.enter(0);
    session.frame(0);
    session.handleKey(key('Escape', { timeStamp: 100 }));
    expect(on.cancel).not.toHaveBeenCalled();
    expect(session.frame(599).leaving).toEqual({ to: 'select', atMs: 100 });
    // A later Enter does not turn the screen around.
    session.handleKey(key('Enter', { timeStamp: 300 }));
    session.frame(600);
    expect(on.cancel).toHaveBeenCalledTimes(1);
    expect(on.continue).not.toHaveBeenCalled();
  });

  it('plays the decide jingle as its own and stops it on exit and dispose', () => {
    const { session, audio } = createSession({ sounds: { decideBgm: JINGLE, decide: { path: 'decide.wav' } } });
    session.enter(0);
    expect(audio.playJingle).toHaveBeenCalledTimes(1);
    expect(audio.playJingle).toHaveBeenCalledWith(JINGLE, { owner: session });
    session.exit();
    expect(audio.stopOwned).toHaveBeenCalledWith(session);
    session.enter(100);
    expect(audio.playJingle).toHaveBeenCalledTimes(2);
    session.dispose();
    expect(audio.stopOwned).toHaveBeenCalledTimes(2);
  });

  it('plays no jingle without one', () => {
    const { session, audio } = createSession({ sounds: { decide: { path: 'decide.wav' } } });
    session.enter(0);
    expect(audio.playJingle).not.toHaveBeenCalled();
  });

  it('starts over on a new entry', () => {
    const { session, on } = createSession({ timing: { autoAdvanceMs: 1000 } });
    session.enter(0);
    session.frame(1000);
    expect(on.continue).toHaveBeenCalledTimes(1);
    session.exit();
    session.handleKey(key('Escape'));
    expect(on.cancel).not.toHaveBeenCalled();
    session.enter(5000);
    expect(session.frame(5000)).not.toHaveProperty('leaving');
    session.frame(6000);
    expect(on.continue).toHaveBeenCalledTimes(2);
  });

  it('carries the course and the play options it was given', () => {
    const playOptions = { ...DEFAULT_PLAY_OPTIONS, autoPlay: true };
    const course = { title: 'Course', kind: 'grade' } as never;
    const session = new DecideSession({
      chart: CHART,
      course,
      playOptions,
      sounds: {},
      audio: createAudio(),
      timing: { inputDelayMs: 0, fadeOutMs: 0 },
      on: { continue: () => undefined, cancel: () => undefined },
    });
    session.enter(0);
    const frame = session.frame(0);
    expect(frame.course).toBe(course);
    expect(frame.playOptions).toBe(playOptions);
  });

  it("draws the chart's #RANDOM branches once, for the screen and the play alike", () => {
    const chart = parseChart(
      ['#RANDOM 2', '#IF 1', '#00111:01', '#ENDIF', '#IF 2', '#00112:01', '#ENDIF', '#ENDRANDOM'].join('\n'),
      'bms',
    );
    for (const [roll, value, channel] of [
      [0, 1, '11'],
      [0.9, 2, '12'],
    ] as const) {
      const random = vi.fn(() => roll);
      const session = new DecideSession({
        chart: { ...CHART, chart },
        sounds: {},
        audio: createAudio(),
        timing: { inputDelayMs: 0, fadeOutMs: 0 },
        random,
        on: { continue: () => undefined, cancel: () => undefined },
      });
      expect(session.resolved.randomDraws).toEqual([{ command: 'RANDOM', range: 2, value }]);
      expect(session.resolved.chart.events.map((event) => event.channel)).toEqual([channel]);
      session.enter(0);
      expect(session.frame(0).playChart).toBe(session.resolved.chart);
      session.exit();
      session.enter(100);
      expect(session.frame(100).playChart).toBe(session.resolved.chart);
      expect(random).toHaveBeenCalledTimes(1);
    }
  });
});
