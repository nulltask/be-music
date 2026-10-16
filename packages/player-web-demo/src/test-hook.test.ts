import { createEmptyJson } from '@be-music/json';
import { parseLr2CourseFile } from '@be-music/player/course';
import type { BeMusicCoursePlaylog, BeMusicPlaylog, PlaylogCourseResult } from '@be-music/player/playlog';
import type { BrowserCourseEntry, BrowserSongEntry } from '@be-music/player-web/collection';
import type { PixiGameplayResultData } from '@be-music/player-web/scenes';
import { describe, expect, test } from 'vite-plus/test';
import {
  type BeMusicTestHook,
  describeBar,
  isTestHookEnabled,
  judgedOf,
  nameJingle,
  resultFromCourseLog,
  resultFromData,
  TEST_HOOK_VERSION,
  TestHookRecorder,
  type TestHookLiveState,
} from './test-hook.ts';

function song(title: string): BrowserSongEntry {
  return {
    id: title,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${title}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${title}.bms`,
    title,
    totalNotes: 10,
    chart: createEmptyJson('bms'),
  };
}

const LIVE: TestHookLiveState = {
  scene: { kind: 'select', family: 'built-in' },
  status: '2 charts loaded',
  loading: false,
  library: { songs: 2, courseFolders: ['courses'] },
};

/** A stage's play log: only the fields the hook reads. */
function stageLog(options: {
  title: string;
  pgreat: number;
  poor: number;
  final: number;
  start?: number;
  aborted?: boolean;
}): BeMusicPlaylog {
  return {
    chart: { title: options.title },
    play: {
      mode: 'auto',
      ...(options.aborted === true ? { aborted: true } : {}),
      course: {
        kind: 'grade',
        ...(options.start !== undefined ? { carryIn: { gauge: options.start, combo: 0, maxCombo: 0 } } : {}),
      },
    },
    results: {
      native: {
        judge: { pgreat: options.pgreat, great: 0, good: 0, bad: 0, poor: options.poor, emptyPoor: 0 },
        exScore: options.pgreat * 2,
        gauge: { type: 'GRADE', final: options.final, cleared: options.final > 0 },
      },
    },
  } as unknown as BeMusicPlaylog;
}

describe('isTestHookEnabled', () => {
  test('is on in a development build and with ?e2e=1 only', () => {
    expect(isTestHookEnabled('https://be-music.app/', true)).toBe(true);
    expect(isTestHookEnabled('https://be-music.app/?e2e=1', false)).toBe(true);
    expect(isTestHookEnabled('https://be-music.app/?e2e=0', false)).toBe(false);
    expect(isTestHookEnabled('https://be-music.app/', false)).toBe(false);
    expect(isTestHookEnabled('not a url', false)).toBe(false);
  });
});

describe('TestHookRecorder', () => {
  test('answers state() with the live state and what the host handed it', () => {
    const recorder = new TestHookRecorder();
    const target: { __beMusicTest?: BeMusicTestHook } = {};
    recorder.install(target, () => LIVE);
    const hook = target.__beMusicTest!;
    expect(hook.version).toBe(TEST_HOOK_VERSION);
    expect(hook.state()).toEqual({
      version: TEST_HOOK_VERSION,
      ...LIVE,
      statusLog: [],
      loads: 0,
      results: [],
      playlogs: 0,
    });

    const playlog = stageLog({ title: 'A', pgreat: 1, poor: 0, final: 100 });
    recorder.recordStatus('Loading');
    recorder.recordStatus('2 charts loaded');
    recorder.recordLoad();
    recorder.recordPlaylog(undefined);
    recorder.recordPlaylog(playlog);
    recorder.recordResult({
      run: 'single',
      family: 'beatoraja',
      title: 'A',
      cleared: false,
      exScore: 2,
      judged: { pgreat: 1, great: 0, good: 0, bad: 0, poor: 0 },
      gauge: { value: 0 },
    });
    const state = hook.state();
    expect(state).toMatchObject({ statusLog: ['Loading', '2 charts loaded'], loads: 1, playlogs: 1 });
    expect(state.results).toHaveLength(1);
    expect(hook.lastPlaylog()).toBe(playlog);
    // A state is a copy: changing it changes nothing the hook keeps.
    state.results.pop();
    state.statusLog.pop();
    expect(hook.state()).toMatchObject({ statusLog: ['Loading', '2 charts loaded'], results: [expect.anything()] });
  });
});

describe('describeBar', () => {
  test('names a folder, a song with its lamp, and a course with its stages', () => {
    expect(describeBar({ kind: 'folder', folder: { label: 'pack', songs: [] } })).toEqual({
      kind: 'folder',
      title: 'pack',
    });
    expect(describeBar({ kind: 'song', song: song('Fixture A') }, { lamp: 'HARD' })).toEqual({
      kind: 'song',
      title: 'Fixture A',
      lamp: 'HARD',
    });
    const [definition] = parseLr2CourseFile(
      `<courselist><course><title>C</title><type>2</type><hash>${'0'.repeat(32)}${'1'.repeat(32)}${'2'.repeat(32)}</hash></course></courselist>`,
    );
    const course: BrowserCourseEntry = {
      id: 'courses:0',
      definition: definition!,
      stages: [{ title: 'Fixture A', song: song('Fixture A') }, { title: 'NOT FOUND' }],
      playable: false,
    };
    expect(describeBar({ kind: 'course', course }, { lamp: 'FAILED', trophy: 'bronzemedal' })).toEqual({
      kind: 'course',
      title: 'C',
      course: {
        kind: 'grade',
        stages: ['Fixture A', 'NOT FOUND'],
        missingStages: 1,
        playable: false,
        newCourse: false,
      },
      lamp: 'FAILED',
      trophy: 'bronzemedal',
    });
  });
});

describe('results', () => {
  test('a result from the data a result view shows', () => {
    const data = {
      score: { total: 12, perfect: 10, great: 1, good: 0, bad: 1, poor: 0, emptyPoor: 0, exScore: 21, score: 0 },
      maxCombo: 11,
      gauge: 80,
      cleared: true,
      playSeconds: 6.5,
      song: song('Fixture A'),
      gaugeHistory: [],
      scoreHistory: [],
      lamp: 'NORMAL',
      gaugeType: 'GROOVE',
    } satisfies PixiGameplayResultData;
    expect(resultFromData(data, 'stage', 'lr2', 'lr2:clear')).toEqual({
      run: 'stage',
      family: 'lr2',
      title: 'Fixture A',
      lamp: 'NORMAL',
      cleared: true,
      exScore: 21,
      judged: { pgreat: 10, great: 1, good: 0, bad: 1, poor: 0 },
      gauge: { type: 'GROOVE', value: 80 },
      playSeconds: 6.5,
      jingle: 'lr2:clear',
    });
  });

  test('a result of a play on the beatoraja play screen, from the result it hands its result screen', () => {
    const data = {
      score: { total: 5, perfect: 3, great: 0, good: 0, bad: 0, poor: 2, emptyPoor: 0, exScore: 6, score: 6 },
      maxCombo: 3,
      gauge: 40,
      cleared: false,
      playSeconds: 4,
      song: song('Fixture B'),
      gaugeHistory: [],
      scoreHistory: [],
      lamp: 'FAILED',
      gaugeType: 'NORMAL',
    } satisfies PixiGameplayResultData;
    expect(resultFromData(data, 'single', 'beatoraja', 'beatoraja:fail')).toEqual({
      run: 'single',
      family: 'beatoraja',
      title: 'Fixture B',
      lamp: 'FAILED',
      cleared: false,
      exScore: 6,
      judged: { pgreat: 3, great: 0, good: 0, bad: 0, poor: 2 },
      gauge: { type: 'NORMAL', value: 40 },
      playSeconds: 4,
      jingle: 'beatoraja:fail',
    });
  });

  test('a course result with each stage, its carried gauge and whether it was given up', () => {
    const courseLog = {
      course: { name: 'FIX GRADE', kind: 'grade', constraints: [], trophies: [] },
      stages: [
        { played: true, playlog: stageLog({ title: 'A', pgreat: 12, poor: 0, final: 100 }) },
        { played: true, playlog: stageLog({ title: 'B', pgreat: 3, poor: 1, final: 97, start: 100, aborted: true }) },
        { played: false, facts: {} },
      ],
    } as unknown as BeMusicCoursePlaylog;
    const native = {
      judge: { pgreat: 15, great: 0, good: 0, bad: 0, poor: 1, emptyPoor: 0 },
      exScore: 30,
      gauge: { type: 'GRADE', final: 97, cleared: false },
      stagesPlayed: 2,
      lamp: 'FAILED',
    } as unknown as PlaylogCourseResult;
    expect(
      resultFromCourseLog(courseLog, native, { family: 'built-in', playSeconds: 9, jingle: 'lr2:courseFail' }),
    ).toEqual({
      run: 'course',
      family: 'built-in',
      title: 'FIX GRADE',
      lamp: 'FAILED',
      cleared: false,
      exScore: 30,
      judged: { pgreat: 15, great: 0, good: 0, bad: 0, poor: 1 },
      gauge: { type: 'GRADE', value: 97 },
      playSeconds: 9,
      jingle: 'lr2:courseFail',
      course: {
        name: 'FIX GRADE',
        kind: 'grade',
        stageCount: 3,
        stagesPlayed: 2,
        aborted: true,
        stages: [
          {
            title: 'A',
            aborted: false,
            judged: { pgreat: 12, great: 0, good: 0, bad: 0, poor: 0 },
            exScore: 24,
            gauge: { type: 'GRADE', final: 100 },
          },
          {
            title: 'B',
            aborted: true,
            judged: { pgreat: 3, great: 0, good: 0, bad: 0, poor: 1 },
            exScore: 6,
            gauge: { type: 'GRADE', start: 100, final: 97 },
          },
        ],
      },
    });
  });

  test('judgments by kind', () => {
    expect(judgedOf({ perfect: 1, great: 2, good: 3, bad: 4, poor: 5 })).toEqual({
      pgreat: 1,
      great: 2,
      good: 3,
      bad: 4,
      poor: 5,
    });
  });
});

describe('nameJingle', () => {
  test('names the slot holding the very bytes', () => {
    const clear = new Uint8Array([1]);
    const courseClear = new Uint8Array([1]);
    const sets = { lr2: { clear, courseClear }, beatoraja: { clear: undefined } };
    expect(nameJingle(courseClear, sets)).toBe('lr2:courseClear');
    expect(nameJingle(clear, sets)).toBe('lr2:clear');
    expect(nameJingle(new Uint8Array([1]), sets)).toBeUndefined();
    expect(nameJingle(undefined, sets)).toBeUndefined();
  });
});
