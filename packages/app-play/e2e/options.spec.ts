import { expect, openWithLibrary, test } from './support.ts';

test('native monitors stay read-only and folder persistence keeps the existing keys', async ({ player }, info) => {
  await openWithLibrary(player, {
    'be-music.debug-menu-folders': JSON.stringify({ Audio: false, Developer: true }),
  });
  const pane = player.page.locator('[data-pane=debug]');
  await expect(pane).not.toHaveClass(/tp-rotv-expanded/);
  await pane.locator(':scope > .tp-rotv_b').click();
  const status = pane.locator('.status-row textarea');
  expect(await status.evaluate((element: HTMLTextAreaElement) => element.readOnly)).toBe(true);
  const audioButton = pane.getByRole('button', { name: 'Audio', exact: true });
  await expect(audioButton.locator('..')).not.toHaveClass(/tp-fldv-expanded/);
  await audioButton.click();
  await expect(audioButton.locator('..')).toHaveClass(/tp-fldv-expanded/);
  const developer = pane.getByRole('button', { name: 'Developer', exact: true }).locator('..');
  await expect(developer).toHaveClass(/tp-fldv-expanded/);
  const graph = developer.locator('polyline');
  await expect(graph).toHaveAttribute('points', /\d/);
  expect(await graph.getAttribute('points')).not.toContain('NaN');
  const remembered = await player.page.evaluate(() => JSON.parse(localStorage.getItem('be-music.debug-menu-folders')!));
  expect(remembered.Audio).toBe(true);
  expect(remembered.Developer).toBe(true);
  expect(remembered['Debug Menu']).toBeUndefined();
  await developer.scrollIntoViewIfNeeded();
  await player.page.locator('.debug-pane-container').screenshot({ path: info.outputPath('debug-pane.png') });
});

test('Debug Menu saves immediately across reloads and reset cancels pending publication', async ({ player }) => {
  let remote: unknown;
  const methods: string[] = [];
  await player.page.route('**/api/player-settings', async (route) => {
    const method = route.request().method();
    methods.push(method);
    if (method === 'GET') {
      await route.fulfill(remote ? { json: remote } : { status: 204 });
      return;
    }
    const document = route.request().postDataJSON();
    remote = method === 'DELETE' ? { ...document, settings: {}, deleted: true } : document;
    await route.fulfill({ json: remote });
  });
  await player.page.goto('/?e2e=1');
  await player.waitFor((state) => state.scene.kind === 'select', 'initial select');
  await player.setOption(['Play options'], 'Auto play', true);
  expect(
    await player.page.evaluate(
      () => JSON.parse(localStorage.getItem('be-music.debug-menu-settings')!).settings.autoPlay,
    ),
  ).toBe(true);
  await player.page.reload();
  await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
  expect(await player.readOption(['Play options'], 'Auto play')).toBe(true);
  await player.page.evaluate(() => localStorage.setItem('be-music.chart-best-records', 'keep'));
  await player.setOption(['Play options'], 'Auto play', false);
  player.page.once('dialog', (dialog) => void dialog.accept());
  await Promise.all([player.page.waitForEvent('load'), player.pressOption(['Developer'], 'Reset settings and reload')]);
  await player.waitFor((state) => state.scene.kind === 'select', 'select after reset');
  await expect.poll(() => player.page.evaluate(() => localStorage.getItem('be-music.debug-menu-settings'))).toBeNull();
  expect(await player.readOption(['Play options'], 'Auto play')).toBe(false);
  expect(await player.page.evaluate(() => localStorage.getItem('be-music.chart-best-records'))).toBe('keep');
  expect(methods).toContain('DELETE');
  expect(remote).toMatchObject({ deleted: true, settings: {} });
});

for (const hasCurrentCourses of [false, true]) {
  test(`migrates former player storage and ${hasCurrentCourses ? 'preserves current' : 'copies saved'} courses`, async ({
    player,
  }) => {
    await player.page.route('**/api/player-settings', (route) => route.fulfill({ status: 204 }));
    await player.page.goto('/?e2e=1');
    await player.waitFor((state) => state.scene.kind === 'select', 'initial select');
    const result = await player.page.evaluate(async (hasCurrent) => {
      const oldCourses = { version: 0, lr2crs: '<courselist/>', titles: [], defaultConnection: 'cut' };
      const currentCourses = { ...oldCourses, defaultConnection: 'blank1' };
      const write = (name: string, value: unknown) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onupgradeneeded = () => request.result.createObjectStore('courses');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('courses', 'readwrite');
            transaction.objectStore('courses').put(value, 'made');
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
      await write('be-music-demo', oldCourses);
      if (hasCurrent) await write('be-music', currentCourses);
      localStorage.setItem(
        'be-music-demo.debug-menu-settings',
        JSON.stringify({ version: 0, updatedAt: Date.now(), settings: { autoPlay: true } }),
      );
      localStorage.setItem('be-music-demo.chart-best-records', 'saved records');
      return hasCurrent ? currentCourses : oldCourses;
    }, hasCurrentCourses);
    await player.page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after migration');
    expect(await player.readOption(['Play options'], 'Auto play')).toBe(true);
    expect(await player.page.evaluate(() => localStorage.getItem('be-music.chart-best-records'))).toBe('saved records');
    expect(
      await player.page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('be-music-demo.'))),
    ).toEqual([]);
    const readCourses = () =>
      player.page.evaluate(async () => {
        const read = (name: string) =>
          new Promise<unknown>((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const transaction = db.transaction('courses', 'readonly');
              const get = transaction.objectStore('courses').get('made');
              transaction.oncomplete = () => {
                db.close();
                resolve(get.result);
              };
              transaction.onabort = () => {
                db.close();
                reject(transaction.error);
              };
            };
          });
        return { current: await read('be-music'), previous: await read('be-music-demo') };
      });
    await expect.poll(readCourses).toEqual({ current: result, previous: undefined });
    await player.page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after second visit');
    expect(await readCourses()).toEqual({ current: result, previous: undefined });
  });
}
