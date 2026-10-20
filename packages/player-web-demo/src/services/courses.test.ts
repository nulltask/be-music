import { createEmptyJSON } from '@be-music/json';
import { parseBeatorajaCourseData } from '@be-music/player/course';
import type { BeMusicReplay } from '@be-music/player/replay';
import type { BrowseSnapshot, LibraryChart, LibraryCourse } from '@be-music/scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { CourseRunService } from './courses.ts';

function chartEntry(id: string): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id,
    totalNotes: 10,
    chart: createEmptyJSON('bms'),
  };
}

/** A GRADE course of two stages, both in the collection. */
function grade(): LibraryCourse {
  const definition = parseBeatorajaCourseData({
    name: 'Dan',
    hash: ['1', '2'].map((digit) => ({ md5: digit.repeat(32) })),
    constraint: ['CLASS'],
  })!;
  return {
    id: 'dan#0',
    definition,
    stages: ['a', 'b'].map((id) => ({ title: id, chart: chartEntry(id) })),
    playable: true,
  };
}

/** A stage's replay with a result: the gauge where the stage left it. */
function stageLog(final = 80): BeMusicReplay {
  return {
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
    results: {
      native: {
        ruleset: 'be-music/native',
        judge: { pgreat: 10, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
        fast: 0,
        slow: 0,
        exScore: 20,
        noteCount: 10,
        maxCombo: 10,
        gauge: { type: 'GRADE', final, cleared: final > 0 },
      },
    },
  } as unknown as BeMusicReplay;
}

/** Where the select screen was (a folder open, the cursor on a bar). */
const AT_COURSE_BAR = { folderPath: ['courses'] } as unknown as BrowseSnapshot;

describe('CourseRunService', () => {
  test('starts with no run, no AUTO and nowhere to return to', () => {
    const courses = new CourseRunService();
    expect(courses.active).toBeUndefined();
    expect(courses.autoPlay).toBeUndefined();
    expect(courses.takeReturnNavigation()).toBeUndefined();
    expect(courses.endRun()).toBeUndefined();
  });

  test('a course started with AUTO keeps it for every play; PLAY follows the menu', () => {
    const courses = new CourseRunService();
    courses.start(true);
    expect(courses.autoPlay).toBe(true);
    courses.start(undefined);
    expect(courses.autoPlay).toBeUndefined();
  });

  test('a run begins on the course and plays its stages in order', () => {
    const courses = new CourseRunService();
    const course = grade();
    const active = courses.beginRun(course);
    expect(courses.active).toBe(active);
    expect(active.course).toBe(course);
    expect(active.run.nextStage()?.stage.id).toBe('a');
    active.run.recordStage(stageLog());
    expect(active.run.nextStage()?.stage.id).toBe('b');
  });

  test('backing out of the decide screen drops only the run it was shown for', () => {
    const courses = new CourseRunService();
    const first = courses.beginRun(grade());
    courses.cancelRun(first);
    expect(courses.active).toBeUndefined();
    const stale = courses.beginRun(grade());
    const newer = courses.beginRun(grade());
    courses.cancelRun(stale);
    expect(courses.active).toBe(newer);
  });

  test('ESC gives the run up: the stage is recorded, the run ends and is the running one again for its result', () => {
    const courses = new CourseRunService();
    const active = courses.beginRun(grade());
    // A navigation took the run meanwhile (the replay arrives after the stage left).
    courses.finishRun();
    courses.giveUp(active, stageLog(40));
    expect(courses.active).toBe(active);
    expect(active.run.finished).toBe(true);
    expect(active.run.stagesPlayed).toBe(1);
  });

  test('the course result takes the run, once', () => {
    const courses = new CourseRunService();
    const active = courses.beginRun(grade());
    expect(courses.finishRun()).toBe(active);
    expect(courses.active).toBeUndefined();
    expect(courses.finishRun()).toBeUndefined();
  });

  test('F5 in a stage drops the run but keeps the AUTO and where to return, for the select screen to take', () => {
    const courses = new CourseRunService();
    courses.start(true);
    courses.leaveSelect(AT_COURSE_BAR);
    courses.beginRun(grade());
    courses.abandonRun();
    expect(courses.active).toBeUndefined();
    expect(courses.autoPlay).toBe(true);
    expect(courses.takeReturnNavigation()).toBe(AT_COURSE_BAR);
  });

  test('the select screen returns to the course bar only once the course is over, and only once', () => {
    const courses = new CourseRunService();
    courses.leaveSelect(AT_COURSE_BAR);
    courses.beginRun(grade());
    expect(courses.takeReturnNavigation()).toBeUndefined();
    courses.finishRun();
    expect(courses.takeReturnNavigation()).toBe(AT_COURSE_BAR);
    expect(courses.takeReturnNavigation()).toBeUndefined();
  });

  test('a NONSTOP course keeps no run, so the select screen returns to its bar after its one play', () => {
    const courses = new CourseRunService();
    courses.start(true);
    courses.leaveSelect(AT_COURSE_BAR);
    expect(courses.active).toBeUndefined();
    expect(courses.takeReturnNavigation()).toBe(AT_COURSE_BAR);
  });

  test('an interrupt ends the run unrecorded and hands back where the course started', () => {
    const courses = new CourseRunService();
    courses.start(true);
    courses.leaveSelect(AT_COURSE_BAR);
    const active = courses.beginRun(grade());
    active.run.recordStage(stageLog());
    expect(courses.endRun()).toBe(AT_COURSE_BAR);
    expect(courses.active).toBeUndefined();
    expect(courses.autoPlay).toBeUndefined();
    expect(courses.takeReturnNavigation()).toBeUndefined();
    // Outside a run it does nothing.
    expect(courses.endRun()).toBeUndefined();
  });
});
