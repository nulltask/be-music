import type { TestHookFamily, TestHookResult, TestHookState } from '../src/test-hook.ts';
import { COURSES, expect, SMOKE, test, type Player } from './support.ts';

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
  /** Opens the player with the checklist library and the family's skin. */
  open(player: Player): Promise<void>;
  /** Starts the course under the select screen's cursor with AUTO, as the family offers it. */
  startAuto(player: Player): Promise<void>;
  /** The families of a NONSTOP run's play and result (each family's own: the stitched play is one play). */
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
function playingStage(player: Player, course: string, stage: number): Promise<TestHookState> {
  return player.waitFor(
    (state) => state.scene.kind === 'play' && state.play?.course?.name === course && state.play.course.stage === stage,
    `${course} stage ${stage} to play`,
  );
}

/** Starts the course `title` from its bar, with AUTO or as a manual play. */
async function startCourse(player: Player, setup: FamilyCase, title: string, auto: boolean): Promise<void> {
  await player.browseTo(COURSES, title);
  if (auto) await setup.startAuto(player);
  else await player.key('Enter');
  await player.waitFor((state) => state.scene.kind === 'decide' || state.scene.kind === 'play', `${title} to start`);
}

/**
 * Leaves the course result and checks the cursor is back on the course bar (item 8), showing `record`, the best record
 * the run kept for the course (item 1), when given.
 */
async function expectBackOnCourseBar(player: Player, title: string, record?: { lamp: string }): Promise<void> {
  await player.leaveResult();
  const state = await player.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  expect(state.cursor?.folderPath).toEqual([COURSES]);
  expect(state.cursor?.bar).toMatchObject({ kind: 'course', title, ...record });
}

