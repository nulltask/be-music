import { expect, test } from './support.ts';

for (const mode of ['remembered', 'session-only', 'worker-transfer-fails'] as const) {
  const canRemember = mode !== 'session-only';
  test(`lists dropped folders and restores saved charts (${mode})`, async ({ player }) => {
    const { page } = player;
    await page.route('**/api/player-settings', (route) => route.fulfill({ status: 204 }));
    await page.route('**/__url-load-proxy?**', (route) => route.fulfill({ status: 404 }));
    await player.open({ 'be-music.lang': 'en' });

    for (const name of ['First pack', 'Second pack']) {
      const before = (await player.state()).loads;
      await page.evaluate(
        async ({ name, canRemember }) => {
          const chart = new File([`#TITLE ${name}\n#BPM 120\n#WAV01 kick.wav\n#00111:01\n`], 'chart.bms');
          const directory = {
            isDirectory: true,
            isFile: false,
            name,
            fullPath: `/${name}`,
            createReader() {
              let read = false;
              return {
                readEntries(complete: (entries: unknown[]) => void) {
                  const entry = {
                    isDirectory: false,
                    isFile: true,
                    name: chart.name,
                    fullPath: `/${name}/${chart.name}`,
                    file: (complete: (file: File) => void) => complete(chart),
                  };
                  complete(read ? [] : [entry]);
                  read = true;
                },
              };
            },
          };
          const handle = canRemember
            ? await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })
            : undefined;
          if (handle) {
            const savedChart = await handle.getFileHandle(chart.name, { create: true });
            const writer = await savedChart.createWritable();
            await writer.write(chart);
            await writer.close();
          }
          const item = {
            kind: 'file',
            webkitGetAsEntry: () => directory,
            ...(handle ? { getAsFileSystemHandle: async () => handle } : {}),
          };
          const event = new Event('drop', { cancelable: true });
          Object.defineProperty(event, 'dataTransfer', { value: { items: [item], files: [], types: ['Files'] } });
          window.dispatchEvent(event);
        },
        { name, canRemember },
      );
      await player.waitFor((state) => state.loads > before && !state.loading, `the drop of ${name}`);
    }

    const state = await player.state();
    expect(state.library.charts).toBe(2);
    expect(state.cursor?.folderPath).toEqual([]);

    const dialog = page.locator('#options-modal');
    await page.locator('[data-service-header="settings"]').click();
    await dialog.getByRole('tab', { name: 'Library', exact: true }).click();
    const folders = dialog.locator('[data-remembered-folder-manager]');
    await expect(folders.getByText('First pack', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(folders.getByText('Second pack', { exact: true })).toBeVisible();
    if (canRemember) {
      await expect(folders.getByRole('button', { name: 'Remove First pack' })).toBeVisible();
      if (mode === 'worker-transfer-fails') {
        await page.addInitScript(() => {
          const originalPost = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage')!
            .value as Worker['postMessage'];
          Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
            if (typeof message === 'object' && message !== null && 'folder' in message) {
              throw new DOMException('Could not transfer the directory handle', 'DataCloneError');
            }
            Reflect.apply(originalPost, this, [message, ...args]);
          };
        });
      }
      if (mode === 'remembered') {
        await page.waitForFunction(async () => {
          const name = 'be-music-folder-snapshots';
          if (!(await indexedDB.databases()).some((database) => database.name === name)) return false;
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const open = indexedDB.open(name);
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
          });
          try {
            return await new Promise<boolean>((resolve, reject) => {
              const count = database.transaction('snapshots', 'readonly').objectStore('snapshots').count();
              count.onsuccess = () => resolve(count.result === 2);
              count.onerror = () => reject(count.error);
            });
          } finally {
            database.close();
          }
        });
      }
      let releaseWalk: () => void = () => {};
      if (mode === 'remembered') {
        const walk = new Promise<void>((resolve) => {
          releaseWalk = resolve;
        });
        await page.route('**/assets/folder-listing-worker-*.js', async (route) => {
          await walk;
          await route.continue();
        });
      }
      try {
        await page.reload();
        const first = await player.waitFor(
          (state) => state.scene.kind === 'select',
          'the first select screen after reload',
        );
        if (mode === 'remembered') expect(first.library.charts).toBe(2);
      } finally {
        releaseWalk();
      }
      await page.locator('[data-service-header="settings"]').click();
      await dialog.getByRole('tab', { name: 'Library', exact: true }).click();
      await expect(folders.getByText('First pack', { exact: true })).toBeVisible();
      await expect(folders.getByText('Second pack', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await player.state()).library.charts, { timeout: 5_000 }).toBe(2);
      const selected = await player.openFolder('First pack');
      expect(selected.cursor?.bar).toMatchObject({ kind: 'chart', title: 'First pack' });
    } else {
      await expect(folders.getByRole('heading', { name: 'Folders loaded for this visit' })).toBeVisible();
      await expect(folders.getByRole('button', { name: 'Remove First pack' })).toHaveCount(0);
    }
  });
}
