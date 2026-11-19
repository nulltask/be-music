import { expect, test } from './support.ts';

for (const slowSource of ['Bemuse server', 'saved folder', 'difficulty table'] as const) {
  test(`restores the other library sources while a ${slowSource} is still loading`, async ({ player: { page } }) => {
    const server = 'https://startup-bemuse.example';
    const table = 'https://startup-table.example/header.json';
    const chart = (title: string) => `#TITLE ${title}\n#BPM 120\n#WAV01 key.wav\n#00111:01\n`;

    await page.route('**/__startup-seed', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }),
    );
    await page.goto('/__startup-seed');
    await page.evaluate(
      async ({ settings, text }) => {
        for (const [key, value] of Object.entries(settings)) localStorage.setItem(key, value);
        const root = await navigator.storage.getDirectory();
        const folder = await root.getDirectoryHandle('Saved charts', { create: true });
        const file = await folder.getFileHandle('saved.bms', { create: true });
        const writer = await file.createWritable();
        await writer.write(text);
        await writer.close();
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('be-music-folders', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('folders');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('folders', 'readwrite');
            transaction.objectStore('folders').put([folder], 'last');
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onabort = () => {
              db.close();
              reject(transaction.error);
            };
          };
        });
      },
      {
        settings: {
          'be-music.bemuse-server-urls': JSON.stringify([`${server}/index.json`]),
          'be-music.course-table-urls': JSON.stringify([table]),
          'be-music.render-resolution': '1',
        },
        text: chart('Saved chart'),
      },
    );

    let release!: () => void;
    const slowRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${server}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const headers = { 'access-control-allow-origin': '*' };
      if (path === '/index.json') {
        if (slowSource === 'Bemuse server') await slowRead;
        await route.fulfill({
          headers,
          json: { songs: [{ path: 'song', bemusepack_url: null, charts: [{ file: 'server.bms' }] }] },
        });
      } else if (path === '/song/server.bms') {
        await route.fulfill({ headers, body: chart('Bemuse chart') });
      } else {
        await route.fulfill({ headers, status: 404 });
      }
    });
    await page.route('**/assets/folder-listing-worker-*.js', async (route) => {
      if (slowSource === 'saved folder') await slowRead;
      await route.continue();
    });
    await page.route('**/__url-load-proxy?**', async (route) => {
      if (new URL(route.request().url()).searchParams.get('url') !== table) {
        await route.fulfill({ status: 404 });
        return;
      }
      if (slowSource === 'difficulty table') await slowRead;
      await route.fulfill({ json: { name: 'Startup Table', course: [[{ name: 'Dan', md5: ['a'.repeat(32)] }]] } });
    });
    await page.route('**/api/player-settings', (route) => route.fulfill({ status: 204 }));

    const library = () => page.evaluate(() => window.__beMusicTest?.state().library);
    try {
      await page.goto('/?e2e=1');
      if (slowSource === 'difficulty table') {
        await expect.poll(async () => (await library())?.charts, { timeout: 8_000 }).toBe(2);
        expect((await library())?.courseFolders).not.toContain('Startup Table');
      } else {
        await expect
          .poll(library, { timeout: 8_000 })
          .toEqual({ charts: 1, courseFolders: expect.arrayContaining(['Startup Table']) });
      }
      await expect.poll(() => page.evaluate(() => window.__beMusicTest?.state().scene.kind)).toBe('select');
    } finally {
      release();
    }
    await expect.poll(library).toEqual({ charts: 2, courseFolders: expect.arrayContaining(['Startup Table']) });
  });
}
