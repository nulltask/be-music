// The test hook's live half: what `window.__beMusicTest.state()` reads from the app at each call (the scene the router
// shows, the select screen's cursor, the play on the stage, the library, the course run and the course being made),
// and the theme slot a result's jingle came from. `test-hook.ts` keeps the contract and records what the host hands
// it (results, replays, loads). Every read here is synchronous and starts nothing: `state()` answers at once, from
// what the app holds already, and leaves the app as it found it.

import type { PlayScene, SelectScene } from '@be-music/player-browser/host';
import type { LibraryChart, LibraryEntry } from '@be-music/player-scene-model';
import type { BeMusicChartBestRecord } from '@be-music/player-skin-sdk';
import { lookupCourseBestRecord } from '../course-result.ts';
import { describeBar, judgedOf, nameJingle, type TestHookLiveState } from '../test-hook.ts';
import type { DemoGUIState, DemoScene, PlayerWebDemoElements } from '../types.ts';
import type { CourseMakerService } from './course-maker.ts';
import type { CourseRunService } from './courses.ts';
import type { LibraryService } from './library.ts';
import type { RecordsService } from './records.ts';
import type { BeatorajaThemeService } from './themes/beatoraja.ts';
import type { LR2ThemeService } from './themes/lr2.ts';

/** The scenes the router holds: the one showing, the select scene it keeps, and the play on the stage or loading. */
export interface TestHookScenes {
  readonly current: DemoScene | undefined;
  readonly select: SelectScene | undefined;
  readonly play: PlayScene | undefined;
}

/** The chart and play mode of the most recent play start (the play route's `lastPlay`). */
export interface TestHookPlayStart {
  readonly chart: Pick<LibraryChart, 'title'>;
  readonly overrides: { readonly autoPlay: boolean; readonly replay?: unknown };
}

export interface LiveTestHookDeps {
  /** The scene router. */
  readonly router: TestHookScenes;
  /** The page: the loading overlay. */
  readonly elements: Pick<PlayerWebDemoElements, 'loadingOverlay'>;
  /** The Debug Menu's state: the status line, and the NONSTOP placement a course bar's record is read for. */
  readonly guiState: Pick<DemoGUIState, 'status' | 'nonstopPlacement'>;
  /** The library: its charts and course folders. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The best records of the current judge ruleset, which the select screen shows, read without hashing a chart. */
  readonly records: Pick<RecordsService, 'peekChartBestRecord' | 'currentRulesetRecords'>;
  /** The course run in progress. */
  readonly courses: Pick<CourseRunService, 'active'>;
  /** The course being made. */
  readonly courseMaker: { readonly maker: Pick<CourseMakerService['maker'], 'draft'> };
  /** The most recent play start, which the play on the stage was started with. */
  readonly lastPlay: () => TestHookPlayStart | undefined;
}

/** What `window.__beMusicTest` reports now (`test-hook.ts`), read from the scenes up and the services' state. */
export function liveTestHookState(deps: LiveTestHookDeps): TestHookLiveState {
  const { router } = deps;
  // The scene showing names itself; none shows between screens.
  const current = router.current;
  const scene: TestHookLiveState['scene'] =
    current === undefined ? { kind: 'none' } : { kind: current.identity.kind, family: current.identity.family };
  const select = scene.kind === 'select' && current === router.select ? router.select : undefined;
  const entry = select?.focused();
  // The select screen's browse position: its folders, sort, filters and search.
  const navigation = select?.snapshot();
  const play = scene.kind === 'play' ? deps.lastPlay() : undefined;
  // The play's running result, whichever family draws it.
  const gameplay = router.play;
  const progress = gameplay?.progress();
  const active = deps.courses.active;
  const draft = deps.courseMaker.maker.draft;
  const { collection } = deps.library;
  return {
    scene,
    status: deps.guiState.status,
    loading: deps.elements.loadingOverlay.classList.contains('visible'),
    library: {
      charts: collection.charts.length,
      courseFolders: (collection.courseFolders ?? []).map((folder) => folder.label),
    },
    cursor:
      scene.kind === 'select'
        ? {
            folderPath: [...(navigation?.folderPath ?? [])],
            bar: entry && describeBar(entry, barRecord(entry, deps)),
            list: navigation && {
              sort: navigation.list?.sort ?? 'OFF',
              keysFilter: navigation.list?.keysFilter ?? 'ALL',
              difficultyFilter: navigation.list?.difficultyFilter ?? 'ALL',
              search: navigation.searchText ?? '',
            },
          }
        : undefined,
    play: play && {
      title: play.chart.title,
      autoPlay: play.overrides.autoPlay,
      replay: play.overrides.replay !== undefined,
      tempo: gameplay?.getTempo() ?? 1,
      hiSpeed: gameplay?.getHiSpeed(),
      seconds: progress?.playSeconds,
      judged: progress && judgedOf(progress.score),
      gauge: progress && { type: progress.gaugeType, value: progress.gauge },
      course: active && {
        name: active.course.definition.name,
        stage: active.run.stagesPlayed + 1,
        stageCount: active.run.stageCount,
      },
    },
    courseDraft: draft && { kind: draft.kind, stages: draft.stages.map((stage) => stage.title ?? stage.md5) },
  };
}

/**
 * The best record kept for a select-screen bar, as the select screen shows it: a chart's or a course's (with the trophy
 * its bests earn), of the current judge ruleset. Records are stored under ruleset-prefixed keys (a course run's under the
 * ruleset it was played on, `resolveCourseBestRecordUpdate`), so a course is looked up in the current ruleset's records.
 */
function barRecord(entry: LibraryEntry, deps: LiveTestHookDeps): BeMusicChartBestRecord | undefined {
  // A chart's record is keyed by its hash once known; a read hashes nothing (the select screen does as it shows the bar).
  if (entry.kind === 'chart') return deps.records.peekChartBestRecord(entry.chart);
  if (entry.kind === 'course') {
    return lookupCourseBestRecord(entry.course, deps.records.currentRulesetRecords(), deps.guiState.nonstopPlacement);
  }
  return undefined;
}

/** The themes a result's jingle may come from. */
export interface ResultJingleThemes {
  readonly lr2: Pick<LR2ThemeService, 'resultJingles'>;
  readonly beatoraja: Pick<BeatorajaThemeService, 'beatorajaThemeBGM'>;
}

/** Which theme slot a result jingle came from (`lr2:courseClear`, `beatoraja:fail`, ...), for the test hook. */
export function nameResultJingle(bytes: Uint8Array | undefined, themes: ResultJingleThemes): string | undefined {
  return nameJingle(bytes, {
    lr2: themes.lr2.resultJingles(),
    beatoraja: { ...themes.beatoraja.beatorajaThemeBGM },
  });
}
