import { expect, openWithLibrary, test } from './support.ts';

test('the header opens the Options dialog, with sections, Play options pages, hover help and read-only monitors', async ({
  player,
}, info) => {
  await openWithLibrary(player);
  const { page } = player;
  const dialog = page.locator('#options-modal');
  const settings = page.locator('[data-service-header="settings"]');
  await expect(dialog).not.toHaveAttribute('open');
  await expect(dialog.locator(':scope > div')).toBeHidden();
  await settings.click();
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.locator(':scope > div')).toBeVisible();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  // Nothing in it folds: every folder is a section.
  await expect(dialog.locator('details')).toHaveCount(0);
  // Hi-speed sits on the View tab's first page, Hi-speed.
  await dialog.getByRole('tab', { name: 'View', exact: true }).click();
  const hiSpeed = dialog
    .locator('.options-row[data-option-label="Hi-speed"]')
    .filter({ has: page.locator('input[type="number"]') });
  await expect(hiSpeed).toBeVisible();
  // Its help button shows Help's entry while hovered.
  await hiSpeed.locator('.options-help').hover();
  const tip = page.locator('#options-help-tip');
  await expect(tip).toBeVisible();
  await expect(tip).not.toBeEmpty();
  await dialog.getByRole('tab', { name: 'Library', exact: true }).click();
  const status = dialog.locator('.status-row textarea');
  expect(await status.evaluate((element: HTMLTextAreaElement) => element.readOnly)).toBe(true);
  await dialog.getByRole('tab', { name: 'Advanced', exact: true }).click();
  const graph = dialog.locator('.options-graph polyline');
  await expect(graph).toHaveAttribute('points', /\d/);
  expect(await graph.getAttribute('points')).not.toContain('NaN');
  await dialog.locator(':scope > div').screenshot({ path: info.outputPath('options.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open');
  await expect(dialog.locator(':scope > div')).toBeHidden();
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
  await Promise.all([player.page.waitForEvent('load'), player.pressOption(['Advanced'], 'Reset settings and reload')]);
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

test('editing a number preserves its control and help while synchronizing the slider', async ({ player }) => {
  await player.open();
  const { page } = player;
  await page.locator('[data-service-header="settings"]').click();
  const dialog = page.locator('#options-modal');
  await dialog.getByRole('tab', { name: 'View', exact: true }).click();
  const row = dialog
    .locator('.options-row[data-option-label="Hi-speed"]')
    .filter({ has: page.locator('input[type="number"]') });
  const field = row.locator('input[type="number"]');
  const original = await field.elementHandle();
  await field.fill('3.14');
  await field.dispatchEvent('change');
  await expect(field).toHaveValue('3.1');
  await expect(field).toBeFocused();
  expect(await field.evaluate((current, previous) => current === previous, original)).toBe(true);
  await expect(row.locator('input[type="range"]')).toHaveValue('3.1');
  await expect(row.locator('.options-help')).toHaveCount(1);
  // A slider edit updates the same number field, even while the field still has focus.
  await row.locator('input[type="range"]').evaluate((range: HTMLInputElement) => {
    range.value = '4.2';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(field).toHaveValue('4.2');
  await expect(field).toBeFocused();
  await row.locator('.options-help').hover();
  await expect(page.locator('#options-help-tip')).toBeVisible();
});

test('acknowledgements load on demand and render package metadata as text', async ({ player }) => {
  let requests = 0;
  await player.page.route('**/acknowledgements.json', async (route) => {
    requests++;
    await route.fulfill({
      json: [{ name: '<img src=x onerror=alert(1)>', version: '1.0', license: 'MIT', licenseText: '<license>' }],
    });
  });
  await player.open();
  expect(requests).toBe(0);
  await player.page.locator('[data-service-header="help"]').click();
  await player.page.locator('#help-tab-oss').click();
  const list = player.page.locator('#help-oss-list');
  await expect(list.locator('.ack-card-name')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(list.locator('img')).toHaveCount(0);
  await list.locator('summary').click();
  await expect(list.locator('pre')).toHaveText('<license>');
  await player.page.locator('#help-tab-usage').click();
  await player.page.locator('#help-tab-oss').click();
  expect(requests).toBe(1);
  await expect(list.locator('details')).toHaveAttribute('open', '');
});

test('language changes preserve inputs, help controls and selected tabs', async ({ player }) => {
  await player.open();
  const { page } = player;
  await page.locator('[data-service-header="settings"]').click();
  const dialog = page.locator('#options-modal');
  await dialog.getByRole('tab', { name: 'View', exact: true }).click();
  const row = dialog
    .locator('.options-row[data-option-label="Hi-speed"]')
    .filter({ has: page.locator('input[type="number"]') });
  const field = row.locator('input[type="number"]');
  const original = await field.elementHandle();
  await field.fill('3.14');
  // Simulate a preference update while an editor is focused, without moving focus to the header.
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('#language-menu a[lang="ja"]')!.click());
  await expect(dialog.getByRole('tab', { name: '表示', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(field).toHaveValue('3.14');
  await expect(field).toBeFocused();
  expect(await field.evaluate((current, previous) => current === previous, original)).toBe(true);
  await expect(page.locator('.drop-title').first()).toHaveText('ドロップして読み込む');
  await expect(page.locator('footer.service-page-footer nav')).toHaveAttribute('aria-label', 'サービス');
  await expect(row.locator('.options-help')).toHaveCount(1);
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('#language-menu a[lang="en"]')!.click());
  await expect(dialog.getByRole('tab', { name: 'View', exact: true })).toHaveAttribute('aria-selected', 'true');
  await field.dispatchEvent('change');
  await expect(field).toHaveValue('3.1');
  await row.locator('.options-help').hover();
  await expect(page.locator('#options-help-tip')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Keys', exact: true }).click();
  const lane = dialog.locator('.options-row[data-option-label="1P key 1"]');
  await lane.locator('button.options-key').click();
  await expect(lane.locator('button.options-key')).toContainText('Press a key');
  await page.keyboard.press('Escape');
  await expect(lane.locator('button.options-key')).not.toContainText('Press a key');
  await expect(dialog).toHaveAttribute('open', '');
});

test('header updates retain the language popover and focused controls', async ({ player }) => {
  await player.open();
  const { page } = player;
  const language = page.locator('[popovertarget="language-menu"]');
  const original = await language.elementHandle();
  await language.click();
  await expect(page.locator('#language-menu')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
  await expect(page.locator('[data-service-header="install"]')).toBeVisible();
  expect(await language.evaluate((current, previous) => current === previous, original)).toBe(true);
  await expect(page.locator('#language-menu')).toBeVisible();
  await expect(language).toBeFocused();
  await page.locator('#language-menu a[lang="ja"]').click();
  await expect(language).toHaveAttribute('aria-label', '言語: 日本語');
  await expect(page.locator('.drop-title').first()).toHaveText('ドロップして読み込む');
  await expect(page.locator('footer.service-page-footer nav')).toHaveAttribute('aria-label', 'サービス');
  await page.locator('[data-service-header="settings"]').click();
  await expect(page.locator('#options-modal').getByRole('tab', { name: 'プレイ', exact: true })).toBeVisible();
});
