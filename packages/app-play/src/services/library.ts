// The library the select screen lists: the charts of every drop, file pick and URL load (the collection store), and
// the course folders matched against them: course files, difficulty tables (by URL or a dropped `header.json`) and
// the player's own courses. A drop's theme files go to the theme loaders, its replays to the replay.

import { logger } from '@be-music/player-browser';
import {
  BrowserChartCollectionStore,
  bindCourseStagePaths,
  createChartHashLookup,
  describeChartCollection,
  isCourseFilePath,
  materializeDroppedFiles,
  readCourseFile,
  resolveCourseFolders,
  readDropEntries,
  resolveCourseMakerFolders,
  splitDroppedChartAndThemeFiles,
  type BrowserDroppedFile,
  type BrowserChartCollection,
  type ChartCacheKeyBook,
  type ChartFileHashes,
  type CourseDefinitionGroup,
  type LoadProgressOptions,
  type CourseMaker,
  type LoadProgress,
} from '@be-music/player-browser/collection';
import { applyChartLevelEdits, readChartLevelEdits } from '../chart-level-edits.ts';
import { createIndexedDBParsedChartCache, currentParsedChartBuildStamp } from './parsed-chart-database.ts';
import type { SceneKind, SelectScene } from '@be-music/player-browser/host';
import {
  skinFamilyRegistry,
  summarizeBeatorajaPlaySkins,
  type BeatorajaThemeBundle,
  type SkinFamilyId,
} from '@be-music/player-browser/skin';
import { summarizeLR2PlaySkins, type LR2PlaySkinMap, type LR2Skin } from '@be-music/skin-lr2';
import { discoverBeatorajaTheme } from '@be-music/skin-beatoraja';
import { countLR2UnplayedStages, LR2_MAX_PLAYED_STAGES } from '@be-music/player-engine/course';
import { COURSE_REPLAY_FILE_SUFFIX, REPLAY_FILE_SUFFIX } from '@be-music/player-engine/replay';
import type { BrowseSnapshot, LibraryChart, LibraryCourse } from '@be-music/player-scene-model';
import {
  createCachedCourseTableFetchText,
  describeCourseTableImportError,
  importCourseTable,
  type ImportedCourseTable,
  isTableHeaderFilePath,
  mergeCourseGroup,
  readStoredCourseTableURLs,
  readTableHeaderFile,
  rememberCourseTableURL,
} from '../course-table-import.ts';
import {
  describeMissingCourseStages,
  parseTableSongIndex,
  withTableSongTitles,
  type MissingCourseStage,
  type TableSongIndex,
} from '../course-table-songs.ts';
import type { CourseDefinition } from '@be-music/player-engine/course';
import { navigationAfterDrop } from '../drop-navigation.ts';
import {
  applyLoadProgress,
  hideLoadingOverlay,
  showLoadingOverlay,
  type LoadingOverlayElements,
} from '../loading-overlay.ts';
import type { PlayerWebElements } from '../types.ts';
import { expandZipToFiles, fetchZipAsFile, fetchZipAsFiles, parseURLMediaParams } from '../url-load.ts';
import { bemuseServerLabel, readStoredBemuseServerURLs } from '../bemuse-server.ts';
import {
  keepBemuseLibraryIndex,
  openBemuseLibraryIndex,
  readBemuseLibraryIndex,
  readBemuseServerFiles,
  type BemuseServerFiles,
  type BemuseLibraryIndex,
} from './bemuse-servers.ts';
import { pageRemoteCacheStore } from './remote-cache.ts';
import type { TableFetchText } from '@be-music/player-engine/course';
import { BemuseSongExtrasRegistry } from '../bemuse-song-extras.ts';
import { isDroppedArchive, sortDroppedArchives } from './drop-archives.ts';

const dropLog = logger('drop');

export interface LibraryServiceOptions {
  /** The loading overlay a URL load shows and every load reports its progress on, and the shell (`.playing`). */
  readonly elements: LoadingOverlayElements & Pick<PlayerWebElements, 'shell'>;
  /** A chart's file hashes, cached per chart (`RecordsService`): course stages are matched by them. */
  readonly resolveChartHashes: (chartEntry: LibraryChart) => Promise<ChartFileHashes | undefined>;
  /**
   * Whether Bemuse server songs take their ReplayGain (Options → "Bemuse ReplayGain"); on when left out. After it
   * changes, {@link LibraryService.refreshBemuseReplayGain} applies it to the charts already loaded.
   */
  readonly bemuseReplayGain?: () => boolean;
  /** The course maker, whose saved courses are listed in their own folders. */
  readonly courseMaker: Pick<CourseMaker, 'courses'>;
  /** The select screen the router keeps, on the stage or off it; `undefined` before the first. */
  readonly selectView: () => SelectScene | undefined;
  /** The kind of screen on the stage; `undefined` between screens. */
  readonly showing: () => SceneKind | undefined;
  readonly setStatus: (text: string) => void;
  /** Shows the select screen with the library as it is now. */
  readonly showSelect: () => Promise<void>;
  /** Takes the select screen off the stage while files load, when it is the one showing. */
  readonly leaveSelect: () => Promise<boolean>;
  /** Opens the select screen on `navigation` the next time it shows: a drop opens what it brought. */
  readonly browseTo: (navigation: BrowseSnapshot) => void;
  /** Starts replaying a dropped replay, once the drop's charts are listed. */
  readonly startReplayReplayFromFile: (file: BrowserDroppedFile) => Promise<void>;
  /** Loads a drop's LR2 theme files. */
  readonly loadTheme: (files: File[]) => Promise<void>;
  /** Loads a drop's beatoraja theme files. */
  readonly loadBeatorajaTheme: (files: File[]) => Promise<void>;
  /** The LR2 theme's play skins, per play variant, for the drop's log line. */
  readonly playSkins: () => LR2PlaySkinMap;
  /** The LR2 theme's select skin. */
  readonly selectSkin: () => LR2Skin | undefined;
  /** The LR2 theme's result skin. */
  readonly resultSkin: () => LR2Skin | undefined;
  /** The beatoraja theme. */
  readonly beatorajaTheme: () => BeatorajaThemeBundle | undefined;
  /** Confirms a detected skin before replacing any loaded theme; cancellation leaves charts importable. */
  readonly confirmSkinDrop: (families: ReadonlySet<SkinFamilyId>) => Promise<SkinFamilyId | undefined>;
  /** Applies the confirmed skin and releases the previous select scene before its replacement mounts. */
  readonly applyDroppedSkin: (family: SkinFamilyId) => void | Promise<void>;
}

