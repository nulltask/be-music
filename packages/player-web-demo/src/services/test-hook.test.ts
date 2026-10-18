import { createEmptyJson } from '@be-music/json';
import { computeChartFileHashes, type BrowserSongCollection } from '@be-music/player-web/collection';
import type { PlayScene, SelectScene } from '@be-music/player-web/host';
import { parseBeatorajaCourseData } from '@be-music/player/course';
import type { PlaylogRulesetId } from '@be-music/player/ruleset';
import type { BrowseSnapshot, LibraryChart, LibraryCourse, LibraryEntry, PlayResult } from '@be-music/scene-model';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { ActiveCourse } from '../course-flow.ts';
import { courseRecordKey } from '../course-result.ts';
import type { DemoScene, PlayerWebDemoElements } from '../types.ts';
import { RecordsService } from './records.ts';
import { liveTestHookState, nameResultJingle, type LiveTestHookDeps } from './test-hook.ts';

vi.mock('@be-music/player-web/collection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@be-music/player-web/collection')>();
  return { ...actual, computeChartFileHashes: vi.fn(actual.computeChartFileHashes) };
});

const hashChart = vi.mocked(computeChartFileHashes);

function song(id: string): LibraryChart {
  return {
    id,
    sourceId: 'src',
    sourceLabel: 'src',
    sourceKind: 'files',
    chartPath: `${id}.bms`,
    directoryLabel: 'src',
    fileLabel: `${id}.bms`,
    title: id.toUpperCase(),
    totalNotes: 10,
    chart: createEmptyJson('bms'),
  };
}

/** A GRADE course of charts `a`, `b` and `c` (30 notes), with a bronze and a gold medal. */
function dan(): LibraryCourse {
  const definition = parseBeatorajaCourseData({
    name: 'Dan',
    hash: ['1', '2', '3'].map((digit) => ({ md5: digit.repeat(32) })),
    constraint: ['CLASS'],
  })!;
  return {
    id: 'dan#0',
    definition: {
      ...definition,
      trophies: [
        { name: 'bronzemedal', missRate: 10, scoreRate: 50 },
        { name: 'goldmedal', missRate: 2.5, scoreRate: 85 },
      ],
    },
    stages: ['a', 'b', 'c'].map((id) => ({ title: id.toUpperCase(), chart: song(id) })),
    playable: true,
  };
}

/** A library whose one source holds `a.bms` (the bytes `abc`), listing `a` and a course folder. */
function library(): BrowserSongCollection {
  return {
    sources: [{ id: 'src', kind: 'files', label: 'src', files: new Map([['a.bms', new TextEncoder().encode('abc')]]) }],
    charts: [song('a')],
    errors: [],
    courseFolders: [{ label: 'courses', charts: [], courses: [dan()] }],
  };
}

/** A select scene on `family` with `entry` under its cursor, browsed to `snapshot`. */
function selectScene(entry: LibraryEntry | undefined, snapshot?: Partial<BrowseSnapshot>): SelectScene {
  return {
    identity: { kind: 'select', family: 'lr2' },
    focused: () => entry,
    snapshot: (): BrowseSnapshot => ({ folderPath: [], cursors: [0], ...snapshot }),
  } as unknown as SelectScene;
}

/** A play scene with its tempo, hi-speed and running result. */
function playScene(progress?: Partial<PlayResult>): PlayScene {
  return {
    identity: { kind: 'play', family: 'beatoraja' },
    getTempo: () => 0.8,
    getHiSpeed: () => 2.5,
    progress: () => progress,
  } as unknown as PlayScene;
}

/** The loading overlay, shown or not. */
function overlay(visible: boolean): Pick<PlayerWebDemoElements, 'loadingOverlay'> {
  return {
    loadingOverlay: { classList: { contains: (name: string) => visible && name === 'visible' } },
  } as unknown as Pick<PlayerWebDemoElements, 'loadingOverlay'>;
}

