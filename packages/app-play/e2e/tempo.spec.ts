import { expect, openWithLibrary, SONGS, test } from './support.ts';

const TEMPO = ['Tempo'];

test('defaults to WSOLA and bypasses a saved percentage until enabled', async ({ player }) => {
  await openWithLibrary(player, {
    'be-music.play-tempo': JSON.stringify({ tempoPercent: 20 }),
  });
  expect(await player.readOption(TEMPO, 'Enabled')).toBe(false);
  expect(await player.readOption(TEMPO, 'Keep-pitch stretcher')).toBe('WSOLA');
  const algorithms = await player.page
    .locator('[data-pane=debug] .tp-lblv')
    .filter({ hasText: 'Keep-pitch stretcher' })
    .locator('option')
    .allTextContents();
  expect(algorithms).toEqual(['WSOLA', 'Signalsmith Stretch']);
  await player.setOption(TEMPO, 'Enabled', true);
  await player.setOption(TEMPO, 'Enabled', false);
  expect(await player.readOption(TEMPO, 'Tempo (%)')).toBe(20);
  expect(await player.page.evaluate(() => JSON.parse(localStorage.getItem('be-music.play-tempo')!))).toMatchObject({
    tempoEnabled: false,
    tempoPercent: 20,
    tempoStretchAlgorithm: 'wsola',
  });
  await player.setOption(['Play options'], 'Auto play', true);
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  const state = await player.waitFor((current) => current.scene.kind === 'play', 'play at the original tempo');
  expect(state.play?.tempo).toBe(1);
  expect(state.status).toBe('Playing: Fixture A');
  expect(await player.optionEnabled(TEMPO, 'Enabled')).toBe(false);
  expect(await player.optionEnabled(TEMPO, 'Tempo (%)')).toBe(false);
  await player.waitForResult(0);
  expect(await player.optionEnabled(TEMPO, 'Enabled')).toBe(true);
  await player.setOption(TEMPO, 'Enabled', true);
  expect(await player.readOption(TEMPO, 'Tempo (%)')).toBe(20);
  expect(await player.page.evaluate(() => JSON.parse(localStorage.getItem('be-music.play-tempo')!))).toMatchObject({
    tempoEnabled: true,
    tempoPercent: 20,
  });
});
