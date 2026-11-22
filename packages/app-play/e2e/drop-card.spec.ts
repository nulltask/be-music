import { expect, SONGS, test } from './support.ts';

test('closes the initial Drop card with its close button, even with an empty library', async ({ player }) => {
  await player.open();
  const card = player.page.locator('.drop-card');
  const close = card.getByRole('button', { name: 'Close drop card' });
  await close.click();
  await expect(card).toBeHidden();
  expect((await player.state()).library.charts).toBe(0);

  await player.page.evaluate(() => window.dispatchEvent(new Event('dragenter', { cancelable: true })));
  await expect(card).toBeVisible();
  await expect(close).toBeHidden();
  await player.page.evaluate(() => window.dispatchEvent(new Event('dragleave', { cancelable: true })));
  await expect(card).toBeHidden();
});

test('keeps the Drop card until a dropped folder adds a chart', async ({ player }) => {
  await player.open();
  const card = player.page.locator('.drop-card');
  await expect(card).toBeVisible();

  await player.dropText('Unrelated/readme.txt', 'No charts here');
  await expect(card).toBeVisible();
  await player.waitFor((state) => state.scene.kind === 'select', 'select after an unrelated drop');

  const loose = await player.dropText('loose.bms', '#TITLE Loose chart\n#BPM 120\n#WAV01 key.wav\n#00111:01\n');
  expect(loose.library.charts).toBe(1);
  await expect(card).toBeVisible();

  await player.dropText('Broken/broken.bmson', '{"version":"1.0.0",');
  await expect(card).toBeVisible();

  const folder = await player.drop('songs', { prefix: SONGS });
  expect(folder.library.charts).toBeGreaterThan(1);
  await expect(card).toBeHidden();
});

for (const skin of ['lr2', 'beatoraja'] as const) {
  test(`closes the Drop card when a ${skin} skin folder is dropped without charts`, async ({ player }) => {
    await player.open();
    const card = player.page.locator('.drop-card');
    await expect(card).toBeVisible();

    const folder = await player.drop(`skins/${skin}`, { prefix: `Example ${skin}` });
    expect(folder.library.charts).toBe(0);
    await expect(card).toBeHidden();
  });
}
