import { expect, test } from './support.ts';

test('starts the default Bemuse library when the saved server list is malformed', async ({ player }) => {
  const { page } = player;
  const official = 'https://music4.bemuse.ninja/server/';
  await page.route('**/api/player-settings', (route) => route.fulfill({ status: 204 }));
  await page.route('**/__url-load-proxy?**', (route) => route.fulfill({ status: 404 }));
  await page.route(/^https:\/\/(?:flicknote\.bemuse\.ninja|yuinore\.net)\//, (route) =>
    route.fulfill({ headers: { 'access-control-allow-origin': '*' }, status: 404 }),
  );
  await page.route(`${official}**`, (route) => {
    const headers = { 'access-control-allow-origin': '*' };
    return route.request().url() === `${official}index.json`
      ? route.fulfill({
          headers,
          json: { songs: [{ path: 'song', bemusepack_url: null, charts: [{ file: 'chart.bms' }] }] },
        })
      : route.fulfill({ headers, body: '#TITLE Restored chart\n#BPM 120\n#WAV01 key.wav\n#00111:01\n' });
  });
  await player.open({ 'be-music.bemuse-server-urls': '{' });
  await expect.poll(async () => (await player.state()).library.charts, { timeout: 5_000 }).toBe(1);
  const dropCard = page.locator('.drop-card');
  await expect(dropCard).toBeVisible();
  await dropCard.getByRole('button', { name: 'Close drop card' }).press('Enter');
  await expect(dropCard).toBeHidden();
  expect((await player.state()).scene.kind).toBe('select');
});

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
      if (slowSource === 'saved folder') {
        await page.locator('[data-service-header="settings"]').click();
        const dialog = page.locator('#options-modal');
        await dialog.getByRole('tab', { name: 'Library', exact: true }).click();
        await expect(dialog.getByText('Saved charts', { exact: true })).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      release();
    }
    await expect.poll(library).toEqual({ charts: 2, courseFolders: expect.arrayContaining(['Startup Table']) });
  });
}

test('shows the cached library first and suspends refreshes during gameplay', async ({ player }) => {
  const { page } = player;
  const servers = ['https://first-bemuse.example', 'https://second-bemuse.example'];
  const table = 'https://startup-table.example/header.json';
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reloading = false;
  let indexRequests = 0;
  let tableRequests = 0;
  let aborted = 0;
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (
      request.failure()?.errorText === 'net::ERR_ABORTED' &&
      ((servers.includes(url.origin) && url.pathname === '/index.json') || url.searchParams.get('url') === table)
    ) {
      aborted += 1;
    }
  });
  await page.route('https://*-bemuse.example/**', async (route) => {
    const url = new URL(route.request().url());
    const first = url.origin === servers[0];
    const title = first ? 'First chart' : 'Second chart';
    const headers = { 'access-control-allow-origin': '*' };
    if (url.pathname === '/index.json') {
      if (reloading) {
        indexRequests += 1;
        await paused;
      }
      const charts = [{ file: 'main.bms' }];
      if (reloading && first) charts.push({ file: 'new.bms' });
      if (route.request().failure() === null) {
        await route.fulfill({ headers, json: { songs: [{ path: 'song', bemusepack_url: null, charts }] } });
      }
    } else if (url.pathname.endsWith('.bms')) {
      await route.fulfill({
        headers,
        body: `#TITLE ${url.pathname.endsWith('new.bms') ? 'New chart' : title}\n#BPM 120\n#WAV01 key.wav\n#00111:01\n#01611:01\n`,
      });
    } else {
      await route.fulfill({ headers, status: 404 });
    }
  });
  await page.route('**/__url-load-proxy?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('url') !== table) {
      await route.fulfill({ status: 404 });
      return;
    }
    if (reloading) {
      tableRequests += 1;
      await paused;
    }
    if (route.request().failure() === null) {
      await route.fulfill({ json: { name: 'Saved Table', course: [[{ name: 'Dan', md5: ['a'.repeat(32)] }]] } });
    }
  });
  await page.route('**/api/player-settings', (route) => route.fulfill({ status: 204 }));
  await player.open({
    'be-music.bemuse-server-urls': JSON.stringify(servers.map((url) => `${url}/index.json`)),
    'be-music.course-table-urls': JSON.stringify([table]),
  });
  await expect
    .poll(async () => (await player.state()).library)
    .toEqual({
      charts: 2,
      courseFolders: expect.arrayContaining(['Saved Table']),
    });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open('be-music-remote-v1');
        return (await cache.keys()).filter((request) =>
          new URL(request.url).searchParams.get('key')?.startsWith('bemuse-library-v1:'),
        ).length;
      }),
    )
    .toBe(2);

  try {
    reloading = true;
    await page.reload();
    const first = await player.waitFor((state) => state.scene.kind === 'select', 'the first select screen', 10_000);
    expect(first.library.charts).toBe(2);
    expect(first.library.courseFolders).toContain('Saved Table');
    await expect.poll(() => indexRequests).toBe(2);
    await expect.poll(() => tableRequests).toBe(1);
    const selected = await player.openFolder('Bemuse first-bemuse.example');
    expect(selected.cursor?.bar).toMatchObject({ kind: 'chart', title: 'First chart' });
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play', 'the cached chart to start playing', 15_000);
    await expect.poll(() => aborted).toBe(3);
    release();
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.5,
      'the chart to play',
      15_000,
    );
    expect(indexRequests).toBe(2);
    expect(tableRequests).toBe(1);
    expect((await player.state()).library.charts).toBe(2);

    await player.key('Escape');
    const afterPlay = await player.waitFor(
      (state) => state.scene.kind === 'result' || state.scene.kind === 'select',
      'the play to end',
      15_000,
    );
    if (afterPlay.scene.kind === 'result') await player.leaveResult();
    await player.waitFor((state) => state.scene.kind === 'select', 'the select screen to return');
    await expect.poll(() => indexRequests).toBe(4);
    await expect.poll(() => tableRequests).toBe(2);
  } finally {
    release();
  }
  await expect.poll(async () => (await player.state()).library.charts).toBe(3);
  expect((await player.state()).cursor?.bar).toMatchObject({ kind: 'chart', title: 'First chart' });
});
