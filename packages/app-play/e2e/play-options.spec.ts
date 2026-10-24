import { expect, openWithLibrary, SONGS, test } from './support.ts';

test('START BPM is selectable in Debug Menu, remembered and recorded in a play', async ({ player }) => {
  await openWithLibrary(player);
  await player.setOption(['Play options'], 'HS-FIX', 'STARTBPM');
  expect(await player.readOption(['Play options'], 'HS-FIX')).toBe('STARTBPM');
  expect(
    await player.page.evaluate(() => JSON.parse(localStorage.getItem('be-music.debug-menu-settings')!).settings.hsFix),
  ).toBe('STARTBPM');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  await player.waitForResult(0);
  const replay = await player.lastReplay();
  expect(replay?.play.view?.hsFix).toBe('STARTBPM');
  await player.page.reload();
  await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
  expect(await player.readOption(['Play options'], 'HS-FIX')).toBe('STARTBPM');
});

for (const skin of ['native', 'plain', 'lr2', 'beatoraja'] as const) {
  test(`persistent display-area information renders on ${skin}`, async ({ player }, info) => {
    await openWithLibrary(player, { 'be-music.built-in-skin': skin === 'native' ? 'native' : 'plain' });
    if (skin === 'lr2' || skin === 'beatoraja') {
      await player.drop(`skins/${skin}`);
      await player.waitFor((state) => state.scene.kind === 'select' && state.scene.family === skin, `${skin} select`);
    }
    await player.setOption(['Play options'], 'Display area info', 'ON');
    await player.setOption(['Play options'], 'Effect 1P', 'SUDDEN');
    await player.setOption(['Play options'], 'Lane cover', true);
    await player.setOption(['Play options'], 'Cover height', 0.25);
    await player.setOption(['Play options'], 'Auto play', true);
    await player.browseTo(SONGS, 'Fixture A');
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.1,
      'the chart to start',
    );
    await player.key('Space');
    await player.page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    if (skin === 'native') {
      const readout = player.page.locator('[data-display-area-info] [data-side="1P"][data-edge="sudden"]');
      await expect(readout).toBeVisible();
      await expect(readout).toContainText('SUD-LENGTH 250');
    }
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`display-area-${skin}.png`) });
  });
}
