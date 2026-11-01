import {
  appendCourseDraftStage,
  createCourseDraft,
  DEFAULT_LR2_RANDOM_MIX_SETTINGS,
  defaultCourseMakerConstraints,
  drawLR2RandomMix,
  LR2_RANDOM_MIX_NAME,
  normalizeLR2RandomMixSettings,
  resolveLR2RandomMixSettings,
  stepLR2RandomMixSetting,
  finishCourseDraft,
  parseLR2NonstopConnections,
  removeLastCourseDraftStage,
  stepLR2NonstopConnection,
  withCourseConstraints,
  withNonstopConnection,
  type CourseChartLookup,
  type CourseConstraint,
  type CourseDefinition,
  type CourseDraft,
  type CourseDraftAppendFailure,
  type CourseKind,
  type LR2RandomMixChart,
  type LR2RandomMixDrawResult,
  type LR2RandomMixSetting,
  type LR2RandomMixSettings,
  type NonstopConnection,
} from '@be-music/player-engine/course';
import {
  resolveLibraryChartPlayVariant,
  type LibraryChart,
  type LibraryCourse,
  type LibraryFolder,
} from '@be-music/player-scene-model';
import { resolveChartBPMRange } from '../chart/bpm-range.ts';
import { resolveCourseEntry } from './course.ts';

/** The course folders the player's own courses are listed in, in LR2's order (its `course1-3.lr2folder`). */
export const COURSE_MAKER_KINDS: readonly CourseKind[] = ['expert', 'nonstop', 'grade'];

/** The label of each course folder, as its folder bar shows it. */
export const COURSE_MAKER_FOLDER_LABELS: Readonly<Record<CourseKind, string>> = {
  expert: 'MY COURSES',
  nonstop: 'MY NONSTOP',
  grade: 'MY DAN',
};

/** What a course saved without a name is called, before its number in its folder. */
const UNNAMED_COURSE_LABELS: Readonly<Record<CourseKind, string>> = {
  expert: 'COURSE',
  nonstop: 'NONSTOP',
  grade: 'DAN',
};

/** The title of a course folder's NEW COURSE bar. */
export const NEW_COURSE_NAME = 'NEW COURSE';

/**
 * What the course name reads while it is empty: LR2 starts a course with a prompt to type its title (OpenLR2
 * L12148-L12177).
 */
export const COURSE_NAME_PROMPT = 'Type the course title';

/** The course folders LR2 lists a RANDOM MIX bar in (OpenLR2 L18168-L18191: not GRADE). */
export const RANDOM_MIX_KINDS: readonly ('expert' | 'nonstop')[] = ['expert', 'nonstop'];

/**
 * What changed in a {@link CourseMaker}: the course being made, the saved courses, or the settings (the default
 * connection, the RANDOM MIX settings).
 */
export type CourseMakerChange = 'draft' | 'courses' | 'settings';

/** Why a song cannot join a course being made: `not-making` when no course is being made. */
export type CourseMakerAppendFailure = CourseDraftAppendFailure | 'not-making';

export interface CourseMakerOptions {
  /** The player's saved courses, newest first. */
  courses?: readonly CourseDefinition[];
  /** The connection a new NONSTOP course gets after each stage (LR2's button 268). Default `fade`. */
  defaultConnection?: NonstopConnection;
  /** The RANDOM MIX settings (LR2's buttons 260-266). Default LR2's. */
  randomMixSettings?: LR2RandomMixSettings;
  /** A song's chart MD5, which a course keys its stages by; `undefined` when it cannot be hashed. */
  md5Of: (chartEntry: LibraryChart) => Promise<string | undefined>;
  /** Called after every change, so a host can save the courses and redraw. */
  onChange?: (change: CourseMakerChange) => void;
}

