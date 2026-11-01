import { expect, openWithLibrary, SMOKE, test } from './support.ts';

test('native screens browse, search, play, show results and switch back to Canvas', SMOKE, async ({ player }, info) => {
  await openWithLibrary(player, { 'be-music.built-in-skin': 'native' });
  const { page } = player;
  await player.setOption(['Developer'], 'Judgment windows', '????');
  const select = page.locator('[data-be-music-screen="select"]');
  await expect(select.getByRole('heading', { name: 'Collection' })).toBeVisible();
  await expect(page.locator('#search')).toBeHidden();
  const search = select.getByRole('searchbox', { name: 'Search charts' });
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await search.fill('Fixture A');
  await expect(select.getByRole('button', { name: /Fixture A/ })).toHaveCount(1);
  await search.press('Enter');
  expect((await player.state()).scene.kind).toBe('select');
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
  // The landscape HUD is the cabinet arrangement: the play information opens from its Info button.
  await hud.getByRole('button', { name: 'Info', exact: true }).click();
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
  await player.waitForResult(0);
  const replay = await player.lastReplay();
  expect(replay?.play.judgeRuleset).toBe('____');
  expect(replay?.results?.native?.ruleset).toBe('be-music/native');
  const result = page.locator('[data-be-music-screen="result"]');
  await expect(result.getByRole('heading', { name: 'Fixture A' })).toBeVisible();
  await expect(result.getByRole('img', { name: 'Gauge history' })).toBeVisible();
  await expect(hud).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('native-result.png') });
  for (let step = 0; step < 3 && (await player.state()).scene.kind === 'result'; step++) {
    await result.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(select).toHaveCount(1);
  await player.setOption(['Skin & display'], 'Built-in skin', 'Plain');
  await expect(page.locator('[data-be-music-screen]')).toHaveCount(0);
  await player.setOption(['Skin & display'], 'Built-in skin', 'Native (DOM + Canvas)');
  await expect(page.locator('[data-be-music-screen="select"]')).toHaveCount(1);
});

test('native collection fits a portrait screen and waits for IME composition to commit', async ({ player }, info) => {
  await player.page.setViewportSize({ width: 390, height: 844 });
  await openWithLibrary(player, { 'be-music.built-in-skin': 'native' });
  await expect(player.page.locator('html')).toHaveClass(/portrait-stage/);
  const screen = player.page.locator('[data-native-screen="select"]');
  const rows = screen.locator('.rows > li');
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  await rows.nth(0).getByRole('button').focus();
  await player.page.keyboard.press('ArrowDown');
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
  await player.page.screenshot({ path: info.outputPath('native-portrait.png') });
});

test('Native BGA canvases replace, overlay and hide POOR frames', async ({ player }, info) => {
  await openWithLibrary(player, { 'be-music.built-in-skin': 'native' });
  const samples = await player.page.evaluate(async () => {
    await customElements.whenDefined('be-music-bga');
    const image = (color: string, half = false) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(half ? 128 : 0, 0, half ? 128 : 256, 256);
      return canvas;
    };
    const bga = document.createElement('be-music-bga');
    bga.style.cssText = 'position:fixed;inset:0 auto auto 0;width:256px;height:256px;z-index:99999';
    bga.rect = { x: 0, y: 0, w: 256, h: 256 };
    document.body.append(bga);
    const base = image('red'),
      poor = image('lime', true);
    const samples = [];
    for (const mode of [0, 1, 2]) {
      bga.data = {
        shown: true,
        frame: { base, poor: mode === 2 ? undefined : poor, poorActive: mode !== 2, poorOverlays: mode === 1 },
      };
      await bga.updateComplete;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const canvas = bga.shadowRoot!.querySelector('canvas')!;
      const ctx = canvas.getContext('2d')!;
      const rgb = (x: number) =>
        Array.from(ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height / 2), 1, 1).data).slice(
          0,
          3,
        );
      samples.push({ mode, left: rgb(0.25), right: rgb(0.75) });
    }
    return samples;
  });
  expect(samples).toEqual([
    { mode: 0, left: [0, 0, 0], right: [0, 255, 0] },
    { mode: 1, left: [255, 0, 0], right: [0, 255, 0] },
    { mode: 2, left: [255, 0, 0], right: [255, 0, 0] },
  ]);
  await player.page.screenshot({ path: info.outputPath('native-bga-hidden.png') });
});
