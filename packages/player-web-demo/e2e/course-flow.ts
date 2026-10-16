import type { TestHookFamily, TestHookResult, TestHookState } from '../src/test-hook.ts';
import { COURSES, type Demo, expect, test } from './support.ts';

/**
 * The course flow of the checklist (`docs/course-checklist.md`, items 1-8 and 10), run the same way on each skin family:
 * a spec file describes the family ({@link FamilyCase}) and calls {@link courseFlowTests}.
 */

/** How a family runs the checklist. */
export interface FamilyCase {
  /** The family's name in test titles. */
  name: string;
  /** The family the select, decide, play and result screens of a course are drawn by. */
  family: TestHookFamily;
  /** Opens the demo with the checklist library and the family's skin. */
  open(demo: Demo): Promise<void>;
  /** Starts the course under the select screen's cursor with AUTO, as the family offers it. */
  startAuto(demo: Demo): Promise<void>;
  /** The families of a NONSTOP run's play and result (beatoraja plays it on the built-in scene). */
  nonstop: { play: TestHookFamily; result: TestHookFamily };
  /** The jingle each result plays (`test-hook.ts` names them), when the family's skin has a sound set. */
  jingles?: { courseClear: string; courseFail: string; clear: string };
  /** Whether the course result reports PLAY TIME (the LR2 and built-in result views). */
  playTime: boolean;
}

const PLAY_OPTIONS = ['Play options'];

/** The stages of a course result. */
function stagesOf(result: TestHookResult | undefined) {
  const course = result?.course;
  if (course === undefined) throw new Error(`not a course result: ${JSON.stringify(result)}`);
  return course.stages;
}

/** Waits for the course's stage `stage` (1-based) to be playing. */
function playingStage(demo: Demo, course: string, stage: number): Promise<TestHookState> {
  return demo.waitFor(
    (state) => state.scene.kind === 'play' && state.play?.course?.name === course && state.play.course.stage === stage,
    `${course} stage ${stage} to play`,
  );
}

/** Starts the course `title` from its bar, with AUTO or as a manual play. */
async function startCourse(demo: Demo, setup: FamilyCase, title: string, auto: boolean): Promise<void> {
  await demo.browseTo(COURSES, title);
  if (auto) await setup.startAuto(demo);
  else await demo.key('Enter');
  await demo.waitFor((state) => state.scene.kind === 'decide' || state.scene.kind === 'play', `${title} to start`);
}

/** Leaves the course result and checks the cursor is back on the course bar (item 8). */
async function expectBackOnCourseBar(demo: Demo, title: string): Promise<void> {
  await demo.leaveResult();
  const state = await demo.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  expect(state.cursor?.folderPath).toEqual([COURSES]);
  expect(state.cursor?.bar).toMatchObject({ kind: 'course', title });
}

