import { expect, openWithLibrary, test } from './support.ts';

test('keeps a successful random course draw and replays its fixed stages', async ({ player }) => {
  await openWithLibrary(player);
  await player.dropText(
    'folder/default.json',
    JSON.stringify([{ name: 'Draws', rcourse: [{ name: 'Random A', stage: [{ sql: "title = 'Fixture A'" }] }] }]),
  );
  await player.openFolder('Draws');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.key('Enter');
  const play = await player.waitFor((s) => s.scene.kind === 'play', 'the drawn course');
  const name = play.play?.course?.name;
  expect(name).toMatch(/^Random A \d{8}_\d{6}$/);
  await player.waitForResult(0);
  await player.leaveResult();
  await player.waitFor((s) => s.scene.kind === 'result' && s.results.at(-1)?.course !== undefined, 'the course result');
  await player.leaveResult();
  const select = await player.waitFor((s) => s.scene.kind === 'select', 'the retained course bar');
  expect(select.cursor?.bar?.title).toBe(name);
  expect(select.cursor?.bar?.course?.random).toBeFalsy();
  await player.key('Enter');
  const replayed = await player.waitFor((s) => s.scene.kind === 'play', 'the fixed draw to play again');
  expect(replayed.play?.title).toBe('Fixture A');
  expect(replayed.play?.course?.name).toBe(name);
});

test('draws a RANDOM MIX from its bar, plays it and keeps it as the folder newest course', async ({ player }) => {
  test.setTimeout(360_000);
  await openWithLibrary(player);
  await player.openFolder('MY COURSES');
  await player.cursorTo((bar) => bar.course?.randomMix === true, 'the RANDOM MIX bar');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.key('Enter');
  // The RANDOM MIX dialog asks for the conditions first; its defaults draw up to five stages, once.
  const dialog = player.page.locator('#random-mix-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.random-mix-matches')).not.toHaveAttribute('data-empty', 'true');
  await dialog.locator('button[value="ok"]').click();
  const play = await player.waitFor((s) => s.scene.kind === 'play', 'the drawn RANDOM MIX');
  expect(play.play?.course?.name).toBe('RANDOM MIX');
  const stageCount = play.play?.course?.stageCount ?? 0;
  expect(stageCount).toBeGreaterThan(0);
  // The last stage's result, then the course result.
  await player.waitForResult(0, 300_000);
  await player.leaveResult();
  await player.waitFor((s) => s.scene.kind === 'result' && s.results.at(-1)?.course !== undefined, 'the course result');
  await player.leaveResult();
  const select = await player.waitFor((s) => s.scene.kind === 'select', 'the kept RANDOM MIX');
  expect(select.cursor?.bar?.title).toBe('RANDOM MIX');
  expect(select.cursor?.bar?.course).toMatchObject({ kind: 'expert', randomMix: false, playable: true });
  expect(select.cursor?.bar?.course?.stages).toHaveLength(stageCount);
  // Back on the select screen, the save dialog offers the run's course under the date and time it ended, with every
  // stage drawn and the settings it started with, read-only.
  const save = player.page.locator('#random-mix-save-dialog');
  await expect(save).toBeVisible();
  const name = save.locator('#random-mix-save-name');
  await expect(name).toHaveValue(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  await expect(save.locator('.random-mix-save-stage')).toHaveCount(stageCount);
  await expect(save.locator('.random-mix-save-row')).not.toHaveCount(0);
  // The name is the only field: the settings are text.
  await expect(save.locator('input, select, textarea')).toHaveCount(1);
  await name.fill('My mix');
  await save.locator('button[value="save"]').click();
  await expect(save).toBeHidden();
  const saved = await player.waitFor((s) => s.cursor?.bar?.title === 'My mix', 'the saved RANDOM MIX');
  expect(saved.cursor?.bar?.course?.stages).toHaveLength(stageCount);
});

test('offers to save a RANDOM MIX given up mid-run, listing every stage drawn', async ({ player }) => {
  test.setTimeout(240_000);
  await openWithLibrary(player);
  await player.openFolder('MY COURSES');
  await player.cursorTo((bar) => bar.course?.randomMix === true, 'the RANDOM MIX bar');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.key('Enter');
  const dialog = player.page.locator('#random-mix-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('button[value="ok"]').click();
  const play = await player.waitFor((s) => s.scene.kind === 'play', 'the drawn RANDOM MIX');
  const stageCount = play.play?.course?.stageCount ?? 0;
  // ESC gives the run up: its course result shows, then the select screen offers to save it.
  await player.key('Escape');
  await player.waitFor((s) => s.scene.kind === 'result' && s.results.at(-1)?.run === 'course', 'the course result');
  await player.leaveResult();
  const save = player.page.locator('#random-mix-save-dialog');
  await expect(save).toBeVisible();
  await expect(save.locator('.random-mix-save-stage')).toHaveCount(stageCount);
  await save.locator('button[value=""]').click();
  await expect(save).toBeHidden();
  const select = await player.waitFor((s) => s.scene.kind === 'select', 'the select screen');
  expect(select.cursor?.bar?.title).toBe('RANDOM MIX');
});
