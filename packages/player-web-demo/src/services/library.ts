// The library the select screen lists: the charts of every drop, file pick and URL load (the collection store), and
// the course folders matched against them: course files, difficulty tables (by URL or a dropped `header.json`) and
// the player's own courses. A drop's theme files go to the theme loaders, its play logs to the replay.

import { logger } from '@be-music/player-web';
import {
  BrowserSongCollectionStore,
  createSongHashLookup,
  describeSongCollection,
  isCourseFilePath,
  materializeDroppedFiles,
  readCourseFile,
  resolveCourseFolders,
  resolveCourseMakerFolders,
  splitDroppedSongAndThemeFiles,
  type BrowserDroppedFile,
  type BrowserSongCollection,
  type ChartFileHashes,
  type CourseDefinitionGroup,
  type CourseMaker,
} from '@be-music/player-web/collection';
import type { SceneKind, SelectScene } from '@be-music/player-web/host';
import {
  skinFamilyRegistry,
  summarizeBeatorajaPlaySkins,
  type BeatorajaThemeBundle,
  type SkinFamilyId,
} from '@be-music/player-web/skin';
import { summarizeLR2PlaySkins, type LR2PlaySkinMap, type LR2Skin } from '@be-music/lr2-skin';
import { countLR2UnplayedStages, LR2_MAX_PLAYED_STAGES } from '@be-music/player/course';
import { PLAYLOG_FILE_SUFFIX } from '@be-music/player/playlog';
import type { BrowseSnapshot, LibraryChart } from '@be-music/scene-model';
import {
  describeCourseTableImportError,
  importCourseTable,
  isTableHeaderFilePath,
  mergeCourseGroup,
  readStoredCourseTableURLs,
  readTableHeaderFile,
  rememberCourseTableURL,
} from '../course-table-import.ts';
import { navigationAfterDrop } from '../drop-navigation.ts';
import {
  applyLoadProgress,
  hideLoadingOverlay,
  showLoadingOverlay,
  type LoadingOverlayElements,
} from '../loading-overlay.ts';
import type { PlayerWebDemoElements } from '../types.ts';
import { fetchZipAsFile, fetchZipAsFiles, parseURLMediaParams } from '../url-load.ts';

const dropLog = logger('drop');

export interface LibraryServiceOptions {
  /** The loading overlay a URL load shows and every load reports its progress on, and the shell (`.playing`). */
  readonly elements: LoadingOverlayElements & Pick<PlayerWebDemoElements, 'shell'>;
  /** A chart's file hashes, cached per chart (`RecordsService`): course stages are matched by them. */
  readonly resolveChartHashes: (song: LibraryChart) => Promise<ChartFileHashes | undefined>;
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
  /** Starts replaying a dropped play log, once the drop's charts are listed. */
  readonly startPlaylogReplayFromFile: (file: BrowserDroppedFile) => Promise<void>;
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
  /** Hands the skin families a drop brought to the "Drop a skin" prompt, once its select screen shows. */
  readonly answerSkinDropPrompt: (families: ReadonlySet<SkinFamilyId>) => void;
}

/** The charts and courses the select screen lists, and the loads that add to them. */
export class LibraryService {
  /**
   * The library as last loaded: a new object whenever it changes, so the select screen tells a new library from a
   * redraw of the same one (`setLibrary`).
   */
  public collection: BrowserSongCollection = { sources: [], charts: [], errors: [] };
  private readonly collectionStore = new BrowserSongCollectionStore();
  /**
   * Course files dropped so far (`.lr2crs`, beatoraja `course/*.json`) and courses imported from difficulty-table URLs,
   * resolved into `collection.courseFolders`.
   */
  private courseGroups: CourseDefinitionGroup[] = [];
  private readonly elements: LibraryServiceOptions['elements'];
  private readonly resolveChartHashes: LibraryServiceOptions['resolveChartHashes'];
  private readonly courseMaker: LibraryServiceOptions['courseMaker'];
  private readonly selectView: LibraryServiceOptions['selectView'];
  private readonly showing: LibraryServiceOptions['showing'];
  private readonly setStatus: LibraryServiceOptions['setStatus'];
  private readonly showSelect: LibraryServiceOptions['showSelect'];
  private readonly leaveSelect: LibraryServiceOptions['leaveSelect'];
  private readonly browseTo: LibraryServiceOptions['browseTo'];
  private readonly startPlaylogReplayFromFile: LibraryServiceOptions['startPlaylogReplayFromFile'];
  private readonly loadTheme: LibraryServiceOptions['loadTheme'];
  private readonly loadBeatorajaTheme: LibraryServiceOptions['loadBeatorajaTheme'];
  private readonly playSkins: LibraryServiceOptions['playSkins'];
  private readonly selectSkin: LibraryServiceOptions['selectSkin'];
  private readonly resultSkin: LibraryServiceOptions['resultSkin'];
  private readonly beatorajaTheme: LibraryServiceOptions['beatorajaTheme'];
  private readonly answerSkinDropPrompt: LibraryServiceOptions['answerSkinDropPrompt'];

