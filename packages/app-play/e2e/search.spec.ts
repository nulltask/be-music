import { expect, openWithLibrary, test } from './support.ts';

test('inline filter errors render as text, clear, and preserve the focused input', async ({ player }) => {
  await openWithLibrary(player, { 'be-music.built-in-skin': 'plain' });
  const { page } = player;
  const input = page.locator('#search');
  const error = page.locator('#search-error');
  await page.keyboard.press('/');
  await expect(input).toBeFocused();
  await input.fill('?ORDER BY RANDOM()');
  await expect(error).toBeVisible();
  await expect(error).toHaveText('unexpected ORDER at 0');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('Fixture A');
  await expect(error).toBeHidden();
  await expect(error).toHaveText('');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(input).toBeFocused();
  await input.fill('?ORDER BY RANDOM()');
  await expect(error).toBeVisible();
  await input.press('Escape');
  await expect(error).toBeHidden();
  await expect(input).not.toBeFocused();
});
