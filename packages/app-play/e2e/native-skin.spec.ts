import { expect, openWithLibrary, test } from './support.ts';

test('native screens browse, search, play, show results and switch back to Canvas', async ({ demo }, info) => {
  await openWithLibrary(demo, { 'be-music-demo.built-in-skin': 'native' });
  const { page } = demo;
  await demo.setOption(['Developer'], 'Judgment windows', '????');
  const select = page.locator('[data-be-music-screen="select"]');
  await expect(select.getByRole('heading', { name: 'Collection' })).toBeVisible();
  await expect(page.locator('#search')).toBeHidden();
  const search = select.getByRole('searchbox', { name: 'Search charts' });
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await search.fill('Fixture A');
  await expect(select.getByRole('button', { name: /Fixture A/ })).toHaveCount(1);
  await search.press('Enter');
  expect((await demo.state()).scene.kind).toBe('select');
  await select.getByRole('combobox', { name: 'Gauge', exact: true }).selectOption('HARD');
  await expect(select.getByRole('combobox', { name: 'Gauge', exact: true })).toHaveValue('HARD');
  await page.screenshot({ path: info.outputPath('native-select.png') });
  await select.getByRole('button', { name: 'Auto play', exact: true }).click();
  const hud = page.locator('[data-be-music-screen="gameplay"]');
  await expect(hud.getByRole('heading', { name: 'Fixture A' })).toBeVisible();
  await expect(select).toHaveCount(0);
  // The meter is named after the gauge chosen above.
  await expect(hud.getByRole('meter', { name: 'HARD' }).first()).toBeVisible();
  await hud.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(hud.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(hud.locator('be-music-play-settings')).toContainText('????');
  await expect(hud.locator('be-music-play-settings')).not.toContainText('____');
  // Checked while paused, before the short chart ends. No stage-sized canvas: each part of the playfield, BGA
  // included, draws on a canvas of its own.
  await expect(page.locator('canvas[aria-label="be-music stage"]')).toHaveCount(0);
  for (const part of ['be-music-bga', 'be-music-lanes', 'be-music-notes', 'be-music-judge-line']) {
    await expect(hud.locator(`${part} canvas`)).toBeAttached();
  }
  const lanes = await hud.locator('be-music-lanes').boundingBox();
  const stageBox = await page.locator('#stage').boundingBox();
  expect(lanes!.width).toBeLessThan(stageBox!.width / 2);
  await page.screenshot({ path: info.outputPath('native-play-paused.png') });
  await hud.getByRole('button', { name: 'Resume', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(hud.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('native-play.png') });
  await demo.waitForResult(0);
  const replay = await demo.lastReplay();
  expect(replay?.play.judgeRuleset).toBe('____');
  expect(replay?.results?.native?.ruleset).toBe('be-music/native');
  const result = page.locator('[data-be-music-screen="result"]');
  await expect(result.getByRole('heading', { name: 'Fixture A' })).toBeVisible();
  await expect(result.getByRole('img', { name: 'Gauge history' })).toBeVisible();
  await expect(hud).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('native-result.png') });
  for (let step = 0; step < 3 && (await demo.state()).scene.kind === 'result'; step++) {
    await result.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(select).toHaveCount(1);
  await demo.setOption(['Skin & display'], 'Built-in skin', 'Plain');
  await expect(page.locator('[data-be-music-screen]')).toHaveCount(0);
  await demo.setOption(['Skin & display'], 'Built-in skin', 'Native (DOM + Canvas)');
  await expect(page.locator('[data-be-music-screen="select"]')).toHaveCount(1);
});

test('native collection fits a portrait screen and waits for IME composition to commit', async ({ demo }, info) => {
  await demo.page.setViewportSize({ width: 390, height: 844 });
  await openWithLibrary(demo, { 'be-music-demo.built-in-skin': 'native' });
  await expect(demo.page.locator('html')).toHaveClass(/portrait-stage/);
  const screen = demo.page.locator('[data-native-screen="select"]');
  const rows = screen.locator('.rows > li');
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  await rows.nth(0).getByRole('button').focus();
  await demo.page.keyboard.press('ArrowDown');
  await expect(rows.nth(1).getByRole('button')).toBeFocused();
  const search = screen.getByRole('searchbox', { name: 'Search charts' });
  await search.focus();
  await search.evaluate((element: HTMLInputElement) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.value = 'Fixture A';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  await expect(rows).toHaveCount(count);
  await search.evaluate((element) => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect(rows).toHaveCount(1);
  expect(await screen.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await demo.page.screenshot({ path: info.outputPath('native-portrait.png') });
});
