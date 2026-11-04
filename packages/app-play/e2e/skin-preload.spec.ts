import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './support.ts';

for (const family of ['lr2', 'beatoraja'] as const) {
  test(`${family} loads behind confirmation and remains available after declining`, async ({ player }) => {
    await player.open();
    await player.dropText('preload.bme', '#TITLE Skin preload\n#BPM 120\n#00111:01');
    const root = join(process.env.E2E_FIXTURES!, 'skins', family);
    const files = await readdir(root, { recursive: true, withFileTypes: true });
    const payload = await Promise.all(
      files
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const path = join(entry.parentPath, entry.name);
          return { path: path.slice(root.length + 1), data: (await readFile(path)).toString('base64') };
        }),
    );
    const before = (await player.state()).loads;
    await player.page.evaluate((payload) => {
      const files = payload.map(({ path, data }) => {
        const file = new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], path.split('/').at(-1)!);
        Object.defineProperty(file, 'webkitRelativePath', { value: path });
        return file;
      });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files, items: [], types: ['Files'] } });
      window.dispatchEvent(event);
    }, payload);
    const dialog = player.page.locator('#skin-switch[open]');
    await expect(dialog.locator('button[value=""]')).toBeVisible();
    await expect
      .poll(() =>
        player.page
          .locator('#options-modal select option')
          .evaluateAll(
            (options, label) => options.some((option) => option.textContent === label),
            family === 'lr2' ? 'LR2' : 'beatoraja',
          ),
      )
      .toBe(true);
    await dialog.locator('button[value=""]').click();
    await player.waitFor((state) => state.loads > before && !state.loading, 'declined drop');
    expect((await player.state()).scene.family).toBe('built-in');
    await player.setOption(['Skin & display'], 'Skin system', family === 'lr2' ? 'LR2' : 'beatoraja');
    await player.waitFor((state) => state.scene.family === family, 'cached skin activation');
    await expect(player.page.locator('#skin-switch[open]')).toHaveCount(0);
  });
}

test('leaving select requests closing the window and keeps select if the browser refuses', async ({ player }, info) => {
  await player.open({ 'be-music.built-in-skin': 'synesthesia' });
  await player.dropText('exit.bme', '#TITLE Exit preview\n#BPM 120\n#00111:01');
  await player.page.evaluate(() => {
    window.close = () => {
      document.documentElement.dataset.closeRequested = 'true';
    };
  });
  await player.key('Escape');
  if ((await player.page.getByRole('button', { name: 'Close window', exact: true }).count()) === 0)
    await player.key('Escape');
  await expect(player.page.getByRole('button', { name: 'Close window', exact: true })).toBeVisible();
  await player.page.screenshot({ path: info.outputPath('close-window-confirmation.png') });
  await player.page.getByRole('button', { name: 'Close window', exact: true }).click();
  await expect(player.page.locator('html')).toHaveAttribute('data-close-requested', 'true');
  expect((await player.state()).scene.kind).toBe('select');
});
