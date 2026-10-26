import { readFile } from 'node:fs/promises';
import type { BeMusicCourseReplay } from '@be-music/player-engine/replay';
import { COURSES, expect, openWithLibrary, test, type Player } from './support.ts';

/**
 * A course replay (`*.bmcourse.json`) dropped on the built-in family: it plays the recorded run back as its course, its
 * stage results and its course result marked as a replay, and keeps nothing. Each run here is recorded first, with
 * "Auto-save replays" on, from the course's own bar.
 */

const RECORDS_KEY = 'be-music.chart-best-records';

/** Starts the course `title` from its bar: with the Debug Menu's auto play, or by hand. */
async function startCourse(player: Player, title: string, auto: boolean): Promise<void> {
  await player.setOption(['Play options'], 'Auto play', auto);
  await player.browseTo(COURSES, title);
  await player.key('Enter');
  await player.waitFor((state) => state.scene.kind === 'decide' || state.scene.kind === 'play', `${title} to start`);
}

/**
 * The course replay the page downloads next ("Auto-save replays" on): it is saved as the course result shows, which
 * may be while the previous result is being left, so the wait starts before that.
 */
async function nextCourseReplayDownload(player: Player): Promise<string> {
  const file = await player.page.waitForEvent('download', { timeout: 180_000 });
  expect(file.suggestedFilename()).toMatch(/\.bmcourse\.json$/);
  return readFile(await file.path(), 'utf8');
}

/** The best records the player keeps, as stored. */
function storedRecords(player: Player): Promise<string | null> {
  return player.page.evaluate((key) => window.localStorage.getItem(key), RECORDS_KEY);
}

/** Counts the downloads the page offers from now on. */
function countDownloads(player: Player): { readonly count: number } {
  const counter = { count: 0 };
  player.page.on('download', () => {
    counter.count += 1;
  });
  return counter;
}

test('a dropped GRADE course replay plays the run back to where it failed, with every result, keeping nothing', async ({
  player,
}) => {
  // Four stages played: the run recorded, then its replay.
  test.setTimeout(360_000);
  await openWithLibrary(player);
  await player.setOption(['Library & records'], 'Auto-save replays', true);
  // A manual run with no input: Fixture A clears, the dense Fixture D empties the course gauge, the run stops there.
  await startCourse(player, 'FIX GRADE FAIL', false);
  await player.waitForResult(0);
  await player.leaveResult();
  await player.waitForResult(1);
  const downloaded = nextCourseReplayDownload(player);
  await player.leaveResult();
  await player.waitForResult(2);
  const text = await downloaded;
  const recorded = (await player.state()).results[2]!;
  expect(recorded).toMatchObject({ run: 'course', lamp: 'FAILED', course: { stagesPlayed: 2 } });
  await player.leaveResult();
  await player.waitFor((state) => state.scene.kind === 'select', 'the select screen');
  const records = await storedRecords(player);
  expect(records).not.toBeNull();
  const downloads = countDownloads(player);

  await player.dropText('FIX GRADE FAIL.bmcourse.json', text);
  let state = await player.waitFor(
    (current) => current.scene.kind === 'play' && current.play?.course?.stage === 1,
    'the replay of stage 1',
  );
  expect(state.play).toMatchObject({ replay: true, course: { name: 'FIX GRADE FAIL', stageCount: 3 } });
  // Each stage shows its result, as LR2 and beatoraja show a replayed stage's.
  state = await player.waitForResult(3);
  expect(state.results[3]).toMatchObject({ run: 'stage', title: 'Fixture A', cleared: true, fromReplay: true });
  await player.leaveResult();
  state = await player.waitFor(
    (current) => current.scene.kind === 'play' && current.play?.course?.stage === 2,
    'the replay of stage 2',
  );
  expect(state.play?.replay).toBe(true);
  state = await player.waitForResult(4);
  expect(state.results[4]).toMatchObject({ run: 'stage', title: 'Fixture D dense', cleared: false, fromReplay: true });
  await player.leaveResult();
  // The run stops where it failed: the course result, not stage 3.
  state = await player.waitForResult(5);
  expect(state.results[5]).toMatchObject({
    run: 'course',
    title: 'FIX GRADE FAIL',
    lamp: 'FAILED',
    cleared: false,
    fromReplay: true,
    exScore: recorded.exScore,
    course: { stagesPlayed: 2, stageCount: 3 },
  });
  await player.leaveResult();
  state = await player.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  // No record, no saved replay.
  expect(await storedRecords(player)).toBe(records);
  expect(downloads.count).toBe(0);

  // A course replay whose stage chart is not loaded lists it and does not start.
  const log = JSON.parse(text) as BeMusicCourseReplay;
  const stage = log.stages[1]!;
  if (!stage.played) throw new Error('stage 2 was not played');
  stage.replay.chart.sha256 = '0'.repeat(64);
  stage.replay.chart.title = 'Not Loaded';
  await player.dropText('missing.bmcourse.json', JSON.stringify(log));
  const dialog = player.page.locator('dialog#replay-missing');
  // A Basecoat dialog is an empty box; its panel, the child, is what shows.
  await expect(dialog.locator(':scope > form')).toBeVisible();
  const artist = stage.replay.chart.artist;
  await expect(dialog.locator('li')).toHaveText([`Stage 2: Not Loaded${artist !== undefined ? ` / ${artist}` : ''}`]);
  state = await player.state();
  expect(state.status).toBe('Course replay: 1 of 3 stage charts are not loaded');
  expect(state.scene.kind).toBe('select');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog.locator(':scope > form')).toBeHidden();

  // So does a single replay whose chart is not loaded (its stage replay, cut loose from the loaded chart).
  delete stage.replay.play.native;
  await player.dropText('missing.bmplay.json', JSON.stringify(stage.replay));
  await expect(dialog.locator(':scope > form')).toBeVisible();
  await expect(dialog.locator('li')).toHaveText([`Not Loaded${artist !== undefined ? ` / ${artist}` : ''}`]);
  state = await player.state();
  expect(state.status).toBe('Replay: song not loaded (Not Loaded)');
  expect(state.scene.kind).toBe('select');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog.locator(':scope > form')).toBeHidden();
});

test('a dropped NONSTOP course replay plays its stitched run back as one chart, keeping nothing', async ({
  player,
}) => {
  await openWithLibrary(player);
  await player.setOption(['Library & records'], 'Auto-save replays', true);
  const downloaded = nextCourseReplayDownload(player);
  await startCourse(player, 'FIX NONSTOP', true);
  await player.waitForResult(0);
  const text = await downloaded;
  const recorded = (await player.state()).results[0]!;
  expect(recorded).toMatchObject({ run: 'nonstop', title: 'FIX NONSTOP', cleared: true });
  await player.leaveResult();
  await player.waitFor((state) => state.scene.kind === 'select', 'the select screen');
  const records = await storedRecords(player);
  const downloads = countDownloads(player);

  await player.dropText('FIX NONSTOP.bmcourse.json', text);
  let state = await player.waitFor(
    (current) => current.scene.kind === 'play' && current.play?.title === 'FIX NONSTOP',
    'the replay of the stitched run',
  );
  expect(state.play).toMatchObject({ replay: true, autoPlay: true });
  state = await player.waitForResult(1);
  expect(state.results[1]).toMatchObject({
    run: 'nonstop',
    title: 'FIX NONSTOP',
    cleared: true,
    fromReplay: true,
    exScore: recorded.exScore,
  });
  await player.leaveResult();
  await player.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  expect(await storedRecords(player)).toBe(records);
  expect(downloads.count).toBe(0);
});
