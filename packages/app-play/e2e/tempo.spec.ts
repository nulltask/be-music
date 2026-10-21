import { expect, openWithLibrary, SONGS, test } from './support.ts';

const TEMPO = ['Tempo'];

test('defaults to WSOLA and bypasses a saved percentage until enabled', async ({ demo }) => {
  await openWithLibrary(demo, {
    'be-music-demo.play-tempo': JSON.stringify({ tempoPercent: 20 }),
  });
  expect(await demo.readOption(TEMPO, 'Enabled')).toBe(false);
  expect(await demo.readOption(TEMPO, 'Keep-pitch stretcher')).toBe('WSOLA');
  const algorithms = await demo.page
    .locator('[data-pane=debug] .tp-lblv')
    .filter({ hasText: 'Keep-pitch stretcher' })
    .locator('option')
    .allTextContents();
  expect(algorithms).toEqual(['WSOLA', 'Signalsmith Stretch']);
  await demo.setOption(TEMPO, 'Enabled', true);
  await demo.setOption(TEMPO, 'Enabled', false);
  expect(await demo.readOption(TEMPO, 'Tempo (%)')).toBe(20);
  expect(await demo.page.evaluate(() => JSON.parse(localStorage.getItem('be-music-demo.play-tempo')!))).toMatchObject({
    tempoEnabled: false,
    tempoPercent: 20,
    tempoStretchAlgorithm: 'wsola',
  });
  await demo.setOption(['Play options'], 'Auto play', true);
  await demo.browseTo(SONGS, 'Fixture A');
  await demo.key('Enter');
  const state = await demo.waitFor((current) => current.scene.kind === 'play', 'play at the original tempo');
  expect(state.play?.tempo).toBe(1);
  expect(state.status).toBe('Playing: Fixture A');
  expect(await demo.optionEnabled(TEMPO, 'Enabled')).toBe(false);
  expect(await demo.optionEnabled(TEMPO, 'Tempo (%)')).toBe(false);
  await demo.waitForResult(0);
  expect(await demo.optionEnabled(TEMPO, 'Enabled')).toBe(true);
  await demo.setOption(TEMPO, 'Enabled', true);
  expect(await demo.readOption(TEMPO, 'Tempo (%)')).toBe(20);
  expect(await demo.page.evaluate(() => JSON.parse(localStorage.getItem('be-music-demo.play-tempo')!))).toMatchObject({
    tempoEnabled: true,
    tempoPercent: 20,
  });
});