/**
 * The player's own courses and the course being made, as LR2's select screen keeps them (`isMakingCourse`, its
 * `expert` / `nonstop` / `grade` tables). Making a course: {@link start} it from a NEW COURSE bar, {@link append}
 * songs (decide on a song bar), {@link removeLast} (LR2's right click), then {@link finish} (button 230) or
 * {@link cancel} (231). A saved course can be renamed (text 170), deleted (button 233) and, when NONSTOP, have each
 * connection stepped (buttons 240-248). {@link releaseCourse} flags a saved course for IR (button 253, its `release`),
 * once and for good, and the flagged course is then read-only: its connections and constraints, which key its ranking,
 * no longer change, though it can still be renamed and deleted, as in LR2. A RANDOM MIX bar {@link drawRandomMix draws} a course by the
 * {@link randomMixSettings} and keeps it as the newest course of its kind, in place of the previous draw.
 */
export class CourseMaker {
  private savedCourses: CourseDefinition[];
  private current: CourseDraft | undefined;
  private connection: NonstopConnection;
  private mixSettings: LR2RandomMixSettings;
  /** The last RANDOM MIX drawn in each folder, among {@link savedCourses}: the next draw there replaces it. */
  private lastRandomMixes = new Set<CourseDefinition>();

  private readonly options: CourseMakerOptions;

  constructor(options: CourseMakerOptions) {
    this.options = options;
    this.savedCourses = [...(options.courses ?? [])];
    this.connection = options.defaultConnection ?? 'fade';
    this.mixSettings = { ...(options.randomMixSettings ?? DEFAULT_LR2_RANDOM_MIX_SETTINGS) };
  }

  /** The saved courses, newest first. */
  get courses(): readonly CourseDefinition[] {
    return this.savedCourses;
  }

  /** The course being made, or `undefined` when none is. */
  get draft(): CourseDraft | undefined {
    return this.current;
  }

  get defaultConnection(): NonstopConnection {
    return this.connection;
  }

  get randomMixSettings(): LR2RandomMixSettings {
    return this.mixSettings;
  }

  /** The saved courses that are the last RANDOM MIX drawn in their folder (the next draw there replaces them). */
  get randomMixes(): readonly CourseDefinition[] {
    return this.savedCourses.filter((course) => this.lastRandomMixes.has(course));
  }

  /**
   * Replaces the saved courses, the default connection and the RANDOM MIX settings with ones read back from storage (no
   * change is emitted). `randomMixes` are those of `courses` that are a folder's last RANDOM MIX.
   */
  restore(saved: {
    courses: readonly CourseDefinition[];
    defaultConnection?: NonstopConnection;
    randomMixSettings?: LR2RandomMixSettings;
    randomMixes?: readonly CourseDefinition[];
  }): void {
    this.savedCourses = [...saved.courses];
    if (saved.defaultConnection !== undefined) this.connection = saved.defaultConnection;
    if (saved.randomMixSettings !== undefined)
      this.mixSettings = normalizeLR2RandomMixSettings(saved.randomMixSettings);
    this.lastRandomMixes = new Set((saved.randomMixes ?? []).filter((course) => this.savedCourses.includes(course)));
  }

  /** Starts making a course of `kind`, dropping any course being made. */
  start(kind: CourseKind): void {
    this.current = { ...createCourseDraft(kind), constraints: defaultCourseMakerConstraints(kind) };
    this.emit('draft');
  }

  /** Adds a song to the course being made (see `appendCourseDraftStage` for the limits). */
  async append(chartEntry: LibraryChart): Promise<{ ok: true } | { ok: false; reason: CourseMakerAppendFailure }> {
    if (this.current === undefined) return { ok: false, reason: 'not-making' };
    const md5 = await this.options.md5Of(chartEntry);
    // The course may have been finished or cancelled while the chart was hashed.
    const draft = this.current;
    if (draft === undefined) return { ok: false, reason: 'not-making' };
    const result = appendCourseDraftStage(draft, {
      md5: md5 ?? '',
      keyMode: Number(resolveLibraryChartPlayVariant(chartEntry)),
      title: chartEntry.title,
      ...(chartEntry.subtitle !== undefined ? { subtitle: chartEntry.subtitle } : {}),
      ...(chartEntry.artist !== undefined ? { artist: chartEntry.artist } : {}),
    });
    if (!result.ok) return result;
    this.current = result.draft;
    this.emit('draft');
    return { ok: true };
  }