  public constructor(options: LibraryServiceOptions) {
    this.elements = options.elements;
    this.resolveChartHashes = options.resolveChartHashes;
    this.courseMaker = options.courseMaker;
    this.selectView = options.selectView;
    this.showing = options.showing;
    this.setStatus = options.setStatus;
    this.showSelect = options.showSelect;
    this.leaveSelect = options.leaveSelect;
    this.browseTo = options.browseTo;
    this.startPlaylogReplayFromFile = options.startPlaylogReplayFromFile;
    this.loadTheme = options.loadTheme;
    this.loadBeatorajaTheme = options.loadBeatorajaTheme;
    this.playSkins = options.playSkins;
    this.selectSkin = options.selectSkin;
    this.resultSkin = options.resultSkin;
    this.beatorajaTheme = options.beatorajaTheme;
    this.answerSkinDropPrompt = options.answerSkinDropPrompt;
  }

  /**
   * `?music=<url.zip>` / `?skin=<url.zip>` auto-load: fetch + expand the archives at boot and run them through the
   * same pipeline as a drag-drop, so the select screen lists the archive's charts (with any skin already applied).
   * Sequenced after the first select screen shows (`ready`).
   */
  public autoLoad(href: string, ready: Promise<void>): Promise<void> {
    const mediaParams = parseURLMediaParams(href);
    // Difficulty tables imported in an earlier visit are imported again, after the URL load so their stages match it.
    const storedCourseTables = readStoredCourseTableURLs();
    return ready.then(async () => {
      if (mediaParams.musicURL || mediaParams.skinURL) await this.loadFromURL(mediaParams);
      if (storedCourseTables.length > 0) await this.importCourseTables(storedCourseTables, false);
    });
  }

