import { expect, openWithLibrary, test } from './support.ts';

test('the header opens the Options dialog, with sections, Play options pages, hover help and read-only monitors', async ({
  player,
}, info) => {
  await openWithLibrary(player);
  const { page } = player;
  const dialog = page.locator('#options-modal');
  const settings = page.locator('[data-service-header="settings"]');
  await expect(dialog).toBeHidden();
  await settings.click();
  await expect(dialog).toBeVisible();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  // Nothing in it folds: every folder is a section.
  await expect(dialog.locator('details')).toHaveCount(0);
  // Play options splits its options into pages; Hi-speed sits on Hi-speed & view.
  await dialog.getByRole('tab', { name: 'Hi-speed & view', exact: true }).click();
  const hiSpeed = dialog.locator('.options-row[data-option-label="Hi-speed"]');
  await expect(hiSpeed).toBeVisible();
  // Its help button shows Help's entry while hovered.
  await hiSpeed.locator('.options-help').hover();
  const tip = page.locator('#options-help-tip');
  await expect(tip).toBeVisible();
  await expect(tip).not.toBeEmpty();
  await dialog.getByRole('tab', { name: 'Library', exact: true }).click();
  const status = dialog.locator('.status-row textarea');
  expect(await status.evaluate((element: HTMLTextAreaElement) => element.readOnly)).toBe(true);
  await dialog.getByRole('tab', { name: 'Developer', exact: true }).click();
  const graph = dialog.locator('.options-graph polyline');
  await expect(graph).toHaveAttribute('points', /\d/);
  expect(await graph.getAttribute('points')).not.toContain('NaN');
  await dialog.locator(':scope > div').screenshot({ path: info.outputPath('options.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
});

test('Options save immediately across reloads and reset cancels pending publication', async ({ player }) => {
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
    await player.page.evaluate(() => JSON.parse(localStorage.getItem('be-music.option-settings')!).settings.autoPlay),
  ).toBe(true);
  await player.page.reload();
  await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
  expect(await player.readOption(['Play options'], 'Auto play')).toBe(true);
  await player.page.evaluate(() => localStorage.setItem('be-music.chart-best-records', 'keep'));
  await player.setOption(['Play options'], 'Auto play', false);
  player.page.once('dialog', (dialog) => void dialog.accept());
  await Promise.all([player.page.waitForEvent('load'), player.pressOption(['Developer'], 'Reset settings and reload')]);
  await player.waitFor((state) => state.scene.kind === 'select', 'select after reset');
  await expect.poll(() => player.page.evaluate(() => localStorage.getItem('be-music.option-settings'))).toBeNull();
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
        'be-music-demo.option-settings',
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