  /** Drops the last song of the course being made. */
  removeLast(): void {
    if (this.current === undefined || this.current.stages.length === 0) return;
    this.current = removeLastCourseDraftStage(this.current);
    this.emit('draft');
  }

  /** Sets the constraints of the course being made (beatoraja's course constraints, one per group). */
  setConstraints(constraints: readonly CourseConstraint[]): void {
    if (this.current === undefined) return;
    this.current = { ...this.current, constraints: [...constraints] };
    this.emit('draft');
  }

  /** Names the course being made. */
  rename(name: string): void {
    if (this.current === undefined) return;
    this.current = { ...this.current, name };
    this.emit('draft');
  }

  /**
   * Saves the course being made as the newest course and stops making it. Returns the saved course, or `undefined`
   * when none is being made or it has no song (LR2's button 230 needs one).
   */
  finish(): CourseDefinition | undefined {
    if (this.current === undefined) return undefined;
    const { kind } = this.current;
    // A course saved without a name is named after its kind and its number among the courses of that kind.
    const fallback = `${UNNAMED_COURSE_LABELS[kind]} ${this.savedCourses.filter((saved) => saved.kind === kind).length + 1}`;
    const course = finishCourseDraft(
      { ...this.current, name: this.current.name.trim() || fallback },
      { defaultConnection: this.connection },
    );
    if (course === undefined) return undefined;
    this.current = undefined;
    this.savedCourses = [course, ...this.savedCourses];
    this.emit('draft');
    this.emit('courses');
    return course;
  }

  /** Stops making a course without saving it. */
  cancel(): void {
    if (this.current === undefined) return;
    this.current = undefined;
    this.emit('draft');
  }

  /** Steps the default NONSTOP connection (LR2's button 268). */
  stepDefaultConnection(delta: number): void {
    this.connection = stepLR2NonstopConnection(this.connection, delta);
    this.emit('settings');
  }

  /** Steps one RANDOM MIX setting (LR2's buttons 260-266), wrapping around at both ends. */
  stepRandomMixSetting(key: LR2RandomMixSetting, delta: number): void {
    this.mixSettings = stepLR2RandomMixSetting(this.mixSettings, key, delta);
    this.emit('settings');
  }

  /**
   * Draws a RANDOM MIX course of `kind` from `charts` in `keyMode` (`drawLR2RandomMix`) and keeps it as the newest
   * course, deleting the last RANDOM MIX drawn in that folder, as LR2's `WriteRandomCourse` deletes and re-inserts its
   * `RANDOM MIX` row. The previous draw is matched as this maker's own draw rather than by its title, so a course the
   * player named "RANDOM MIX" stays. Min and max settings the wrong way round are swapped and kept so, as LR2 writes
   * them back, even when the draw then fails; a failed draw keeps the courses as they were.
   */
  drawRandomMix<T extends LR2RandomMixChart>(
    kind: 'expert' | 'nonstop',
    keyMode: number,
    charts: readonly T[],
    random: () => number,
  ): LR2RandomMixDrawResult<T> {
    // LR2 swaps the limits and writes them back before it draws, whether or not the draw finds a chart.
    const settings = resolveLR2RandomMixSettings(this.mixSettings);
    if (Object.entries(settings).some(([key, value]) => this.mixSettings[key as LR2RandomMixSetting] !== value)) {
      this.mixSettings = settings;
      this.emit('settings');
    }
    const drawn = drawLR2RandomMix({ kind, keyMode, settings, defaultConnection: this.connection }, charts, random);
    if (!drawn.ok) return drawn;
    const previous = this.savedCourses.filter((course) => course.kind === kind && this.lastRandomMixes.has(course));
    for (const course of previous) this.lastRandomMixes.delete(course);
    this.savedCourses = [drawn.course, ...this.savedCourses.filter((course) => !previous.includes(course))];
    this.lastRandomMixes.add(drawn.course);
    this.emit('courses');
    return drawn;
  }