export interface LibraryLoadOrigin {
  /** Refreshes an active select screen without interrupting other scenes. */
  readonly startup?: boolean;
  readonly showLibraryRoot?: boolean;
  readonly entries?: readonly FileSystemEntry[];
  readonly readFiles?: () => Promise<BrowserDroppedFile[]>;
  /** The cache keys of the load's chart files, so the ones known unchanged are listed without being read. */
  readonly chartKeys?: ChartCacheKeyBook;
  readonly onChartCacheMiss?: LoadProgressOptions['onChartCacheMiss'];
  readonly bemuseURL?: string;
  /** Opens course and skin files after the first select screen, outside the cached chart restore. */
  readonly readAuxiliaryAfter?: Promise<void>;
  /** The load's charts are in the library: after the first load, and after each time they are read again. */
  readonly onLoaded?: () => void;
}

function isReplayFile(file: BrowserDroppedFile): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(REPLAY_FILE_SUFFIX) || name.endsWith(COURSE_REPLAY_FILE_SUFFIX);
}

type LibraryChartLoad = LibraryLoadOrigin & { files: BrowserDroppedFile[]; sourceIds: string[] };

/** The charts and courses the select screen lists, and the loads that add to them. */
export class LibraryService {
  /**
   * The library as last loaded: a new object whenever it changes, so the select screen tells a new library from a
   * redraw of the same one (`setLibrary`).
   */
  public collection: BrowserChartCollection = { sources: [], charts: [], errors: [] };
  /** Every load of charts, for the folder reload (`reloadCharts`): a drop's entries, or the files themselves. */
  private readonly chartLoads: LibraryChartLoad[] = [];
  private collectionStore = new BrowserChartCollectionStore();
  /** The songs of the Bemuse servers loaded, whose preview, video, images and gain go onto their charts. */
  private readonly bemuseSongs: BemuseSongExtrasRegistry;
  private readonly displayedBemuseIndexes = new Map<string, BemuseLibraryIndex>();
  /** The library changed on disk while no select screen showed; it is read again when one does ({@link selectShown}). */
  private refreshPending = false;
  private refreshing: Promise<void> | undefined;
  /** The last change to the collection in line: a load and a re-read each start once the one before is in. */
  private collectionWork: Promise<unknown> = Promise.resolve();
  /** Charts parsed on an earlier visit, by the SHA-256 of their files: a folder dropped again is not parsed again. */
  private readonly parsedChartCache = createIndexedDBParsedChartCache(currentParsedChartBuildStamp());
  /**
   * Course files dropped so far (`.lr2crs`, beatoraja `course/*.json`) and courses imported from difficulty-table URLs,
   * resolved into `collection.courseFolders`.
   */
  private courseGroups: CourseDefinitionGroup[] = [];
  /** The course group label of each difficulty table imported by URL this session, by its URL. */
  private readonly courseTableLabels = new Map<string, string>();
  /** Called when a difficulty table imports or is removed (the Options dialog's table list names them). */
  private readonly courseTableListeners = new Set<() => void>();
  /** The song list (`data_url`) of the difficulty table each imported course came from. */
  private readonly courseTableDataURLs = new WeakMap<CourseDefinition, string>();
  /** Table song lists being fetched or fetched this session, by URL: fetched once, when a course of the table needs it. */
  private readonly tableSongIndexes = new Map<string, Promise<TableSongIndex>>();
  /** The table song lists that arrived, by URL, whose titles the course folders show. */
  private readonly loadedSongIndexes = new Map<string, TableSongIndex>();
  /**
   * When the player last reloaded the folders: what was kept from the difficulty tables and the Bemuse servers before
   * then is asked for again (`services/remote-cache.ts`).
   */
  private remoteRefreshedSince: number | undefined;
  /** Session-only draws, oldest first across every source folder. */
  private keptRandomCourses: Array<{ folderLabel: string; course: LibraryCourse }> = [];
  private nextDrawId = 0;
  private readonly elements: LibraryServiceOptions['elements'];
  private readonly resolveChartHashes: LibraryServiceOptions['resolveChartHashes'];
  private readonly courseMaker: LibraryServiceOptions['courseMaker'];
  private readonly selectView: LibraryServiceOptions['selectView'];
  private readonly showing: LibraryServiceOptions['showing'];
  private readonly setStatus: LibraryServiceOptions['setStatus'];
  private readonly showSelect: LibraryServiceOptions['showSelect'];
  private readonly leaveSelect: LibraryServiceOptions['leaveSelect'];
  private readonly browseTo: LibraryServiceOptions['browseTo'];
  private readonly startReplayReplayFromFile: LibraryServiceOptions['startReplayReplayFromFile'];
  private readonly loadTheme: LibraryServiceOptions['loadTheme'];
  private readonly loadBeatorajaTheme: LibraryServiceOptions['loadBeatorajaTheme'];
  private readonly playSkins: LibraryServiceOptions['playSkins'];
  private readonly selectSkin: LibraryServiceOptions['selectSkin'];
  private readonly resultSkin: LibraryServiceOptions['resultSkin'];
  private readonly beatorajaTheme: LibraryServiceOptions['beatorajaTheme'];
  private readonly confirmSkinDrop: LibraryServiceOptions['confirmSkinDrop'];
  private readonly applyDroppedSkin: LibraryServiceOptions['applyDroppedSkin'];

  public constructor(options: LibraryServiceOptions) {
    this.elements = options.elements;
    this.resolveChartHashes = options.resolveChartHashes;
    this.courseMaker = options.courseMaker;
    this.bemuseSongs = new BemuseSongExtrasRegistry(options.bemuseReplayGain);
    this.selectView = options.selectView;
    this.showing = options.showing;
    this.setStatus = options.setStatus;
    this.showSelect = options.showSelect;
    this.leaveSelect = options.leaveSelect;
    this.browseTo = options.browseTo;
    this.startReplayReplayFromFile = options.startReplayReplayFromFile;
    this.loadTheme = options.loadTheme;
    this.loadBeatorajaTheme = options.loadBeatorajaTheme;
    this.playSkins = options.playSkins;
    this.selectSkin = options.selectSkin;
    this.resultSkin = options.resultSkin;
    this.beatorajaTheme = options.beatorajaTheme;
    this.confirmSkinDrop = options.confirmSkinDrop;
    this.applyDroppedSkin = options.applyDroppedSkin;
  }

