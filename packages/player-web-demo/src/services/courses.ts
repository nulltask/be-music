// The course run in progress: the EXPERT / GRADE course between its stages, the AUTO it was started with, and where the
// select screen was when it started. Every change to them is one of the transitions below, made by the course and
// NONSTOP routes (`app/routes/course.ts`, `app/routes/nonstop.ts`), the play and result screens, and the scene router's
// interrupt. What a course's flow decides is `course-flow.ts`'s, and the run itself is `CourseRun`
// (`@be-music/player/course`).

import type { BeMusicReplay } from '@be-music/player/replay';
import type { BrowseSnapshot, LibraryCourse } from '@be-music/scene-model';
import { startCourseRun, type ActiveCourse } from '../course-flow.ts';

/**
 * The course run in progress, from the course bar started to its course result, or until a navigation the scenes did
 * not ask for ends it ({@link endRun}). A NONSTOP course is one play and keeps no run here, only its AUTO and where the
 * select screen was.
 */
export class CourseRunService {
  /** The EXPERT / GRADE course being played, between its stages. */
  private activeCourse: ActiveCourse | undefined;
  /** Set when a course was started with AUTO (`true`), so its every stage plays itself; `undefined` follows the menu. */
  private courseAutoPlay: boolean | undefined;
  /**
   * Where the select screen was when a course started. A later stage starts with no select screen up, so the course
   * keeps this to put the cursor back on the course bar once it is over.
   */
  private courseReturnNavigation: BrowseSnapshot | undefined;

  /** The EXPERT / GRADE course being played, between its stages. */
  public get active(): ActiveCourse | undefined {
    return this.activeCourse;
  }

  /**
   * The AUTO the course was started with, which its every play takes (each stage, and a NONSTOP run's every restitch):
   * `true`, or `undefined` to follow the Debug Menu's auto play.
   */
  public get autoPlay(): boolean | undefined {
    return this.courseAutoPlay;
  }

  /** A course bar is started: with AUTO (`true`), or with PLAY (`undefined`). */
  public start(autoPlay: boolean | undefined): void {
    this.courseAutoPlay = autoPlay;
  }

  /** The course leaves the select screen at `navigation`, where the cursor comes back once the course is over. */
  public leaveSelect(navigation: BrowseSnapshot | undefined): void {
    this.courseReturnNavigation = navigation;
  }

  /** An EXPERT / GRADE course's run begins (its stages all in the collection). */
  public beginRun(course: LibraryCourse): ActiveCourse {
    const active = startCourseRun(course);
    this.activeCourse = active;
    return active;
  }

  /** Backing out of the course's decide screen drops its run, unless another run has begun since. */
  public cancelRun(active: ActiveCourse): void {
    if (this.activeCourse === active) this.activeCourse = undefined;
  }

  /**
   * ESC gave `active` up: the stage given up is recorded, with its replay once the engine has handed it over, and the
   * run is the running one again, so that its course result shows it as a failed run.
   */
  public giveUp(active: ActiveCourse, replay: BeMusicReplay | undefined): void {
    active.run.giveUp(replay);
    this.activeCourse = active;
  }

  /** The course result takes the run, which ends there; `undefined` when none is running. */
  public finishRun(): ActiveCourse | undefined {
    const active = this.activeCourse;
    this.activeCourse = undefined;
    return active;
  }

  /** F5 in a course stage drops the run with no result, as quick retry is off there. */
  public abandonRun(): void {
    this.activeCourse = undefined;
  }

  /**
   * Ends the course run (EXPERT, GRADE or NONSTOP) when a navigation the scenes did not ask for takes over (the router's
   * `onInterrupt`: a drop, a skin or theme change, files or a replay loaded): the run is dropped unrecorded, so the
   * next single play is not taken for its next stage. Returns where the select screen was when the course started, for
   * the select screen to come back to unless that navigation has put it somewhere already (a drop opens what it
   * brought). Outside a run it does nothing and returns `undefined`.
   */
  public endRun(): BrowseSnapshot | undefined {
    this.activeCourse = undefined;
    this.courseAutoPlay = undefined;
    const navigation = this.courseReturnNavigation;
    this.courseReturnNavigation = undefined;
    return navigation;
  }

  /**
   * Back on the select screen once no course runs: where the select screen was when the course started, so the cursor
   * returns to the course bar it was started from, taken once. `undefined` while a course runs or after none.
   */
  public takeReturnNavigation(): BrowseSnapshot | undefined {
    if (this.courseReturnNavigation === undefined || this.activeCourse !== undefined) return undefined;
    const navigation = this.courseReturnNavigation;
    this.courseReturnNavigation = undefined;
    return navigation;
  }
}
