import { expect, openWithLibrary, test } from './support.ts';

test('native monitors stay read-only and folder persistence keeps the existing keys', async ({ demo }, info) => {
  await openWithLibrary(demo, {
    'be-music-demo.debug-menu-folders': JSON.stringify({ Audio: false, Developer: true }),
  });
  const pane = demo.page.locator('[data-pane=debug]');
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
  const remembered = await demo.page.evaluate(() =>
    JSON.parse(localStorage.getItem('be-music-demo.debug-menu-folders')!),
  );
  expect(remembered.Audio).toBe(true);
  expect(remembered.Developer).toBe(true);
  expect(remembered['Debug Menu']).toBeUndefined();
  await developer.scrollIntoViewIfNeeded();
  await demo.page.locator('.debug-pane-container').screenshot({ path: info.outputPath('debug-pane.png') });
});

test('Debug Menu saves immediately across reloads and reset cancels pending publication', async ({ demo }) => {
  let remote: unknown;
  const methods: string[] = [];
  await demo.page.route('**/api/player-settings', async (route) => {
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
  await demo.page.goto('/?e2e=1');
  await demo.waitFor((state) => state.scene.kind === 'select', 'initial select');
  await demo.setOption(['Play options'], 'Auto play', true);
  expect(
    await demo.page.evaluate(
      () => JSON.parse(localStorage.getItem('be-music-demo.debug-menu-settings')!).settings.autoPlay,
    ),
  ).toBe(true);
  await demo.page.reload();
  await demo.waitFor((state) => state.scene.kind === 'select', 'select after reload');
  expect(await demo.readOption(['Play options'], 'Auto play')).toBe(true);
  await demo.page.evaluate(() => localStorage.setItem('be-music-demo.chart-best-records', 'keep'));
  await demo.setOption(['Play options'], 'Auto play', false);
  demo.page.once('dialog', (dialog) => void dialog.accept());
  await Promise.all([demo.page.waitForEvent('load'), demo.pressOption(['Developer'], 'Reset settings and reload')]);
  await demo.waitFor((state) => state.scene.kind === 'select', 'select after reset');
  await expect
    .poll(() => demo.page.evaluate(() => localStorage.getItem('be-music-demo.debug-menu-settings')))
    .toBeNull();
  expect(await demo.readOption(['Play options'], 'Auto play')).toBe(false);
  expect(await demo.page.evaluate(() => localStorage.getItem('be-music-demo.chart-best-records'))).toBe('keep');
  expect(methods).toContain('DELETE');
  expect(remote).toMatchObject({ deleted: true, settings: {} });
});
