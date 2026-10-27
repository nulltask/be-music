import { expect, openWithLibrary, test } from './support.ts';

/** Debug Menu → Library & records → Local data… lists what the player keeps in this browser, without changing it. */
test('the local data viewer lists localStorage keys and IndexedDB databases, and opens a value', async ({ player }) => {
  const { page } = player;
  await openWithLibrary(player, { 'be-music.hi-speed': '3.25' });
  await player.pressOption(['Library & records'], 'Local data…');
  const dialog = page.locator('dialog.local-data-dialog');
  // A Basecoat dialog is an empty box; its panel, the child, is what shows.
  await expect(dialog.locator(':scope > div')).toBeVisible();
  await expect(dialog.locator('.local-data-usage')).not.toHaveText('Reading…');
  // What is stored now; a refresh reads it all again and must change none of it.
  const stored = () =>
    page.evaluate(async () => ({
      local: JSON.stringify(Object.entries(window.localStorage).sort(([a], [b]) => a.localeCompare(b))),
      databases: (await indexedDB.databases())
        .map((database) => database.name ?? '')
        .sort((a, b) => a.localeCompare(b)),
    }));
  const before = await stored();
  await dialog.getByRole('button', { name: 'Refresh' }).click();
  await expect(dialog.locator('.local-data-usage')).not.toHaveText('Reading…');

  const hiSpeed = dialog.locator('details', { has: page.locator('summary code', { hasText: /^be-music\.hi-speed$/ }) });
  await expect(hiSpeed.locator('summary')).toContainText('The hi-speed the next play starts at');
  await hiSpeed.locator('summary').click();
  await expect(hiSpeed.locator('pre')).toHaveText('3.25');
  await expect(dialog.locator('summary code', { hasText: /^be-music\.debug-menu-settings$/ })).toBeVisible();

  // The player's course database is listed with its store.
  const courses = dialog.locator('details[data-database="be-music"]');
  await expect(courses.locator(':scope > summary')).toContainText('Courses you made');
  await courses.locator(':scope > summary').click();
  await expect(courses.locator('summary code', { hasText: /^courses$/ })).toBeVisible();

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toHaveAttribute('open');
  expect(await stored()).toEqual(before);
});
