import { createEmptyJson } from '@be-music/json';
import type { LibraryChart, PlayResult, PlayRunKind, SystemSoundSet } from '@be-music/scene-model';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { SceneViewTiming } from '../../view/types.ts';
import type { SessionKeyEvent } from '../session-scene.ts';
import { pickResultJingle, RESULT_GRAPH_DRAW_MS, ResultSession, type ResultAudio } from './result-session.ts';

const CHART: LibraryChart = {
  id: 'chart',
  sourceId: 'source',
  sourceLabel: 'Source',
  sourceKind: 'directory',
  chartPath: 'song/chart.bms',
  directoryLabel: 'song',
  fileLabel: 'chart.bms',
  title: 'Chart',
  totalNotes: 10,
  chart: createEmptyJson('bms'),
};

function playResult(overrides: Partial<PlayResult> = {}): PlayResult {
  return {
    score: { total: 10, perfect: 8, great: 2, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 18, score: 18 },
    maxCombo: 10,
    gauge: 90,
    cleared: true,
    playSeconds: 30,
    song: CHART,
    gaugeHistory: [],
    scoreHistory: [],
    ...overrides,
  };
}

const sound = (id: number) => ({ bytes: new Uint8Array([id]) });
const CLEAR = sound(1);
const FAIL = sound(2);
const RESULT = sound(3);
const COURSE_CLEAR = sound(4);
const COURSE_FAIL = sound(5);
const ALL_JINGLES: SystemSoundSet = {
  clear: CLEAR,
  fail: FAIL,
  result: RESULT,
  courseClear: COURSE_CLEAR,
  courseFail: COURSE_FAIL,
};

function createAudio() {
  return {
    playJingle: vi.fn<ResultAudio['playJingle']>(async () => true),
    stopOwned: vi.fn<ResultAudio['stopOwned']>(),
  } satisfies ResultAudio;
}

