import { expect, openWithLibrary, smokeGroup, SONGS, test } from './support.ts';

test(
  'the saved FPS option displays a live readout in gameplay and the shortcut can hide it',
  smokeGroup(2),
  async ({ player }) => {
    await openWithLibrary(player);
    const { page } = player;
    const overlay = page.locator('#fps-overlay');
    await expect(overlay).toBeHidden();
    await page.locator('[data-service-header="settings"]').click();
    const dialog = page.locator('#options-modal');
    await dialog.getByRole('tab', { name: 'Advanced' }).click();
    await dialog.getByRole('switch', { name: 'Show FPS' }).check();
    await dialog.locator('#options-modal-close').click();
    await expect(overlay).toHaveText(/^\d+ FPS$/);

    await page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after reloading');
    await expect(overlay).toBeVisible();

    await player.drop('songs', { prefix: SONGS });
    await player.browseTo(SONGS, 'Fixture A');
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && state.play?.title === 'Fixture A' && (state.play.seconds ?? 0) > 0,
      'the chart to play',
    );
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveText(/^\d+ FPS$/);
    await player.key('F7');
    await expect(overlay).toBeHidden();
    await player.key('F7');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveText(/^\d+ FPS$/);
  },
);