  /** Names a draw now, but lists it only once the decide screen (or direct play) has loaded. */
  public prepareDrawnCourse(
    drawn: LibraryCourse,
    navigation: BrowseSnapshot | undefined,
    at: Date = new Date(),
  ): { course: LibraryCourse; remember: () => void } {
    const folderLabel =
      navigation?.folderPath.at(-1) ??
      this.collection.courseFolders?.find((folder) => folder.courses?.some((course) => course.id === drawn.id))?.label;
    const pad = (value: number): string => String(value).padStart(2, '0');
    const suffix = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}_${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
    const { random: _random, ...fixed } = drawn;
    let id: string;
    do {
      id = `be-music:drawn-random:${++this.nextDrawId}`;
    } while (this.collection.courseFolders?.some((folder) => folder.courses?.some((entry) => entry.id === id)));
    const course: LibraryCourse = {
      ...fixed,
      id,
      definition: { ...drawn.definition, name: `${drawn.definition.name} ${suffix}`, release: false },
    };
    let remembered = false;
    return {
      course,
      remember: () => {
        if (remembered || folderLabel === undefined) return;
        remembered = true;
        const replacedIds = new Set(this.keptRandomCourses.map((entry) => entry.course.id));
        this.keptRandomCourses.push({ folderLabel, course });
        if (this.keptRandomCourses.length > 100) this.keptRandomCourses.shift();
        this.appendKeptRandomCourses(replacedIds);
      },
    };
  }

  /** Reprojects the history after imports, maker edits and each draw; fixed bars retain their authored order. */
  private appendKeptRandomCourses(
    replacedIds: ReadonlySet<string> = new Set(this.keptRandomCourses.map((entry) => entry.course.id)),
  ): void {
    this.collection = {
      ...this.collection,
      courseFolders: this.collection.courseFolders?.map((folder) => ({
        ...folder,
        courses: [
          ...(folder.courses ?? []).filter((course) => !replacedIds.has(course.id)),
          ...this.keptRandomCourses.filter((entry) => entry.folderLabel === folder.label).map((entry) => entry.course),
        ],
      })),
    };
  }

  /**
   * `?music=<url.zip>` / `?skin=<url.zip>` auto-load: fetch + expand the archives at boot and run them through the
   * same pipeline as a drag-drop, so the select screen lists the archive's charts (with any skin already applied).
   * Sequenced after the first select screen shows (`ready`).
   */
  public autoLoad(href: string, ready: Promise<void>): Promise<void> {
    const mediaParams = parseURLMediaParams(href);
    const storedCourseTables = readStoredCourseTableURLs();
    const bemuseServers = readStoredBemuseServerURLs();
    return ready.then(async () => {
      if (mediaParams.musicURL || mediaParams.skinURL) await this.loadFromURL(mediaParams);
      const startedAt = Date.now();
      await Promise.all([
        ...bemuseServers.map(async (url) => {
          if (await this.loadBemuseServer(url, startedAt)) await this.showStartupLibrary();
        }),
        ...storedCourseTables.map(async (url) => {
          const imported = await this.importCourseTables([url], false, { relist: false, refreshedSince: startedAt });
          if (imported.length > 0) await this.showStartupLibrary();
        }),
      ]);
    });
  }

  public async restoreStartupCache(): Promise<void> {
    const urls = readStoredBemuseServerURLs();
    const tableFetch = createCachedCourseTableFetchText({ store: pageRemoteCacheStore(), cacheOnly: true });
    const [servers, tables] = await Promise.all([
      Promise.all(urls.map(async (url) => ({ url, index: await readBemuseLibraryIndex(url) }))),
      Promise.all(
        readStoredCourseTableURLs().map(async (url) => ({
          url,
          table: await importCourseTable(url, tableFetch).catch(() => undefined),
        })),
      ),
    ]);
    for (const { url, index } of servers) {
      if (index === undefined) continue;
      try {
        const { files, songs } = openBemuseLibraryIndex(index);
        this.bemuseSongs.remember(songs);
        const keys = new Map(index.chartKeys);
        let incomplete = false;
        await this.loadCharts(files, {
          startup: true,
          bemuseURL: url,
          chartKeys: { known: (path) => keys.get(path), learned: () => {} },
          onChartCacheMiss: () => {
            incomplete = true;
          },
        });
        if (!incomplete) this.displayedBemuseIndexes.set(url, index);
      } catch (error) {
        dropLog.warn(`Bemuse library index could not be restored: ${url}`, error);
      }
    }
    for (const { url, table } of tables) if (table !== undefined) this.installCourseTable(url, table);
  }

  /** Applies listing settings and matches course stages once all cached sources are in. */
  public async finishStartupCache(): Promise<void> {
    await this.changeCollection(async () => {
      this.applyChartSettings();
      await this.refreshCourseFolders();
      if (this.courseTableLabels.size > 0) this.notifyCourseTableListeners();
    });
  }

  private async showStartupLibrary(): Promise<void> {
    if (this.showing() !== 'select' || this.elements.shell.classList.contains('playing')) return;
    const view = this.selectView();
    if (view === undefined) {
      await this.showSelect();
      return;
    }
    view.setLibrary(this.collection);
    this.elements.shell.classList.toggle('empty', this.collection.charts.length === 0);
  }