function key(key: string, timeStamp: number, overrides: Partial<SessionKeyEvent> = {}): SessionKeyEvent {
  return {
    type: 'down',
    code: key,
    key,
    repeat: false,
    timeStamp,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

function createSession(
  options: {
    result?: PlayResult;
    run?: PlayRunKind;
    sounds?: SystemSoundSet;
    retry?: boolean;
    timing?: Partial<SceneViewTiming>;
  } = {},
) {
  const audio = createAudio();
  const on = { continue: vi.fn<() => void>(), retry: vi.fn<() => void>() };
  const session = new ResultSession({
    result: options.result ?? playResult(),
    ...(options.run !== undefined ? { run: options.run } : {}),
    sounds: options.sounds ?? ALL_JINGLES,
    audio,
    timing: { inputDelayMs: 1500, fadeOutMs: 0, ...options.timing },
    on: options.retry === false ? { continue: on.continue } : on,
  });
  return { session, audio, on };
}

describe('pickResultJingle', () => {
  it('plays the jingle of the verdict, else the generic one, else the other one', () => {
    expect(pickResultJingle({ clear: CLEAR, fail: FAIL, result: RESULT }, true)).toBe(CLEAR);
    expect(pickResultJingle({ clear: CLEAR, fail: FAIL, result: RESULT }, false)).toBe(FAIL);
    expect(pickResultJingle({ fail: FAIL, result: RESULT }, true)).toBe(RESULT);
    expect(pickResultJingle({ clear: CLEAR, result: RESULT }, false)).toBe(RESULT);
    expect(pickResultJingle({ fail: FAIL }, true)).toBe(FAIL);
    expect(pickResultJingle({ clear: CLEAR }, false)).toBe(CLEAR);
    expect(pickResultJingle({}, true)).toBeUndefined();
  });
});

describe('ResultSession', () => {
  it('draws the result with its presentation, and the graphs once their time is up', () => {
    const result = playResult();
    const { session } = createSession({ result });
    session.enter(1000);
    expect(session.frame(1000)).toEqual({
      clock: { nowMs: 1000, enteredAtMs: 1000 },
      result,
      presentation: { courseResultSkin: false, courseJingles: false, quickRetry: true },
      inputOpenAtMs: 2500,
    });
    expect(session.frame(2500 + RESULT_GRAPH_DRAW_MS - 1)).not.toHaveProperty('graphShownAtMs');
    expect(session.frame(2500 + RESULT_GRAPH_DRAW_MS + 16).graphShownAtMs).toBe(2500 + RESULT_GRAPH_DRAW_MS);
  });

  it('steps on with Enter, Space or a click once input is open: graphs, record update, then continue', () => {
    const { session, on } = createSession();
    session.enter(0);
    session.frame(0);
    expect(session.handleKey(key('Enter', 1000))).toBe(true);
    expect(session.frame(1000)).not.toHaveProperty('graphShownAtMs');
    expect(session.handleKey(key('Enter', 1600))).toBe(true);
    expect(session.frame(1600).graphShownAtMs).toBe(1600);
    session.frame(1700);
    session.dispatch({ type: 'continue' });
    expect(session.frame(1700).updateShownAtMs).toBe(1700);
    expect(on.continue).not.toHaveBeenCalled();
    expect(session.handleKey(key(' ', 1800))).toBe(true);
    expect(on.continue).toHaveBeenCalledTimes(1);
    expect(session.frame(1800).leaving).toEqual({ to: 'continue', atMs: 1800 });
    session.handleKey(key('Enter', 1900));
    session.handleKey(key('Escape', 1950));
    expect(on.continue).toHaveBeenCalledTimes(1);
  });

  it('shows the record update on the first press once the graphs have drawn by themselves', () => {
    const { session, on } = createSession();
    session.enter(0);
    session.handleKey(key('Enter', 1500 + RESULT_GRAPH_DRAW_MS + 10));
    expect(session.frame(1500 + RESULT_GRAPH_DRAW_MS + 10).updateShownAtMs).toBe(1500 + RESULT_GRAPH_DRAW_MS + 10);
    expect(on.continue).not.toHaveBeenCalled();
  });

  it('continues on Escape at any time', () => {
    const { session, on } = createSession();
    session.enter(0);
    expect(session.handleKey(key('Escape', 10))).toBe(true);
    expect(on.continue).toHaveBeenCalledTimes(1);
    expect(on.retry).not.toHaveBeenCalled();
  });

  it('retries on a bare R once input is open, on a run that offers it', () => {
    const { session, on } = createSession();
    session.enter(0);
    expect(session.retryOffered).toBe(true);
    expect(session.handleKey(key('r', 1000))).toBe(true);
    expect(on.retry).not.toHaveBeenCalled();
    expect(session.handleKey(key('r', 1600, { ctrlKey: true }))).toBe(false);
    expect(session.handleKey(key('R', 1600, { shiftKey: true }))).toBe(false);
    expect(session.handleKey(key('r', 1600, { repeat: true }))).toBe(false);
    expect(session.handleKey(key('R', 1600))).toBe(true);
    expect(on.retry).toHaveBeenCalledTimes(1);
    expect(session.frame(1600).leaving).toEqual({ to: 'retry', atMs: 1600 });
    session.handleKey(key('r', 1700));
    session.handleKey(key('Escape', 1700));
    expect(on.retry).toHaveBeenCalledTimes(1);
    expect(on.continue).not.toHaveBeenCalled();
  });

  it('retries from a skin button too', () => {
    const { session, on } = createSession();
    session.enter(0);
    session.frame(1500);
    session.dispatch({ type: 'retry' });
    expect(on.retry).toHaveBeenCalledTimes(1);
  });

  it('offers no retry without a retry handler, on a course stage or on a course run', () => {
    const noHandler = createSession({ retry: false });
    noHandler.session.enter(0);
    expect(noHandler.session.retryOffered).toBe(false);
    expect(noHandler.session.handleKey(key('r', 2000))).toBe(false);
    for (const run of ['stage', 'course'] as const) {
      const { session, on } = createSession({ run });
      session.enter(0);
      expect(session.retryOffered).toBe(false);
      session.frame(2000);
      session.dispatch({ type: 'retry' });
      expect(on.retry).not.toHaveBeenCalled();
    }
    const nonstop = createSession({ run: 'nonstop' });
    expect(nonstop.session.retryOffered).toBe(true);
  });

  it('plays the jingle of its verdict as its own, and stops it on exit and dispose', () => {
    const cleared = createSession();
    cleared.session.enter(0);
    expect(cleared.audio.playJingle).toHaveBeenCalledWith(CLEAR, { owner: cleared.session });
    cleared.session.exit();
    expect(cleared.audio.stopOwned).toHaveBeenCalledWith(cleared.session);
    cleared.session.enter(100);
    expect(cleared.audio.playJingle).toHaveBeenCalledTimes(2);
    cleared.session.dispose();
    expect(cleared.audio.stopOwned).toHaveBeenCalledTimes(2);

    const failed = createSession({ result: playResult({ cleared: false }) });
    failed.session.enter(0);
    expect(failed.audio.playJingle).toHaveBeenCalledWith(FAIL, { owner: failed.session });
  });

  it('plays the course jingles for a course run, from the run it is given or its own', () => {
    const given = createSession({ run: 'course' });
    given.session.enter(0);
    expect(given.audio.playJingle).toHaveBeenCalledWith(COURSE_CLEAR, expect.anything());
    const own = createSession({ result: playResult({ run: 'course', cleared: false }) });
    own.session.enter(0);
    expect(own.audio.playJingle).toHaveBeenCalledWith(COURSE_FAIL, expect.anything());
    expect(own.session.presentation.courseResultSkin).toBe(true);
    // A NONSTOP run and a course stage play the clear / fail ones.
    const nonstop = createSession({ run: 'nonstop' });
    nonstop.session.enter(0);
    expect(nonstop.audio.playJingle).toHaveBeenCalledWith(CLEAR, expect.anything());
    // A course run falls back to the clear / fail jingles without course ones.
    const fallback = createSession({ run: 'course', sounds: { clear: CLEAR, fail: FAIL } });
    fallback.session.enter(0);
    expect(fallback.audio.playJingle).toHaveBeenCalledWith(CLEAR, expect.anything());
  });

  it('plays nothing for a theme without result jingles', () => {
    const { session, audio } = createSession({ sounds: { decideBgm: sound(9) } });
    session.enter(0);
    expect(audio.playJingle).not.toHaveBeenCalled();
  });

  it('leaves keys it does not use and key releases to the page', () => {
    const { session } = createSession({ retry: false });
    session.enter(0);
    expect(session.handleKey(key('a', 2000))).toBe(false);
    expect(session.handleKey(key('Enter', 2000, { type: 'up' }))).toBe(false);
  });

  it('fades out before it says where it goes', () => {
    const { session, on } = createSession({ timing: { fadeOutMs: 400 } });
    session.enter(0);
    session.handleKey(key('Escape', 100));
    expect(on.continue).not.toHaveBeenCalled();
    session.frame(499);
    expect(on.continue).not.toHaveBeenCalled();
    session.frame(500);
    expect(on.continue).toHaveBeenCalledTimes(1);
  });

  it('starts over on a new entry', () => {
    const { session, on } = createSession();
    session.enter(0);
    session.frame(5000);
    session.handleKey(key('Escape', 5000));
    session.exit();
    session.enter(10_000);
    const frame = session.frame(10_000);
    expect(frame).not.toHaveProperty('graphShownAtMs');
    expect(frame).not.toHaveProperty('leaving');
    expect(frame.inputOpenAtMs).toBe(11_500);
    session.handleKey(key('Escape', 10_100));
    expect(on.continue).toHaveBeenCalledTimes(2);
  });
});
