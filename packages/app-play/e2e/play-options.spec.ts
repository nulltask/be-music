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