export function courseFlowTests(setup: FamilyCase): void {
  test.describe(`course flow on the ${setup.name} family`, () => {
    test('lists course folders and bars, and says why a course with a missing stage does not start', async ({
      demo,
    }) => {
      await setup.open(demo);
      let state = await demo.state();
      expect(state.library.courseFolders).toEqual(
        expect.arrayContaining([COURSES, 'MY COURSES', 'MY NONSTOP', 'MY DAN']),
      );
      state = await demo.browseTo(COURSES, 'FIX GRADE');
      expect(state.scene.family).toBe(setup.family);
      expect(state.cursor?.bar?.course).toMatchObject({
        kind: 'grade',
        stages: ['Fixture A', 'Fixture B', 'Fixture C'],
        missingStages: 0,
        playable: true,
      });
      state = await demo.cursorTo((bar) => bar.title === 'FIX MISSING STAGE', 'FIX MISSING STAGE');
      expect(state.cursor?.bar?.course).toMatchObject({ kind: 'expert', missingStages: 1, playable: false });
      // Enter and the family's AUTO both say why, and the course does not start.
      for (const start of [() => demo.key('Enter'), () => setup.startAuto(demo)]) {
        const shown = state.statusLog.length;
        await start();
        state = await demo.waitFor((current) => current.statusLog.length > shown, 'a status line');
        expect(state.status).toBe('FIX MISSING STAGE: 1 stage is not in the collection');
        expect(state.scene.kind).toBe('select');
      }
    });

    test('plays a GRADE course with AUTO: stage results skipped, gauge carried over, settings restored', async ({
      demo,
    }) => {
      await setup.open(demo);
      // An LR2 grade turns the lane option off and EASY into GROOVE for its stages only.
      await demo.setOption(PLAY_OPTIONS, 'Gauge', 'EASY');
      await demo.setOption(PLAY_OPTIONS, 'Random 1P', 'MIRROR');
      await startCourse(demo, setup, 'FIX GRADE', true);
      let state = await playingStage(demo, 'FIX GRADE', 1);
      expect(state.scene.family).toBe(setup.family);
      expect(state.play).toMatchObject({ autoPlay: true, course: { stageCount: 3 } });
      await playingStage(demo, 'FIX GRADE', 2);
      state = await playingStage(demo, 'FIX GRADE', 3);
      // AUTO skips the results of the stages before the last, as LR2 does.
      expect(state.results).toHaveLength(0);
      state = await demo.waitForResult(0);
      expect(state.results[0]).toMatchObject({ run: 'stage', family: setup.family, title: 'Fixture C' });
      const stageLog = await demo.lastPlaylog();
      expect(stageLog?.play).toMatchObject({ mode: 'auto', gauge: 'GROOVE', course: { kind: 'grade' } });
      expect(stageLog?.play.randomLane?.p1 ?? 'OFF').toBe('OFF');
      await demo.leaveResult();
      state = await demo.waitForResult(1);
      const result = state.results[1]!;
      expect(result).toMatchObject({
        run: 'course',
        family: setup.family,
        title: 'FIX GRADE',
        cleared: true,
        course: { kind: 'grade', stageCount: 3, stagesPlayed: 3, aborted: false },
      });
      expect(result.lamp).not.toBe('FAILED');
      const stages = stagesOf(result);
      expect(stages[0]!.gauge.start).toBeUndefined();
      expect(stages[1]!.gauge.start).toBe(stages[0]!.gauge.final);
      expect(stages[2]!.gauge.start).toBe(stages[1]!.gauge.final);
      expect(result.exScore).toBe(stages.reduce((sum, stage) => sum + stage.exScore, 0));
      if (setup.jingles !== undefined) expect(result.jingle).toBe(setup.jingles.courseClear);
      if (setup.playTime) expect(result.playSeconds).toBeGreaterThan(0);
      await expectBackOnCourseBar(demo, 'FIX GRADE');
      // The player's own settings come back after the course.
      expect(await demo.readOption(PLAY_OPTIONS, 'Gauge')).toBe('EASY');
      expect(await demo.readOption(PLAY_OPTIONS, 'Random 1P')).toBe('MIRROR');
    });

    test('fails a GRADE course whose gauge empties in a stage played with no input', async ({ demo }) => {
      await setup.open(demo);
      await startCourse(demo, setup, 'FIX GRADE FAIL', false);
      await playingStage(demo, 'FIX GRADE FAIL', 1);
      let state = await demo.waitForResult(0);
      expect(state.results[0]).toMatchObject({ run: 'stage', title: 'Fixture A', cleared: true });
      await demo.leaveResult();
      await playingStage(demo, 'FIX GRADE FAIL', 2);
      // Fixture D is dense enough to empty the course gauge long before its last note; the play ends there.
      state = await demo.waitForResult(1);
      expect(state.results[1]).toMatchObject({ run: 'stage', title: 'Fixture D dense', cleared: false });
      expect(state.results[1]!.gauge.value).toBe(0);
      await demo.leaveResult();
      state = await demo.waitForResult(2);
      const result = state.results[2]!;
      expect(result).toMatchObject({
        run: 'course',
        title: 'FIX GRADE FAIL',
        lamp: 'FAILED',
        cleared: false,
        course: { stagesPlayed: 2, stageCount: 3, aborted: false },
      });
      expect(stagesOf(result)[1]!.gauge.final).toBe(0);
      if (setup.jingles !== undefined) expect(result.jingle).toBe(setup.jingles.courseFail);
      await expectBackOnCourseBar(demo, 'FIX GRADE FAIL');
    });

    test('plays an EXPERT course with AUTO on the course gauge', async ({ demo }) => {
      await setup.open(demo);
      await startCourse(demo, setup, 'FIX EXPERT', true);
      await playingStage(demo, 'FIX EXPERT', 1);
      let state = await demo.waitForResult(0);
      expect(state.results[0]).toMatchObject({ run: 'stage', title: 'Fixture C' });
      await demo.leaveResult();
      state = await demo.waitForResult(1);
      const result = state.results[1]!;
      expect(result).toMatchObject({
        run: 'course',
        title: 'FIX EXPERT',
        cleared: true,
        course: { kind: 'expert', stagesPlayed: 3, aborted: false },
      });
      // The LR2 ruleset's course gauge for EXPERT on GROOVE.
      expect(result.gauge.type).toBe('COURSE');
      const stages = stagesOf(result);
      expect(stages[1]!.gauge.start).toBe(stages[0]!.gauge.final);
      if (setup.jingles !== undefined) expect(result.jingle).toBe(setup.jingles.courseClear);
      await expectBackOnCourseBar(demo, 'FIX EXPERT');
    });

    test('plays a NONSTOP course as one stitched chart, retries it with R, on both placements', async ({ demo }) => {
      await setup.open(demo);
      await startCourse(demo, setup, 'FIX NONSTOP', true);
      let state = await demo.waitFor(
        (current) => current.scene.kind === 'play' && current.play?.title === 'FIX NONSTOP',
        'the stitched play',
      );
      expect(state.scene.family).toBe(setup.nonstop.play);
      expect(state.play?.course).toBeUndefined();
      // The pitch handling and the stretcher are locked during the play; the tempo slider stays live in pitch mode.
      expect(await demo.optionEnabled(['Tempo'], 'Pitch')).toBe(false);
      expect(await demo.optionEnabled(['Tempo'], 'Keep-pitch stretcher')).toBe(false);
      expect(await demo.optionEnabled(['Tempo'], 'Tempo (%)')).toBe(true);
      state = await demo.waitForResult(0);
      expect(state.results[0]).toMatchObject({
        run: 'nonstop',
        family: setup.nonstop.result,
        title: 'FIX NONSTOP',
        cleared: true,
      });
      if (setup.jingles !== undefined) expect(state.results[0]!.jingle).toBe(setup.jingles.clear);
      // R stitches the course again and plays it.
      state = await demo.leaveResult('KeyR');
      await demo.waitFor(
        (current) => current.scene.kind === 'play' && current.play?.title === 'FIX NONSTOP',
        'the retried stitched play',
      );
      state = await demo.waitForResult(1);
      expect(state.results[1]).toMatchObject({ run: 'nonstop', title: 'FIX NONSTOP' });
      await expectBackOnCourseBar(demo, 'FIX NONSTOP');
      // LR2's own placement.
      await demo.setOption(['Course'], 'NONSTOP placement', 'lr2');
      await startCourse(demo, setup, 'FIX NONSTOP', true);
      state = await demo.waitForResult(2);
      expect(state.results[2]).toMatchObject({ run: 'nonstop', title: 'FIX NONSTOP', cleared: true });
      await expectBackOnCourseBar(demo, 'FIX NONSTOP');
    });

    test('ESC on the first stage of a manual run fails the course and counts the stage given up', async ({ demo }) => {
      await setup.open(demo);
      await startCourse(demo, setup, 'FIX GRADE FAIL', false);
      await demo.waitFor(
        (state) => state.play?.course?.stage === 1 && (state.play.judged?.poor ?? 0) >= 3,
        'a few POORs on stage 1',
      );
      await demo.key('Escape');
      const state = await demo.waitForResult(0);
      const result = state.results[0]!;
      expect(result).toMatchObject({
        run: 'course',
        title: 'FIX GRADE FAIL',
        lamp: 'FAILED',
        course: { stagesPlayed: 1, aborted: true },
      });
      const [stage] = stagesOf(result);
      expect(stage!.aborted).toBe(true);
      expect(stage!.judged.poor).toBeGreaterThanOrEqual(3);
      expect(result.judged.poor).toBeGreaterThanOrEqual(3);
      if (setup.playTime) expect(result.playSeconds).toBeGreaterThan(0);
      await expectBackOnCourseBar(demo, 'FIX GRADE FAIL');
    });

    test('a click on the canvas during a stage does not start it over', async ({ demo }) => {
      await setup.open(demo);
      // A manual run shows each stage's result: a result screen left alive would take the click (the bug this
      // guards against), so the click lands on the stage after one.
      await startCourse(demo, setup, 'FIX GRADE', false);
      await demo.waitForResult(0);
      await demo.leaveResult();
      let last = await demo.waitFor(
        (state) => state.play?.course?.stage === 2 && (state.play.seconds ?? 0) > 1,
        'stage 2 under way',
      );
      await demo.clickCanvas();
      // Until stage 2 ends, its clock only moves on.
      for (;;) {
        const state = await demo.state();
        if (state.scene.kind !== 'play') break;
        expect(state.play?.course?.stage).toBe(2);
        expect(state.play?.seconds ?? 0).toBeGreaterThanOrEqual(last.play?.seconds ?? 0);
        last = state;
        await demo.page.waitForTimeout(100);
      }
      const state = await demo.waitForResult(1);
      expect(state.results[1]).toMatchObject({ run: 'stage', title: 'Fixture B' });
    });

    test('ESC on stage 2 of an AUTO run ends the course as a failed run that counts the stage given up', async ({
      demo,
    }) => {
      await setup.open(demo);
      await startCourse(demo, setup, 'FIX GRADE', true);
      await demo.waitFor(
        (state) => state.play?.course?.stage === 2 && (state.play.judged?.pgreat ?? 0) >= 2,
        'stage 2 under way',
      );
      await demo.key('Escape');
      const state = await demo.waitForResult(0);
      const result = state.results[0]!;
      expect(result).toMatchObject({
        run: 'course',
        title: 'FIX GRADE',
        lamp: 'FAILED',
        course: { stagesPlayed: 2, aborted: true },
      });
      const stages = stagesOf(result);
      expect(stages[0]!.aborted).toBe(false);
      expect(stages[1]!.aborted).toBe(true);
      expect(stages[1]!.judged.pgreat).toBeGreaterThanOrEqual(2);
      if (setup.playTime) expect(result.playSeconds).toBeGreaterThan(0);
      await expectBackOnCourseBar(demo, 'FIX GRADE');
    });

    test('warns that a course file listing more than five stages is read as its first five', async ({ demo }) => {
      await setup.open(demo);
      const warning = /seven-stages\.lr2crs: 1 course\(s\) list more than 5 stages/;
      let state = await demo.drop('.', { only: (path) => path === 'seven-stages.lr2crs' });
      expect(state.status).toMatch(warning);
      expect(state.library.courseFolders.filter((label) => label === 'seven-stages')).toHaveLength(1);
      state = await demo.browseTo('seven-stages', 'FIX SEVEN STAGES');
      expect(state.cursor?.bar?.course?.stages).toHaveLength(5);
      // A second drop of the same file warns again and adds no folder.
      state = await demo.drop('.', { only: (path) => path === 'seven-stages.lr2crs' });
      expect(state.status).toMatch(warning);
      expect(state.library.courseFolders.filter((label) => label === 'seven-stages')).toHaveLength(1);
    });
  });
}