  /** Whether `course` is one of the saved courses (and so can be edited). */
  owns(course: CourseDefinition): boolean {
    return this.savedCourses.includes(course);
  }

  /**
   * Whether `course` is a saved course flagged for IR (`release`), and so read-only: LR2 reads a course whose `ir` is 1
   * as `courseReadOnly` (OpenLR2 L18078-L18080), and `WriteCourse` and the connection buttons refuse it (L17580-L17584,
   * L11126-L11129).
   */
  isReadOnly(course: CourseDefinition): boolean {
    return this.owns(course) && course.release;
  }

  /**
   * Flags a saved course for IR (LR2's button 253): sets its `release`, so its runs are ranked, and makes it read-only
   * ({@link isReadOnly}). The flag only turns on, as LR2's button does (OpenLR2 L11141-L11153). A RANDOM MIX flagged
   * becomes a course of the player's own, which the next draw keeps. Returns the flagged course, or `undefined` when
   * `course` is not a saved course or is flagged already.
   */
  releaseCourse(course: CourseDefinition): CourseDefinition | undefined {
    if (!this.owns(course) || course.release) return undefined;
    const edited = this.replace(course, { ...course, release: true });
    this.lastRandomMixes.delete(edited);
    return edited;
  }

  /**
   * Steps the connection after stage `slot + 1` of a saved NONSTOP course (LR2's buttons 240-248). Returns the edited
   * course, or `undefined` when `course` is not a saved NONSTOP course or is read-only.
   */
  stepConnection(course: CourseDefinition, slot: number, delta: number): CourseDefinition | undefined {
    if (!this.owns(course) || course.release || course.kind !== 'nonstop' || course.source.format !== 'lr2crs')
      return undefined;
    const current = parseLR2NonstopConnections(course.source.header)[slot] ?? 'fade';
    const edited = withNonstopConnection(course, slot, stepLR2NonstopConnection(current, delta));
    return this.replace(course, edited);
  }

  /**
   * Renames a saved course, read-only or not (the name does not key a course's ranking, and LR2's `ChangeCourseTitle`
   * renames an IR course too). A RANDOM MIX renamed becomes a course of the player's own, which the next draw keeps, as
   * LR2's draw only deletes the course titled `RANDOM MIX`.
   */
  renameCourse(course: CourseDefinition, name: string): CourseDefinition | undefined {
    if (!this.owns(course)) return undefined;
    const renamed = name.trim() || course.name;
    const edited = this.replace(course, { ...course, name: renamed });
    if (renamed !== LR2_RANDOM_MIX_NAME) this.lastRandomMixes.delete(edited);
    return edited;
  }

  /** Replaces a saved course's constraints; refused (`undefined`) for a read-only course. */
  setCourseConstraints(
    course: CourseDefinition,
    constraints: readonly CourseConstraint[],
  ): CourseDefinition | undefined {
    if (!this.owns(course) || course.release) return undefined;
    return this.replace(course, withCourseConstraints(course, constraints));
  }

  /** Deletes a saved course. */
  deleteCourse(course: CourseDefinition): void {
    if (!this.owns(course)) return;
    this.savedCourses = this.savedCourses.filter((saved) => saved !== course);
    this.lastRandomMixes.delete(course);
    this.emit('courses');
  }

  private replace(course: CourseDefinition, edited: CourseDefinition): CourseDefinition {
    this.savedCourses = this.savedCourses.map((saved) => (saved === course ? edited : saved));
    if (this.lastRandomMixes.delete(course)) this.lastRandomMixes.add(edited);
    this.emit('courses');
    return edited;
  }

  private emit(change: CourseMakerChange): void {
    this.options.onChange?.(change);
  }
}

/** The NEW COURSE bar of a course folder (see `LibraryCourse.newCourse`). */
export function createNewCourseEntry(kind: CourseKind): LibraryCourse {
  return {
    id: `maker:${kind}#new`,
    definition: {
      name: NEW_COURSE_NAME,
      kind,
      stages: [],
      constraints: [],
      trophies: [],
      release: false,
      source: { format: 'lr2crs', type: COURSE_MAKER_KINDS.indexOf(kind), header: '', hash: '' },
    },
    stages: [],
    playable: true,
    newCourse: true,
  };
}