  /**
   * Shared post-enumeration pipeline for both drag-drop and the Options dialog's "Open folder" / "Open files" pickers. Routes the incoming
   * file list through {@link splitDroppedChartAndThemeFiles}, dispatches theme + song loaders in parallel, then mounts
   * the freshly populated select view.
   *
   * The caller is responsible for showing / hiding the loading overlay and pausing the select view — both entry points
   * handle that around their own enumeration phase.
   *
   * `loadCharts` appends to the existing collection so a second / third invocation of this routine accumulates entries
   * rather than wiping the previous pack — the host can call this multiple times in succession (e.g. Open folder
   * pressed twice with two different folders) and every drop's charts stay uniquely addressable through the collection
   * per-source prefixing.
   */
  public async processIncomingFiles(files: BrowserDroppedFile[], origin: LibraryLoadOrigin = {}): Promise<void> {
    if (origin.readAuxiliaryAfter !== undefined) {
      const courseOrTable = (file: BrowserDroppedFile) =>
        isCourseFilePath(file.webkitRelativePath || file.name) || isTableHeaderFilePath(file.name);
      const { chartFiles, themeFiles } = splitDroppedChartAndThemeFiles(
        files.filter((file) => !courseOrTable(file) && !isReplayFile(file)),
      );
      await this.loadCharts(chartFiles, origin);
      const auxiliary = [...themeFiles, ...files.filter(courseOrTable)];
      if (auxiliary.length > 0) {
        void origin.readAuxiliaryAfter
          .then(() => this.processIncomingFiles(auxiliary, { startup: true }))
          .catch((error: unknown) => dropLog.warn('Remembered folder course or skin load failed', error));
      }
      return;
    }
    if (files.length === 0) {
      // A folder's snapshot can be empty while its background walk finds new charts.
      if (origin.readFiles !== undefined) await this.loadCharts(files, origin);
      return;
    }
    const showLibrary = () =>
      origin.onChartCacheMiss !== undefined
        ? Promise.resolve()
        : origin.startup
          ? this.showStartupLibrary()
          : this.showSelect();
    // Dropped ZIP archives: one that holds a chart goes to the collection whole, as the Open files picker sends it;
    // any other (a skin, replays, course files) is expanded and joins the drop, as a `?skin=` archive does. A ZIP inside
    // a dropped folder is neither: it stays a plain file of the folder.
    const archives = files.filter(isDroppedArchive);
    if (archives.length > 0) {
      files = files.filter((file) => !isDroppedArchive(file));
      const sorted = await sortDroppedArchives(
        await materializeDroppedFiles(archives, {
          onError: (file, error) => dropLog.warn(`skipped (open failed): ${file.webkitRelativePath}`, error),
        }),
        expandZipToFiles,
      );
      files.push(...sorted.expandedFiles);
      if (sorted.chartArchives.length > 0) {
        await this.loadCharts(sorted.chartArchives);
        if (files.length === 0) {
          await showLibrary();
          if (this.collection.charts.length > 0) this.setStatus(describeChartCollection(this.collection));
          return;
        }
      }
    }
    // Replay files ride their own path: they are replay inputs, not chart / theme assets. They are peeled off
    // BEFORE the song/theme split so a stray `.bmplay.json` (or a course's `.bmcourse.json`) never classifies as a
    // theme candidate — and handled AFTER the split's loaders ran, so dropping a song folder together with its replay
    // loads the song first and then starts the replay in one gesture.
    const replayFiles = origin.startup ? [] : files.filter(isReplayFile);
    files = files.filter((file) => !isReplayFile(file));
    if (files.length === 0 && replayFiles.length > 0) {
      await this.startReplayReplayFromFile(replayFiles[0]!);
      return;
    }
    // Course files (LR2 `.lr2crs`, beatoraja `course/*.json`, Nanasi Groove 2 `.n2x` lists) are read here and matched
    // against the collection once its songs are in.
    const courseFiles = files.filter((file) => isCourseFilePath(file.webkitRelativePath || file.name));
    files = files.filter((file) => !isCourseFilePath(file.webkitRelativePath || file.name));
    const courseGroupCount = this.courseGroups.length;
    await this.readCourseFiles(courseFiles);
    // A saved difficulty-table header stands in for a table whose site cannot be fetched from here.
    const tableHeaders = await this.readTableHeaderFiles(files.filter((file) => isTableHeaderFilePath(file.name)));
    files = files.filter((file) => !tableHeaders.has(file));
    courseFiles.push(...tableHeaders);
    if (files.length === 0 && courseFiles.length > 0) {
      if (origin.readFiles !== undefined) await this.loadCharts([], origin);
      if (this.courseGroups.length > courseGroupCount) {
        if (origin.readFiles === undefined) await this.refreshCourseFolders();
        await showLibrary();
      }
      return;
    }
    const split = splitDroppedChartAndThemeFiles(files);
    const chartFiles = split.chartFiles;
    // Folder drops leave song-bundle files unopened; the theme side is opened up front by the drop walk, so this is
    // normally a pass-through that only narrows the type for the theme loaders.
    const themeFiles = await materializeDroppedFiles(split.themeFiles, {
      onError: (file, error) => dropLog.warn(`skipped (open failed): ${file.webkitRelativePath}`, error),
    });
    // `splitDroppedChartAndThemeFiles` routes any non-chart files outside a chart directory into `themeFiles`. That
    // includes stray `readme.txt` / `info.json` / album-art images sitting at the root of a BMS pack that isn't a real
    // theme bundle. Funnel the detection through `skinFamilyRegistry` so each family's `matchesThemeFile` predicate
    // owns its own decision — this keeps "what counts as an LR2 theme file?" colocated with the LR2 family metadata
    // (and the same for beatoraja). Adding a fourth family in the future is a one-line registry edit instead of an
    // edit here.
    const themeFamilies = skinFamilyRegistry.detectThemeFamilies(
      themeFiles.map((file) => file.webkitRelativePath || file.name),
    );
    // A standalone JSON theme has neither a .luaskin marker nor a skin/ ancestor. Probe its headers before
    // offering the family switch, using the same content checks as theme discovery rather than filename guesses.
    if (!themeFamilies.has('beatoraja')) {
      const jsonFiles = themeFiles.filter((file) => file.name.toLowerCase().endsWith('.json'));
      const entries = await Promise.all(
        jsonFiles.map(
          async (file) => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())] as const,
        ),
      );
      if (discoverBeatorajaTheme(new Map(entries)).theme.entries.length > 0) themeFamilies.add('beatoraja');
    }
    const confirmation = this.confirmSkinDrop(themeFamilies);
    const carriesLR2Theme = themeFamilies.has('lr2');
    const carriesBeatorajaTheme = themeFamilies.has('beatoraja');
    const themeMarkers = [...themeFamilies];
    dropLog.info(
      `received ${files.length} file(s) · theme=${themeFiles.length}${
        themeMarkers.length > 0 ? ` (${themeMarkers.join('+')})` : ' (no skin entry → preserving current theme)'
      } · charts=${chartFiles.length}`,
    );
    // The songs already listed, so the select screen can open on what this drop added.
    const previousChartIds = new Set(this.collection.charts.map((chartEntry) => chartEntry.id));
    const tasks: Array<Promise<unknown>> = [];
    if (carriesLR2Theme) {
      tasks.push(this.loadTheme(themeFiles));
    }
    if (carriesBeatorajaTheme) {
      tasks.push(this.loadBeatorajaTheme(themeFiles));
    }
    if (chartFiles.length > 0 || origin.readFiles !== undefined) {
      tasks.push(this.loadCharts(chartFiles, origin));
    }
    const playContinues = this.showing() === 'play';
    if (tasks.length === 0) {
      // A canceled skin drop resumes select; unrelated files leave navigation untouched. A play on the stage stays.
      if (themeFamilies.size > 0 && !playContinues) await showLibrary();
      return;
    }
    await Promise.all(tasks);
    const playSkinSummary = summarizeLR2PlaySkins(this.playSkins());
    const beatorajaTheme = this.beatorajaTheme();
    const beatorajaSummary = beatorajaTheme
      ? summarizeBeatorajaPlaySkins(beatorajaTheme.theme.playSkins) || 'none'
      : 'none';
    dropLog.info(
      `loaded · charts=${this.collection.charts.length} · errors=${
        this.collection.errors.length
      } · play-skins=${playSkinSummary || 'none'} · select-skin=${this.selectSkin()?.name ?? 'none'}${
        beatorajaTheme ? ` · beatoraja-skins=${beatorajaSummary}` : ''
      }`,
    );
    if (this.collection.errors.length > 0) {
      dropLog.warn('parse errors:', this.collection.errors);
    }
    // Status panel stays terse on purpose — only show "loaded" when there's something to celebrate, and skip the
    // per-key-mode skin enumeration since the user can see the active skin in-canvas. "0 charts loaded" is suppressed
    // so a theme-only drop doesn't read like an error.
    if (this.collection.charts.length > 0) {
      this.setStatus(describeChartCollection(this.collection));
    } else if (this.selectSkin() || this.resultSkin() || Object.keys(this.playSkins()).length > 0) {
      this.setStatus('Theme loaded');
    }
    // Charts list the course folders as they load; course files dropped without charts are listed here.
    if (chartFiles.length === 0 && origin.readFiles === undefined && courseFiles.length > 0) {
      await this.refreshCourseFolders();
    }
    // Open what was dropped: its folder, or the folder list when the drop carried several.
    const dropped = navigationAfterDrop(this.collection.charts, previousChartIds, origin.showLibraryRoot);
    if (dropped !== undefined && !origin.startup) this.browseTo(dropped);
    // Commit the confirmed family before mounting the next select scene. A skin dropped onto a play swaps that play's
    // family (`applyDroppedSkin`) and leaves the chart running; the select screen takes the family when the play returns.
    const confirmedFamily = await confirmation;
    if (confirmedFamily !== undefined) await this.applyDroppedSkin(confirmedFamily);
    if (!(playContinues && chartFiles.length === 0 && confirmedFamily !== undefined)) await showLibrary();
    if (replayFiles.length > 0) {
      await this.startReplayReplayFromFile(replayFiles[0]!);
    }
  }

  /**
   * Loads what the Options dialog's "Open files" picker returned, as a drop of the same files: a chart archive (`.zip`) goes
   * to the song collection whole, another archive is expanded, and replays start once the archives are listed.
   */
  public async loadPickedFiles(files: File[]): Promise<void> {
    await this.processIncomingFiles(files);
  }

  /** Reads dropped `header.json` files that are difficulty-table headers into `courseGroups`; returns the ones read. */
  private async readTableHeaderFiles(files: readonly BrowserDroppedFile[]): Promise<Set<BrowserDroppedFile>> {
    const read = new Set<BrowserDroppedFile>();
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      const folder = path.replaceAll('\\', '/').split('/').slice(-2, -1)[0] ?? 'table';
      const group = readTableHeaderFile(new TextDecoder().decode(await file.arrayBuffer()), folder);
      if (group === undefined) continue;
      this.courseGroups = mergeCourseGroup(this.courseGroups, group);
      read.add(file);
      dropLog.info(`table header: ${path} · ${group.label} · courses=${group.courses.length}`);
    }
    return read;
  }

  /** Reads dropped course files into `courseGroups`; a file that holds no valid course is skipped with a warning. */
  private async readCourseFiles(files: readonly BrowserDroppedFile[]): Promise<void> {
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      try {
        const groups = readCourseFile(path, new Uint8Array(await file.arrayBuffer()));
        if (groups.length === 0) {
          dropLog.warn(`skipped (no course): ${path}`);
          continue;
        }
        // A file dropped again replaces its folder instead of adding another.
        for (const group of groups) this.courseGroups = mergeCourseGroup(this.courseGroups, group);
        for (const group of groups) {
          dropLog.info(
            `course file: ${path} · ${group.label} · courses=${group.courses.length} random=${group.randomCourses?.length ?? 0}`,
          );
        }
        // LR2 plays only the first five stages of a course, so an `.lr2crs` course listing more is read cut short.
        const cutShort = groups
          .flatMap((group) => group.courses)
          .filter((course) => countLR2UnplayedStages(course) > 0);
        if (cutShort.length > 0) {
          const names = cutShort.map((course) => course.name || '(untitled)').join(', ');
          dropLog.warn(`course file: ${path} · read as the first ${LR2_MAX_PLAYED_STAGES} stages LR2 plays: ${names}`);
          this.setStatus(
            `${path}: ${cutShort.length} course(s) list more than ${LR2_MAX_PLAYED_STAGES} stages; LR2 plays only the first ${LR2_MAX_PLAYED_STAGES}, so the rest were left out`,
          );
        }
      } catch (error) {
        dropLog.warn(`skipped (course read failed): ${path}`, error);
      }
    }
  }

  /**
   * Imports the courses of difficulty tables by URL into `courseGroups` (replacing a group with the same label), then
   * matches them against the collection. With `remember`, a table that imported is stored to be imported again on load.
   * Returns the URLs that imported. Without `relist`, the select screen is left as it is, for a caller that lists it
   * itself.
   */
  public async importCourseTables(
    urls: readonly string[],
    remember: boolean,
    { relist = true, refreshedSince }: { relist?: boolean; refreshedSince?: number } = {},
  ): Promise<string[]> {
    const imported: string[] = [];
    for (const url of urls) {
      this.setStatus('Fetching course table…');
      try {
        const table = await importCourseTable(url, this.tableFetchText(refreshedSince));
        this.installCourseTable(url, table);
        const { group } = table;
        if (remember) rememberCourseTableURL(url);
        imported.push(url);
        this.notifyCourseTableListeners();
        dropLog.info(`course table: ${url} · ${group.label} · courses=${group.courses.length}`);
        this.setStatus(`Course table: ${group.label} (${group.courses.length} courses)`);
      } catch (error) {
        dropLog.warn(`course table import failed: ${url}`, error);
        this.setStatus(describeCourseTableImportError(error));
      }
    }
    if (imported.length === 0) return imported;
    await this.changeCollection(() => this.refreshCourseFolders());
    if (!relist) return imported;
    // Re-list the select screen so the new folders show; mid-play they show the next time it opens.
    const showing = this.showing();
    const busy = this.elements.shell.classList.contains('playing') || showing === 'result' || showing === 'decide';
    if (!busy) await this.showSelect();
    return imported;
  }

  private installCourseTable(url: string, { group, dataURL }: ImportedCourseTable): void {
    const previous = this.courseTableLabels.get(url);
    if (previous !== undefined && previous !== group.label) {
      this.courseGroups = this.courseGroups.filter(({ label }) => label !== previous);
    }
    if (dataURL !== undefined) for (const course of group.courses) this.courseTableDataURLs.set(course, dataURL);
    this.courseGroups = mergeCourseGroup(this.courseGroups, group);
    this.courseTableLabels.set(url, group.label);
  }

  /** Calls `listener` whenever a difficulty table imports or is removed; returns the unsubscribe. */
  public onCourseTablesChange(listener: () => void): () => void {
    this.courseTableListeners.add(listener);
    return () => this.courseTableListeners.delete(listener);
  }

  private notifyCourseTableListeners(): void {
    for (const listener of this.courseTableListeners) listener();
  }

  /** The name of the difficulty table imported from `url` this session (its course group's label). */
  public courseTableLabel(url: string): string | undefined {
    return this.courseTableLabels.get(url);
  }

  /**
   * Takes the courses of the difficulty table imported from `url` off the select screen. A group another imported URL
   * shares (the same table under two URLs) stays.
   */
  public async removeCourseTable(url: string): Promise<void> {
    const label = this.courseTableLabels.get(url);
    if (label === undefined) return;
    this.courseTableLabels.delete(url);
    this.notifyCourseTableListeners();
    if ([...this.courseTableLabels.values()].includes(label)) return;
    this.courseGroups = this.courseGroups.filter((group) => group.label !== label);
    await this.relistCourseFolders();
  }

  /** Reads a difficulty table's files through the kept copies, asking again for those kept before the last reload. */
  private tableFetchText(refreshedSince = this.remoteRefreshedSince): TableFetchText {
    return createCachedCourseTableFetchText({
      store: pageRemoteCacheStore(),
      ...(refreshedSince !== undefined ? { refreshedSince } : {}),
      onRead: (url, source) => {
        if (source === 'stale') dropLog.warn(`course table: ${url} unreachable, using the copy kept last time`);
      },
    });
  }

  /**
   * The stages `course` is missing from the collection, with the download pages its difficulty table's song list names
   * for them. The list is fetched (through the proxy) the first time a course of that table needs it; a course from
   * elsewhere, or a list that cannot be fetched, gives the stages without links.
   */
  public async findMissingCourseStages(course: LibraryCourse): Promise<MissingCourseStage[]> {
    const dataURL = this.courseTableDataURLs.get(course.definition);
    const songs = dataURL !== undefined ? await this.tableSongIndex(dataURL) : undefined;
    return describeMissingCourseStages(course, songs);
  }

  /**
   * Titles the stages a focused course is missing from the collection by its difficulty table's song list, in place of
   * the course's placeholders (beatoraja's `course N`): the list is fetched the first time a course of that table that
   * cannot start is focused, and then every course of the table shows its songs' titles.
   */
  public async titleMissingCourseStages(course: LibraryCourse): Promise<void> {
    if (course.playable || course.random !== undefined) return;
    const dataURL = this.courseTableDataURLs.get(course.definition);
    if (dataURL === undefined || this.loadedSongIndexes.has(dataURL)) return;
    await this.tableSongIndex(dataURL);
  }

  /**
   * A difficulty table's song list, fetched through the proxy once and kept for the session; `undefined` when it cannot
   * be fetched, which is asked again next time. The first time a list arrives, the course folders are listed again with
   * its titles.
   */
  private async tableSongIndex(dataURL: string): Promise<TableSongIndex | undefined> {
    const loaded = this.loadedSongIndexes.get(dataURL);
    if (loaded !== undefined) return loaded;
    let pending = this.tableSongIndexes.get(dataURL);
    if (pending === undefined) {
      pending = this.tableFetchText()(dataURL).then(parseTableSongIndex);
      this.tableSongIndexes.set(dataURL, pending);
    }
    let songs: TableSongIndex;
    try {
      songs = await pending;
    } catch (error) {
      this.tableSongIndexes.delete(dataURL);
      dropLog.warn(`course table song list failed: ${dataURL}`, error);
      return undefined;
    }
    if (!this.loadedSongIndexes.has(dataURL)) {
      this.loadedSongIndexes.set(dataURL, songs);
      await this.relistCourseFolders();
    }
    return songs;
  }

  /**
   * Matches every dropped course's stages against the collection by chart-file hash and lists them as course folders.
   * Hashing the whole library is cheap (chart files are small) and cached per song.
   */
  private async refreshCourseFolders(): Promise<void> {
    // Only a course with fixed stages finds its charts by hash. Without one, hashing every chart (reading each file
    // again) would only slow the drop down; a chart is still hashed when its record or replay needs it.
    const needsHashes =
      this.courseGroups.some((group) => group.courses.length > 0) || this.courseMaker.courses.length > 0;
    const hashed = needsHashes
      ? await Promise.all(
          this.collection.charts.map(async (chartEntry) => ({
            chart: chartEntry,
            ...(await this.resolveChartHashes(chartEntry)),
          })),
        )
      : [];
    this.collection = {
      ...this.collection,
      courseFolders: [
        // An `.n2x` list names its charts by path: they take the hashes of the charts at those paths first.
        ...resolveCourseFolders(bindCourseStagePaths(this.courseGroups, hashed), createChartHashLookup(hashed)).map(
          (folder) =>
            folder.courses === undefined
              ? folder
              : { ...folder, courses: folder.courses.map((course) => this.withSongTitles(course)) },
        ),
        ...resolveCourseMakerFolders(this.courseMaker.courses, createChartHashLookup(hashed)),
      ],
    };
    this.appendKeptRandomCourses();
  }

  /** A course with its missing stages titled by its table's song list, once the list has arrived. */
  private withSongTitles(course: LibraryCourse): LibraryCourse {
    const dataURL = this.courseTableDataURLs.get(course.definition);
    const songs = dataURL !== undefined ? this.loadedSongIndexes.get(dataURL) : undefined;
    return songs !== undefined ? withTableSongTitles(course, songs) : course;
  }

  /** Relists the course folders after the player's own courses changed, keeping the select screen where it was. */
  public async refreshMadeCourses(): Promise<void> {
    await this.relistCourseFolders();
  }

  /** Relists the course folders, keeping the select screen where it was. */
  private async relistCourseFolders(): Promise<void> {
    await this.refreshCourseFolders();
    const view = this.selectView();
    if (view === undefined) return;
    const navigation = view.snapshot();
    view.setLibrary(this.collection);
    view.restore(navigation);
  }

  /**
   * Auto-loads a music and/or skin archive named by the `?music=` / `?skin=` URL parameters at boot, reusing the drop
   * pipeline so nothing about song listing or skin application is special-cased.
   *
   * - The skin archive is expanded into per-file `File`s and handed to {@link processIncomingFiles}, which detects the
   *   LR2 / beatoraja family and mounts it (it carries no charts, so it routes entirely to the theme loaders).
   * - The music archive is passed as a single `.zip` to {@link loadCharts}, letting the player-web loader expand it via
   *   its own guarded `unzipSync`; the select scene then lists every chart inside.
   *
   * Skin is loaded first so the select screen that follows is already themed. Failures (bad link, CORS, HTTP error)
   * surface as a status line rather than throwing, so a broken URL never wedges the boot.
   */
  public async loadFromURL(params: { musicURL: string | undefined; skinURL: string | undefined }): Promise<void> {
    if (!params.musicURL && !params.skinURL) {
      return;
    }
    showLoadingOverlay(this.elements);
    const leftSelect = await this.leaveSelect();
    try {
      if (params.skinURL) {
        this.setStatus('Fetching skin…');
        await this.processIncomingFiles(await fetchZipAsFiles(params.skinURL));
      }
      if (params.musicURL) {
        this.setStatus('Fetching music…');
        await this.loadCharts([await fetchZipAsFile(params.musicURL)]);
        await this.showSelect();
      }
      if (this.collection.charts.length > 0) {
        this.setStatus(describeChartCollection(this.collection));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dropLog.error('URL auto-load failed', error);
      this.setStatus(`URL load failed: ${message}`);
    } finally {
      hideLoadingOverlay(this.elements);
      if (leftSelect && this.showing() === undefined) await this.showSelect();
    }
  }

  /**
   * Lists the songs of Bemuse music servers (their `index.json` or `bemuse-song.json` URLs), each server as a folder of
   * the library. Charts are fetched as the songs list, sound files as a song is played (`readBemuseServerFiles`); the
   * folder reload reads a server's index again. A server that cannot be read only says so, so a dead server never
   * wedges the boot.
   */
  /** Puts the Bemuse ReplayGain on, or takes it off, the charts already loaded, as the setting now says. */
  public refreshBemuseReplayGain(): void {
    this.bemuseSongs.refreshReplayGain(this.collection.charts);
  }

  public async loadBemuseServers(indexURLs: readonly string[]): Promise<void> {
    if (indexURLs.length === 0) return;
    showLoadingOverlay(this.elements);
    await this.leaveSelect();
    try {
      for (const indexURL of indexURLs) await this.loadBemuseServer(indexURL);
      await this.showSelect();
    } finally {
      hideLoadingOverlay(this.elements);
    }
  }

  private async readBemuseURL(
    url: string,
    refreshedSince = this.remoteRefreshedSince,
    displayedIndex?: BemuseLibraryIndex,
  ): Promise<BemuseServerFiles> {
    const server = await readBemuseServerFiles(url, {
      ...(refreshedSince === undefined ? {} : { refreshedSince }),
      ...(displayedIndex === undefined ? {} : { displayedIndex }),
    });
    this.bemuseSongs.remember(server.songs);
    return server;
  }

  private async loadBemuseServer(indexURL: string, refreshedSince?: number): Promise<boolean> {
    const label = bemuseServerLabel(indexURL);
    this.setStatus(`Fetching Bemuse server ${label}…`);
    try {
      const displayed = this.displayedBemuseIndexes.get(indexURL);
      const index = displayed ?? (await readBemuseLibraryIndex(indexURL));
      const server = await this.readBemuseURL(indexURL, refreshedSince, displayed);
      if (server.indexSource === 'stale') dropLog.warn(`Bemuse server ${label}: unreachable, listing its kept index`);
      if (server.unchanged || (displayed !== undefined && server.skipped.length > 0)) return false;
      for (const { track, reason } of server.skipped)
        dropLog.warn(`Bemuse server ${label}: skipped ${track}: ${reason}`);
      dropLog.info(`Bemuse server ${label}: songs=${server.songs.length} skipped=${server.skipped.length}`);
      if (server.files.length === 0 && !this.chartLoads.some((load) => load.bemuseURL === indexURL)) {
        this.setStatus(`Bemuse server ${label} has no songs Be-Music can play`);
        return false;
      }
      // Reuse parse keys only for songs whose index entry still describes the same files.
      const unchanged = new Set<string>();
      const before = new Map(index?.songs.map(({ folder, track }) => [folder, JSON.stringify(track)]));
      for (const { folder, track, paths } of server.indexedSongs) {
        if (before.get(folder) === JSON.stringify(track)) {
          for (const path of paths) unchanged.add(`${folder}/${path}`);
        }
      }
      const keys = new Map(index?.chartKeys.filter(([path]) => unchanged.has(path)));
      await this.loadCharts(server.files, {
        bemuseURL: indexURL,
        chartKeys: { known: (path) => keys.get(path), learned: (path, key) => keys.set(path, key) },
      });
      const nextIndex = { songs: server.indexedSongs, chartKeys: [...keys] };
      this.displayedBemuseIndexes.set(indexURL, nextIndex);
      await keepBemuseLibraryIndex(indexURL, nextIndex).catch(() => undefined);
      return true;
    } catch (error) {
      dropLog.warn(`Bemuse server failed: ${indexURL}`, error);
      this.setStatus(`Bemuse server ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Reads the library's charts again, as LR2's and beatoraja's folder reload does: a dropped folder is walked again, so
   * charts added, changed or removed on disk since show up; picked files and archives are read again as they were. The
   * Bemuse servers' indexes and the difficulty tables are asked for again too, whatever their kept copies' age, and the
   * tables' song lists already read are read again. The select screen then shows the new library. Without a load or a
   * table to read again it only says so.
   */
  public async reloadCharts(): Promise<void> {
    const tables = readStoredCourseTableURLs();
    if (this.chartLoads.length === 0 && tables.length === 0) {
      this.setStatus('No folders to reload');
      return;
    }
    this.remoteRefreshedSince = Date.now();
    this.setStatus('Reloading charts...');
    if (this.chartLoads.length > 0) {
      await this.readChartsAgain((progress) => applyLoadProgress(this.elements, progress));
    }
    const servers = this.chartLoads.flatMap(({ bemuseURL }) => (bemuseURL === undefined ? [] : [bemuseURL]));
    await Promise.all([
      ...servers.map((url) => this.loadBemuseServer(url, this.remoteRefreshedSince)),
      ...(tables.length > 0 ? [this.importCourseTables(tables, false, { relist: false })] : []),
    ]);
    await this.readTableSongIndexesAgain();
    await this.showSelect();
    this.setStatus(describeChartCollection(this.collection));
  }

  /** Reads the song lists of this visit again (after a reload), keeping each list in use until its new one is in. */
  private async readTableSongIndexesAgain(): Promise<void> {
    const dataURLs = [...this.loadedSongIndexes.keys()];
    this.tableSongIndexes.clear();
    const fetchText = this.tableFetchText();
    const read = await Promise.all(
      dataURLs.map(async (dataURL) => {
        try {
          return [dataURL, parseTableSongIndex(await fetchText(dataURL))] as const;
        } catch (error) {
          dropLog.warn(`course table song list failed: ${dataURL}`, error);
          return undefined;
        }
      }),
    );
    for (const entry of read) if (entry !== undefined) this.loadedSongIndexes.set(entry[0], entry[1]);
    if (read.some((entry) => entry !== undefined)) await this.refreshCourseFolders();
  }

  /**
   * Reads the library's charts again without leaving the screen: a remembered folder listed from its snapshot turned
   * out to have changed on disk. The select screen, when it is the one showing, keeps its place; any other screen goes
   * on with the charts it has, and the library is read again when the select screen next shows ({@link selectShown}).
   */
  public refreshCharts(): Promise<void> {
    if (this.showing() !== 'select') {
      this.refreshPending = true;
      return Promise.resolve();
    }
    this.refreshPending = false;
    // One at a time: a second change found meanwhile is read once the first read is in.
    const refresh = (this.refreshing ?? Promise.resolve()).then(async () => {
      await this.readChartsAgain();
      const view = this.selectView();
      if (view === undefined || this.showing() !== 'select') return;
      const navigation = view.snapshot();
      view.setLibrary(this.collection);
      view.restore(navigation);
      this.elements.shell.classList.toggle('empty', this.collection.charts.length === 0);
      this.setStatus(describeChartCollection(this.collection));
    });
    this.refreshing = refresh.catch(() => undefined);
    return refresh;
  }

  /** The select screen shows: a change on disk found during a play is read now ({@link refreshCharts}). */
  public selectShown(): void {
    if (!this.refreshPending) return;
    void this.refreshCharts().catch((error: unknown) => dropLog.warn('library refresh failed', error));
  }

  /**
   * Reads every load again into a new collection, which replaces the library's once it is whole: until then the
   * screens go on with the charts they have.
   */
  private readChartsAgain(onProgress?: (progress: LoadProgress) => void): Promise<void> {
    return this.changeCollection(() => this.readLoadsAgain(onProgress));
  }

  /** Runs `work`, which changes the collection, once every change before it is in. */
  private changeCollection<T>(work: () => Promise<T>): Promise<T> {
    const done = this.collectionWork.then(work);
    this.collectionWork = done.catch(() => undefined);
    return done;
  }

  private async readLoadsAgain(onProgress?: (progress: LoadProgress) => void): Promise<void> {
    const loads = [...this.chartLoads];
    const groups: BrowserDroppedFile[][] = [];
    for (const load of loads) {
      const { entries } = load;
      const readFiles = load.readFiles ?? (entries && (() => readDropEntries(entries)));
      if (!readFiles) {
        groups.push(load.files);
        continue;
      }
      const files = (await readFiles()).filter((file) => {
        const name = file.name.toLowerCase();
        const path = file.webkitRelativePath || file.name;
        return (
          !isDroppedArchive(file) &&
          !name.endsWith(REPLAY_FILE_SUFFIX) &&
          !name.endsWith(COURSE_REPLAY_FILE_SUFFIX) &&
          !isCourseFilePath(path) &&
          !isTableHeaderFilePath(file.name)
        );
      });
      groups.push(splitDroppedChartAndThemeFiles(files).chartFiles);
    }
    const store = new BrowserChartCollectionStore();
    for (const [index, files] of groups.entries()) {
      const load = loads[index]!;
      const { chartKeys } = load;
      const offset = store.collection.sources.length;
      await store.appendFromFiles(files, {
        ...(onProgress !== undefined ? { onProgress } : {}),
        parsedChartCache: this.parsedChartCache,
        ...(chartKeys !== undefined ? { chartKeys } : {}),
        ...(load.bemuseURL !== undefined && load.onChartCacheMiss !== undefined
          ? { onChartCacheMiss: load.onChartCacheMiss }
          : {}),
      });
      load.sourceIds = store.collection.sources.slice(offset).map(({ id }) => id);
    }
    this.collectionStore = store;
    this.collection = store.collection;
    this.applyChartSettings();
    // The player's own courses are listed again too, with any course files'.
    await this.refreshCourseFolders();
    for (const load of loads) load.onLoaded?.();
  }

  private loadCharts(files: BrowserDroppedFile[], origin: LibraryLoadOrigin = {}): Promise<void> {
    return this.changeCollection(() => this.appendCharts(files, origin));
  }

  private async appendCharts(files: BrowserDroppedFile[], origin: LibraryLoadOrigin): Promise<void> {
    // Kept for the folder reload: the drop's entries walk its folders again, other files are read again as they are.
    const replacing =
      origin.bemuseURL === undefined ? undefined : this.chartLoads.find((load) => load.bemuseURL === origin.bemuseURL);
    const before = new Set(this.collectionStore.collection.sources.map(({ id }) => id));
    const cached = origin.onChartCacheMiss !== undefined;
    if (!cached) this.setStatus('Loading charts...');
    // Append rather than replace so a second / third folder drop adds to the existing collection instead of wiping the
    // previous pack. The store re-prefixes source / song IDs so each drop's entries stay uniquely addressable. The
    // very first drop is just `append onto an empty collection`, which produces the same result as `loadFromFiles`
    // would have.
    this.collection = await this.collectionStore.appendFromFiles(files, {
      ...(cached
        ? { onChartCacheMiss: origin.onChartCacheMiss! }
        : {
            onProgress: (progress: LoadProgress) => applyLoadProgress(this.elements, progress),
          }),
      parsedChartCache: this.parsedChartCache,
      ...(origin.chartKeys !== undefined ? { chartKeys: origin.chartKeys } : {}),
      ...(replacing === undefined ? {} : { replaceSourceIds: replacing.sourceIds }),
    });
    const sourceIds = this.collection.sources
      .filter(({ id }) => !before.has(id) || replacing?.sourceIds.includes(id))
      .map(({ id }) => id);
    const loaded = { ...origin, files, sourceIds };
    if (replacing === undefined) this.chartLoads.push(loaded);
    else this.chartLoads[this.chartLoads.indexOf(replacing)] = loaded;
    origin.onLoaded?.();
    if (cached) return;
    this.applyChartSettings();
    // The store's collection has no course folders: list the course files' and the player's own (MY COURSES, MY
    // NONSTOP, MY DAN) again, whichever path loaded the charts.
    await this.refreshCourseFolders();
    // Suppress the "0 charts loaded" reading — that text reads like a parse error to the user. The post-load status
    // text is set by `processIncomingFiles` once both theme + songs land, so a mid-flight transient is plenty.
    if (this.collection.charts.length > 0) {
      this.setStatus(describeChartCollection(this.collection));
    }
  }

  private applyChartSettings(): void {
    applyChartLevelEdits(this.collection.charts, readChartLevelEdits(globalThis.localStorage));
    this.bemuseSongs.apply(this.collection.charts);
  }
}