  /**
   * Shared post-enumeration pipeline for both drag-drop and the Debug Menu's "Open folder" / "Open files" pickers. Routes the incoming
   * file list through {@link splitDroppedSongAndThemeFiles}, dispatches theme + song loaders in parallel, then mounts
   * the freshly populated select view.
   *
   * The caller is responsible for showing / hiding the loading overlay and pausing the select view — both entry points
   * handle that around their own enumeration phase.
   *
   * `loadSongs` appends to the existing collection so a second / third invocation of this routine accumulates entries
   * rather than wiping the previous pack — the host can call this multiple times in succession (e.g. Open folder
   * pressed twice with two different folders) and every drop's charts stay uniquely addressable through the collection
   * per-source prefixing.
   */
  public async processIncomingFiles(files: BrowserDroppedFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    // Play log files ride their own path: they are replay inputs, not chart / theme assets. They are peeled off
    // BEFORE the song/theme split so a stray `.bmplay.json` never classifies as a theme candidate — and handled
    // AFTER the split's loaders ran, so dropping a song folder together with its play log loads the song first and
    // then starts the replay in one gesture.
    const playlogFiles = files.filter((file) => file.name.toLowerCase().endsWith(PLAYLOG_FILE_SUFFIX));
    files = files.filter((file) => !file.name.toLowerCase().endsWith(PLAYLOG_FILE_SUFFIX));
    if (files.length === 0 && playlogFiles.length > 0) {
      await this.startPlaylogReplayFromFile(playlogFiles[0]!);
      return;
    }
    // Course files (LR2 `.lr2crs`, beatoraja `course/*.json`) list charts by hash; they are read here and matched
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
      if (this.courseGroups.length > courseGroupCount) {
        await this.refreshCourseFolders();
        await this.showSelect();
      }
      return;
    }
    const split = splitDroppedSongAndThemeFiles(files);
    const songFiles = split.songFiles;
    // Folder drops leave song-bundle files unopened; the theme side is opened up front by the drop walk, so this is
    // normally a pass-through that only narrows the type for the theme loaders.
    const themeFiles = await materializeDroppedFiles(split.themeFiles, {
      onError: (file, error) => dropLog.warn(`skipped (open failed): ${file.webkitRelativePath}`, error),
    });
    // `splitDroppedSongAndThemeFiles` routes any non-chart files outside a chart directory into `themeFiles`. That
    // includes stray `readme.txt` / `info.json` / album-art images sitting at the root of a BMS pack that isn't a real
    // theme bundle. Funnel the detection through `skinFamilyRegistry` so each family's `matchesThemeFile` predicate
    // owns its own decision — this keeps "what counts as an LR2 theme file?" colocated with the LR2 family metadata
    // (and the same for beatoraja). Adding a fourth family in the future is a one-line registry edit instead of an
    // edit here.
    const themeFamilies = skinFamilyRegistry.detectThemeFamilies(
      themeFiles.map((file) => file.webkitRelativePath || file.name),
    );
    const carriesLR2Theme = themeFamilies.has('lr2');
    const carriesBeatorajaTheme = themeFamilies.has('beatoraja');
    const themeMarkers = [...themeFamilies];
    dropLog.info(
      `received ${files.length} file(s) · theme=${themeFiles.length}${
        themeMarkers.length > 0 ? ` (${themeMarkers.join('+')})` : ' (no skin entry → preserving current theme)'
      } · songs=${songFiles.length}`,
    );
    // The songs already listed, so the select screen can open on what this drop added.
    const previousSongIds = new Set(this.collection.charts.map((song) => song.id));
    const tasks: Array<Promise<unknown>> = [];
    if (carriesLR2Theme) {
      tasks.push(this.loadTheme(themeFiles));
    }
    if (carriesBeatorajaTheme) {
      tasks.push(this.loadBeatorajaTheme(themeFiles));
    }
    if (songFiles.length > 0) {
      tasks.push(this.loadSongs(songFiles));
    }
    if (tasks.length === 0) {
      dropLog.warn('nothing to load — neither theme nor chart files matched');
      return;
    }
    await Promise.all(tasks);
    const playSkinSummary = summarizeLR2PlaySkins(this.playSkins());
    const beatorajaTheme = this.beatorajaTheme();
    const beatorajaSummary = beatorajaTheme
      ? summarizeBeatorajaPlaySkins(beatorajaTheme.theme.playSkins) || 'none'
      : 'none';
    dropLog.info(
      `loaded · songs=${this.collection.charts.length} · errors=${
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
      this.setStatus(describeSongCollection(this.collection));
    } else if (this.selectSkin() || this.resultSkin() || Object.keys(this.playSkins()).length > 0) {
      this.setStatus('Theme loaded');
    }
    await this.refreshCourseFolders();
    // Open what was dropped: its folder, or the folder list when the drop carried several.
    const dropped = navigationAfterDrop(this.collection.charts, previousSongIds);
    if (dropped !== undefined) this.browseTo(dropped);
    await this.showSelect();
    // A skin the player asked for through the Debug Menu ("drop a skin") is switched to once the drop brings it.
    this.answerSkinDropPrompt(themeFamilies);
    if (playlogFiles.length > 0) {
      await this.startPlaylogReplayFromFile(playlogFiles[0]!);
    }
  }

  /**
   * Loads what the Debug Menu's "Open files" picker returned: chart archives (`.zip`) go to the song collection whole,
   * the way `?music=` archives do (the collection expands them itself), and anything else — play logs — takes the
   * drop pipeline, which starts the replay once the archives are listed.
   */
  public async loadPickedFiles(files: File[]): Promise<void> {
    const isZip = (file: File) => file.name.toLowerCase().endsWith('.zip');
    const archives = files.filter(isZip);
    const others = files.filter((file) => !isZip(file));
    if (archives.length > 0) {
      await this.loadSongs(archives);
      await this.showSelect();
      if (this.collection.charts.length > 0) {
        this.setStatus(describeSongCollection(this.collection));
      }
    }
    if (others.length > 0) {
      await this.processIncomingFiles(others);
    }
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
   */
  public async importCourseTables(urls: readonly string[], remember: boolean): Promise<void> {
    let imported = 0;
    for (const url of urls) {
      this.setStatus('Fetching course table…');
      try {
        const { group } = await importCourseTable(url);
        this.courseGroups = mergeCourseGroup(this.courseGroups, group);
        if (remember) rememberCourseTableURL(url);
        imported += 1;
        dropLog.info(`course table: ${url} · ${group.label} · courses=${group.courses.length}`);
        this.setStatus(`Course table: ${group.label} (${group.courses.length} courses)`);
      } catch (error) {
        dropLog.warn(`course table import failed: ${url}`, error);
        this.setStatus(describeCourseTableImportError(error));
      }
    }
    if (imported === 0) return;
    await this.refreshCourseFolders();
    // Re-list the select screen so the new folders show; mid-play they show the next time it opens.
    const showing = this.showing();
    const busy = this.elements.shell.classList.contains('playing') || showing === 'result' || showing === 'decide';
    if (!busy) await this.showSelect();
  }

  /**
   * Matches every dropped course's stages against the collection by chart-file hash and lists them as course folders.
   * Hashing the whole library is cheap (chart files are small) and cached per song.
   */
  private async refreshCourseFolders(): Promise<void> {
    const hashed = await Promise.all(
      this.collection.charts.map(async (song) => ({ song, ...(await this.resolveChartHashes(song)) })),
    );
    this.collection = {
      ...this.collection,
      courseFolders: [
        ...resolveCourseFolders(this.courseGroups, createSongHashLookup(hashed)),
        ...resolveCourseMakerFolders(this.courseMaker.courses, createSongHashLookup(hashed)),
      ],
    };
  }

  /** Relists the course folders after the player's own courses changed, keeping the select screen where it was. */
  public async refreshMadeCourses(): Promise<void> {
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
   * - The music archive is passed as a single `.zip` to {@link loadSongs}, letting the player-web loader expand it via
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
    await this.leaveSelect();
    try {
      if (params.skinURL) {
        this.setStatus('Fetching skin…');
        await this.processIncomingFiles(await fetchZipAsFiles(params.skinURL));
      }
      if (params.musicURL) {
        this.setStatus('Fetching music…');
        await this.loadSongs([await fetchZipAsFile(params.musicURL)]);
        if (this.courseGroups.length > 0) await this.refreshCourseFolders();
        await this.showSelect();
      }
      if (this.collection.charts.length > 0) {
        this.setStatus(describeSongCollection(this.collection));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dropLog.error('URL auto-load failed', error);
      this.setStatus(`URL load failed: ${message}`);
    } finally {
      hideLoadingOverlay(this.elements);
    }
  }

  private async loadSongs(files: BrowserDroppedFile[]): Promise<void> {
    this.setStatus('Loading songs...');
    // Append rather than replace so a second / third folder drop adds to the existing collection instead of wiping the
    // previous pack. The store re-prefixes source / song IDs so each drop's entries stay uniquely addressable. The
    // very first drop is just `append onto an empty collection`, which produces the same result as `loadFromFiles`
    // would have.
    this.collection = await this.collectionStore.appendFromFiles(files, {
      onProgress: (progress) => applyLoadProgress(this.elements, progress),
    });
    // Suppress the "0 charts loaded" reading — that text reads like a parse error to the user. The post-load status
    // text is set by `processIncomingFiles` once both theme + songs land, so a mid-flight transient is plenty.
    if (this.collection.charts.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    }
  }
}