/** The RANDOM MIX bar of an EXPERT or NONSTOP course folder (see `LibraryCourse.randomMix`). */
export function createRandomMixEntry(kind: 'expert' | 'nonstop'): LibraryCourse {
  return {
    id: `maker:${kind}#random-mix`,
    definition: {
      name: LR2_RANDOM_MIX_NAME,
      kind,
      stages: [],
      constraints: [],
      trophies: [],
      release: false,
      source: { format: 'lr2crs', type: COURSE_MAKER_KINDS.indexOf(kind), header: '', hash: '' },
    },
    stages: [],
    playable: true,
    randomMix: true,
  };
}

/**
 * The course folders of the player's own courses, one per course kind (EXPERT, NONSTOP, GRADE): each lists its saved
 * courses, newest first and matched to local charts, then a NEW COURSE bar, then (EXPERT and NONSTOP only) a RANDOM
 * MIX bar, as LR2's course folders do. A drawn RANDOM MIX is one of the saved courses.
 */
export function resolveCourseMakerFolders(
  courses: readonly CourseDefinition[],
  lookup: CourseChartLookup<LibraryChart>,
): LibraryFolder[] {
  return COURSE_MAKER_KINDS.map((kind) => ({
    label: COURSE_MAKER_FOLDER_LABELS[kind],
    charts: [],
    courses: [
      ...courses
        .filter((course) => course.kind === kind)
        .map((course, index) => ({
          ...resolveCourseEntry(`maker:${kind}#${index}`, course, lookup),
          editable: true as const,
        })),
      createNewCourseEntry(kind),
      ...(kind === 'grade' ? [] : [createRandomMixEntry(kind)]),
    ],
  }));
}

/**
 * A song as a RANDOM MIX sees it (`LR2RandomMixChart`), with the song under `chart`: its MD5, its folder (the chart's
 * directory within its source, LR2's `folder` column), key mode, play level and BPMs, the level and BPMs truncated to
 * integers as LR2's song database keeps them. A level that is not a number reads as 0.
 */
export function createRandomMixChart(
  chartEntry: LibraryChart,
  md5: string,
): LR2RandomMixChart & { readonly chart: LibraryChart } {
  const level =
    typeof chartEntry.playLevel === 'number'
      ? chartEntry.playLevel
      : Number.parseInt(String(chartEntry.playLevel ?? ''), 10);
  const slash = chartEntry.chartPath.lastIndexOf('/');
  const bpm = resolveChartBPMRange(chartEntry.chart);
  return {
    chart: chartEntry,
    md5: md5.toLowerCase(),
    folder: `${chartEntry.sourceId}/${slash < 0 ? '' : chartEntry.chartPath.slice(0, slash)}`,
    keyMode: Number(resolveLibraryChartPlayVariant(chartEntry)),
    level: Number.isFinite(level) ? Math.trunc(level) : 0,
    minBPM: Math.trunc(bpm.min),
    maxBPM: Math.trunc(bpm.max),
    title: chartEntry.title,
    ...(chartEntry.subtitle !== undefined ? { subtitle: chartEntry.subtitle } : {}),
    ...(chartEntry.artist !== undefined ? { artist: chartEntry.artist } : {}),
  };
}

/**
 * The course bar a RANDOM MIX draw plays: the drawn course, its stages the drawn songs, under the id its folder lists
 * it by once relisted (`resolveCourseMakerFolders`: the newest course of its kind), so the cursor comes back onto it as
 * LR2 puts it on the top bar.
 */
export function createDrawnRandomMixEntry(
  course: CourseDefinition,
  charts: readonly { readonly chart: LibraryChart }[],
): LibraryCourse {
  return {
    id: `maker:${course.kind}#0`,
    definition: course,
    stages: charts.map(({ chart }) => ({ title: chart.title, chart })),
    playable: true,
    editable: true,
  };
}