interface Harness {
  readonly deps: LiveTestHookDeps;
  readonly router: { current: DemoScene | undefined; select: SelectScene | undefined; play: PlayScene | undefined };
  readonly records: RecordsService;
  readonly ruleset: { current: PlaylogRulesetId };
}

function harness(options: { loading?: boolean } = {}): Harness {
  const router: Harness['router'] = { current: undefined, select: undefined, play: undefined };
  const collection = library();
  const ruleset: Harness['ruleset'] = { current: 'lr2' };
  const records = new RecordsService({ collection: () => collection, judgeRuleset: () => ruleset.current });
  const deps: LiveTestHookDeps = {
    router,
    elements: overlay(options.loading ?? false),
    guiState: { status: '1 chart loaded', nonstopPlacement: 'intended' },
    library: { collection },
    records,
    courses: { active: undefined },
    courseMaker: { maker: { draft: undefined } },
    lastPlay: () => undefined,
  };
  return { deps, router, records, ruleset };
}

beforeEach(() => {
  hashChart.mockClear();
});

describe('liveTestHookState', () => {
  test('reports no scene between screens, with the status line, the loading overlay and the library', () => {
    const { deps } = harness({ loading: true });
    expect(liveTestHookState(deps)).toEqual({
      scene: { kind: 'none' },
      status: '1 chart loaded',
      loading: true,
      library: { songs: 1, courseFolders: ['courses'] },
      cursor: undefined,
      play: undefined,
      courseDraft: undefined,
    });
  });

  test("reports the select screen's cursor: its folders, the bar under it with its record, and the list's shape", () => {
    const h = harness();
    h.records.songRecords.set('lr2:path:a.bms', { lamp: 'HARD' });
    const select = selectScene(
      { kind: 'chart', chart: song('a') },
      { folderPath: ['src'], list: { sort: 'TITLE', keysFilter: 'KEYS_7' }, searchText: 'a' },
    );
    h.router.current = select;
    h.router.select = select;
    expect(liveTestHookState(h.deps)).toMatchObject({
      scene: { kind: 'select', family: 'lr2' },
      cursor: {
        folderPath: ['src'],
        bar: { kind: 'song', title: 'A', lamp: 'HARD' },
        list: { sort: 'TITLE', keysFilter: 'KEYS_7', difficultyFilter: 'ALL', search: 'a' },
      },
    });
  });

  test('reports a folder bar, and the default list shape for a screen that keeps none', () => {
    const h = harness();
    const select = selectScene({ kind: 'folder', folder: { label: 'courses', charts: [] } });
    h.router.current = select;
    h.router.select = select;
    expect(liveTestHookState(h.deps).cursor).toEqual({
      folderPath: [],
      bar: { kind: 'folder', title: 'courses' },
      list: { sort: 'OFF', keysFilter: 'ALL', difficultyFilter: 'ALL', search: '' },
    });
  });

  test("reports a course bar's best lamp and trophy, kept under the current judge ruleset", () => {
    const h = harness();
    const course = dan();
    const select = selectScene({ kind: 'course', course }, { folderPath: ['courses'] });
    h.router.current = select;
    h.router.select = select;
    // A run is kept under the ruleset it was played on (`resolveCourseRecordUpdate`): 52 / 60 EX, no BP, a gold medal.
    h.records.songRecords.set(`lr2:${courseRecordKey(course)}`, { lamp: 'FAILED', exScore: 52, missCount: 0 });
    h.records.songRecords.set(`beatoraja:${courseRecordKey(course)}`, { lamp: 'HARD', exScore: 40, missCount: 3 });
    expect(liveTestHookState(h.deps).cursor?.bar).toMatchObject({
      kind: 'course',
      title: 'Dan',
      lamp: 'FAILED',
      trophy: 'goldmedal',
    });
    // Judge windows picks the ruleset whose records the select screen shows, and the hook reports the same.
    h.ruleset.current = 'beatoraja';
    expect(liveTestHookState(h.deps).cursor?.bar).toMatchObject({ lamp: 'HARD', trophy: 'bronzemedal' });
    h.ruleset.current = 'iidx';
    const bar = liveTestHookState(h.deps).cursor?.bar;
    expect(bar?.lamp).toBeUndefined();
    expect(bar?.trophy).toBeUndefined();
  });

  test('reports no cursor while the select scene is kept off the stage', () => {
    const h = harness();
    h.router.select = selectScene({ kind: 'chart', chart: song('a') });
    h.router.current = { identity: { kind: 'decide', family: 'lr2' } } as unknown as DemoScene;
    expect(liveTestHookState(h.deps)).toMatchObject({ scene: { kind: 'decide', family: 'lr2' }, cursor: undefined });
  });

  test('reports the play on the stage: its start, tempo, hi-speed, running result and course stage', () => {
    const h = harness();
    const play = playScene({
      playSeconds: 4.5,
      score: { total: 4, perfect: 3, great: 1, good: 0, bad: 0, poor: 2, emptyPoor: 0, exScore: 7, score: 0 },
      gaugeType: 'GRADE',
      gauge: 88,
    });
    h.router.current = play;
    h.router.play = play;
    const deps: LiveTestHookDeps = {
      ...h.deps,
      lastPlay: () => ({ song: song('b'), overrides: { autoPlay: true, replay: {} } }),
      courses: {
        active: { course: dan(), run: { stagesPlayed: 1, stageCount: 3 } } as unknown as ActiveCourse,
      },
    };
    expect(liveTestHookState(deps)).toMatchObject({
      scene: { kind: 'play', family: 'beatoraja' },
      cursor: undefined,
      play: {
        title: 'B',
        autoPlay: true,
        replay: true,
        tempo: 0.8,
        hiSpeed: 2.5,
        seconds: 4.5,
        judged: { pgreat: 3, great: 1, good: 0, bad: 0, poor: 2 },
        gauge: { type: 'GRADE', value: 88 },
        course: { name: 'Dan', stage: 2, stageCount: 3 },
      },
    });
  });

  test('reports no play while a play loads behind another screen', () => {
    const h = harness();
    h.router.play = playScene();
    h.router.current = { identity: { kind: 'decide', family: 'beatoraja' } } as unknown as DemoScene;
    const deps: LiveTestHookDeps = { ...h.deps, lastPlay: () => ({ song: song('b'), overrides: { autoPlay: false } }) };
    expect(liveTestHookState(deps).play).toBeUndefined();
  });

  test('reports the course being made, a stage by its title or else its MD5', () => {
    const h = harness();
    const deps: LiveTestHookDeps = {
      ...h.deps,
      courseMaker: {
        maker: {
          draft: { kind: 'grade', stages: [{ title: 'A', md5: '1'.repeat(32) }, { md5: '2'.repeat(32) }] },
        } as unknown as LiveTestHookDeps['courseMaker']['maker'],
      },
    };
    expect(liveTestHookState(deps).courseDraft).toEqual({ kind: 'grade', stages: ['A', '2'.repeat(32)] });
  });
});

describe('nameResultJingle', () => {
  test('names the theme slot holding the very bytes, LR2 first', () => {
    const courseClear = new Uint8Array([1]);
    const fail = new Uint8Array([2]);
    const themes = {
      lr2: { resultJingles: () => ({ courseClear }) },
      beatoraja: { beatorajaThemeBgm: { fail } },
    } as unknown as Parameters<typeof nameResultJingle>[1];
    expect(nameResultJingle(courseClear, themes)).toBe('lr2:courseClear');
    expect(nameResultJingle(fail, themes)).toBe('beatoraja:fail');
    expect(nameResultJingle(new Uint8Array([1]), themes)).toBeUndefined();
    expect(nameResultJingle(undefined, themes)).toBeUndefined();
  });
});