export function courseFlowTests(setup: FamilyCase): void {
  test.describe(`course flow on the ${setup.name} family`, () => {
    test('lists course folders and bars, and says why a course with a missing stage does not start', async ({
      player,
    }) => {
      await setup.open(player);
      let state = await player.state();
      expect(state.library.courseFolders).toEqual(
        expect.arrayContaining([COURSES, 'MY COURSES', 'MY NONSTOP', 'MY DAN']),
      );
      state = await player.browseTo(COURSES, 'FIX GRADE');
      expect(state.scene.family).toBe(setup.family);
      expect(state.cursor?.bar?.course).toMatchObject({
        kind: 'grade',
        stages: ['Fixture A', 'Fixture B', 'Fixture C'],
        missingStages: 0,
        playable: true,
      });
      state = await player.cursorTo((bar) => bar.title === 'FIX MISSING STAGE', 'FIX MISSING STAGE');
      expect(state.cursor?.bar?.course).toMatchObject({ kind: 'expert', missingStages: 1, playable: false });
      // Enter and the family's AUTO both say why, and the course does not start.
      for (const start of [() => player.key('Enter'), () => setup.startAuto(player)]) {
        const shown = state.statusLog.length;
        await start();
        state = await player.waitFor((current) => current.statusLog.length > shown, 'a status line');
        expect(state.status).toBe('FIX MISSING STAGE: 1 stage is not in the collection');
        expect(state.scene.kind).toBe('select');
      }
    });

    test(
      'plays a GRADE course with AUTO: stage results skipped, gauge carried over, settings restored',
      SMOKE,
      async ({ player }) => {
        await setup.open(player);
        // An LR2 grade turns the lane option off and EASY into GROOVE for its stages only.
        await player.setOption(PLAY_OPTIONS, 'Gauge', 'EASY');
        await player.setOption(PLAY_OPTIONS, 'Random 1P', 'MIRROR');
        await startCourse(player, setup, 'FIX GRADE', true);
        let state = await playingStage(player, 'FIX GRADE', 1);
        expect(state.scene.family).toBe(setup.family);
        expect(state.play).toMatchObject({ autoPlay: true, course: { stageCount: 3 } });
        await playingStage(player, 'FIX GRADE', 2);
        state = await playingStage(player, 'FIX GRADE', 3);
        // AUTO skips the results of the stages before the last, as LR2 does.
        expect(state.results).toHaveLength(0);
        state = await player.waitForResult(0);
        expect(state.results[0]).toMatchObject({ run: 'stage', family: setup.family, title: 'Fixture C' });
        const stageLog = await player.lastReplay();
        expect(stageLog?.play).toMatchObject({ mode: 'auto', gauge: 'GROOVE', course: { kind: 'grade' } });
        expect(stageLog?.play.randomLane?.p1 ?? 'OFF').toBe('OFF');
        await player.leaveResult();
        state = await player.waitForResult(1);
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
        await expectBackOnCourseBar(player, 'FIX GRADE');
        // The player's own settings come back after the course.
        expect(await player.readOption(PLAY_OPTIONS, 'Gauge')).toBe('EASY');
        expect(await player.readOption(PLAY_OPTIONS, 'Random 1P')).toBe('MIRROR');
      },
    );

    test('seeking a course stage makes every later stage and the course result practice', async ({ player }) => {
      await setup.open(player);
      await startCourse(player, setup, 'FIX GRADE', true);
      await playingStage(player, 'FIX GRADE', 1);
      await player.waitFor((state) => (state.play?.seconds ?? 0) > 0.5, 'the stage clock to start');
      await player.key('Space');
      await player.key('ArrowRight');
      await player.waitFor((state) => (state.play?.seconds ?? 0) > 5, 'the paused stage to seek forwards');
      await player.key('ArrowLeft');
      await player.key('Space');
      await playingStage(player, 'FIX GRADE', 2);
      await playingStage(player, 'FIX GRADE', 3);
      let state = await player.waitForResult(0);
      expect(state.results[0]).toMatchObject({ run: 'stage', practice: true });
      expect(await player.lastReplay()).toBeUndefined();
      await player.leaveResult();
      state = await player.waitForResult(1);
      expect(state.results[1]).toMatchObject({ run: 'course', practice: true, cleared: true });
      await expectBackOnCourseBar(player, 'FIX GRADE');
    });

    test('seeks a NONSTOP run across stages and retains practice and course retry', async ({ player }) => {
      await setup.open(player);
      await startCourse(player, setup, 'FIX NONSTOP', true);
      await player.waitFor(
        (state) => state.play?.title === 'FIX NONSTOP' && (state.play.seconds ?? 0) > 0.5,
        'NONSTOP under way',
      );
      await player.key('Space');
      // Each seek moves 5 s from wherever the play is. The paused position depends on when Space landed, so each seek
      // is checked against the position just before it, not against fixed times.
      const seekBy = async (code: 'ArrowLeft' | 'ArrowRight', what: string): Promise<void> => {
        const before = (await player.state()).play?.seconds ?? 0;
        await player.key(code);
        await player.waitFor((state) => {
          const seconds = state.play?.seconds;
          return seconds !== undefined && (code === 'ArrowRight' ? seconds > before + 4 : seconds < before - 4);
        }, what);
      };
      // Forward until past 15 s, across a stage seam: from wherever Space paused, so a late pause needs fewer seeks
      // (and three from a late pause would run into the end of the run).
      for (let i = 0; i < 6 && ((await player.state()).play?.seconds ?? 0) <= 15; i++)
        await seekBy('ArrowRight', 'the next forward seek');
      await player.waitFor((state) => (state.play?.seconds ?? 0) > 15, 'NONSTOP sought across a stage seam');
      for (let i = 0; i < 3; i++) await seekBy('ArrowLeft', 'the next backward seek');
      await player.key('Space');
      const state = await player.waitForResult(0);
      expect(state.results[0]).toMatchObject({ run: 'nonstop', practice: true, cleared: true });
      expect(await player.lastReplay()).toBeUndefined();
      await player.leaveResult('KeyR');
      await player.waitFor((current) => current.play?.title === 'FIX NONSTOP', 'course retry to restitch NONSTOP');
    });

    test('fails a GRADE course whose gauge empties in a stage played with no input', async ({ player }) => {
      await setup.open(player);
      await startCourse(player, setup, 'FIX GRADE FAIL', false);
      await playingStage(player, 'FIX GRADE FAIL', 1);
      let state = await player.waitForResult(0);
      expect(state.results[0]).toMatchObject({ run: 'stage', title: 'Fixture A', cleared: true });
      await player.leaveResult();
      await playingStage(player, 'FIX GRADE FAIL', 2);
      // Fixture D is dense enough to empty the course gauge long before its last note; the play ends there.
      state = await player.waitForResult(1);
      expect(state.results[1]).toMatchObject({ run: 'stage', title: 'Fixture D dense', cleared: false });
      expect(state.results[1]!.gauge.value).toBe(0);
      await player.leaveResult();
      state = await player.waitForResult(2);
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
      // A manual run keeps the course's record (an AUTO one keeps none), and the course bar shows its lamp.
      await expectBackOnCourseBar(player, 'FIX GRADE FAIL', { lamp: 'FAILED' });
    });

    test('plays an EXPERT course with AUTO on the course gauge', async ({ player }) => {
      await setup.open(player);
      await startCourse(player, setup, 'FIX EXPERT', true);
      await playingStage(player, 'FIX EXPERT', 1);
      let state = await player.waitForResult(0);
      expect(state.results[0]).toMatchObject({ run: 'stage', title: 'Fixture C' });
      await player.leaveResult();
      state = await player.waitForResult(1);
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
      await expectBackOnCourseBar(player, 'FIX EXPERT');
    });

    test('plays a NONSTOP course as one stitched chart, retries it with R, on both placements', async ({ player }) => {
      await setup.open(player);
      await player.setOption(['Tempo'], 'Enabled', true);
      await startCourse(player, setup, 'FIX NONSTOP', true);
      let state = await player.waitFor(
        (current) => current.scene.kind === 'play' && current.play?.title === 'FIX NONSTOP',
        'the stitched play',
      );
      expect(state.scene.family).toBe(setup.nonstop.play);
      expect(state.play?.course).toBeUndefined();
      // The pitch handling and the stretcher are locked during the play; the tempo slider stays live in pitch mode.
      expect(await player.optionEnabled(['Tempo'], 'Pitch')).toBe(false);
      expect(await player.optionEnabled(['Tempo'], 'Keep-pitch stretcher')).toBe(false);
      expect(await player.optionEnabled(['Tempo'], 'Tempo (%)')).toBe(true);
      state = await player.waitForResult(0);
      expect(state.results[0]).toMatchObject({
        run: 'nonstop',
        family: setup.nonstop.result,
        title: 'FIX NONSTOP',
        cleared: true,
      });
      if (setup.jingles !== undefined) expect(state.results[0]!.jingle).toBe(setup.jingles.clear);
      // R stitches the course again and plays it.
      state = await player.leaveResult('KeyR');
      await player.waitFor(
        (current) => current.scene.kind === 'play' && current.play?.title === 'FIX NONSTOP',
        'the retried stitched play',
      );
      state = await player.waitForResult(1);
      expect(state.results[1]).toMatchObject({ run: 'nonstop', title: 'FIX NONSTOP' });
      await expectBackOnCourseBar(player, 'FIX NONSTOP');
      // LR2's own placement.
      await player.setOption(['Course'], 'NONSTOP placement', 'lr2');
      await startCourse(player, setup, 'FIX NONSTOP', true);
      state = await player.waitForResult(2);
      expect(state.results[2]).toMatchObject({ run: 'nonstop', title: 'FIX NONSTOP', cleared: true });
      await expectBackOnCourseBar(player, 'FIX NONSTOP');
    });

    test('ESC on the first stage of a manual run fails the course and counts the stage given up', async ({
      player,
    }) => {
      await setup.open(player);
      await startCourse(player, setup, 'FIX GRADE FAIL', false);
      await player.waitFor(
        (state) => state.play?.course?.stage === 1 && (state.play.judged?.poor ?? 0) >= 3,
        'a few POORs on stage 1',
      );
      await player.key('Escape');
      const state = await player.waitForResult(0);
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
      await expectBackOnCourseBar(player, 'FIX GRADE FAIL');
    });

    test('a click on the canvas during a stage does not start it over', async ({ player }) => {
      await setup.open(player);
      // A manual run shows each stage's result: a result screen left alive would take the click (the bug this
      // guards against), so the click lands on the stage after one.
      await startCourse(player, setup, 'FIX GRADE', false);
      await player.waitForResult(0);
      await player.leaveResult();
      let last = await player.waitFor(
        (state) => state.play?.course?.stage === 2 && (state.play.seconds ?? 0) > 1,
        'stage 2 under way',
      );
      await player.clickCanvas();
      // Until stage 2 ends, its clock only moves on.
      for (;;) {
        const state = await player.state();
        if (state.scene.kind !== 'play') break;
        expect(state.play?.course?.stage).toBe(2);
        expect(state.play?.seconds ?? 0).toBeGreaterThanOrEqual(last.play?.seconds ?? 0);
        last = state;
        await player.page.waitForTimeout(100);
      }
      const state = await player.waitForResult(1);
      expect(state.results[1]).toMatchObject({ run: 'stage', title: 'Fixture B' });
    });

    test('ESC on stage 2 of an AUTO run ends the course as a failed run that counts the stage given up', async ({
      player,
    }) => {
      await setup.open(player);
      await startCourse(player, setup, 'FIX GRADE', true);
      await player.waitFor(
        (state) => state.play?.course?.stage === 2 && (state.play.judged?.pgreat ?? 0) >= 2,
        'stage 2 under way',
      );
      await player.key('Escape');
      const state = await player.waitForResult(0);
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
      await expectBackOnCourseBar(player, 'FIX GRADE');
    });

    test('warns that a course file listing more than five stages is read as its first five', async ({ player }) => {
      await setup.open(player);
      const warning = /seven-stages\.lr2crs: 1 course\(s\) list more than 5 stages/;
      let state = await player.drop('.', { only: (path) => path === 'seven-stages.lr2crs' });
      expect(state.status).toMatch(warning);
      expect(state.library.courseFolders.filter((label) => label === 'seven-stages')).toHaveLength(1);
      state = await player.browseTo('seven-stages', 'FIX SEVEN STAGES');
      expect(state.cursor?.bar?.course?.stages).toHaveLength(5);
      // A second drop of the same file warns again and adds no folder.
      state = await player.drop('.', { only: (path) => path === 'seven-stages.lr2crs' });
      expect(state.status).toMatch(warning);
      expect(state.library.courseFolders.filter((label) => label === 'seven-stages')).toHaveLength(1);
    });
  });
}
