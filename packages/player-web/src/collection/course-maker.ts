import {
  appendCourseDraftStage,
  createCourseDraft,
  defaultCourseMakerConstraints,
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
  type NonstopConnection,
} from '@be-music/player/course';
import {
  resolveLibraryChartPlayVariant,
  type LibraryChart,
  type LibraryCourse,
  type LibraryFolder,
} from '@be-music/scene-model';
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

/** What changed in a {@link CourseMaker}: the course being made, the saved courses, or the default connection. */
export type CourseMakerChange = 'draft' | 'courses' | 'settings';

/** Why a song cannot join a course being made: `not-making` when no course is being made. */
export type CourseMakerAppendFailure = CourseDraftAppendFailure | 'not-making';

export interface CourseMakerOptions {
  /** The player's saved courses, newest first. */
  courses?: readonly CourseDefinition[];
  /** The connection a new NONSTOP course gets after each stage (LR2's button 268). Default `fade`. */
  defaultConnection?: NonstopConnection;
  /** A song's chart MD5, which a course keys its stages by; `undefined` when it cannot be hashed. */
  md5Of: (song: LibraryChart) => Promise<string | undefined>;
  /** Called after every change, so a host can save the courses and redraw. */
  onChange?: (change: CourseMakerChange) => void;
}

/**
 * The player's own courses and the course being made, as LR2's select screen keeps them (`isMakingCourse`, its
 * `expert` / `nonstop` / `grade` tables). Making a course: {@link start} it from a NEW COURSE bar, {@link append}
 * songs (decide on a song bar), {@link removeLast} (LR2's right click), then {@link finish} (button 230) or
 * {@link cancel} (231). A saved course can be renamed (text 170), deleted (button 233) and, when NONSTOP, have each
 * connection stepped (buttons 240-248).
 */
export class CourseMaker {
  private savedCourses: CourseDefinition[];
  private current: CourseDraft | undefined;
  private connection: NonstopConnection;

  private readonly options: CourseMakerOptions;

  constructor(options: CourseMakerOptions) {
    this.options = options;
    this.savedCourses = [...(options.courses ?? [])];
    this.connection = options.defaultConnection ?? 'fade';
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

  /** Replaces the saved courses and the default connection with ones read back from storage (no change is emitted). */
  restore(saved: { courses: readonly CourseDefinition[]; defaultConnection?: NonstopConnection }): void {
    this.savedCourses = [...saved.courses];
    if (saved.defaultConnection !== undefined) this.connection = saved.defaultConnection;
  }

  /** Starts making a course of `kind`, dropping any course being made. */
  start(kind: CourseKind): void {
    this.current = { ...createCourseDraft(kind), constraints: defaultCourseMakerConstraints(kind) };
    this.emit('draft');
  }

  /** Adds a song to the course being made (see `appendCourseDraftStage` for the limits). */
  async append(song: LibraryChart): Promise<{ ok: true } | { ok: false; reason: CourseMakerAppendFailure }> {
    if (this.current === undefined) return { ok: false, reason: 'not-making' };
    const md5 = await this.options.md5Of(song);
    // The course may have been finished or cancelled while the chart was hashed.
    const draft = this.current;
    if (draft === undefined) return { ok: false, reason: 'not-making' };
    const result = appendCourseDraftStage(draft, {
      md5: md5 ?? '',
      keyMode: Number(resolveLibraryChartPlayVariant(song)),
      title: song.title,
      ...(song.subtitle !== undefined ? { subtitle: song.subtitle } : {}),
      ...(song.artist !== undefined ? { artist: song.artist } : {}),
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

  /** Whether `course` is one of the saved courses (and so can be edited). */
  owns(course: CourseDefinition): boolean {
    return this.savedCourses.includes(course);
  }

  /**
   * Steps the connection after stage `slot + 1` of a saved NONSTOP course (LR2's buttons 240-248). Returns the edited
   * course, or `undefined` when `course` is not a saved NONSTOP course.
   */
  stepConnection(course: CourseDefinition, slot: number, delta: number): CourseDefinition | undefined {
    if (!this.owns(course) || course.kind !== 'nonstop' || course.source.format !== 'lr2crs') return undefined;
    const current = parseLR2NonstopConnections(course.source.header)[slot] ?? 'fade';
    const edited = withNonstopConnection(course, slot, stepLR2NonstopConnection(current, delta));
    return this.replace(course, edited);
  }

  /** Renames a saved course. */
  renameCourse(course: CourseDefinition, name: string): CourseDefinition | undefined {
    if (!this.owns(course)) return undefined;
    return this.replace(course, { ...course, name: name.trim() || course.name });
  }

  /** Replaces a saved course's constraints. */
  setCourseConstraints(
    course: CourseDefinition,
    constraints: readonly CourseConstraint[],
  ): CourseDefinition | undefined {
    if (!this.owns(course)) return undefined;
    return this.replace(course, withCourseConstraints(course, constraints));
  }

  /** Deletes a saved course. */
  deleteCourse(course: CourseDefinition): void {
    if (!this.owns(course)) return;
    this.savedCourses = this.savedCourses.filter((saved) => saved !== course);
    this.emit('courses');
  }

  private replace(course: CourseDefinition, edited: CourseDefinition): CourseDefinition {
    this.savedCourses = this.savedCourses.map((saved) => (saved === course ? edited : saved));
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

/**
 * The course folders of the player's own courses, one per course kind (EXPERT, NONSTOP, GRADE): each lists its saved
 * courses, newest first and matched to local charts, then a NEW COURSE bar, as LR2's course folders do.
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
    ],
  }));
}
