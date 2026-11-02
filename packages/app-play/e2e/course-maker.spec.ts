import { readFile } from 'node:fs/promises';
import type { Download } from '@playwright/test';
import { type Player, expect, openWithLibrary, SONGS, test } from './support.ts';

/**
 * Checklist item 9 on the built-in family: making EXPERT, GRADE and NONSTOP courses from the NEW COURSE bars, the
 * five-song cap, the key-mode rule, the card's constraint editor, Save and Cancel, then the saved-course manager's
 * rename, delete and the `.lr2crs` / beatoraja `.json` exports.
 */

/** Decides the song `title` (adding it to the course being made) and returns the status line it leaves. */
async function decide(player: Player, title: string): Promise<string> {
  await player.browseTo(SONGS, title);
  const shown = (await player.state()).statusLog.length;
  await player.key('Enter');
  const state = await player.waitFor((current) => current.statusLog.length > shown, `a status line for ${title}`);
  expect(state.scene.kind).toBe('select');
  return state.status;
}

/** Starts making a course from the NEW COURSE bar of `folder`. */
async function startMaking(player: Player, folder: string, kind: string): Promise<void> {
  await player.openFolder(folder);
  await player.cursorTo((bar) => bar.course?.newCourse === true, 'the NEW COURSE bar');
  await player.key('Enter');
  const state = await player.waitFor((current) => current.courseDraft?.kind === kind, `a ${kind} course being made`);
  expect(state.status).toBe('Making a course: decide charts to add them, then save');
}

/** The text of a file the page offered as a download. */
async function downloadedText(download: Download): Promise<string> {
  const path = await download.path();
  return readFile(path, 'utf8');
}

test('makes, saves, cancels, renames, deletes and exports courses', async ({ player }) => {
  // Hundreds of UI steps: the CI runner spends seconds per click (#792).
  test.setTimeout(360_000);
  const { page } = player;
  await openWithLibrary(player);
  const card = page.locator('aside.course-maker-card');

  // EXPERT: five songs at most, all in the first song's key mode; deciding a sixth saves the course.
  await startMaking(player, 'MY COURSES', 'expert');
  expect(await decide(player, 'Fixture A')).toBe('Added Fixture A to the course (1 / 5)');
  expect(await decide(player, 'Fixture 5KEY')).toBe(
    'Could not add Fixture 5KEY: its key mode differs from the first chart’s',
  );
  for (const [index, title] of ['Fixture B', 'Fixture C', 'Fixture E', 'Fixture F'].entries()) {
    expect(await decide(player, title)).toBe(`Added ${title} to the course (${index + 2} / 5)`);
  }
  const saved = await decide(player, 'Fixture G');
  const expertName = /^Saved the course "(.+)"$/.exec(saved)?.[1];
  expect(expertName).toBeDefined();
  let state = await player.waitFor((current) => current.courseDraft === undefined, 'the course to be saved');
  state = await player.browseTo('MY COURSES', expertName!);
  expect(state.cursor?.bar?.course).toMatchObject({
    kind: 'expert',
    stages: ['Fixture A', 'Fixture B', 'Fixture C', 'Fixture E', 'Fixture F'],
    playable: true,
  });

  // GRADE: named and constrained on the card, then cancelled.
  await startMaking(player, 'MY DAN', 'grade');
  await expect(card).toBeVisible();
  await card.locator('input.course-maker-name').fill('E2E DAN');
  await card.locator('label', { hasText: 'Judgment' }).locator('select').selectOption({ label: 'No GOOD' });
  expect(await decide(player, 'Fixture A')).toBe('Added Fixture A to the course (1 / 5)');
  await card.getByRole('button', { name: 'Cancel' }).click();
  state = await player.waitFor((current) => current.courseDraft === undefined, 'the course to be dropped');
  expect(state.status).toBe('Stopped making the course');
  await expect(card).toBeHidden();

  // GRADE again, saved from the card with its constraint; NONSTOP saved from the card too.
  await startMaking(player, 'MY DAN', 'grade');
  await card.locator('input.course-maker-name').fill('E2E DAN');
  await card.locator('label', { hasText: 'Judgment' }).locator('select').selectOption({ label: 'No GOOD' });
  await decide(player, 'Fixture B');
  await card.getByRole('button', { name: 'Save' }).click();
  state = await player.waitFor((current) => current.courseDraft === undefined, 'the GRADE course to be saved');
  expect(state.status).toBe('Saved the course "E2E DAN"');
  await startMaking(player, 'MY NONSTOP', 'nonstop');
  await card.locator('input.course-maker-name').fill('E2E NONSTOP');
  await decide(player, 'Fixture A');
  await decide(player, 'Fixture B');
  await card.getByRole('button', { name: 'Save' }).click();
  state = await player.waitFor((current) => current.courseDraft === undefined, 'the NONSTOP course to be saved');
  expect(state.status).toBe('Saved the course "E2E NONSTOP"');
  state = await player.browseTo('MY NONSTOP', 'E2E NONSTOP');
  expect(state.cursor?.bar?.course).toMatchObject({ kind: 'nonstop', stages: ['Fixture A', 'Fixture B'] });

  // The saved-course manager: exports, rename, delete.
  await player.pressOption(['Course'], 'My courses…');
  const dialog = page.locator('dialog.course-maker-dialog');
  // A Basecoat dialog is an empty box; its panel, the child, is what shows.
  await expect(dialog.locator(':scope > div')).toBeVisible();
  const [lr2crs] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export .lr2crs' }).click(),
  ]);
  expect(lr2crs.suggestedFilename()).toBe('my-courses.lr2crs');
  const lr2crsText = await downloadedText(lr2crs);
  for (const name of [expertName!, 'E2E DAN', 'E2E NONSTOP']) expect(lr2crsText).toContain(`<title>${name}</title>`);
  const [json] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export beatoraja .json' }).click(),
  ]);
  expect(json.suggestedFilename()).toBe('my-courses.json');
  const exported = JSON.parse(await downloadedText(json)) as Array<{ name: string; constraint?: string[] }>;
  // beatoraja has no NONSTOP course; its file keeps the constraints `.lr2crs` cannot hold.
  expect(exported.map((course) => course.name).sort()).toEqual([expertName!, 'E2E DAN'].sort());
  expect(exported.find((course) => course.name === 'E2E DAN')?.constraint).toContain('NO_GOOD');

  const row = (kind: string) =>
    dialog
      .locator('section.course-maker-course')
      .filter({ has: page.locator('.course-maker-kind', { hasText: new RegExp(`^${kind}$`) }) });
  const rename = row('EXPERT').locator('input.course-maker-name');
  await expect(rename).toHaveValue(expertName!);
  await rename.fill('E2E EXPERT');
  await rename.dispatchEvent('change');
  page.once('dialog', (confirm) => void confirm.accept());
  await row('NONSTOP').getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toHaveAttribute('open');
  state = await player.browseTo('MY COURSES', 'E2E EXPERT');
  expect(state.cursor?.bar?.course?.kind).toBe('expert');
  await player.openFolder('MY NONSTOP');
  state = await player.cursorTo((bar) => bar.course?.newCourse === true, 'the NEW COURSE bar');
  expect(state.library.courseFolders).toContain('MY NONSTOP');
  // Only the NEW COURSE and RANDOM MIX bars are left in MY NONSTOP.
  await player.key('ArrowDown');
  state = await player.state();
  expect(state.cursor?.bar?.course?.randomMix).toBe(true);
  await player.key('ArrowDown');
  state = await player.state();
  expect(state.cursor?.bar?.course?.newCourse).toBe(true);
});
